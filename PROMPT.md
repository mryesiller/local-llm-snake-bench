# The prompt

Given to the model verbatim, as a single user message. No follow-ups, no clarifications,
no retries — one turn, one file.

The design goal was that **every requirement can be checked mechanically**, so the result
is a score rather than an opinion. Requirements 3, 4, 7 and 11 are deliberate traps:
they are the ones naive implementations get wrong, and they fail silently rather than
throwing an error.

---

```
Build a complete, single-file browser game.

OUTPUT RULES
- Return exactly one complete HTML document, starting with <!DOCTYPE html>.
- All CSS and JavaScript must be inline in that same file.
- No external files, no CDN links, no imports, no image or audio assets.
- Output only the code inside a single fenced block. No explanation before or after it.
- Keep the entire file under 250 lines.

GAME: Snake

REQUIREMENTS
1.  A 600x600 <canvas>, centered on the page, representing a 30x30 grid of 20px cells.
2.  The snake starts with length 3 at the center of the grid, moving right, at 8 moves
    per second.
3.  Arrow keys and WASD change direction. The snake must never be able to reverse
    directly into itself within a single move.
4.  Exactly one food cell exists at any time. It spawns at a uniformly random empty
    cell and must never spawn on top of the snake's body.
5.  Eating food grows the snake by 1 segment and adds 10 points to the score.
6.  Hitting a wall or the snake's own body ends the game. Draw a
    "GAME OVER - press R to restart" overlay on the canvas. Pressing R fully resets
    the game state.
7.  Space toggles pause and displays a "PAUSED" overlay. Input other than Space and R
    is ignored while paused.
8.  Show the current score in the top-left of the canvas, and a high score persisted
    across page reloads via localStorage.
9.  Every 5 food eaten, movement speed increases by 5%, capped at 20 moves per second.
10. Dark theme: page and canvas background #111111, snake body #4ade80 with a visibly
    darker head, food #ef4444, subtle #222222 grid lines.
11. Movement must use a fixed timestep accumulator decoupled from requestAnimationFrame,
    so game speed is identical on a 60Hz and a 144Hz display.
12. Arrow keys and Space must not scroll the page.
13. The game must run with zero errors and zero warnings in the browser console.
```

---

## Why these four requirements are the interesting ones

**Req 11 — fixed timestep.** The lazy implementation moves the snake inside the
`requestAnimationFrame` callback, which ties game speed to the monitor refresh rate:
the same code plays nearly 2.4x faster on a 144Hz display than on 60Hz. The second-lazy
implementation reaches for `setInterval`, which drifts and stalls when the tab is
backgrounded. Passing this requires an explicit accumulator.

**Req 3 — no reversal.** The obvious implementation writes the new direction straight
into the direction variable on keydown. Moving right, a fast Up-then-Left within one tick
then turns the snake directly into its own neck and kills the player through no fault of
their own. The fix is to validate each input against the last *committed* direction and
to defer the change to the next tick.

**Req 4 — food placement.** The obvious implementation picks a random cell and hopes.
The correct one excludes occupied cells — and must also cope with a full board rather
than spinning forever in a rejection loop.

**Req 7 — pause semantics.** Usually implemented as "stop the loop" while leaving the
input handler live, so direction changes queue up invisibly and fire the moment you
unpause.

An implicit fifth trap sits inside requirement 6: **self-collision must exclude the tail
segment**, because the tail vacates its cell on the same tick the head arrives. Get this
wrong and the snake dies from a phantom collision the instant it turns back on itself.

## Scoring

`verify.js` in this repo checks 13 of these mechanically against the produced HTML file.
Requirement 13 (clean console) and requirement 1's visual centering are the two that
still need a human to open the file.
