/**
 * Multiplayer roster verification (written BEFORE the fix — checks 2-6 must
 * fail against a studio that trusts the presence roster blindly).
 *
 * The bug it locks out: presence and broadcast are two different guarantees.
 * A controller whose presence `track` was still retrying (or whose slot has
 * not synced yet) broadcasts motion, stamps and actions perfectly well, and
 * the studio used to drop every one of them because the sender was not in the
 * roster — "someone's remote wasn't showing on my screen but I could see them
 * spraying and it was working on theirs".
 *
 * Contract:
 *  - traffic from an unknown player mints a provisional roster entry, applied
 *    to the very packet that revealed them (motion must not lose the sample);
 *  - paint from an unknown player both lands on the texture AND puts them on
 *    the roster;
 *  - a presence roster that has not caught up yet does not evict a player who
 *    is actively sending;
 *  - a runaway sender cannot grow the roster without bound.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:4173';
const RES = 2048;

const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
await page.addInitScript(() => {
  try {
    localStorage.setItem('airo:guide:studio', '1');
    localStorage.setItem('airo:guide:controller', '1');
  } catch {}
});
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));

await page.goto(`${BASE}/canvas/MP1?debug`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(11000);
await page.waitForFunction(() => typeof window.__airoSim === 'function');

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

// Keep the render loop alive (headless chromium only renders on demand).
const tick = async (ms) => {
  const steps = Math.ceil(ms / 60);
  for (let i = 0; i < steps; i++) {
    await page.mouse.move(30 + (i % 2), 30);
    await page.waitForTimeout(60);
  }
};

const sim = (event, payload) => page.evaluate(([e, p]) => window.__airoSim(e, p), [event, payload]);
const roster = () => page.evaluate(() => (window.__airoPlayers ? window.__airoPlayers() : null));
const probe = (u, v) =>
  page.evaluate(([pu, pv]) => (window.__airoPaintProbe ? window.__airoPaintProbe(pu, pv) : null), [u, v]);

/* 1: the roster probe exists, and a fresh studio holds only the host. */
const initial = await roster();
check(
  '1 roster probe, host only',
  Array.isArray(initial) && initial.length === 1 && initial[0].isHost === true,
  `roster=${JSON.stringify(initial)}`
);

/* 2: motion from a player presence has not announced still aims a cursor. */
for (let i = 0; i < 8; i++) {
  await sim('motion', { playerId: 'ghost-1', x: 0.3, y: 0.4 });
  await page.waitForTimeout(40);
}
await tick(300);
const afterMotion = await roster();
const ghost1 = (afterMotion || []).find((p) => p.id === 'ghost-1');
check(
  '2 unknown motion mints a player',
  !!ghost1 &&
    Math.abs(ghost1.x - 0.3 * RES) < 24 &&
    Math.abs(ghost1.y - 0.4 * RES) < 24,
  `ghost-1=${JSON.stringify(ghost1)} expected cursor≈(${0.3 * RES}, ${0.4 * RES})`
);

/* 3: paint from an unknown player lands AND puts them on the roster. */
const U = 0.72;
const V = 0.28;
const before = await probe(U, V);
await sim('paint-stamps', {
  playerId: 'ghost-2',
  playerName: 'Ghost Two',
  tool: 'spray',
  color: '#22D3EE',
  state: 'paint',
  strokeId: 'ghost-2#s1',
  // Flat [u, v, radiusPx, opacity] quads — the packStamps wire format.
  stamps: [U, V, 70, 1, U, V, 70, 1],
  cursor: [U, V],
});
await tick(500);
const afterPaint = await roster();
const ghost2 = (afterPaint || []).find((p) => p.id === 'ghost-2');
const painted = await probe(U, V);
check(
  '3 unknown paint mints a player',
  !!ghost2,
  `ghost-2=${JSON.stringify(ghost2)} roster=${(afterPaint || []).map((p) => p.id).join(',')}`
);
check(
  '3 unknown paint still lands',
  !!painted && painted[3] > 40 && (!before || before[3] < 32),
  `alpha before=${before ? before[3] : 'n/a'} after=${painted ? painted[3] : 'n/a'}`
);

/* 4: an action from that same player toggles their painting state. */
await sim('action', { playerId: 'ghost-1', action: 'spray', state: 'start' });
await tick(300);
const spraying = ((await roster()) || []).find((p) => p.id === 'ghost-1');
check('4 action starts painting', spraying?.isPainting === true, `isPainting=${spraying?.isPainting}`);
await sim('action', { playerId: 'ghost-1', action: 'spray', state: 'end' });
await tick(300);
const stopped = ((await roster()) || []).find((p) => p.id === 'ghost-1');
check('4 action ends painting', stopped?.isPainting === false, `isPainting=${stopped?.isPainting}`);

/* 5: a presence roster that has not caught up must not evict an active player.
 *    "Active" is the whole point of the grace window, so both ghosts send once
 *    more immediately before the stale roster lands. */
await sim('motion', { playerId: 'ghost-1', x: 0.3, y: 0.4 });
await sim('paint-stamps', {
  playerId: 'ghost-2',
  tool: 'spray',
  color: '#22D3EE',
  state: 'paint',
  strokeId: 'ghost-2#s1',
  stamps: [U, V, 70, 1],
});
await sim('player-list-update', []);
await tick(400);
const afterRoster = (await roster()) || [];
check(
  '5 stale roster keeps active players',
  afterRoster.some((p) => p.id === 'ghost-1') && afterRoster.some((p) => p.id === 'ghost-2'),
  `roster=${afterRoster.map((p) => p.id).join(',')}`
);

/* 6: minting is bounded — a runaway sender cannot grow the roster forever. */
for (let i = 0; i < 20; i++) {
  await sim('motion', { playerId: `flood-${i}`, x: 0.5, y: 0.5 });
}
await tick(300);
const flooded = (await roster()) || [];
const remotes = flooded.filter((p) => !p.isHost).length;
check('6 provisional roster is capped', remotes <= 8, `${remotes} remote players (cap 8)`);

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} multiplayer checks passed`);
process.exit(failed.length ? 1 : 0);
