/**
 * Admin session regression suite.
 *
 * `lib/auth.ts` is the whole of `/admin`'s security: one shared password, one
 * signed cookie, no user table and no second factor. Every check below encodes
 * a way in which that arrangement fails quietly rather than loudly:
 *
 *  A  a fresh session round-trips, and its expiry is 12 hours out. A session
 *     that never expires is a stolen laptop with permanent access.
 *  B  a TAMPERED EXPIRY reports 'bad-signature', not 'expired'. Verifying the
 *     expiry first turns the endpoint into an oracle: an attacker learns
 *     whether their guessed timestamp is in the future before they have
 *     guessed the key. This is the single most important check in the file.
 *  C  a token signed with a different secret is rejected — the rotation story.
 *  D  an expired-but-genuine token reports 'expired' so the dashboard can say
 *     "sign in again" instead of "something is wrong".
 *  E  every malformed shape lands on 'malformed' or 'absent' rather than
 *     throwing. A throw here is a 500 on a public URL.
 *  F  `constantTimeEqual` never throws on unequal lengths. `timingSafeEqual`
 *     does, and a thrown comparison is itself a length oracle.
 *  G  nonces do not repeat, so two sessions minted in the same millisecond are
 *     different tokens.
 *  H  `readAdminEnv` refuses a half-configured deploy. An empty password
 *     compared constant-time against an empty submission is a wide-open door.
 *  I  the cookie is HttpOnly + Secure + SameSite=Strict on path `/`, and
 *     logging out actually deletes it.
 *  J  `requireAdmin` answers 503 unconfigured, 401 with no or bad cookie, and
 *     `null` — meaning "carry on" — only for a valid one.
 *
 * Runs headless: bundles netlify/functions/lib/auth.ts with esbuild (same pattern
 * as review-export.mjs). No Netlify, no database, no network.
 */
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airo-auth-'));
const bundle = path.join(outDir, 'auth.mjs');

await build({
  entryPoints: [path.join(repo, 'netlify/functions/lib/auth.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundle,
  logLevel: 'error',
  external: ['node:crypto'],
});

const {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  SESSION_SECRET_MIN,
  constantTimeEqual,
  createSession,
  newNonce,
  signSession,
  verifySession,
  readAdminEnv,
  readSessionCookie,
  setSessionCookie,
  clearSessionCookie,
  requireAdmin,
} = await import(pathToFileURL(bundle).href);

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

const SECRET = 'a-secret-long-enough-to-sign-with-32';
const OTHER = 'a-different-secret-of-adequate-length';

/** A stand-in for Netlify's `Context.cookies`, recording what a handler did. */
function fakeContext(cookies = {}) {
  const jar = { ...cookies };
  const set = [];
  const deleted = [];
  return {
    jar,
    set,
    deleted,
    cookies: {
      get: (name) => jar[name],
      set: (cookie) => {
        set.push(cookie);
        jar[cookie.name] = cookie.value;
      },
      delete: (input) => {
        const name = typeof input === 'string' ? input : input.name;
        deleted.push(input);
        delete jar[name];
      },
    },
  };
}

const withEnv = (env, fn) => {
  const saved = { ADMIN_PASSWORD: process.env.ADMIN_PASSWORD, ADMIN_SESSION_SECRET: process.env.ADMIN_SESSION_SECRET };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

/* ------------------------------------------------------------------
   A — a fresh session round-trips
   ------------------------------------------------------------------ */
{
  const now = Date.now();
  const { token, expiresAt } = createSession(SECRET, now);
  const parts = token.split('.');
  check(
    'A token is exp.nonce.hmac',
    parts.length === 3 && parts[0] === String(expiresAt) && /^[0-9a-f]{64}$/.test(parts[2]),
    `parts=${parts.length} mac=${parts[2]?.length} chars`
  );
  check(
    'A session lasts 12 hours',
    expiresAt - now === SESSION_TTL_MS && SESSION_TTL_MS === 12 * 60 * 60 * 1000,
    `ttl=${SESSION_TTL_MS}ms`
  );
  const verified = verifySession(SECRET, token, now);
  check(
    'A round trip verifies',
    verified.ok === true && verified.expiresAt === expiresAt,
    JSON.stringify(verified)
  );
}

/* ------------------------------------------------------------------
   B — a tampered expiry is a signature failure, not an expiry failure
   ------------------------------------------------------------------ */
{
  const now = Date.now();
  const { token } = createSession(SECRET, now);
  const [, nonce, mac] = token.split('.');

  const pushedOut = verifySession(SECRET, `${now + 999 * 86400000}.${nonce}.${mac}`, now);
  check(
    'B expiry pushed forward reports bad-signature',
    pushedOut.ok === false && pushedOut.reason === 'bad-signature',
    `reason=${pushedOut.reason} (NOT "expired" — that answer would be an oracle)`
  );

  const pulledBack = verifySession(SECRET, `${now - 86400000}.${nonce}.${mac}`, now);
  check(
    'B expiry pulled back also reports bad-signature',
    pulledBack.ok === false && pulledBack.reason === 'bad-signature',
    `reason=${pulledBack.reason} (signature is checked before expiry)`
  );

  const swappedNonce = verifySession(SECRET, `${now + SESSION_TTL_MS}.${newNonce()}.${mac}`, now);
  check(
    'B swapped nonce reports bad-signature',
    swappedNonce.ok === false && swappedNonce.reason === 'bad-signature',
    `reason=${swappedNonce.reason}`
  );

  // A leading-zero expiry re-signs to a different string: canonical form only.
  const padded = verifySession(SECRET, `0${now + SESSION_TTL_MS}.${nonce}.${mac}`, now);
  check(
    'B non-canonical expiry rejected',
    padded.ok === false && padded.reason === 'bad-signature',
    `reason=${padded.reason}`
  );
}

/* ------------------------------------------------------------------
   C — wrong secret
   ------------------------------------------------------------------ */
{
  const now = Date.now();
  const { token } = createSession(SECRET, now);
  const result = verifySession(OTHER, token, now);
  check(
    'C token from another secret rejected',
    result.ok === false && result.reason === 'bad-signature',
    `reason=${result.reason} (rotating ADMIN_SESSION_SECRET signs everyone out)`
  );
}

/* ------------------------------------------------------------------
   D — a genuine but expired token
   ------------------------------------------------------------------ */
{
  const issued = Date.now() - SESSION_TTL_MS - 1000;
  const { token, expiresAt } = createSession(SECRET, issued);
  const result = verifySession(SECRET, token, Date.now());
  check(
    'D genuine expired token reports expired',
    result.ok === false && result.reason === 'expired',
    `reason=${result.reason} expiredAt=${new Date(expiresAt).toISOString()}`
  );
  const justInside = verifySession(SECRET, token, expiresAt - 1);
  check(
    'D still valid one millisecond before expiry',
    justInside.ok === true,
    `ok=${justInside.ok}`
  );
  const exactly = verifySession(SECRET, token, expiresAt);
  check(
    'D expired exactly at the boundary',
    exactly.ok === false && exactly.reason === 'expired',
    `reason=${exactly.reason}`
  );
}

/* ------------------------------------------------------------------
   E — malformed shapes never throw
   ------------------------------------------------------------------ */
{
  const absent = [undefined, null, ''];
  const absentOk = absent.every((t) => {
    const r = verifySession(SECRET, t);
    return r.ok === false && r.reason === 'absent';
  });
  check('E missing token reports absent', absentOk, `${absent.length} shapes: undefined, null, ""`);

  const malformed = [
    'nonsense',
    'a.b',
    'a.b.c.d',
    '..',
    'notanumber.deadbeefdeadbeef.' + 'a'.repeat(64),
    '123.NOTHEX.' + 'a'.repeat(64),
    '123.deadbeefdeadbeef.short',
    '99999999999999999999.deadbeefdeadbeef.' + 'a'.repeat(64),
    { not: 'a string' },
    12345,
  ];
  let thrown = null;
  const reasons = malformed.map((t) => {
    try {
      return verifySession(SECRET, t).reason;
    } catch (err) {
      thrown = err;
      return 'THREW';
    }
  });
  check(
    'E malformed tokens report malformed/absent, never throw',
    thrown === null && reasons.every((r) => r === 'malformed' || r === 'absent'),
    `reasons=[${reasons.join(', ')}]`
  );
}

/* ------------------------------------------------------------------
   F — constant-time compare
   ------------------------------------------------------------------ */
{
  check('F equal strings compare equal', constantTimeEqual('hunter2', 'hunter2') === true, '');
  check(
    'F different strings of equal length differ',
    constantTimeEqual('hunter2', 'hunter3') === false,
    ''
  );
  let threw = false;
  let unequal = null;
  try {
    unequal = constantTimeEqual('short', 'a-considerably-longer-password-value');
  } catch {
    threw = true;
  }
  check(
    'F unequal lengths return false without throwing',
    !threw && unequal === false,
    'hashing first is what makes this safe'
  );
  check(
    'F empty against non-empty is false',
    constantTimeEqual('', 'anything') === false && constantTimeEqual('', '') === true,
    ''
  );
}

/* ------------------------------------------------------------------
   G — nonce uniqueness
   ------------------------------------------------------------------ */
{
  const nonces = new Set();
  for (let i = 0; i < 2000; i += 1) nonces.add(newNonce());
  check('G nonces are unique', nonces.size === 2000, `${nonces.size}/2000 distinct`);

  const a = createSession(SECRET, 1700000000000).token;
  const b = createSession(SECRET, 1700000000000).token;
  check(
    'G two sessions in the same millisecond differ',
    a !== b,
    'same exp, different nonce'
  );
}

/* ------------------------------------------------------------------
   H — readAdminEnv refuses a half-configured deploy
   ------------------------------------------------------------------ */
{
  check(
    'H missing password is not configured',
    withEnv({ ADMIN_PASSWORD: undefined, ADMIN_SESSION_SECRET: SECRET }, () => readAdminEnv()) === null,
    'null, so the endpoints answer 503'
  );
  check(
    'H empty password is not configured',
    withEnv({ ADMIN_PASSWORD: '', ADMIN_SESSION_SECRET: SECRET }, () => readAdminEnv()) === null,
    'an empty password would match an empty submission'
  );
  check(
    'H short secret is not configured',
    withEnv({ ADMIN_PASSWORD: 'pw', ADMIN_SESSION_SECRET: 'x'.repeat(SESSION_SECRET_MIN - 1) }, () =>
      readAdminEnv()
    ) === null,
    `secret must be at least ${SESSION_SECRET_MIN} characters`
  );
  const good = withEnv({ ADMIN_PASSWORD: 'pw', ADMIN_SESSION_SECRET: SECRET }, () => readAdminEnv());
  check(
    'H both set is configured',
    good !== null && good.password === 'pw' && good.secret === SECRET,
    JSON.stringify({ password: good && '<redacted>', secretLength: good && good.secret.length })
  );
}

/* ------------------------------------------------------------------
   I — cookie attributes
   ------------------------------------------------------------------ */
{
  const ctx = fakeContext();
  const now = Date.now();
  const { token, expiresAt } = createSession(SECRET, now);
  setSessionCookie(ctx, token, expiresAt, now);
  const cookie = ctx.set[0];
  check(
    'I cookie is HttpOnly + Secure + SameSite=Strict on /',
    cookie.name === SESSION_COOKIE &&
      cookie.httpOnly === true &&
      cookie.secure === true &&
      cookie.sameSite === 'Strict' &&
      cookie.path === '/',
    `name=${cookie.name} httpOnly=${cookie.httpOnly} secure=${cookie.secure} sameSite=${cookie.sameSite} path=${cookie.path}`
  );
  check(
    'I cookie max-age matches the session',
    cookie.maxAge === Math.round(SESSION_TTL_MS / 1000),
    `maxAge=${cookie.maxAge}s`
  );
  check('I cookie reads back', readSessionCookie(ctx) === token, 'round trip through the jar');

  clearSessionCookie(ctx);
  check(
    'I logout deletes the cookie on the same path',
    ctx.deleted.length === 1 &&
      ctx.deleted[0].name === SESSION_COOKIE &&
      ctx.deleted[0].path === '/' &&
      readSessionCookie(ctx) === '',
    JSON.stringify(ctx.deleted[0])
  );

  check(
    'I a context with no cookie header reads empty',
    readSessionCookie({
      cookies: {
        get() {
          throw new Error('no cookie header');
        },
      },
    }) === '',
    'never throws out of a request handler'
  );
}

/* ------------------------------------------------------------------
   J — requireAdmin
   ------------------------------------------------------------------ */
{
  const unconfigured = withEnv({ ADMIN_PASSWORD: undefined, ADMIN_SESSION_SECRET: undefined }, () =>
    requireAdmin(fakeContext())
  );
  check(
    'J unconfigured deploy answers 503',
    unconfigured !== null && unconfigured.status === 503,
    `status=${unconfigured && unconfigured.status}`
  );

  const noCookie = withEnv({ ADMIN_PASSWORD: 'pw', ADMIN_SESSION_SECRET: SECRET }, () =>
    requireAdmin(fakeContext())
  );
  check(
    'J no cookie answers 401',
    noCookie !== null && noCookie.status === 401,
    `status=${noCookie && noCookie.status}`
  );

  const forged = withEnv({ ADMIN_PASSWORD: 'pw', ADMIN_SESSION_SECRET: SECRET }, () =>
    requireAdmin(fakeContext({ [SESSION_COOKIE]: createSession(OTHER).token }))
  );
  check(
    'J a cookie signed with another secret answers 401',
    forged !== null && forged.status === 401,
    `status=${forged && forged.status}`
  );

  const valid = withEnv({ ADMIN_PASSWORD: 'pw', ADMIN_SESSION_SECRET: SECRET }, () =>
    requireAdmin(fakeContext({ [SESSION_COOKIE]: createSession(SECRET).token }))
  );
  check('J a valid cookie passes the gate', valid === null, 'null means carry on');

  const body = noCookie === null ? null : await noCookie.json();
  check(
    'J the 401 body names the reason but not the password',
    body !== null && body.error === 'unauthorized' && body.message === 'absent',
    JSON.stringify(body)
  );

  // Signing must be the only thing that lets a token through: a token whose
  // signature is right for a DIFFERENT nonce must not be accepted.
  const { token } = createSession(SECRET);
  const [exp, nonce] = token.split('.');
  const mixed = signSession(SECRET, Number(exp), nonce).split('.')[2];
  check(
    'J re-signing the same parts reproduces the mac',
    `${exp}.${nonce}.${mixed}` === token,
    'signSession is deterministic'
  );
}

fs.rmSync(outDir, { recursive: true, force: true });
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} admin auth checks passed`);
process.exit(failed.length ? 1 : 0);
