# Code review — `snake.html`

Reviewer: **Claude Opus 5** (Anthropic), running in Claude Code.
Subject: the unmodified output of Qwen3.8-27B-UD-Q2_K_XL.

Method: static reading, plus the headless harness in [`verify.js`](verify.js), which runs
the game against a stubbed canvas and drives it with a synthetic clock and synthetic key
events. Claims below marked *(verified)* were measured, not eyeballed.

**Verdict: 13/13 requirements met. 181 of a permitted 250 lines. No correctness bugs found.**

---

## What the model got right

### Requirement 11 — fixed timestep *(verified)*

```js
function frame(now) {
  let dt = now - lastTime;
  lastTime = now;
  if (dt > 250) dt = 250; // clamp long gaps (e.g. tab switch) to avoid a catch-up burst
  if (!paused && !gameOver) {
    acc += dt;
    const step = 1000 / speed;
    while (acc >= step && !gameOver) { acc -= step; tick(); }
  }
  render();
  requestAnimationFrame(frame);
}
```

A textbook accumulator. Driven at 30, 60, 75, 120, 144 and 240 fps for 1060 simulated
milliseconds, the snake finished on the identical cell (x=23) in all six runs.

The 250ms clamp was not asked for. It stops the accumulator from replaying a long
backgrounded gap as a burst of instant moves — a bug the requirement does not mention and
most implementations ship with.

`lastTime` is seeded from `performance.now()`, which shares a time origin with the
`DOMHighResTimeStamp` that `requestAnimationFrame` passes, so the first frame's `dt` is
correct rather than absurd.

### Requirement 3 — reversal is genuinely impossible *(verified)*

```js
const d = DIRS[k];
if (!d || (d.x === -dir.x && d.y === -dir.y)) return; // never reverse into itself
pendingDir = d;
```

The comparison is against `dir` — the direction already committed by the last tick — not
against `pendingDir`. That is the correct choice, and it means `pendingDir` can only ever
hold a direction perpendicular to `dir`, so no input sequence can produce a reversal.

Tested: moving right, `ArrowUp` then `ArrowLeft` inside a single tick window turns the
snake up and discards the Left. Then, moving up, `ArrowDown` is discarded too.

### Requirement 4 — food placement *(verified)*

```js
const taken = new Set(snake.map(p => p.x * GRID + p.y));
const empty = [];
for (let i = 0; i < GRID * GRID; i++) if (!taken.has(i)) empty.push(i);
if (empty.length === 0) { food = null; return; }
```

Enumerate-then-pick rather than reject-and-retry. Uniform over empty cells by
construction, and terminating even when the board is full — the case a rejection loop
hangs on. The `x * GRID + y` encoding is collision-free for `y < GRID`, and the decode
matches. 40 seeds x 12 spawns: zero overlaps with the body.

### The tail-vacates rule — the trap inside requirement 6

```js
const willEat = food !== null && head.x === food.x && head.y === food.y;
const limit = willEat ? snake.length : snake.length - 1;
```

When the snake is not eating, its tail leaves its cell on this tick, so the head is
allowed to move into it; when it *is* eating, the tail stays and the whole body counts.
This is the single most commonly botched line in a Snake implementation, and it is
correct here. (It is safe to check all segments in the eating branch precisely because
food never spawns on the body.)

### The rest *(verified)*

| Req | Check | Result |
|---|---|---|
| 5 | length == 3 + food eaten; score == 10 x food | 17 food eaten -> length 20, score 170 |
| 7 | pause freezes the snake, swallows direction input, Space resumes | exact |
| 8 | high score written to and read back from `localStorage` | both directions |
| 9 | speed ramp | tick interval 125ms -> 108ms over 17 food; 8 x 1.05³ = 9.26 moves/s, exactly as specified |
| 12 | `preventDefault` on arrows and Space, nothing else | 5 of 7 test keys prevented; W and R untouched |

Style is consistent throughout: `'use strict'`, IIFE encapsulation, `try/catch` around
`localStorage` (private browsing throws on access), the whole grid stroked as a single
path, `+0.5` offsets so 1px lines land on pixel boundaries, and the head drawn last so it
paints over the body.

Using `e.code` rather than `e.key` is the right call for WASD: it identifies the physical
key position, so the WASD cluster stays in the same place on an AZERTY keyboard.

---

## Findings

No bug changes the outcome of a game. These are ranked by how much they would actually
bother a player or a maintainer.

### 1. The single-slot direction buffer drops queued input

`pendingDir` holds one direction. Moving right, pressing Down then Left inside one tick:
Down is accepted; Left is then validated against `dir`, which is *still* right, so it is
rejected as a reversal. The player's intended U-turn silently disappears and has to be
re-entered. Harmless at the 125ms starting tick, increasingly annoying as the interval
drops toward 50ms.

Fix — a two-slot queue, validating each input against the last *queued* direction:

```js
const last = queue.length ? queue[queue.length - 1] : dir;
if (!d || (d.x === -last.x && d.y === -last.y)) return;
if (queue.length < 2) queue.push(d);
```

### 2. No `devicePixelRatio` scaling

The canvas has 600 CSS pixels and a 600-pixel backing store, so on any HiDPI display the
grid lines and text are resampled and soft.

```js
const dpr = window.devicePixelRatio || 1;
canvas.width = SIZE * dpr; canvas.height = SIZE * dpr;
canvas.style.width = canvas.style.height = SIZE + 'px';
ctx.scale(dpr, dpr);
```

### 3. The difficulty curve is nearly flat

This one is the prompt's fault, not the model's — it implemented requirement 9 exactly as
written. But compounding 5% every 5th food means reaching the 20 moves/s cap takes 19
increases, i.e. **95 food, 950 points**. After 20 food the snake is still only at 9.7
moves/s. The cap is close to decorative. `speed * 1.15`, or a bump every 3 food, would
actually be felt.

### 4. A backgrounded tab keeps playing

The 250ms clamp limits the damage, but you still return to a snake that has moved two
cells while you were away — occasionally into a wall. One line fixes it:

```js
document.addEventListener('visibilitychange', () => { if (document.hidden) paused = true; });
```

### 5. Fixed 600px layout overflows small viewports

No `<meta name="viewport">`, no scaling, no touch controls. On a phone the canvas simply
runs off the side. Out of scope for the prompt, but it is the first thing anyone opening
the link on mobile will hit.

### Minor

- `saveHigh()` is called both when a record is beaten mid-game and again in `endGame()`.
  Redundant, but deliberate-looking: it preserves the score if the tab is closed
  mid-game.
- `return endGame();` returns the value of a void function to exit early. It works; it
  reads oddly.
- `spawnFood()` allocates a 900-element array and a `Set` on every food. Irrelevant at
  this scale, and it is the right trade for guaranteed termination.

---

## Assessment

For a nominally 2-bit quantization of a 27B model this is well above expectation. The
four requirements designed to separate real implementations from plausible-looking ones
were all handled, and the unrequested 250ms clamp suggests the behaviour was reasoned
about rather than pattern-matched from a training-set Snake.

The likely explanation for the gap between "Q2" and this output quality is the
quantization itself: `UD-Q2_K_XL` is Unsloth Dynamic, which assigns different bit widths
per layer instead of quantizing uniformly, keeping the layers that matter closer to full
precision. The nominal bit count undersells it.

Where the aggressive quantization would be expected to show is not in one-shot code
generation but in long multi-step tool-calling chains and strict structured output. This
test does not measure either.
