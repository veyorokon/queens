# Kitchen Table Queens

A Queens-style logic puzzle for an iPad. Place one crown in every row, every
column and every colour region. Crowns may never touch, not even at a corner.

- **150 campaign puzzles**, ramped from gentle 7x7 boards to hard 10x10 ones,
  plus a Random mode that makes a fresh puzzle on the device.
- **Every puzzle has exactly one answer** and can be reached by reasoning
  alone. Nothing needs a guess. The generator proves both before a puzzle ships.
- Tap a square once for a cross, twice for a crown, once more to clear it.
  Drag a finger to cross out a run of squares.
- **Auto X** crosses out everything a crown rules out, and takes those crosses
  back when the crown comes off.
- A crown that breaks a rule turns red straight away, along with the crown it
  clashes with. Mistakes are counted and never go down, even after Undo.
- Hint marks one square that can be proved and says why in a line.
- English and Persian, right to left with Persian numerals. Light and dark.
- No ads, no timers counting down, no lives. The clock only counts up.
- The game in progress, the campaign record and the best time per board size
  are all kept on the device.

Single static page, no build step. Add to Home Screen on an iPad for a
full-screen app with its own icon.

## Building the puzzles

```
node tools/test.js                     # engine checks and generation timings
node tools/build.js                    # regenerates levels.js
node tools/mirror.js [out.html]        # refreshes core.js, and writes the single-file mirror
python3 tools/icons.py .               # regenerates the app icons
```

`tools/core.js` holds the board model, the solution counter, the
technique-based rater and the generator. The page cannot `require` it, so
`core.js` at the root is a copy that `tools/mirror.js` refreshes and
`tools/test.js` refuses to let drift. Edit the one under `tools/`.

`tools/build.js` is seeded, so rebuilding produces the same 210 puzzles.
Each one is re-decoded from its codec string and re-proved to have a single
solution reachable without guessing before it is written.
