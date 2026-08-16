/**
 * Headless verifier for the Snake benchmark.
 *
 * Loads the <script> block out of snake.html, runs it against a stubbed canvas /
 * localStorage / requestAnimationFrame, and drives it with synthetic keyboard events
 * and a controlled clock. Nothing is eyeballed: every requirement that can be checked
 * mechanically is checked here.
 *
 * Usage:  node verify.js [path/to/file.html]
 */

const fs = require('fs');
const path = require('path');

const target = process.argv[2] || path.join(__dirname, 'snake.html');
const html = fs.readFileSync(target, 'utf8');
const match = html.match(/<script>([\s\S]*?)<\/script>/);
if (!match) {
  console.error('No inline <script> block found in ' + target);
  process.exit(1);
}
const code = match[1];

/** Boot a fresh instance of the game in a sandbox. */
function boot(seed = 1, preload = null) {
  let s = seed;
  const rects = [], texts = [], arcs = [], prevented = [];
  let curFill = '', rafCb = null, handler = null;
  const store = preload ? { ...preload } : {};

  const ctx = {
    set fillStyle(v) { curFill = v; }, get fillStyle() { return curFill; },
    strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
    fillRect: (x, y, w, h) => rects.push({ x, y, w, h, c: curFill }),
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {},
    arc: (x, y, r) => arcs.push({ x, y, r, c: curFill }),
    fillText: t => texts.push(t),
  };

  const sandbox = {
    document: { getElementById: () => ({ getContext: () => ctx }) },
    window: { addEventListener: (ev, fn) => { if (ev === 'keydown') handler = fn; } },
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = v; },
    },
    performance: { now: () => 0 },
    requestAnimationFrame: cb => { rafCb = cb; },
    Math: Object.create(Math),
  };
  // Deterministic PRNG so runs are reproducible.
  sandbox.Math.random = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };

  const names = Object.keys(sandbox);
  new Function(...names, code)(...names.map(n => sandbox[n]));

  // Reconstruct game state from what was drawn this frame.
  const state = () => {
    const body = rects
      .filter(r => r.c === '#4ade80' || r.c === '#16a34a')
      .map(r => ({ x: (r.x - 1) / 20, y: (r.y - 1) / 20, head: r.c === '#16a34a' }));
    return {
      head: body.find(b => b.head), body, len: body.length,
      food: arcs.length ? { x: (arcs[0].x - 10) / 20, y: (arcs[0].y - 10) / 20 } : null,
      texts: texts.slice(),
      score: +(texts.find(t => t.startsWith('Score:')) || 'Score: -1').slice(7),
      best: +(texts.find(t => t.startsWith('Best:')) || 'Best: -1').slice(6),
      over: texts.some(t => t.includes('GAME OVER')),
      paused: texts.includes('PAUSED'),
    };
  };

  let t = 0;
  const frame = dt => {
    t += dt;
    rects.length = 0; texts.length = 0; arcs.length = 0;
    const cb = rafCb; rafCb = null; cb(t);
    return state();
  };
  const run = (ms, fps) => {
    const step = 1000 / fps;
    let last;
    for (let i = 0; i < Math.round(ms / step); i++) last = frame(step);
    return last;
  };
  const key = c => handler({ code: c, repeat: false, preventDefault: () => prevented.push(c) });

  frame(0); // establish the clock baseline
  return { frame, run, key, state: () => frame(0), prevented, store };
}

const results = [];
const check = (name, pass, detail) => results.push({ name, pass, detail });

/** Advance in 1ms slices until the head moves; returns how long the tick took. */
function tickOnce(g, maxMs = 400) {
  const before = g.state().head;
  for (let i = 0; i < maxMs; i++) {
    const s = g.frame(1);
    if (!s.head || s.over) return { s, ms: i + 1 };
    if (s.head.x !== before.x || s.head.y !== before.y) return { s, ms: i + 1 };
  }
  return { s: g.state(), ms: maxMs };
}

/** Greedy food-seeking autopilot; exercises eating, growth, scoring and the speed ramp. */
function autopilot(g, maxTicks) {
  let prev = g.state().head, foods = 0;
  const stepMs = [];
  for (let n = 0; n < maxTicks; n++) {
    const s = g.state();
    if (s.over || !s.head || !s.food) break;
    const { head, food, body } = s;
    const back = { x: prev.x - head.x, y: prev.y - head.y };
    const opts = [
      { c: 'ArrowRight', x: 1, y: 0 }, { c: 'ArrowLeft', x: -1, y: 0 },
      { c: 'ArrowDown', x: 0, y: 1 }, { c: 'ArrowUp', x: 0, y: -1 },
    ]
      .filter(o => !(o.x === back.x && o.y === back.y))
      .filter(o => {
        const nx = head.x + o.x, ny = head.y + o.y;
        return nx >= 0 && ny >= 0 && nx < 30 && ny < 30 &&
          !body.slice(0, -1).some(b => b.x === nx && b.y === ny);
      })
      .sort((a, b) =>
        (Math.abs(head.x + a.x - food.x) + Math.abs(head.y + a.y - food.y)) -
        (Math.abs(head.x + b.x - food.x) + Math.abs(head.y + b.y - food.y)));
    if (!opts.length) break;
    g.key(opts[0].c);
    prev = head;
    const before = s.score;
    const r = tickOnce(g);
    stepMs.push(r.ms);
    if (r.s.score > before) foods++;
  }
  return { foods, stepMs, final: g.state() };
}

// -- req 11: fixed timestep, decoupled from the frame rate ---------------------
{
  const at = fps => {
    const g = boot(); const step = 1000 / fps; let last;
    for (let i = 0; i < Math.round(1060 / step); i++) last = g.frame(step);
    return last.head.x;
  };
  const r = [at(30), at(60), at(75), at(120), at(144), at(240)];
  check('req 11  frame-rate independence (30-240fps)', r.every(v => v === r[0]) && r[0] === 23,
    `head x = ${r.join(', ')} after 1060ms (expected 23 everywhere = 15 + 8 moves)`);
}

// -- req 3: the snake can never reverse into itself ---------------------------
{
  const g = boot();
  g.key('ArrowUp'); g.key('ArrowLeft');          // second input is an illegal reversal
  const s1 = g.run(130, 60);
  const s2 = g.run(130, 60);
  check('req 3   reversal blocked (Up then Left in one tick)',
    s1.head.x === 15 && s1.head.y === 14, `head = (${s1.head.x},${s1.head.y}), expected (15,14)`);
  g.key('ArrowDown');                             // now illegal relative to Up
  const s3 = g.run(130, 60);
  check('req 3   reversal blocked after turning',
    s3.head.y < s2.head.y, `y went ${s2.head.y} -> ${s3.head.y} (kept heading up)`);
}

// -- req 4: food never spawns on the snake ------------------------------------
{
  let violations = 0; const cells = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const g = boot(seed);
    for (let i = 0; i < 12; i++) {
      const s = g.run(130, 60);
      if (!s.head) break;
      if (s.food) {
        cells.add(s.food.x + ',' + s.food.y);
        if (s.body.some(b => b.x === s.food.x && b.y === s.food.y)) violations++;
      }
    }
  }
  check('req 4   food never overlaps the body', violations === 0,
    `${violations} violations over 40 seeds, ${cells.size} distinct spawn cells`);
}

// -- req 7: pause freezes the game and swallows direction input ---------------
{
  const g = boot();
  const before = g.run(300, 60);
  g.key('Space');
  g.key('ArrowUp');                               // must be ignored while paused
  const during = g.run(500, 60);
  check('req 7   pause freezes the snake',
    during.head.x === before.head.x && during.head.y === before.head.y,
    `(${before.head.x},${before.head.y}) -> (${during.head.x},${during.head.y})`);
  check('req 7   PAUSED overlay drawn', during.paused, during.texts.join(' | '));
  g.key('Space');
  const after = g.run(200, 60);
  check('req 7   Space resumes, swallowed input not replayed',
    after.head.x > during.head.x && after.head.y === during.head.y,
    `resumed at (${after.head.x},${after.head.y}), still heading right`);
}

// -- req 6: wall collision ends the game, R restarts --------------------------
{
  const g = boot();
  const dead = g.run(3000, 60);
  check('req 6   wall collision ends the game', dead.over, dead.texts.join(' | '));
  g.key('KeyR');
  const fresh = g.run(20, 60);
  check('req 6   R restarts to length 3 at the centre',
    fresh.len === 3 && fresh.head.x === 15 && fresh.head.y === 15,
    `len=${fresh.len}, head=(${fresh.head.x},${fresh.head.y})`);
}

// -- req 12: preventDefault on arrows and space, and nothing else -------------
{
  const g = boot();
  ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyR'].forEach(g.key);
  const p = g.prevented;
  check('req 12  preventDefault scoped to arrows + space',
    p.length === 5 && !p.includes('KeyW') && !p.includes('KeyR'), p.join(', '));
}

// -- reqs 5, 8, 9: eating, growth, scoring, speed ramp, high score ------------
{
  const g = boot(7);
  const { foods, stepMs, final } = autopilot(g, 900);
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  check('req 5   length == 3 + food eaten', final.len === 3 + foods,
    `len=${final.len}, food eaten=${foods}`);
  check('req 5   score == 10 x food eaten', final.score === foods * 10,
    `score=${final.score}, food eaten=${foods}`);
  check('req 9   speed ramps up as food is eaten', foods < 5 || avg(stepMs.slice(-3)) < avg(stepMs.slice(0, 3)),
    `tick interval ${avg(stepMs.slice(0, 3)).toFixed(0)}ms -> ${avg(stepMs.slice(-3)).toFixed(0)}ms over ${foods} food`);
  check('req 8   high score written to localStorage',
    g.store.snakeHighScore === String(Math.max(final.score, final.best)),
    JSON.stringify(g.store));
}
{
  const g = boot(1, { snakeHighScore: '420' });
  check('req 8   high score read back on load', g.state().best === 420, `Best: ${g.state().best}`);
}

// -- report -------------------------------------------------------------------
const width = Math.max(...results.map(r => r.name.length));
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name.padEnd(width)}  ${r.detail}`);
}
const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
