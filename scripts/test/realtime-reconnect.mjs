/**
 * Realtime transport reconnection suite.
 *
 * Locks in the behaviour that keeps a room alive on real phones. Each check
 * encodes a symptom that has actually been reported:
 *
 *  A   first connect subscribes and registers presence ("connected")
 *  B   a channel error is not terminal — the room reports "reconnecting" and
 *      tears the dead channel down instead of freezing until someone reloads
 *  C   the rejoin subscribes a FRESH channel with the identical handler wiring
 *      (a rejoined channel missing its broadcast handlers is a silent room)
 *  D   a successful rejoin re-tracks presence and fires 'rejoined' — but the
 *      first connect must not, or peers re-broadcast state on every join
 *  E   presence `track` is retried: a controller whose track failed broadcasts
 *      fine but never appears in anyone's roster ("spraying with no cursor")
 *  F   a screen unlock / network change rejoins immediately rather than waiting
 *      out the backoff
 *  G   a deliberate disconnect stops every retry
 *
 * Runs headless: bundles src/net/realtime.ts with esbuild, aliasing the
 * Supabase client to an in-memory stub whose channels the script drives by
 * hand. `npm test` runs it.
 */
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airo-net-'));

/* ----------------------------- supabase stub ----------------------------- */

const STUB = `
export const stub = {
  channels: [],
  removed: [],
  /** Results the next track() calls resolve/reject with; 'ok' when empty. */
  trackResults: [],
  reset() {
    this.channels.length = 0;
    this.removed.length = 0;
    this.trackResults.length = 0;
  },
  get last() { return this.channels[this.channels.length - 1]; },
};

class StubChannel {
  constructor(topic, opts) {
    this.topic = topic;
    this.opts = opts;
    this.state = 'closed';
    this.subscribeCalls = 0;
    this.tracks = [];
    this.sends = [];
    this.unsubscribes = 0;
    this.bindings = [];
    this.cb = null;
  }
  on(type, filter, handler) {
    this.bindings.push({ type, event: filter && filter.event, handler });
    return this;
  }
  subscribe(cb) {
    this.subscribeCalls++;
    this.state = 'joining';
    this.cb = cb;
    return this;
  }
  track(meta) {
    this.tracks.push(meta);
    const next = stub.trackResults.length ? stub.trackResults.shift() : 'ok';
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  }
  send(message) {
    this.sends.push(message);
    return Promise.resolve('ok');
  }
  unsubscribe() {
    this.unsubscribes++;
    this.state = 'closed';
    // The real library reports CLOSED on a channel we tore down ourselves;
    // reproducing that is what proves the stale-channel guard holds.
    if (this.cb) this.cb('CLOSED');
    return Promise.resolve('ok');
  }
  presenceState() {
    return this.presence || {};
  }
  /* --- test driver --- */
  drive(status) {
    this.state = status === 'SUBSCRIBED' ? 'joined' : 'errored';
    return this.cb && this.cb(status);
  }
  deliver(event, payload) {
    for (const b of this.bindings) {
      if (b.type === 'broadcast' && b.event === event) b.handler({ payload });
    }
  }
  events() {
    return this.bindings.map((b) => b.type + ':' + b.event).join(',');
  }
}

class StubClient {
  channel(topic, opts) {
    const ch = new StubChannel(topic, opts);
    stub.channels.push(ch);
    return ch;
  }
  removeChannel(ch) {
    stub.removed.push(ch);
    return Promise.resolve('ok');
  }
}

export function createClient() {
  return new StubClient();
}
`;

const stubFile = path.join(outDir, 'supabase-stub.mjs');
fs.writeFileSync(stubFile, STUB);

// One entry so realtime.ts and the stub it was bundled against are the same
// module instance — the script drives the very channels the transport holds.
const entryFile = path.join(outDir, 'entry.ts');
fs.writeFileSync(
  entryFile,
  `export * from ${JSON.stringify(path.join(repo, 'src/net/realtime.ts'))};\n` +
    `export { stub } from '@supabase/supabase-js';\n`
);

const bundle = path.join(outDir, 'realtime.mjs');
await build({
  entryPoints: [entryFile],
  bundle: true,
  format: 'esm',
  outfile: bundle,
  logLevel: 'error',
  define: {
    'import.meta.env.VITE_SUPABASE_URL': '"https://stub.supabase.test"',
    'import.meta.env.VITE_SUPABASE_ANON_KEY': '"stub-anon-key"',
  },
  plugins: [
    {
      name: 'supabase-stub',
      setup(b) {
        b.onResolve({ filter: /^@supabase\/supabase-js$/ }, () => ({ path: stubFile }));
      },
    },
  ],
});

/* ------------------------- browser-ish environment ------------------------ */

const listeners = { window: new Map(), document: new Map() };
const bind = (target) => ({
  addEventListener: (type, fn) => {
    if (!listeners[target].has(type)) listeners[target].set(type, new Set());
    listeners[target].get(type).add(fn);
  },
  removeEventListener: (type, fn) => listeners[target].get(type)?.delete(fn),
});
globalThis.window = bind('window');
globalThis.document = { visibilityState: 'visible', ...bind('document') };
const fire = (target, type) => {
  for (const fn of listeners[target].get(type) ?? []) fn();
};
const listenerCount = () =>
  [...listeners.window.values(), ...listeners.document.values()].reduce((n, s) => n + s.size, 0);

const { AiroConnection, RECONNECT_BACKOFF_MS, stub } = await import(pathToFileURL(bundle).href);

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 20ms first backoff, 6ms quick presence retry: a whole cycle in one tick. */
const SCALE = 0.02;
const META = { id: 'ctrl-test', role: 'controller', name: 'Tester', tool: 'spray', mode: 'motion' };

function harness() {
  stub.reset();
  const seen = [];
  const conn = new AiroConnection('test-room', META, { timeScale: SCALE });
  conn.on('connection', ({ status }) => seen.push(status));
  conn.on('rejoined', () => seen.push('rejoined'));
  return { conn, seen };
}

/* 0: the backoff schedule itself — capped, monotonic, retries forever. */
{
  const s = RECONNECT_BACKOFF_MS;
  const monotonic = s.every((v, i) => i === 0 || v >= s[i - 1]);
  check(
    '0 backoff schedule',
    Array.isArray(s) && s.length >= 4 && s[0] <= 1000 && monotonic && s[s.length - 1] <= 15000,
    `schedule=[${s.join(', ')}]ms, last entry repeats`
  );
}

/* A: first connect subscribes, tracks presence, reports connected. */
const { conn, seen } = harness();
conn.connect();
{
  const ch = stub.channels[0];
  check(
    'A subscribes on connect',
    stub.channels.length === 1 && ch.subscribeCalls === 1 && ch.topic === 'airohub:test-room',
    `channels=${stub.channels.length} topic=${ch && ch.topic}`
  );
  ch.drive('SUBSCRIBED');
  await wait(5);
  check(
    'A presence tracked on connect',
    ch.tracks.length === 1 && ch.tracks[0].id === META.id && seen[seen.length - 1] === 'connected',
    `tracks=${ch.tracks.length} status=${seen[seen.length - 1]}`
  );
  check(
    'A no rejoined on first connect',
    !seen.includes('rejoined'),
    `dispatched=[${seen.join(', ')}]`
  );
}

/* B: a channel error is recoverable, not terminal. */
{
  const ch = stub.channels[0];
  seen.length = 0;
  ch.drive('CHANNEL_ERROR');
  check(
    'B error reports reconnecting',
    seen.includes('reconnecting') && !seen.includes('error'),
    `dispatched=[${seen.join(', ')}]`
  );
  check(
    'B dead channel torn down',
    ch.unsubscribes === 1 && stub.removed.includes(ch),
    `unsubscribed=${ch.unsubscribes} removed=${stub.removed.length}`
  );
  check(
    'B teardown CLOSED does not re-enter',
    stub.channels.length === 1,
    `channels=${stub.channels.length} (a second rejoin here would double the backoff rate)`
  );
}

/* C: the rejoin is a fresh channel wired exactly like the first. */
await wait(120);
{
  const [first, second] = stub.channels;
  check(
    'C rejoin subscribes fresh channel',
    stub.channels.length === 2 && second.subscribeCalls === 1 && second !== first,
    `channels=${stub.channels.length} subscribes=${second && second.subscribeCalls}`
  );
  check(
    'C rejoin wiring identical',
    second.events() === first.events(),
    `${second.bindings.length} bindings, same order as the first channel`
  );
  let delivered = null;
  conn.on('motion', (p) => (delivered = p));
  second.deliver('motion', { playerId: 'p1', x: 0.25 });
  check('C rejoined channel forwards', delivered?.playerId === 'p1', `payload=${JSON.stringify(delivered)}`);
}

/* D: a successful rejoin re-registers presence and announces itself. */
{
  const second = stub.channels[1];
  seen.length = 0;
  second.drive('SUBSCRIBED');
  await wait(5);
  check(
    'D rejoin re-tracks presence',
    second.tracks.length === 1 && second.tracks[0].id === META.id,
    `tracks=${second.tracks.length}`
  );
  check(
    'D rejoin dispatches connected + rejoined',
    seen.includes('connected') && seen.filter((s) => s === 'rejoined').length === 1,
    `dispatched=[${seen.join(', ')}]`
  );
}

/* E: presence lands even when the first track attempts fail. */
{
  conn.disconnect();
  const { conn: c2 } = harness();
  stub.trackResults.push(new Error('presence refused'), 'timed out');
  c2.connect();
  const ch = stub.channels[0];
  ch.drive('SUBSCRIBED');
  await wait(60);
  check(
    'E presence retried until it lands',
    ch.tracks.length === 3,
    `track attempts=${ch.tracks.length} (rejected, timed out, ok)`
  );
  c2.disconnect();
}

/* F: waking from a locked screen rejoins without waiting out the backoff. */
{
  const { conn: c3, seen: s3 } = harness();
  c3.connect();
  stub.channels[0].drive('SUBSCRIBED');
  await wait(5);
  // A backgrounded socket dies with no callback at all: the channel simply
  // stops being 'joined'. Nothing has told the transport anything is wrong.
  stub.channels[0].state = 'closed';
  s3.length = 0;
  globalThis.document.visibilityState = 'visible';
  fire('document', 'visibilitychange');
  check(
    'F visibility wake rejoins at once',
    stub.channels.length === 2 && s3.includes('reconnecting'),
    `channels=${stub.channels.length} dispatched=[${s3.join(', ')}]`
  );
  // ...and while the channel is healthy, a wake must not churn the socket.
  stub.channels[1].drive('SUBSCRIBED');
  await wait(5);
  fire('window', 'online');
  fire('document', 'visibilitychange');
  check(
    'F wake is a no-op while joined',
    stub.channels.length === 2,
    `channels=${stub.channels.length} (no needless resubscribe)`
  );
  c3.disconnect();
  check(
    'F disconnect unbinds wake listeners',
    listenerCount() === 0,
    `${listenerCount()} listeners left on window/document`
  );
}

/* H: a first connect that never lands keeps retrying, but does not claim to be
 *    "reconnecting" from a room it was never in — the 9s connect timer owns
 *    that story, so a device with no route settles on solo mode. */
{
  const { conn: c5, seen: s5 } = harness();
  c5.connect();
  stub.channels[0].drive('CHANNEL_ERROR');
  const quiet = s5.length === 0;
  await wait(120);
  check(
    'H failed first connect retries quietly',
    quiet && stub.channels.length === 2,
    `dispatched=[${s5.join(', ')}] channels=${stub.channels.length}`
  );
  c5.disconnect();
}

/* G: a deliberate disconnect ends every retry loop. */
{
  const { conn: c4, seen: s4 } = harness();
  c4.connect();
  const ch = stub.channels[0];
  ch.drive('CHANNEL_ERROR');
  c4.disconnect();
  const channelsAtClose = stub.channels.length;
  s4.length = 0;
  await wait(150);
  check(
    'G disconnect stops rejoin',
    stub.channels.length === channelsAtClose && s4.length === 0,
    `channels=${stub.channels.length} (unchanged), dispatched=[${s4.join(', ')}]`
  );
  // A late status from a channel we already abandoned must stay inert.
  ch.drive('CHANNEL_ERROR');
  await wait(80);
  check(
    'G late status after close is inert',
    stub.channels.length === channelsAtClose,
    `channels=${stub.channels.length}`
  );
}

fs.rmSync(outDir, { recursive: true, force: true });
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} realtime reconnect checks passed`);
process.exit(failed.length ? 1 : 0);
