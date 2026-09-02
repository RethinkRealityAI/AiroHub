/**
 * Launch input/output validator suite.
 *
 * Everything here sits on a boundary the app cannot control: the browser on one
 * side (`lib/validate.ts`, `lib/ua.ts`), a settings table anyone with SQL access can
 * edit (`lib/flags.ts`), and a language model on the other (`lib/sanitize.ts`). Each
 * check encodes a specific thing that goes wrong when the boundary is trusted:
 *
 *  A  `normalisePath` folds room codes to `:room`. Skip it and every throwaway
 *     session becomes its own row in "top pages", and a shareable room URL is
 *     stored in a table that is meant to be anonymous.
 *  B  `referrerHost` keeps a host and nothing else — including Reddit's
 *     android-app referrer, which is the launch's most valuable source and is
 *     not a web URL. A full referrer would store search queries and DM links.
 *  C  `validateTrack` bounds the batch: 25 events in, 20 stored, 5 dropped, and
 *     the count is reported rather than the truncation being silent.
 *  D  `validateFeedback` enforces the bounds the table's CHECK constraints also
 *     enforce — here, where a violation is a 400 instead of a 500 — and the
 *     honeypot answers like a success so bots keep filling it.
 *  E  `deviceFromUa` puts bots BEFORE tablets BEFORE mobiles. Googlebot's
 *     smartphone crawler says both "Googlebot" and "Mobile"; get the order
 *     wrong and launch traffic looks twice as good as it was.
 *  F  `mergeFlags` coerces per field. A stored `"false"` is truthy and would
 *     switch the AI panel on for everybody; a `dailyCap` of `"none"` makes
 *     every comparison false and uncaps the spend.
 *  G  `publicSubset` never leaks `ai` — publishing the daily budget tells a
 *     visitor exactly how many requests exhaust it.
 *  H  `visitorHash` is deterministic per salt and separates on every input, so
 *     a day's uniques are real and yesterday's cannot be recomputed.
 *  I  the AI sanitizers replace any invalid field with the curated fallback's
 *     value, so a `javascript:` "colour" never reaches a style attribute and
 *     the result is always complete.
 *
 * Runs headless: bundles the five pure modules with esbuild. No Netlify, no
 * database, no network.
 */
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airo-launch-'));
const fn = (name) => JSON.stringify(path.join(repo, 'netlify/functions', name));

// One entry so every module shares the bundle, exactly like realtime-reconnect.
const entryFile = path.join(outDir, 'entry.ts');
fs.writeFileSync(
  entryFile,
  [
    `export * from ${fn('lib/validate.ts')};`,
    `export * from ${fn('lib/ua.ts')};`,
    `export * from ${fn('lib/flags.ts')};`,
    `export * from ${fn('lib/sanitize.ts')};`,
    `export { DEFAULT_FLAGS, TRACK_MAX_BATCH, TRACK_MAX_PROPS_BYTES, NOTICE_MAX, AI_DAILY_CAP_MAX } from ${JSON.stringify(
      path.join(repo, 'src/api/contracts.ts')
    )};`,
  ].join('\n')
);

const bundle = path.join(outDir, 'validators.mjs');
await build({
  entryPoints: [entryFile],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundle,
  logLevel: 'error',
  external: ['node:crypto'],
});

const {
  normalisePath,
  referrerHost,
  normaliseRoomId,
  validateTrack,
  validateFeedback,
  visitorHash,
  deviceFromUa,
  mergeFlags,
  publicSubset,
  sanitizeConcept,
  sanitizeStyle,
  sanitizeCritique,
  hex,
  str,
  glyph,
  num,
  hexes,
  DEFAULT_FLAGS,
  TRACK_MAX_BATCH,
  TRACK_MAX_PROPS_BYTES,
  NOTICE_MAX,
  AI_DAILY_CAP_MAX,
} = await import(pathToFileURL(bundle).href);

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

/* ------------------------------------------------------------------
   A — normalisePath
   ------------------------------------------------------------------ */
{
  const cases = [
    ['/canvas/AB12CD', '/canvas/:room'],
    ['/canvas/ab12cd?utm_source=reddit', '/canvas/:room'],
    ['/canvas/AB12CD#tools', '/canvas/:room'],
    ['/controller/XYZ789', '/controller/:room'],
    ['/controller/X', '/controller/:room'],
    ['/', '/'],
    ['/how-it-works', '/how-it-works'],
    ['/how-it-works/', '/how-it-works/'],
    ['?only=query', '/'],
    ['', '/'],
    ['   ', '/'],
    ['how-it-works', '/how-it-works'],
    ['/admin/review', '/admin/review'],
  ];
  const wrong = cases.filter(([input, want]) => normalisePath(input) !== want);
  check(
    'A room codes fold to :room, query and hash are dropped',
    wrong.length === 0,
    wrong.length ? JSON.stringify(wrong.map(([i, w]) => [i, w, normalisePath(i)])) : `${cases.length} cases`
  );

  check(
    'A a canvas path never leaks the room code',
    !normalisePath('/canvas/SECRET99').includes('SECRET'),
    normalisePath('/canvas/SECRET99')
  );

  const long = normalisePath(`/${'x'.repeat(500)}`);
  check('A paths are capped at 200 characters', long.length === 200, `length=${long.length}`);

  const nonStrings = [undefined, null, 42, {}, []].map((v) => normalisePath(v));
  check(
    'A non-strings become /',
    nonStrings.every((v) => v === '/'),
    JSON.stringify(nonStrings)
  );

  check(
    'A control characters are stripped',
    normalisePath('/how\u0000-it\u001f-works') === '/how-it-works',
    JSON.stringify(normalisePath('/how\u0000-it\u001f-works'))
  );
}

/* ------------------------------------------------------------------
   B — referrerHost
   ------------------------------------------------------------------ */
{
  const cases = [
    ['https://www.reddit.com/r/webgames/comments/abc/title/', 'airohub.netlify.app', 'reddit.com'],
    ['https://old.reddit.com/r/x', 'airohub.netlify.app', 'old.reddit.com'],
    ['https://redd.it/1abc2de', 'airohub.netlify.app', 'redd.it'],
    ['android-app://com.reddit.frontpage', 'airohub.netlify.app', 'com.reddit.frontpage'],
    ['android-app://com.reddit.frontpage/', 'airohub.netlify.app', 'com.reddit.frontpage'],
    ['https://news.ycombinator.com/item?id=1', 'airohub.netlify.app', 'news.ycombinator.com'],
    ['https://airohub.netlify.app/how-it-works', 'airohub.netlify.app', ''],
    ['https://www.airohub.netlify.app/', 'airohub.netlify.app', ''],
    ['https://airohub.netlify.app/', 'www.airohub.netlify.app', ''],
    ['not a url at all', 'airohub.netlify.app', ''],
    ['', 'airohub.netlify.app', ''],
    ['javascript:alert(1)', 'airohub.netlify.app', ''],
    [null, 'airohub.netlify.app', ''],
    ['https://EXAMPLE.COM/Path', '', 'example.com'],
  ];
  const wrong = cases.filter(([input, self, want]) => referrerHost(input, self) !== want);
  check(
    'B referrers reduce to a bare host, self-referrals to empty',
    wrong.length === 0,
    wrong.length
      ? JSON.stringify(wrong.map(([i, s, w]) => [i, w, referrerHost(i, s)]))
      : `${cases.length} cases incl. reddit.com, redd.it, android-app://`
  );

  check(
    'B the query string never survives',
    referrerHost('https://google.com/search?q=someones+private+search', 'x') === 'google.com',
    referrerHost('https://google.com/search?q=someones+private+search', 'x')
  );

  const long = referrerHost(`https://${'a'.repeat(300)}.com`, '');
  check('B hosts are capped at 120 characters', long.length <= 120, `length=${long.length}`);
}

/* ------------------------------------------------------------------
   C — validateTrack
   ------------------------------------------------------------------ */
const SESSION = 'sess-1234abcd';
const event = (over = {}) => ({ name: 'page_view', path: '/', ...over });

{
  const many = { sessionId: SESSION, events: Array.from({ length: 25 }, () => event()) };
  const result = validateTrack(many, 'airohub.netlify.app');
  check(
    'C 25 events become 20 accepted and 5 dropped',
    result.events.length === TRACK_MAX_BATCH && result.dropped === 5,
    `accepted=${result.events.length} dropped=${result.dropped} (cap=${TRACK_MAX_BATCH})`
  );

  const bad = validateTrack(
    {
      sessionId: SESSION,
      events: [
        event(),
        event({ name: 'not_a_real_event' }),
        event({ name: 'DROP TABLE events' }),
        event({ props: { blob: 'x'.repeat(TRACK_MAX_PROPS_BYTES + 1) } }),
        event({ props: 'not an object' }),
        event({ props: [1, 2, 3] }),
        'not an object at all',
        event({ name: 'client.error', props: { message: 'boom' } }),
      ],
    },
    'x'
  );
  check(
    'C unknown names, oversized and non-object props are dropped',
    bad.events.length === 2 && bad.dropped === 6,
    `accepted=${bad.events.length} dropped=${bad.dropped}; kept=${bad.events.map((e) => e.name).join(',')}`
  );

  const shaped = validateTrack(
    {
      sessionId: SESSION,
      referrer: 'https://www.reddit.com/r/x',
      events: [event({ path: '/canvas/AB12CD', roomId: 'AB12CD' }), event({ roomId: 'not-a-room!' })],
    },
    'airohub.netlify.app'
  );
  check(
    'C each event is normalised into column shape',
    shaped.events[0].path === '/canvas/:room' &&
      shaped.events[0].room_id === 'AB12CD' &&
      shaped.events[1].room_id === '' &&
      shaped.referrerHost === 'reddit.com',
    JSON.stringify(shaped.events)
  );
  check(
    'C props default to an empty object, never undefined',
    shaped.events.every((e) => e.props && typeof e.props === 'object'),
    JSON.stringify(shaped.events.map((e) => e.props))
  );

  const badSessions = [
    { sessionId: 'short', events: [] },
    { sessionId: 'has spaces in it', events: [] },
    { sessionId: 'x'.repeat(65), events: [] },
    { sessionId: '../../etc/passwd', events: [] },
    { events: [] },
    { sessionId: SESSION },
    { sessionId: SESSION, events: 'nope' },
    null,
    'a string',
    [],
  ];
  check(
    'C a body that is not a track request returns null',
    badSessions.every((b) => validateTrack(b, 'x') === null),
    `${badSessions.length} shapes rejected`
  );

  const roomIds = ['AB12CD', 'a', '1234567890123456'].map((r) => normaliseRoomId(r));
  const badRooms = ['', 'toolongtobearoomid!', 'has-dash', 'x'.repeat(17), null, 42].map((r) =>
    normaliseRoomId(r)
  );
  check(
    'C room ids are alphanumeric and at most 16 characters',
    roomIds.every((r) => r.length > 0) && badRooms.every((r) => r === ''),
    `kept=[${roomIds.join(', ')}]`
  );
}

/* ------------------------------------------------------------------
   D — validateFeedback
   ------------------------------------------------------------------ */
{
  const base = { kind: 'bug', message: 'The spray stops after a minute.' };

  const ok = validateFeedback({ ...base, path: '/canvas/AB12CD', roomId: 'AB12CD', email: ' me@example.com ' });
  check(
    'D a valid message becomes a bounded row',
    'row' in ok &&
      ok.row.kind === 'bug' &&
      ok.row.path === '/canvas/:room' &&
      ok.row.roomId === 'AB12CD' &&
      ok.row.email === 'me@example.com',
    JSON.stringify(ok)
  );

  const honeypot = validateFeedback({ ...base, website: 'http://spam.example' });
  check(
    'D the honeypot short-circuits before anything else',
    'honeypot' in honeypot && honeypot.honeypot === true,
    JSON.stringify(honeypot)
  );
  check(
    'D the honeypot wins even over an invalid body',
    'honeypot' in validateFeedback({ kind: 'nope', message: '', website: 'x' }),
    'a bot learns nothing about the real rules'
  );
  check(
    'D an empty honeypot is not a bot',
    'row' in validateFeedback({ ...base, website: '' }) &&
      'row' in validateFeedback({ ...base, website: '   ' }),
    'the field is present and blank on every real submission'
  );

  const invalid = [
    [{ ...base, message: 'ab' }, 'too short'],
    [{ ...base, message: '   ' }, 'whitespace only'],
    [{ ...base, message: 'x'.repeat(2001) }, 'too long'],
    [{ ...base, kind: 'complaint' }, 'unknown kind'],
    [{ ...base, kind: undefined }, 'missing kind'],
    [{ ...base, email: 'not-an-email' }, 'bad email'],
    [{ ...base, email: 'a@b' }, 'no dot in the domain'],
    [{ ...base, email: `${'a'.repeat(160)}@example.com` }, 'email too long'],
    [{ ...base, email: 42 }, 'email not text'],
    [null, 'not an object'],
  ];
  const missed = invalid.filter(([body]) => !('error' in validateFeedback(body)));
  check(
    'D every out-of-bounds field is a named 400, not a 500 from a CHECK',
    missed.length === 0,
    missed.length ? JSON.stringify(missed) : invalid.map(([, why]) => why).join('; ')
  );

  const boundary = [
    validateFeedback({ ...base, message: 'abc' }),
    validateFeedback({ ...base, message: 'x'.repeat(2000) }),
    validateFeedback({ ...base, email: '' }),
    validateFeedback({ ...base, email: undefined }),
  ];
  check(
    'D the exact bounds are accepted',
    boundary.every((r) => 'row' in r),
    '3 characters, 2000 characters, empty email, absent email'
  );
  check(
    'D an absent email stores as empty string, never undefined',
    boundary[3].row.email === '',
    JSON.stringify(boundary[3].row)
  );
}

/* ------------------------------------------------------------------
   E — deviceFromUa
   ------------------------------------------------------------------ */
{
  const IPHONE =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  const IPAD =
    'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  const ANDROID_PHONE =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
  const ANDROID_TABLET =
    'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const DESKTOP =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const GOOGLEBOT_MOBILE =
    'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

  const matrix = [
    [IPHONE, 'mobile'],
    [IPAD, 'tablet'],
    [ANDROID_PHONE, 'mobile'],
    [ANDROID_TABLET, 'tablet'],
    [DESKTOP, 'desktop'],
    [GOOGLEBOT_MOBILE, 'bot'],
    ['Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)', 'bot'],
    ['Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)', 'bot'],
    ['facebookexternalhit/1.1', 'bot'],
    ['Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/120.0.0.0 Safari/537.36', 'bot'],
    ['curl/8.4.0', 'bot'],
    ['', 'unknown'],
    ['   ', 'unknown'],
    [null, 'unknown'],
    [undefined, 'unknown'],
    [42, 'unknown'],
  ];
  const wrong = matrix.filter(([ua, want]) => deviceFromUa(ua) !== want);
  check(
    'E device matrix: bots before tablets before mobiles',
    wrong.length === 0,
    wrong.length
      ? JSON.stringify(wrong.map(([ua, want]) => [String(ua).slice(0, 40), want, deviceFromUa(ua)]))
      : `${matrix.length} agents`
  );
  check(
    'E Googlebot on a phone UA is a bot, not a mobile',
    deviceFromUa(GOOGLEBOT_MOBILE) === 'bot' && GOOGLEBOT_MOBILE.includes('Mobile'),
    'the UA says "Mobile" and "Googlebot"; the order of the tests decides'
  );
  check(
    'E an Android tablet is not counted as a phone',
    deviceFromUa(ANDROID_TABLET) === 'tablet' && !ANDROID_TABLET.includes('Mobile'),
    'no "Mobile" token means tablet'
  );
}

/* ------------------------------------------------------------------
   F — mergeFlags coercion
   ------------------------------------------------------------------ */
{
  check(
    'F no rows means the compiled-in defaults',
    JSON.stringify(mergeFlags([])) === JSON.stringify(DEFAULT_FLAGS) &&
      JSON.stringify(mergeFlags(null)) === JSON.stringify(DEFAULT_FLAGS) &&
      JSON.stringify(mergeFlags(undefined)) === JSON.stringify(DEFAULT_FLAGS),
    'an empty settings table is a valid state, not a failure'
  );
  check(
    'F the launch defaults hide AI and Pad',
    DEFAULT_FLAGS.ui.aiPanel === false && DEFAULT_FLAGS.ui.padMode === false,
    JSON.stringify(DEFAULT_FLAGS.ui)
  );

  const merged = mergeFlags([{ key: 'ui', value: { aiPanel: true, stamps: false } }]);
  check(
    'F a partial ui row merges over the defaults',
    merged.ui.aiPanel === true &&
      merged.ui.stamps === false &&
      merged.ui.showcase === DEFAULT_FLAGS.ui.showcase &&
      merged.ui.padMode === false,
    JSON.stringify(merged.ui)
  );

  const junk = mergeFlags([
    {
      key: 'ui',
      value: {
        aiPanel: 'true',
        padMode: 1,
        stamps: null,
        showcase: 'false',
        uploads: [],
        feedbackButton: {},
        unknownFlag: true,
        __proto__: { polluted: true },
      },
    },
  ]);
  check(
    'F only real booleans move a ui flag',
    JSON.stringify(junk.ui) === JSON.stringify(DEFAULT_FLAGS.ui),
    `"true" and 1 are truthy in JS and would have switched features on: ${JSON.stringify(junk.ui)}`
  );
  check(
    'F unknown keys are dropped',
    !('unknownFlag' in junk.ui) && !('polluted' in junk.ui) && Object.keys(junk.ui).length === 6,
    JSON.stringify(Object.keys(junk.ui))
  );

  const caps = [
    [{ ai: { dailyCap: 250 } }, 250],
    [{ ai: { dailyCap: 12.7 } }, 12],
    [{ ai: { dailyCap: -5 } }, 0],
    [{ ai: { dailyCap: AI_DAILY_CAP_MAX + 1 } }, AI_DAILY_CAP_MAX],
    [{ ai: { dailyCap: 'none' } }, DEFAULT_FLAGS.ai.dailyCap],
    [{ ai: { dailyCap: null } }, DEFAULT_FLAGS.ai.dailyCap],
    [{ ai: { dailyCap: Number.NaN } }, DEFAULT_FLAGS.ai.dailyCap],
    [{ ai: { dailyCap: Infinity } }, DEFAULT_FLAGS.ai.dailyCap],
    [{ ai: 'nope' }, DEFAULT_FLAGS.ai.dailyCap],
  ];
  const capWrong = caps.filter(
    ([value, want]) => mergeFlags([{ key: 'ai', value: value.ai }]).ai.dailyCap !== want
  );
  check(
    'F the daily cap is an integer clamped to 0..' + AI_DAILY_CAP_MAX,
    capWrong.length === 0,
    capWrong.length ? JSON.stringify(capWrong) : `${caps.length} cases, non-numbers fall back`
  );

  const notice = mergeFlags([{ key: 'notice', value: 'x'.repeat(NOTICE_MAX + 50) }]);
  check(
    'F the notice is capped at ' + NOTICE_MAX,
    notice.notice.length === NOTICE_MAX,
    `length=${notice.notice.length}`
  );
  check(
    'F a non-string notice falls back to empty',
    mergeFlags([{ key: 'notice', value: { text: 'hi' } }]).notice === '' &&
      mergeFlags([{ key: 'notice', value: 42 }]).notice === '',
    'a rendered [object Object] banner is worse than none'
  );
  check(
    'F unknown settings rows are ignored',
    JSON.stringify(mergeFlags([{ key: 'whatever', value: { anything: true } }, { key: null }, null])) ===
      JSON.stringify(DEFAULT_FLAGS),
    'settings is a general table; not every row is a flag'
  );

  const ordered = mergeFlags([
    { key: 'ui', value: { aiPanel: true, stamps: false } },
    { key: 'ui', value: { aiPanel: false } },
  ]);
  check(
    'F later rows win, key by key',
    ordered.ui.aiPanel === false && ordered.ui.stamps === false,
    'this is what makes "current rows + pending patch" a valid dry run'
  );
}

/* ------------------------------------------------------------------
   G — publicSubset
   ------------------------------------------------------------------ */
{
  const flags = mergeFlags([{ key: 'ai', value: { dailyCap: 42 } }]);
  const publicFlags = publicSubset(flags);
  check(
    'G the public payload is exactly { ui, notice }',
    JSON.stringify(Object.keys(publicFlags).sort()) === JSON.stringify(['notice', 'ui']),
    JSON.stringify(Object.keys(publicFlags))
  );
  check(
    'G the AI budget never reaches the browser',
    !('ai' in publicFlags) && !JSON.stringify(publicFlags).includes('42'),
    JSON.stringify(publicFlags)
  );
  publicFlags.ui.aiPanel = true;
  check(
    'G the public copy does not alias the source object',
    flags.ui.aiPanel === false,
    'mutating the response cannot corrupt a memoised flag set'
  );
}

/* ------------------------------------------------------------------
   H — visitorHash
   ------------------------------------------------------------------ */
{
  const SALT = 'salt-of-the-day';
  const a = visitorHash(SALT, '203.0.113.7', 'Mozilla/5.0');
  check('H hashes are 64 hex characters', /^[0-9a-f]{64}$/.test(a), `${a.slice(0, 16)}...`);
  check(
    'H the same visitor on the same day hashes the same',
    visitorHash(SALT, '203.0.113.7', 'Mozilla/5.0') === a,
    'this is what makes a daily unique count possible at all'
  );
  check(
    'H a different IP, agent or day is a different hash',
    visitorHash(SALT, '203.0.113.8', 'Mozilla/5.0') !== a &&
      visitorHash(SALT, '203.0.113.7', 'Mozilla/6.0') !== a &&
      visitorHash('salt-of-tomorrow', '203.0.113.7', 'Mozilla/5.0') !== a,
    'and the new salt at midnight is why the count is per-day only'
  );
  check(
    'H the separator stops fields running together',
    visitorHash(SALT, '1.2.3', '4.5') !== visitorHash(SALT, '1.2', '3.4.5'),
    'without a delimiter these two visitors would be one'
  );
  check(
    'H the raw address is not recoverable from the digest',
    !a.includes('203') && a.length === 64,
    'a digest, not an encoding'
  );
}

/* ------------------------------------------------------------------
   I — AI output sanitizers
   ------------------------------------------------------------------ */
{
  const CONCEPT = {
    title: 'NEON PHANTOM',
    tagLine: 'Midnight Cyber Drip',
    recommendedPalette: ['#FF3D00', '#06B6D4'],
    stencilSymbol: '⚡',
    graffitiText: 'PHANTOM',
    styleNotes: 'High-contrast aerosol gradients.',
  };
  const STYLE = {
    transformedTitle: 'NEO-SHINJUKU OVERDRIVE',
    vibe: 'Cyberpunk 2099',
    tagLine: 'High Tech, Low Life Aerosol',
    accentColor: '#06B6D4',
    secondaryColor: '#EC4899',
    stencilSymbol: '⚡',
    tagText: 'CYBERPUNK',
    dripIntensity: 0.8,
    glowRadius: 28,
    curatorNotes: 'Electric cyan and neon magenta flares.',
  };
  const CRITIQUE = {
    exhibitionTitle: 'VIBRATIONS IN LOWER EAST SIDE',
    curatorCritique: 'A bold, kinetic exploration.',
    estimatedValue: '$24,500 USD',
    auctionHouse: "SOTHEBY'S CONTEMPORARY STREET",
    vibeTags: ['#AerosolExpressionism'],
  };

  check(
    'I a javascript: "colour" is replaced by the fallback',
    hex('javascript:alert(1)', '#06B6D4') === '#06B6D4' &&
      hex('url(evil.css)', '#06B6D4') === '#06B6D4' &&
      hex('red', '#06B6D4') === '#06B6D4' &&
      hex('#06B6D4', '#000000') === '#06B6D4' &&
      hex('#abc', '#000000') === '#abc',
    'only #rgb and #rrggbb are colours'
  );

  const poisoned = sanitizeStyle(
    {
      ...STYLE,
      accentColor: 'javascript:alert(document.cookie)',
      secondaryColor: 'expression(alert(1))',
      dripIntensity: 900,
      glowRadius: -12,
      tagText: 'x'.repeat(200),
      curatorNotes: 'y'.repeat(4000),
      stencilSymbol: 'three glyphs',
    },
    STYLE
  );
  check(
    'I a poisoned style transformation comes back entirely safe',
    poisoned.accentColor === STYLE.accentColor &&
      poisoned.secondaryColor === STYLE.secondaryColor &&
      poisoned.dripIntensity === 1.2 &&
      poisoned.glowRadius === 8 &&
      poisoned.tagText.length === 24 &&
      poisoned.curatorNotes.length === 400 &&
      poisoned.stencilSymbol === STYLE.stencilSymbol,
    JSON.stringify({
      accentColor: poisoned.accentColor,
      drip: poisoned.dripIntensity,
      glow: poisoned.glowRadius,
      symbol: poisoned.stencilSymbol,
    })
  );

  const empty = sanitizeStyle({}, STYLE);
  check(
    'I an empty model answer becomes the complete fallback',
    JSON.stringify(empty) === JSON.stringify(STYLE),
    'the client destructures this; a missing key is a blank card'
  );
  const garbage = [null, undefined, 'a string', 42, []].map((raw) => sanitizeStyle(raw, STYLE));
  check(
    'I non-objects become the complete fallback too',
    garbage.every((g) => JSON.stringify(g) === JSON.stringify(STYLE)),
    `${garbage.length} shapes`
  );

  const concept = sanitizeConcept(
    {
      ...CONCEPT,
      title: '  spaced   out   title  ',
      recommendedPalette: ['#FF3D00', 'javascript:1', 'rgb(1,2,3)', '#06B6D4', '#123456', '#abcdef', '#fedcba', '#111111'],
      stencilSymbol: '👑',
      graffitiText: 'z'.repeat(80),
    },
    CONCEPT
  );
  check(
    'I the palette keeps only hex colours and caps at 6',
    concept.recommendedPalette.length === 6 &&
      concept.recommendedPalette.every((c) => /^#[0-9a-f]{3,6}$/i.test(c)),
    JSON.stringify(concept.recommendedPalette)
  );
  check(
    'I a single emoji is a valid stencil symbol',
    concept.stencilSymbol === '👑',
    'two UTF-16 units, one grapheme'
  );
  check(
    'I text fields are collapsed and capped',
    concept.title === 'spaced out title' && concept.graffitiText.length === 24,
    JSON.stringify({ title: concept.title, len: concept.graffitiText.length })
  );
  check(
    'I an all-invalid palette falls back whole',
    JSON.stringify(sanitizeConcept({ recommendedPalette: ['red', 'blue'] }, CONCEPT).recommendedPalette) ===
      JSON.stringify(CONCEPT.recommendedPalette),
    'never an empty palette'
  );

  const critique = sanitizeCritique(
    {
      ...CRITIQUE,
      vibeTags: ['#one', '#two', '#three', '#four', '#five', '#six', 42, '', 'x'.repeat(90)],
      estimatedValue: '$'.repeat(90),
      curatorCritique: '',
    },
    CRITIQUE
  );
  check(
    'I vibe tags cap at 5 x 32 characters and drop non-strings',
    critique.vibeTags.length === 5 && critique.vibeTags.every((t) => typeof t === 'string' && t.length <= 32),
    JSON.stringify(critique.vibeTags)
  );
  check(
    'I an empty string is a failure, not a value',
    critique.curatorCritique === CRITIQUE.curatorCritique && critique.estimatedValue.length === 32,
    JSON.stringify({ critique: critique.curatorCritique, value: critique.estimatedValue })
  );

  check(
    'I helper primitives behave',
    str(42, 10, 'fb') === 'fb' &&
      str('  ok  ', 10, 'fb') === 'ok' &&
      glyph('ab', 'X') === 'X' &&
      glyph('', 'X') === 'X' &&
      glyph('⚡', 'X') === '⚡' &&
      num('7', 0, 10, 3) === 3 &&
      num(20, 0, 10, 3) === 10 &&
      num(Number.NaN, 0, 10, 3) === 3 &&
      hexes('not an array', 6, ['#000000'])[0] === '#000000',
    'str, glyph, num, hexes'
  );
}

fs.rmSync(outDir, { recursive: true, force: true });
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} launch validator checks passed`);
process.exit(failed.length ? 1 : 0);
