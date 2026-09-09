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
- **Hint takes two taps and never three.** The first says the rule in one
  short sentence, washes the rows, columns and colours it turns on, and draws
  the crosses that follow faintly where they go. The second puts them on the
  board, and hands you the crown if one follows straight away. A crown that can
  be proved outright arrives on the first tap. Every word comes from the solver
  working on the crowns and crosses already on the board, so a cross you have
  made is a fact it reasons from, and a cross where a crown belongs is called
  out the way a wrong crown is.
- **Every hint is a statement about the board as it stands.** None of them
  asks you to put a crown down in your head and see what it forces. There are
  three rules and each is one short line she can check by looking: a row,
  column or colour with one square left; k units of one kind whose squares all
  sit inside k units of another; and a square that every square some unit has
  left already rules out. No puzzle ships that cannot be finished on those
  three alone.
- English only. Light and dark.
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

A puzzle's difficulty is the reasoning it actually asks for, over the same
three rules the hint says out loud. Easy is singles and one-unit confinement
and nothing else. Medium needs the touching rule or a two-unit subset. Hard
needs a subset of three or four units, or enough of the middling steps in one
chain to cross the effort score. The colour sizes are a separate requirement of
each band, and a board that fails them is thrown away rather than shipped under
an easier label.

`tools/build.js` is seeded, so rebuilding produces the same 318 puzzles.
Each one is re-decoded from its codec string and re-proved to have a single
solution reachable without guessing before it is written.
