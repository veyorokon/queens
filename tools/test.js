/* node queens-tools/test.js — checks the engine before any puzzle ships. */
const C = require('./core.js');

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  ' + extra : '')); }
};
const head = s => console.log('\n' + s);

// ------------------------------------------------------------ 0. copies
head('0. the page and the tools run the same engine');
{
  // index.html loads core.js from the site root with a script tag; the tools
  // require it from here. tools/mirror.js refreshes that copy, and this is the
  // check that catches an edit made to only one of them.
  const mine = fs.readFileSync(path.join(__dirname, 'core.js'), 'utf8');
  const sitePath = path.join(__dirname, '..', 'core.js');
  const site = fs.existsSync(sitePath) ? fs.readFileSync(sitePath, 'utf8') : null;
  ok('core.js at the site root matches tools/core.js', site === mine,
    site === null ? 'the site copy is missing; run node tools/mirror.js' : 'they have drifted; run node tools/mirror.js');
}

// ------------------------------------------------------------ 1. solver
head('1. solution counting on hand-made boards');
{
  // Every region is a whole row, so the colour rule adds nothing: the two
  // answers are the two no-touch column orders of a 4x4.
  const twoBoard = C.decode('4|aaaabbbbccccdddd|0000|0');
  ok('rows-as-regions 4x4 has exactly 2 solutions', C.countSolutions(4, twoBoard.regions, 99) === 2, String(C.countSolutions(4, twoBoard.regions, 99)));

  // Colours a and b both live entirely in the top row, so both would need
  // that row's single crown.
  const noneBoard = C.decode('5|aabbbcccddcccddeeeddeeedd|00000|0');
  ok('two colours trapped in one row: 0 solutions', C.countSolutions(5, noneBoard.regions, 99) === 0);

  const uniq = C.decode('5|aaabbaacbbacccdaeeddaaedd|03142|2');
  ok('hand-checked 5x5 has exactly 1 solution', C.countSolutions(5, uniq.regions, 99) === 1);
  ok('found solution matches the stored one', String(C.findSolution(5, uniq.regions)) === String(uniq.sol));
  ok('verify() accepts it', C.verify(uniq));

  // A brute force over column permutations, written a different way, must
  // agree with the fast counter.
  const brute = (N, reg) => {
    const cols = [...Array(N).keys()];
    let n = 0;
    (function perm(a, k) {
      if (k === N) {
        for (let r = 0; r + 1 < N; r++) if (Math.abs(a[r] - a[r + 1]) <= 1) return;
        const seen = new Set();
        for (let r = 0; r < N; r++) { const g = reg[r * N + a[r]]; if (seen.has(g)) return; seen.add(g); }
        n++; return;
      }
      for (let i = k; i < N; i++) { [a[k], a[i]] = [a[i], a[k]]; perm(a, k + 1); [a[k], a[i]] = [a[i], a[k]]; }
    })(cols, 0);
    return n;
  };
  const rnd = C.makeRng(4242);
  let agree = 0;
  for (let k = 0; k < 60; k++) {
    const N = 6 + (k % 2);
    const sol = C.randomPlacement(N, rnd);
    const reg = C.growRegions(N, sol, rnd);
    if (C.countSolutions(N, reg, 1e9) === brute(N, reg)) agree++;
  }
  ok('fast counter agrees with brute force on 60 random boards', agree === 60, agree + '/60');
}

// ------------------------------------------------------------ 2. conflicts
head('2. conflict detection');
{
  const p = C.decode('5|aaabbaacbbacccdaeeddaaedd|03142|2');
  const idx = (r, c) => r * 5 + c;
  const clean = p.sol.map((c, r) => idx(r, c));
  ok('the solution has no conflicts', C.conflicts(5, p.regions, clean).size === 0);
  ok('same row is a conflict', C.conflicts(5, p.regions, [idx(0, 0), idx(0, 3)]).size === 2);
  ok('same column is a conflict', C.conflicts(5, p.regions, [idx(0, 2), idx(3, 2)]).size === 2);
  ok('touching diagonally is a conflict', C.conflicts(5, p.regions, [idx(1, 1), idx(2, 2)]).size === 2);
  ok('same colour is a conflict', C.conflicts(5, p.regions, [idx(0, 0), idx(4, 1)]).size === 2);
  ok('a knight-move apart is fine', C.conflicts(5, p.regions, [idx(0, 0), idx(2, 3)]).size === 0);
}

// ------------------------------------------------------------ 3. codec
head('3. codec round-trip');
{
  const rnd = C.makeRng(77);
  let bad = 0, longest = 0;
  for (let k = 0; k < 40; k++) {
    const N = 7 + (k % 4);
    const p = C.makePuzzle(N, rnd);
    if (!p) { k--; continue; }
    const s = C.encode(p);
    longest = Math.max(longest, s.length);
    const d = C.decode(s);
    if (d.N !== p.N || String(d.sol) !== String(p.sol) || d.band !== p.band) bad++;
    if (String(Array.from(d.regions)) !== String(Array.from(p.regions))) bad++;
    if (C.encode(d) !== s) bad++;
  }
  ok('40 puzzles survive encode -> decode -> encode', bad === 0, bad + ' mismatches');
  ok('longest codec string stays small (' + longest + ' bytes)', longest <= 130);
}

// ------------------------------------------------------------ 4. generator
head('4. every generated puzzle has exactly one solution');
{
  const rnd = C.makeRng(31337);
  const made = [];
  while (made.length < 100) {
    const N = 7 + (made.length % 4);
    const p = C.makePuzzle(N, rnd);
    if (p) made.push(p);
  }
  ok('100 generated puzzles: exactly one solution each', made.every(p => C.countSolutions(p.N, p.regions, 3) === 1));
  ok('100 generated puzzles: stored answer is that solution', made.every(p => C.verify(p)));
  ok('100 generated puzzles: solvable by technique, no guessing', made.every(p => C.rate(p.N, p.regions).solved));
  ok('every colour is one connected blob', made.every(p => {
    const N = p.N, nbr = C.neighbours(N);
    for (let g = 0; g < N; g++) {
      const cells = [];
      for (let i = 0; i < N * N; i++) if (p.regions[i] === g) cells.push(i);
      if (!cells.length) return false;
      const seen = new Set([cells[0]]), st = [cells[0]];
      while (st.length) { const i = st.pop(); for (const j of nbr[i]) if (p.regions[j] === g && !seen.has(j)) { seen.add(j); st.push(j); } }
      if (seen.size !== cells.length) return false;
    }
    return true;
  }));
  ok('every colour holds exactly one queen of the answer', made.every(p => {
    const seen = new Set();
    for (let r = 0; r < p.N; r++) seen.add(p.regions[r * p.N + p.sol[r]]);
    return seen.size === p.N;
  }));
}

// ------------------------------------------------------------ 5. rater
head('5. the rater never calls a guessy board solvable');
{
  const rnd = C.makeRng(909);
  let checked = 0, wrong = 0, easyOnMulti = 0;
  while (checked < 200) {
    const N = 7 + (checked % 3);
    const sol = C.randomPlacement(N, rnd);
    const reg = C.growRegions(N, sol, rnd);
    const n = C.countSolutions(N, reg, 2);
    if (n === 1) continue;               // those are the good ones, skip
    checked++;
    const r = C.rate(N, reg);
    if (r.solved) wrong++;
    if (r.solved && r.band === 0) easyOnMulti++;
  }
  ok('200 boards with 0 or 2+ solutions: rater solves none of them', wrong === 0, wrong + ' solved');
  ok('none of them are labelled Easy', easyOnMulti === 0);

  // band must line up with the tier of rule the solver actually needed
  const made = [];
  const r2 = C.makeRng(515);
  while (made.length < 60) { const p = C.makePuzzle(7 + (made.length % 4), r2); if (p) made.push(p); }
  ok('Hard is exactly the set that needed a disproof', made.every(p => {
    const r = C.rate(p.N, p.regions);
    return (r.band === 2) === (r.rounds[3] > 0);
  }));
  ok('Easy puzzles never needed a disproof', made.filter(p => p.band === 0).every(p => C.rate(p.N, p.regions).rounds[3] === 0));
  ok('rating is deterministic', made.every(p => C.rate(p.N, p.regions).band === C.rate(p.N, p.regions).band));
}

// ------------------------------------------------------------ 6. hints
head('6. hints');
{
  const rnd = C.makeRng(6060);
  const made = [];
  while (made.length < 20) { const p = C.makePuzzle(7 + (made.length % 4), rnd); if (p) made.push(p); }
  let good = 0, wrongCaught = 0;
  for (const p of made) {
    const N = p.N;
    const h = C.hint(N, p.regions, p.sol, []);
    if (h && h.kind === 'place' && p.sol[h.r] === h.c) good++;
    // a crown in the wrong place must be called out
    let bad = -1;
    for (let c = 0; c < N && bad < 0; c++) if (c !== p.sol[0]) bad = c;
    const h2 = C.hint(N, p.regions, p.sol, [0 * N + bad]);
    if (h2 && h2.kind === 'wrong' && h2.r === 0 && h2.c === bad) wrongCaught++;
  }
  ok('the first hint always lands on a real answer square', good === 20, good + '/20');
  ok('a crown off the answer is reported as wrong', wrongCaught === 20, wrongCaught + '/20');

  // hints alone must be able to finish a puzzle
  const p = made[0], N = p.N;
  const placed = [];
  let steps = 0;
  while (placed.length < N && steps++ < 40) {
    const h = C.hint(N, p.regions, p.sol, placed);
    if (!h || h.kind !== 'place') break;
    placed.push(h.r * N + h.c);
  }
  ok('following hints alone solves a puzzle', placed.length === N, placed.length + '/' + N);
}

// ------------------------------------------------- 7. the wrong-crown hint
head('7. the wrong-crown hint');
{
  // "That crown is in the wrong place" points at a crown, and a wrong crown is
  // usually a clashing one too. It marked nothing in exactly that case: the
  // marker shared ::after with the red wash and was suppressed to stop it
  // painting over, so the sentence named a square carrying no mark. Both
  // halves are pinned here, the engine reporting the case and the page
  // marking it.
  const rnd = C.makeRng(8080);
  const made = [];
  while (made.length < 15) { const p = C.makePuzzle(7 + (made.length % 4), rnd); if (p) made.push(p); }
  let reported = 0;
  for (const p of made) {
    const N = p.N;
    // two crowns off the answer sharing a column, so they clash with each other
    let col = -1;
    for (let c = 0; c < N && col < 0; c++) if (c !== p.sol[0] && c !== p.sol[3]) col = c;
    const queens = [0 * N + col, 3 * N + col];
    const clashing = C.conflicts(N, p.regions, queens);
    const h = C.hint(N, p.regions, p.sol, queens);
    const at = h ? h.r * N + h.c : -1;
    if (h && h.kind === 'wrong' && clashing.has(at)) reported++;
  }
  ok('a wrong crown that also clashes is still reported as wrong', reported === 15, reported + '/15');

  const page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const toggle = (page.match(/^.*classList\.toggle\('wronghint'.*$/m) || [''])[0];
  ok('the page marks that crown with a class of its own', toggle !== '');
  // the entire bug was this one condition, so it is the one worth pinning
  ok('the marker is not suppressed by the conflict set', toggle !== '' && !/\bbad\b/.test(toggle), toggle.trim());
  const beforeMotion = page.slice(0, page.indexOf('@media (prefers-reduced-motion'));
  ok('the marker shows with motion turned off too',
    /\.cell\.wronghint \.hint \{[^}]*opacity: 1/.test(beforeMotion));
  // .bad owns ::after on those squares; the marker must not take it back
  ok('the red keeps ::after on a crown that is clashing',
    /\.cell\.wronghint:not\(\.bad\)::after/.test(page) && !/\.cell\.wronghint::after/.test(page));
}

// ------------------------------------------------------------ 8. timings
head('8. generation timing per size (average over 25 puzzles)');
{
  const rows = [];
  for (const N of [7, 8, 9, 10]) {
    const rnd = C.makeRng(1000 + N);
    const t0 = Date.now();
    const bands = [0, 0, 0];
    let attempts = 0;
    for (let k = 0; k < 25; k++) {
      let p = null;
      while (!p) { p = C.makePuzzle(N, rnd); attempts++; }
      bands[p.band]++;
    }
    const avg = (Date.now() - t0) / 25;
    rows.push({ N, avg, attempts, bands });
  }
  console.log('\n  size   avg ms   tries/puzzle   easy/med/hard');
  for (const r of rows) {
    console.log('  ' + String(r.N + 'x' + r.N).padEnd(7) + r.avg.toFixed(1).padStart(6) + '   ' +
      (r.attempts / 25).toFixed(1).padStart(12) + '   ' + r.bands.join('/').padStart(13));
  }
  console.log('');
  for (const r of rows) {
    const budget = r.N <= 9 ? 300 : 1000;
    ok(r.N + 'x' + r.N + ' averages under ' + budget + 'ms (' + r.avg.toFixed(1) + 'ms)', r.avg < budget);
  }
}

console.log('\n' + (fail ? 'FAILED ' + fail + ' of ' + (pass + fail) : 'all ' + pass + ' checks passed'));
process.exit(fail ? 1 : 0);
