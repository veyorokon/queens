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
  ok('the technique band is exactly the set that needed a disproof', made.every(p => {
    const r = C.rate(p.N, p.regions);
    return (r.techBand === 2) === (r.rounds[3] > 0);
  }));
  ok('a board called Hard always needed a disproof', made.every(p => {
    const r = C.rate(p.N, p.regions);
    return r.band !== 2 || r.rounds[3] > 0;
  }));
  ok('the band never runs above what the sizes allow', made.every(p => {
    const r = C.rate(p.N, p.regions);
    return r.band <= C.sizeCap(p.N, p.regions);
  }));
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

  // a tiny colour can never be called Hard, however twisty the rest of it is
  {
    const r3 = C.makeRng(4680);
    let tiny = 0, tinyHard = 0, tinyTechHard = 0;
    for (let k = 0; k < 600 && tiny < 120; k++) {
      const N = 7 + (k % 4);
      const p = C.makePuzzle(N, r3, { minRegion: 1, maxCV: Infinity });
      if (!p || C.minSize(N, p.regions) > 2) continue;
      tiny++;
      const r = C.rate(N, p.regions);
      if (r.band === 2) tinyHard++;
      if (r.techBand === 2) tinyTechHard++;
    }
    ok('rate() calls no board with a 1-2 square colour Hard (' + tiny + ' such boards)', tinyHard === 0, tinyHard + ' slipped through');
    ok('and the check is not vacuous: ' + tinyTechHard + ' of them needed a disproof', tinyTechHard > 0);
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
  ok('all four rules turn up across the shipped boards (' + Object.keys(seenRules).sort().join(', ') + ')',
    ['single', 'subset', 'touch', 'whatif'].every(r => seenRules[r] > 0));
  ok('all six ordered pairs of unit kinds turn up (' + Object.keys(seenPairs).sort().join(', ') + ')',
    Object.keys(seenPairs).length === 6);
  ok('subsets of every size from one to four turn up (' + Object.keys(seenK).sort().join(', ') + ')',
    [1, 2, 3, 4].every(k => seenK[k]));

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

  // one-step what-if: the crown, the cascade, and the unit that runs out
  {
    let bad = null, n2 = 0;
    for (let n = 0; n < boards.length && !bad; n++) {
      const p = boards[n], N = p.N;
      walk(p, (st, w) => {
        if (w.rule !== 'whatif') return;
        n2++;
        const t = C.cloneState(st);
        const trace = { steps: [], empty: null };
        const fine = C.place(t, (w.trigger / N) | 0, w.trigger % N) && C.singlesPass(t, trace) >= 0;
        if (fine) { bad = all[n] + ': that crown is fine, ' + w.text; return false; }
        const left = liveIn(t, cellsOfUnit(N, p.regions, w.emptied));
        // either the unit has nothing left, or its one square is in a column
        // or a colour already spoken for
        const stuck = left.length === 0 ||
          (left.length === 1 && (t.colDone[left[0] % N] || t.regDone[p.regions[left[0]]]));
        if (!stuck || w.elim.length !== 1 || w.elim[0] !== w.trigger) { bad = all[n] + ' ' + w.text; return false; }
        // it earns the deeper wording: a plain touching step would have caught
        // it already, so the cascade is what does the work
        if (!w.cascade.length) { bad = all[n] + ': a what-if with nothing forced, ' + w.text; return false; }
      });
    }
    ok('every what-if really does empty the unit it names (' + n2 + ' of them)', bad === null, bad || '');
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
      else for (const i of w.elim) crossed.add(i);
    }
    ok('a board can be finished on staged hints alone', !stuck && crowns.length === N, crowns.length + '/' + N);
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

  // the witness fields the page paints with have to be there on every step
  const levels = require(path.join(__dirname, '..', 'levels.js'));
  let missing = null, rings = { touch: 0, whatif: 0 }, quiet = 0;
  for (const str of levels.campaign) {
    const p = C.decode(str);
    for (const w of C.chain(p.N, p.regions, p.sol)) {
      if (!Array.isArray(w.units) || !Array.isArray(w.cells) || !Array.isArray(w.ring) || !Array.isArray(w.elim)) { missing = w.rule; break; }
      if (!w.ring.every(i => w.cells.indexOf(i) >= 0)) { missing = w.rule + ': ring is not part of the case'; break; }
      if (w.rule === 'touch' || w.rule === 'whatif') { if (w.ring.length) rings[w.rule]++; }
      else if (!w.ring.length) quiet++;
    }
    if (missing) break;
  }
  ok('every witness carries the units, cells, ring and crosses the page paints', missing === null, missing || '');
  ok('the two rules that turn on named squares ring them (' + rings.touch + ' touching, ' + rings.whatif + ' what-if)',
    rings.touch > 0 && rings.whatif > 0);
  ok('the subset rules leave the ring to the wash (' + quiet + ' steps)', quiet > 0);
}

console.log('\n' + (fail ? 'FAILED ' + fail + ' of ' + (pass + fail) : 'all ' + pass + ' checks passed'));
process.exit(fail ? 1 : 0);
