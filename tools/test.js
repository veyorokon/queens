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

  // The rater used to have a fourth rule under the other three: a crown put
  // down and followed until something ran out. A hint cannot say that without
  // asking her to suppose something, so it is gone, and these are the checks
  // that it stays gone and that the bands are drawn on what is left.
  const made = [];
  const r2 = C.makeRng(515);
  while (made.length < 60) { const p = C.makePuzzle(7 + (made.length % 4), r2); if (p) made.push(p); }
  // rounds is [singles, k=1, k=2, k=3, k=4 subsets, touching]
  ok('Easy is singles and k=1 subsets and nothing else', made.every(p => {
    const r = C.rate(p.N, p.regions);
    return r.band !== 0 || (r.rounds[2] + r.rounds[3] + r.rounds[4] + r.rounds[5] === 0);
  }));
  ok('Medium always needs touching or a k=2 subset', made.every(p => {
    const r = C.rate(p.N, p.regions);
    return r.band !== 1 || r.rounds[2] + r.rounds[5] > 0;
  }));
  ok('Medium never needs a subset wider than two', made.every(p => {
    const r = C.rate(p.N, p.regions);
    return r.band !== 1 || r.rounds[3] + r.rounds[4] === 0;
  }));
  ok('Hard needs a wide subset, or enough middling steps to cross the effort line', made.every(p => {
    const r = C.rate(p.N, p.regions);
    return r.band !== 2 || r.rounds[3] + r.rounds[4] > 0 || r.effort >= C.HARD_EFFORT;
  }));
  ok('and Hard is never just singles and k=1 subsets', made.every(p => {
    const r = C.rate(p.N, p.regions);
    return r.band !== 2 || r.rounds[2] + r.rounds[3] + r.rounds[4] + r.rounds[5] > 0;
  }));
  ok('the ramp is not vacuous: all three bands turn up in 60 boards',
    [0, 1, 2].every(b => made.some(p => p.band === b)),
    made.map(p => p.band).join(''));
  // The band used to be the technique band capped by the size profile, so a
  // board that needed a disproof shipped as Easy if it happened to hold a
  // two-square colour, and most of the campaign was labelled below the work it
  // asked for. Nothing caps it now: the sizes are a separate requirement the
  // generator applies by rejecting the board.
  ok('the band is exactly the technique band, never capped below it', made.every(p => {
    const r = C.rate(p.N, p.regions);
    return r.band === r.techBand;
  }));
  // Every rule the rater runs is a rule the worked chain can say out loud, and
  // the other way about, so a board the rater solves is a board the hint can
  // carry from an empty grid to the last crown. This is what makes the flat
  // fallback unreachable on anything that ships.
  ok('a board the rater solves is a board the hint can explain end to end',
    made.every(p => C.followable(p.N, p.regions, p.sol)));
  {
    // boards the rater turns down: they are the ones whose chain has a hole in
    // it, and the hole is filled by the flat step, which gives no reason at all
    const r4 = C.makeRng(2468);
    let unique = 0, refused = 0, allFlat = 0, finished = 0;
    for (let k = 0; k < 3000 && refused < 6; k++) {
      const N = 7 + (k % 4);
      const sol = C.randomPlacement(N, r4);
      if (!sol) continue;
      const reg = C.growRegions(N, sol, r4);
      if (!reg || C.minSize(N, reg) < 2) continue;
      if (C.tighten(N, reg, sol, r4, 600, 2) < 0) continue;
      if (C.countSolutions(N, reg, 2) !== 1) continue;
      unique++;
      if (C.rate(N, reg).solved) continue;
      refused++;
      const ch = C.chain(N, reg, sol);
      if (ch.some(w => w.rule === 'flat')) allFlat++;
      if (ch.filter(w => w.place).length === N) finished++;
      if (C.followable(N, reg, sol)) allFlat = -99;
    }
    ok('the rater refuses a board its three rules cannot finish (' + refused + ' of ' + unique + ' unique boards)', refused > 0);
    ok('and every one of those falls back on the flat step', allFlat === refused, allFlat + '/' + refused);
    ok('the flat step still gets the chain to the last crown', finished === refused, finished + '/' + refused);
  }
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

// ------------------------------------------------------ 9. the size profile
head('9. colour sizes carry the difficulty');
{
  // The complaint that started this: boards turning up with a one- or two-square
  // colour, which is a crown for free and makes the rest fall out. The floor
  // rises with the band and Hard also has to look even.
  const rnd = C.makeRng(24680);
  for (const band of [0, 1, 2]) {
    const prof = C.SIZE_PROFILE[band];
    const made = [];
    while (made.length < 100) {
      const p = C.makePuzzle(7 + (made.length % 4), rnd, { band });
      if (p) made.push(p);
    }
    // tighten and its repair are what used to shave colours down to a square,
    // so this is the check that they now refuse a move that would
    ok('100 ' + ['easy', 'medium', 'hard'][band] + ' generations: no colour under ' + prof.minRegion + ' squares',
      made.every(p => C.minSize(p.N, p.regions) >= prof.minRegion),
      'smallest seen ' + Math.min.apply(null, made.map(p => C.minSize(p.N, p.regions))));
    if (isFinite(prof.maxCV)) {
      const worst = Math.max.apply(null, made.filter(p => p.band === band).map(p => C.sizeCV(p.N, p.regions)));
      ok('every Hard that came out Hard is within a CV of ' + prof.maxCV, worst <= prof.maxCV, 'worst ' + worst.toFixed(2));
    }
  }

  // tighten on its own, not just through makePuzzle
  {
    const r2 = C.makeRng(1357);
    let runs = 0, breaches = 0;
    for (const floor of [2, 3, 4]) {
      let n = 0;
      while (n < 100) {
        const N = 7 + (n % 4);
        const sol = C.randomPlacement(N, r2);
        const reg = C.growRegions(N, sol, r2, { even: floor >= 4 });
        if (!reg || C.minSize(N, reg) < floor) continue;
        n++; runs++;
        if (C.tighten(N, reg, sol, r2, 600, floor) < 0) continue;   // refusing is allowed
        if (C.minSize(N, reg) < floor) breaches++;
      }
    }
    ok('tighten never breaches the floor over ' + runs + ' runs', breaches === 0, breaches + ' breaches');
  }

  // A board with a tiny colour that still needs a disproof used to be shipped
  // as Easy, which is how a technique-Hard board turned up on level 3. It is
  // rejected now: asking for a band gets a board whose technique really is that
  // band and whose colours really do meet the floor, or nothing.
  {
    const r3 = C.makeRng(4680);
    let tiny = 0, tinyTechHard = 0, relabelled = 0;
    for (let k = 0; k < 900 && tiny < 120; k++) {
      const N = 7 + (k % 4);
      const p = C.makePuzzle(N, r3, { minRegion: 1, maxCV: Infinity });
      if (!p || C.minSize(N, p.regions) > 2) continue;
      tiny++;
      const r = C.rate(N, p.regions);
      if (r.techBand === 2) tinyTechHard++;
      if (r.band !== r.techBand) relabelled++;
    }
    ok('no board with a 1-2 square colour is relabelled down (' + tiny + ' such boards)', relabelled === 0, relabelled + ' relabelled');
    ok('and the check is not vacuous: ' + tinyTechHard + ' of them needed a disproof', tinyTechHard > 0);
    // and generating to a band gets the sizes as well as the technique
    const r5 = C.makeRng(1470);
    const hard = [];
    while (hard.length < 40) { const q = C.makePuzzle(7 + (hard.length % 4), r5, { band: 2 }); if (q && q.band === 2) hard.push(q); }
    ok('40 boards asked for Hard are all technique-Hard and meet the Hard floor',
      hard.every(q => C.rate(q.N, q.regions).techBand === 2 && C.minSize(q.N, q.regions) >= C.SIZE_PROFILE[2].minRegion));
  }

  // everything that actually ships
  {
    const levels = require(path.join(__dirname, '..', 'levels.js'));
    const all = levels.campaign.concat(...Object.values(levels.pool).map(b => [].concat.apply([], b)));
    let bad = null, n = 0;
    for (const str of all) {
      const d = C.decode(str);
      const prof = C.SIZE_PROFILE[d.band];
      const min = C.minSize(d.N, d.regions), cv = C.sizeCV(d.N, d.regions);
      if (min < prof.minRegion || cv > prof.maxCV) { bad = str + ' min ' + min + ' cv ' + cv.toFixed(2); break; }
      if (C.rate(d.N, d.regions).band !== d.band) { bad = 'band drifted: ' + str; break; }
      n++;
    }
    ok('all ' + all.length + ' shipped puzzles meet their band profile', bad === null, bad || '');
    ok('no shipped puzzle is labelled below the work it asks for',
      all.every(str => { const d = C.decode(str); return C.rate(d.N, d.regions).techBand === d.band; }),
      (all.filter(str => { const d = C.decode(str); return C.rate(d.N, d.regions).techBand !== d.band; })[0] || ''));
    ok('no shipped puzzle has a colour of one square',
      all.every(str => { const d = C.decode(str); return C.minSize(d.N, d.regions) >= 2; }));
  }
}

// -------------------------------------------------- 10. explained hints
head('10. every step of a hint carries a witness');
{
  const levels = require(path.join(__dirname, '..', 'levels.js'));
  const all = levels.campaign.concat(...Object.values(levels.pool).map(b => [].concat.apply([], b)));
  const boards = all.map(C.decode);

  // Walking the chain again here, rather than trusting what it hands back, is
  // the point: every witness is re-checked against the board state it was made
  // on. `walk` calls back with (state before the step, the step).
  function walk(p, fn) {
    const st = C.newState(p.N, p.regions);
    for (const w of C.chain(p.N, p.regions, p.sol)) {
      if (fn(st, w) === false) return false;
      C.applyStep(st, w);
    }
    return true;
  }
  const cellsOfUnit = (N, regions, u) => {
    const out = [];
    for (let i = 0; i < N * N; i++) {
      const r = (i / N) | 0, c = i % N;
      if (u.kind === 'row' ? r === u.k : u.kind === 'col' ? c === u.k : regions[i] === u.k) out.push(i);
    }
    return out;
  };
  const liveIn = (st, cells) => cells.filter(i => st.cand[i]);
  const indexOfCell = (N, regions, kind, i) => kind === 'row' ? (i / N) | 0 : kind === 'col' ? i % N : regions[i];
  const unitBusy = (st, u) => u.kind === 'row' ? st.queenCol[u.k] !== -1 : u.kind === 'col' ? !!st.colDone[u.k] : !!st.regDone[u.k];

  let short = null, ruleless = null, textless = null, noProgress = null;
  const seenRules = {}, seenPairs = {}, seenK = {};
  for (let n = 0; n < boards.length; n++) {
    const p = boards[n];
    const ch = C.chain(p.N, p.regions, p.sol);
    const crowns = ch.filter(w => w.place).length;
    if (crowns !== p.N) { short = all[n] + ' placed ' + crowns + '/' + p.N; break; }
    for (const w of ch) {
      seenRules[w.rule] = (seenRules[w.rule] || 0) + 1;
      if (w.rule === 'subset') { seenPairs[w.from + '->' + w.to] = 1; seenK[w.k] = 1; }
      if (w.rule === 'solution') ruleless = ruleless || all[n];
      if (!w.text || !/^[A-Z]/.test(w.text) || !/\.$/.test(w.text)) textless = textless || (all[n] + ' :: ' + w.text);
      if (!w.place && !w.elim.length) noProgress = noProgress || all[n];
    }
  }
  ok('all ' + all.length + ' shipped puzzles reach the answer step by step', short === null, short || '');
  ok('no step falls back on being told the answer', ruleless === null, ruleless || '');
  ok('every step says why, in a sentence', textless === null, textless || '');
  ok('every step that is not a crown crosses something out', noProgress === null, noProgress || '');
  ok('all three rules turn up across the shipped boards (' + Object.keys(seenRules).sort().join(', ') + ')',
    ['single', 'subset', 'touch'].every(r => seenRules[r] > 0));
  ok('and nothing else does: no shipped chain reaches for the flat step',
    !seenRules.flat && !seenRules.whatif, Object.keys(seenRules).sort().join(', '));
  // The four pairings with a colour on one side of them are the common ones,
  // and every shipped set holds all four. A row confined to columns, or a
  // column confined to rows, wants a board where no colour is confined at all,
  // which turns up about once in sixty boards, so whether one lands in a given
  // 318 is a coin toss and is not worth pinning here. That the search covers
  // all six is pinned on a hand-made board further down instead.
  ok('every pairing with a colour in it turns up (' + Object.keys(seenPairs).sort().join(', ') + ')',
    ['reg->row', 'reg->col', 'row->reg', 'col->reg'].every(k => seenPairs[k]));
  ok('subsets of every size from one to four turn up (' + Object.keys(seenK).sort().join(', ') + ')',
    [1, 2, 3, 4].every(k => seenK[k]));

  // All six ordered pairs of unit kinds really are searched, pinned on two
  // hand-made boards rather than on what a build happens to throw up. Colours
  // run down the diagonals, so no colour is ever confined to a line and the
  // four pairings that involve one are all out of the running; what is left is
  // two columns whose squares lie in two rows, and its mirror.
  {
    const N = 5;
    const regions = new Int8Array(N * N);
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) regions[r * N + c] = (r + c) % N;
    const build = dead => {
      const st = C.newState(N, regions);
      for (const i of dead) st.cand[i] = 0;
      return C.nextStep(st, null);   // nothing is a single here, so it lands on a subset
    };
    // columns A and B have squares left in rows 1 and 2 only
    const downCols = [];
    for (let r = 2; r < N; r++) for (const c of [0, 1]) downCols.push(r * N + c);
    const w1 = build(downCols);
    ok('two columns confined to two rows is found as a col->row subset',
      !!w1 && w1.from === 'col' && w1.to === 'row' && w1.k === 2, w1 ? w1.from + '->' + w1.to + ' k=' + w1.k : 'nothing');
    ok('and it says so in a sentence', !!w1 && /^Columns A and B only have squares in rows 1 and 2/.test(w1.text), w1 ? w1.text : '');
    // and the mirror of it: rows 1 and 2 have squares left in columns A and B only
    const downRows = [];
    for (const r of [0, 1]) for (let c = 2; c < N; c++) downRows.push(r * N + c);
    const w2 = build(downRows);
    ok('two rows confined to two columns is found as a row->col subset',
      !!w2 && w2.from === 'row' && w2.to === 'col' && w2.k === 2, w2 ? w2.from + '->' + w2.to + ' k=' + w2.k : 'nothing');
    ok('and it says so too', !!w2 && /^Rows 1 and 2 only have squares in columns A and B/.test(w2.text), w2 ? w2.text : '');
  }

  // nothing a witness crosses out may be a square of the answer
  {
    let bad = null;
    for (let n = 0; n < boards.length && !bad; n++) {
      const p = boards[n], N = p.N;
      const answer = new Set(p.sol.map((c, r) => r * N + c));
      walk(p, (st, w) => {
        for (const i of w.elim) if (answer.has(i)) { bad = all[n] + ' crossed out ' + C.cellName(N, i); return false; }
        if (w.place && p.sol[w.place.r] !== w.place.c) { bad = all[n] + ' crowned the wrong square'; return false; }
      });
    }
    ok('no witness ever crosses out a square of the answer', bad === null, bad || '');
  }

  // a crown always sends the hint back to the singles, so the step after one
  // is the unit it just emptied rather than something clever
  {
    let bad = null, checked = 0;
    for (let n = 0; n < boards.length && !bad; n++) {
      const p = boards[n];
      walk(p, (st, w) => {
        if (w.rule === 'single') return;
        checked++;
        if (C.findSingle(st)) { bad = all[n] + ' reached for ' + w.rule + ' with a single on the board'; return false; }
      });
    }
    ok('no rule is reached for while a single is still there (' + checked + ' steps)', bad === null, bad || '');
  }

  // singles: the unit it names really is down to one square
  {
    let bad = null, n2 = 0;
    for (let n = 0; n < boards.length && !bad; n++) {
      const p = boards[n], N = p.N;
      walk(p, (st, w) => {
        if (w.rule !== 'single') return;
        n2++;
        const live = liveIn(st, cellsOfUnit(N, p.regions, w.units[0]));
        if (live.length !== 1 || live[0] !== w.place.r * N + w.place.c) { bad = all[n] + ' ' + w.text; return false; }
      });
    }
    ok('every single names a unit with exactly one square left (' + n2 + ' of them)', bad === null, bad || '');
  }

  // subsets: k units of one kind, k of another, and the squares really are
  // inside. This is the check that k = 1 confinement and the counting steps
  // both hold, since they are the same rule.
  {
    let bad = null, n2 = 0;
    for (let n = 0; n < boards.length && !bad; n++) {
      const p = boards[n], N = p.N;
      walk(p, (st, w) => {
        if (w.rule !== 'subset') return;
        n2++;
        const S = w.fromUnits, T = w.toUnits;
        const inT = i => T.some(u => indexOfCell(N, p.regions, u.kind, i) === u.k);
        const inS = i => S.some(u => indexOfCell(N, p.regions, u.kind, i) === u.k);
        let held = S.length === w.k && T.length === w.k && w.k >= 1 && w.k <= 4
          && w.from !== w.to
          && S.every(u => u.kind === w.from) && T.every(u => u.kind === w.to)
          && !S.some(u => unitBusy(st, u)) && !T.some(u => unitBusy(st, u));
        // every square each unit of S has left sits inside the units of T
        for (const u of S) {
          const live = liveIn(st, cellsOfUnit(N, p.regions, u));
          if (!live.length || !live.every(inT)) held = false;
        }
        // and the crosses are what is left standing in T that is not S's
        const should = [];
        for (const u of T) for (const i of liveIn(st, cellsOfUnit(N, p.regions, u))) if (!inS(i)) should.push(i);
        if (should.length !== w.elim.length || !should.every(i => w.elim.indexOf(i) >= 0)) held = false;
        if (!held) { bad = all[n] + ' ' + w.text; return false; }
      });
    }
    ok('every subset really does confine, at every k (' + n2 + ' of them)', bad === null, bad || '');
  }

  // touching: a crown on the square really would leave that unit with nothing
  {
    let bad = null, n2 = 0;
    for (let n = 0; n < boards.length && !bad; n++) {
      const p = boards[n], N = p.N;
      walk(p, (st, w) => {
        if (w.rule !== 'touch') return;
        n2++;
        for (const y of w.elim) {
          const t = C.cloneState(st);
          const put = C.place(t, (y / N) | 0, y % N);
          const left = liveIn(t, cellsOfUnit(N, p.regions, w.emptied));
          if (!put || left.length) { bad = all[n] + ' ' + w.text + ' (' + C.cellName(N, y) + ')'; return false; }
        }
      });
    }
    ok('every touching square really would empty the unit it names (' + n2 + ' of them)', bad === null, bad || '');
  }

  // The complaint that ended the fourth rule: "A crown at F1 forces five more
  // crowns, and then indigo has nowhere to go." She does not want to be asked
  // to suppose anything at all, however short the supposition. So no shipped
  // board's chain may hold a step that supposes one, and every chain has to
  // reach the last crown on the three rules that do not.
  {
    let hypothetical = null, unfinished = null, worded = null;
    const rules = {};
    for (let n = 0; n < boards.length; n++) {
      const p = boards[n];
      const ch = C.chain(p.N, p.regions, p.sol);
      for (const w of ch) {
        const key = w.rule === 'subset' ? 'subset k=' + w.k : w.rule;
        rules[key] = (rules[key] || 0) + 1;
        if (w.rule === 'whatif' || w.rule === 'flat' || w.rule === 'solution') {
          hypothetical = hypothetical || (all[n] + ' :: ' + w.rule + ' :: ' + w.text);
        }
        // and no wording anywhere may ask her to imagine a crown somewhere
        if (/\bwould\b|\btry\b|\bsuppose\b|\bif\b/i.test(w.text)) worded = worded || (all[n] + ' :: ' + w.text);
      }
      if (ch.filter(w => w.place).length !== p.N) unfinished = unfinished || all[n];
    }
    const shape = Object.keys(rules).sort().map(k => k + ' ' + rules[k]).join(', ');
    ok('no shipped board asks her to suppose a crown anywhere (' + shape + ')', hypothetical === null, hypothetical || '');
    ok('and every shipped chain finishes on those rules alone', unfinished === null, unfinished || '');
    ok('no hint on a shipped board says would, try, suppose or if', worded === null, worded || '');
    ok('every shipped puzzle can be explained end to end',
      boards.every(p => C.followable(p.N, p.regions, p.sol)));
  }

  // the touching rule reads as a statement about where the unit's squares are,
  // not as a crown put down and taken back
  {
    let bad = null, n2 = 0;
    const shapes = {};
    for (let n = 0; n < boards.length && !bad; n++) {
      const p = boards[n], N = p.N;
      walk(p, (st, w) => {
        if (w.rule !== 'touch') return;
        n2++;
        shapes[w.emptied.kind] = (shapes[w.emptied.kind] || 0) + 1;
        if (!/^Every square /.test(w.text)) { bad = all[n] + ' :: ' + w.text; return false; }
        if (!/ is out\.$|, so they are out\.$/.test(w.text)) { bad = all[n] + ' :: ' + w.text; return false; }
        // a square is never ruled out of its own unit, so the reason named is
        // never the kind of unit the step is about
        const noun = w.emptied.kind === 'row' ? 'row' : w.emptied.kind === 'col' ? 'column' : 'colour';
        const said = w.text.slice(w.text.indexOf("'s ") >= 0 ? w.text.indexOf("'s ") : w.text.indexOf(' the '));
        if (said.indexOf(noun + ',') >= 0 || said.indexOf(noun + ' or') >= 0) { bad = all[n] + ' :: ' + w.text; return false; }
      });
    }
    ok('every touching step is a flat statement about the board (' + n2 + ' of them)', bad === null, bad || '');
    ok('and all three kinds of unit are said the same way (' + JSON.stringify(shapes) + ')',
      ['row', 'col', 'reg'].every(k => shapes[k] > 0));
  }

  // the rater is untouched: its passes still say the same thing about every
  // board that shipped, down to the effort score stored with it
  {
    let drift = null;
    for (let n = 0; n < boards.length && !drift; n++) {
      const r = C.rate(boards[n].N, boards[n].regions);
      if (r.band !== boards[n].band || r.score !== boards[n].score) drift = all[n] + ' -> band ' + r.band + ' score ' + r.score;
    }
    ok('the rater still gives every shipped puzzle its stored band and score', drift === null, drift || '');
  }
}

head('11. the staged hint on the player\'s own board');
{
  const levels = require(path.join(__dirname, '..', 'levels.js'));
  const boards = levels.campaign.slice(0, 40).map(C.decode);

  // a crown in the wrong place is still the first thing said
  let wrongFirst = 0;
  for (const p of boards) {
    const N = p.N;
    let c = -1;
    for (let k = 0; k < N && c < 0; k++) if (k !== p.sol[0]) c = k;
    const e = C.explain(N, p.regions, p.sol, [c], null);
    const h = C.hint(N, p.regions, p.sol, [c]);
    if (e && e.rule === 'wrong' && e.r === 0 && e.c === c && h.kind === 'wrong') wrongFirst++;
  }
  ok('a wrong crown comes before any deduction', wrongFirst === boards.length, wrongFirst + '/' + boards.length);

  // the first thing said on an empty board is the first step of the chain
  let same = 0;
  for (const p of boards) {
    const e = C.explain(p.N, p.regions, p.sol, [], null);
    const first = C.chain(p.N, p.regions, p.sol)[0];
    if (e && first && e.rule === first.rule && e.text === first.text) same++;
  }
  ok('the hint opens on the cheapest step of the chain', same === boards.length, same + '/' + boards.length);

  // A cross on a square that is not part of the answer is a true fact however
  // she got there, so the solver reasons from it. It used to rebuild from the
  // crowns alone, which is why it reached past the cheap step her own crosses
  // had already opened up for a five-crown what-if nobody could follow.
  {
    let used = 0;
    for (const p of boards) {
      const N = p.N;
      const crossed = new Set();
      for (let c = 0; c < N; c++) if (c !== p.sol[0]) crossed.add(c);
      const e = C.explain(N, p.regions, p.sol, [], crossed);
      if (e && e.rule === 'single' && e.place && e.place.r === 0 && e.place.c === p.sol[0]) used++;
    }
    ok('crosses she already holds are facts the hint reasons from', used === boards.length, used + '/' + boards.length);
  }

  // and a cross where the crown belongs is a mistake, said the way a wrong
  // crown is said, after the wrong crown and before any deduction
  {
    let caught = 0, crownFirst = 0;
    for (const p of boards) {
      const N = p.N;
      const onAnswer = 2 * N + p.sol[2];
      const e = C.explain(N, p.regions, p.sol, [], new Set([onAnswer]));
      if (e && e.rule === 'wrongcross' && e.r === 2 && e.c === p.sol[2]) caught++;
      let c = -1;
      for (let k = 0; k < N && c < 0; k++) if (k !== p.sol[0]) c = k;
      const e2 = C.explain(N, p.regions, p.sol, [c], new Set([onAnswer]));
      if (e2 && e2.rule === 'wrong') crownFirst++;
    }
    ok('a cross on a square the crown belongs on is reported as wrong', caught === boards.length, caught + '/' + boards.length);
    ok('a wrong crown is still said before a wrong cross', crownFirst === boards.length, crownFirst + '/' + boards.length);
  }

  // crosses she has already made are not offered back to her
  let skipped = 0, offered = 0;
  for (const p of boards) {
    const first = C.explain(p.N, p.regions, p.sol, [], null);
    if (!first || first.place) { skipped++; continue; }
    const again = C.explain(p.N, p.regions, p.sol, [], first.elim);
    if (again && (again.rule !== first.rule || again.text !== first.text)) offered++;
    else if (again && again.place) offered++;
  }
  ok('a step she has already crossed out is passed over', offered + skipped === boards.length,
    (offered + skipped) + '/' + boards.length);

  // following the staged hint alone, crosses and all, finishes a board
  {
    const p = boards[boards.length - 1], N = p.N;
    const crowns = [], crossed = new Set();
    let steps = 0, stuck = false;
    while (crowns.length < N && steps++ < 300) {
      const w = C.explain(N, p.regions, p.sol, crowns, crossed);
      if (!w || w.rule === 'wrong') { stuck = true; break; }
      if (w.place) crowns.push(w.place.r * N + w.place.c);
      else {
        // every step must move her on: a step whose crosses she already holds
        // would loop forever now that her crosses are facts the solver keeps
        if (w.elim.every(i => crossed.has(i))) { stuck = true; break; }
        for (const i of w.elim) crossed.add(i);
      }
    }
    ok('a board can be finished on staged hints alone', !stuck && crowns.length === N, crowns.length + '/' + N);
  }

  // and it never asks her to cross out a square the crown belongs on, however
  // many of her own crosses it is reasoning from
  {
    let bad = null;
    for (const p of boards) {
      const N = p.N;
      const answer = new Set(p.sol.map((c, r) => r * N + c));
      const crowns = [], crossed = new Set();
      let steps = 0;
      while (crowns.length < N && steps++ < 400 && !bad) {
        const w = C.explain(N, p.regions, p.sol, crowns, crossed);
        if (!w || w.rule === 'wrong' || w.rule === 'wrongcross') break;
        if (w.place) { crowns.push(w.place.r * N + w.place.c); continue; }
        for (const i of w.elim) { if (answer.has(i)) bad = C.cellName(N, i); crossed.add(i); }
      }
    }
    ok('a hint working from her crosses never crosses out an answer square', bad === null, bad || '');
  }

  // The hint's last resort, on a board the three rules cannot finish. Nothing
  // that ships is one of those, but a board saved on the device before the
  // rater changed could be, and random mode makes its own boards. It says the
  // conclusion flat and offers the cross, and it never says how it got there,
  // because how it got there is a crown put down on paper and followed.
  {
    const r6 = C.makeRng(2468);
    let refused = 0, flat = 0, quiet = 0, offered = 0, finished = 0;
    for (let k = 0; k < 3000 && refused < 4; k++) {
      const N = 7 + (k % 4);
      const sol = C.randomPlacement(N, r6);
      if (!sol) continue;
      const reg = C.growRegions(N, sol, r6);
      if (!reg || C.minSize(N, reg) < 2) continue;
      if (C.tighten(N, reg, sol, r6, 600, 2) < 0) continue;
      if (C.countSolutions(N, reg, 2) !== 1) continue;
      if (C.rate(N, reg).solved) continue;
      refused++;
      // play it right through on staged hints, the way she would
      const crowns = [], crossed = new Set();
      let steps = 0, sawFlat = false, stuck = false;
      while (crowns.length < N && steps++ < 400) {
        const w = C.explain(N, reg, sol, crowns, crossed);
        if (!w || w.rule === 'wrong' || w.rule === 'wrongcross') { stuck = true; break; }
        if (w.rule === 'flat') {
          sawFlat = true;
          if (/^[A-J](?:[1-9]|10) is out\.$/.test(w.text)) quiet++;
          if (w.elim.length === 1 && C.sayCrosses(N, w.elim) === 'That crosses out ' + C.cellName(N, w.elim[0]) + '.') offered++;
        }
        if (w.place) crowns.push(w.place.r * N + w.place.c);
        else { if (w.elim.every(i => crossed.has(i))) { stuck = true; break; } for (const i of w.elim) crossed.add(i); }
      }
      if (sawFlat) flat++;
      if (!stuck && crowns.length === N) finished++;
    }
    ok('a board the three rules cannot finish falls back on the flat step (' + refused + ' boards)', flat === refused, flat + '/' + refused);
    ok('the fallback says the conclusion and nothing else', quiet >= refused, quiet + ' flat steps, all bare');
    ok('and still offers the cross that goes with it', offered === quiet, offered + '/' + quiet);
    ok('a board can be finished on the fallback too', finished === refused, finished + '/' + refused);
  }

  // the sentence that names the crosses is rebuilt from the ones she can see
  {
    const N = 7;
    ok('the cross sentence names one square', C.sayCrosses(N, [8]) === 'That crosses out B2.', C.sayCrosses(N, [8]));
    ok('the cross sentence joins two with "and"', C.sayCrosses(N, [8, 9]) === 'That crosses out B2 and C2.', C.sayCrosses(N, [8, 9]));
    ok('a long list of crosses is cut short', /and 2 more\.$/.test(C.sayCrosses(N, [0, 1, 2, 3, 4, 5, 6, 7])), C.sayCrosses(N, [0, 1, 2, 3, 4, 5, 6, 7]));
    ok('no crosses, no sentence', C.sayCrosses(N, []) === '');
  }
}

// ------------------------------------------- 12. the page shows the steps
head('12. the page paints what the witness says');
{
  const page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  ok('every square carries a layer for the wash and the ring', /<span class="wash"><\/span>/.test(page));
  ok('the units of a step are washed over', /\.cell\.lit \.wash \{[^}]*background: var\(--lit-wash\)/.test(page));
  ok('the wash is defined on both themes', (page.match(/--lit-wash:/g) || []).length === 3);
  ok('the squares that make the case are ringed', /\.cell\.focus \.wash \{/.test(page));
  ok('the crosses on offer are drawn faintly', /\.cell\.ghost \.x \{ opacity: \.42; \}/.test(page));
  // a ghost X must never sit on a square that already carries a mark
  ok('a ghost cross only goes on an empty square', /classList\.toggle\('ghost', !!fx && fx\.ghost\.has\(i\) && view\[i\] === 0\)/.test(page));
  ok('the button that makes the crosses is on the page', /id="hintApply"/.test(page));
  ok('and it is hidden until the crosses are on offer', /id="hintApply"[^>]*hidden/.test(page));
  // one Undo has to take a whole hint back, so the crosses go on as one move
  const finish = page.slice(page.indexOf('function finishStep'), page.indexOf('function stepHint'));
  ok('the crosses go on as a single move', /pushHistory\(\);/.test(finish));
  ok('and none of them count as a mistake', finish.indexOf('afterMove') < 0 && finish.indexOf('mistakes') < 0);
  ok('a tap on the board drops the staged hint', /if \(solved\) return;\n    clearHint\(\);/.test(page));
  ok('the worked solution is offered when the board is solved', /id="replayBtn"/.test(page));
  ok('the replay draws on a board of its own', /const view = replay \? replay\.marks : marks;/.test(page));
  ok('the page is English only, with no toggle left in it', !/langBtn|data-lang|toggleLang/.test(page));
  // The staged what-if walk is gone, and so is every piece of the page that
  // drew it: no supposed crowns, no dashed rings, no extra taps.
  ok('no square can be drawn holding a crown the hint only supposed', !/trycrown/.test(page));
  ok('the page has nothing left that walks a what-if',
    !/isWalked|cascadeText|tryText|endText|whatif/.test(page));
  const stages = page.slice(page.indexOf('function stagesOf'), page.indexOf('function clearHint'));
  ok('every rule gets the same two taps, the sentence and the crosses it offers',
    (stages.match(/text: w\.text/g) || []).length === 2 && /offer: true/.test(stages) && !/for \(/.test(stages));
  ok('the replay takes the last stage of every step, one tap each',
    /const stage = stagesOf\(w\)\.slice\(-1\)\[0\];/.test(page));
  ok('a cross where the crown belongs is called out', /w\.rule === 'wrongcross'/.test(page) && /whyWrongCross/.test(page));
  ok('the campaign progress key was bumped with the new levels',
    /progress4: progress/.test(page) && /levelBests4: levelBests/.test(page) && !/progress3/.test(page));

  // the witness fields the page paints with have to be there on every step
  const levels = require(path.join(__dirname, '..', 'levels.js'));
  let missing = null, rings = { touch: 0 }, quiet = 0;
  for (const str of levels.campaign) {
    const p = C.decode(str);
    for (const w of C.chain(p.N, p.regions, p.sol)) {
      if (!Array.isArray(w.units) || !Array.isArray(w.cells) || !Array.isArray(w.ring) || !Array.isArray(w.elim)) { missing = w.rule; break; }
      if (!w.ring.every(i => w.cells.indexOf(i) >= 0)) { missing = w.rule + ': ring is not part of the case'; break; }
      if (w.rule === 'touch') { if (w.ring.length) rings[w.rule]++; }
      else if (!w.ring.length) quiet++;
    }
    if (missing) break;
  }
  ok('every witness carries the units, cells, ring and crosses the page paints', missing === null, missing || '');
  ok('the touching rule rings the squares that make its case (' + rings.touch + ' steps)', rings.touch > 0);
  ok('the subset rules leave the ring to the wash (' + quiet + ' steps)', quiet > 0);
}

console.log('\n' + (fail ? 'FAILED ' + fail + ' of ' + (pass + fail) : 'all ' + pass + ' checks passed'));
process.exit(fail ? 1 : 0);
