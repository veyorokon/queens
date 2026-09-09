/* Kitchen Table Queens — shared core.
   Board model, uniqueness solver, human-technique rater, codec, generator.
   Runs in node (module.exports) and in the browser (window.QueensCore). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QueensCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LETTERS = 'abcdefghij';

  // How even the colours have to be, per difficulty band. A board studded with
  // one- and two-square colours solves itself: those squares are singles on
  // sight, so the puzzle is over before it starts. The floor rises with the
  // band, and Hard also has to be visibly even, measured as the coefficient of
  // variation of the region sizes (sd / mean, and the mean is always N).
  const SIZE_PROFILE = [
    { minRegion: 2, maxCV: Infinity },   // 0 easy
    { minRegion: 3, maxCV: Infinity },   // 1 medium
    { minRegion: 4, maxCV: 0.35 },       // 2 hard
  ];

  // ---------------------------------------------------------------- utility
  function makeRng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const defaultRng = Math.random;
  function shuffle(arr, rnd) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0;
      const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }
  const range = n => Array.from({ length: n }, (_, i) => i);

  // Orthogonal neighbours of every cell, cached per board size.
  const NBR_CACHE = new Map();
  function neighbours(N) {
    let n = NBR_CACHE.get(N);
    if (n) return n;
    n = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const list = [];
      if (r > 0) list.push((r - 1) * N + c);
      if (r < N - 1) list.push((r + 1) * N + c);
      if (c > 0) list.push(r * N + c - 1);
      if (c < N - 1) list.push(r * N + c + 1);
      n.push(list);
    }
    NBR_CACHE.set(N, n);
    return n;
  }
  // The 8 cells a queen touches, cached per board size.
  const TOUCH_CACHE = new Map();
  function touching(N) {
    let t = TOUCH_CACHE.get(N);
    if (t) return t;
    t = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const list = [];
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= N || cc >= N) continue;
        list.push(rr * N + cc);
      }
      t.push(list);
    }
    TOUCH_CACHE.set(N, t);
    return t;
  }

  // ------------------------------------------------------- solution counter
  // One queen per row, so the only touching test that matters is against the
  // row above: |c - prevC| must be at least 2.
  function countSolutions(N, regions, limit) {
    limit = limit || 2;
    let count = 0;
    (function rec(r, usedCols, usedRegs, prevC) {
      if (r === N) { count++; return; }
      for (let c = 0; c < N; c++) {
        if (usedCols & (1 << c)) continue;
        if (prevC >= 0 && c >= prevC - 1 && c <= prevC + 1) continue;
        const g = regions[r * N + c];
        if (usedRegs & (1 << g)) continue;
        rec(r + 1, usedCols | (1 << c), usedRegs | (1 << g), c);
        if (count >= limit) return;
      }
    })(0, 0, 0, -1);
    return count;
  }

  function findSolution(N, regions) {
    const cols = new Array(N).fill(-1);
    const ok = (function rec(r, usedCols, usedRegs, prevC) {
      if (r === N) return true;
      for (let c = 0; c < N; c++) {
        if (usedCols & (1 << c)) continue;
        if (prevC >= 0 && c >= prevC - 1 && c <= prevC + 1) continue;
        const g = regions[r * N + c];
        if (usedRegs & (1 << g)) continue;
        cols[r] = c;
        if (rec(r + 1, usedCols | (1 << c), usedRegs | (1 << g), c)) return true;
        cols[r] = -1;
      }
      return false;
    })(0, 0, 0, -1);
    return ok ? cols : null;
  }

  // -------------------------------------------------------- conflict finder
  // cells: array of board indices holding a queen. Returns a Set of the
  // indices that break a rule, so the page can paint both halves of a clash.
  function conflicts(N, regions, cells) {
    const bad = new Set();
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        const a = cells[i], b = cells[j];
        const ar = (a / N) | 0, ac = a % N, br = (b / N) | 0, bc = b % N;
        const clash = ar === br || ac === bc || regions[a] === regions[b] ||
          (Math.abs(ar - br) <= 1 && Math.abs(ac - bc) <= 1);
        if (clash) { bad.add(a); bad.add(b); }
      }
    }
    return bad;
  }

  // ------------------------------------------------------------------ codec
  // "N|regions|solution|band|score" — regions row-major as a..j, solution as
  // one column digit per row.
  function encode(p) {
    const regs = Array.from(p.regions, g => LETTERS[g]).join('');
    return [p.N, regs, p.sol.join(''), p.band, p.score == null ? 0 : p.score].join('|');
  }
  function decode(str) {
    const parts = String(str).split('|');
    const N = +parts[0];
    const regions = new Int8Array(N * N);
    for (let i = 0; i < N * N; i++) regions[i] = LETTERS.indexOf(parts[1][i]);
    const sol = Array.from(parts[2], ch => +ch);
    return { N, regions, sol, band: +parts[3] || 0, score: +(parts[4] || 0) };
  }

  // ------------------------------------------------- human-technique solver
  // cand[i] = 1 while a queen could still stand on cell i.
  function newState(N, regions) {
    return {
      N, regions,
      cand: new Uint8Array(N * N).fill(1),
      queenCol: new Int8Array(N).fill(-1),
      colDone: new Uint8Array(N),
      regDone: new Uint8Array(N),
      nQueens: 0,
    };
  }
  function cloneState(st) {
    return {
      N: st.N, regions: st.regions,
      cand: st.cand.slice(),
      queenCol: st.queenCol.slice(),
      colDone: st.colDone.slice(),
      regDone: st.regDone.slice(),
      nQueens: st.nQueens,
      elim: st.elim, units: st.units,
    };
  }
  function place(st, r, c) {
    const N = st.N, i = r * N + c;
    if (!st.cand[i] || st.queenCol[r] !== -1) return false;
    const g = st.regions[i];
    if (st.colDone[c] || st.regDone[g]) return false;
    st.queenCol[r] = c; st.colDone[c] = 1; st.regDone[g] = 1; st.nQueens++;
    for (let k = 0; k < N; k++) {
      if (k !== c) st.cand[r * N + k] = 0;
      if (k !== r) st.cand[k * N + c] = 0;
    }
    for (let k = 0; k < N * N; k++) if (k !== i && st.regions[k] === g) st.cand[k] = 0;
    for (const k of touching(N)[i]) st.cand[k] = 0;
    st.cand[i] = 1;
    return true;
  }
  // -1 contradiction, otherwise the number of queens placed this pass.
  // With a trace object it also writes down the crowns it was forced into and
  // the unit that ran out of squares, which is what makes a disproof sayable.
  function singlesPass(st, trace) {
    const N = st.N;
    let placed = 0, again = true;
    const stop = (kind, k) => { if (trace) trace.empty = { kind: kind, k: k }; return -1; };
    const took = (r, c, why) => { if (trace) trace.steps.push({ r: r, c: c, why: why }); };
    while (again) {
      again = false;
      for (let r = 0; r < N; r++) {
        if (st.queenCol[r] !== -1) continue;
        let n = 0, only = -1;
        for (let c = 0; c < N; c++) if (st.cand[r * N + c]) { n++; only = c; }
        if (n === 0) return stop('row', r);
        if (n === 1) { if (!place(st, r, only)) return stop('row', r); placed++; took(r, only, 'row'); again = true; }
      }
      for (let c = 0; c < N; c++) {
        if (st.colDone[c]) continue;
        let n = 0, only = -1;
        for (let r = 0; r < N; r++) if (st.cand[r * N + c]) { n++; only = r; }
        if (n === 0) return stop('col', c);
        if (n === 1) { if (!place(st, only, c)) return stop('col', c); placed++; took(only, c, 'col'); again = true; }
      }
      for (let g = 0; g < N; g++) {
        if (st.regDone[g]) continue;
        let n = 0, only = -1;
        for (let i = 0; i < N * N; i++) if (st.regions[i] === g && st.cand[i]) { n++; only = i; }
        if (n === 0) return stop('reg', g);
        if (n === 1) { if (!place(st, (only / N) | 0, only % N)) return stop('reg', g); placed++; took((only / N) | 0, only % N, 'region'); again = true; }
      }
    }
    return placed;
  }
  // Which rule proves the next queen, in words, for the hint line.
  function findSingle(st) {
    const N = st.N;
    for (let r = 0; r < N; r++) {
      if (st.queenCol[r] !== -1) continue;
      let n = 0, only = -1;
      for (let c = 0; c < N; c++) if (st.cand[r * N + c]) { n++; only = c; }
      if (n === 1) return { r, c: only, why: 'row' };
    }
    for (let c = 0; c < N; c++) {
      if (st.colDone[c]) continue;
      let n = 0, only = -1;
      for (let r = 0; r < N; r++) if (st.cand[r * N + c]) { n++; only = r; }
      if (n === 1) return { r: only, c, why: 'col' };
    }
    for (let g = 0; g < N; g++) {
      if (st.regDone[g]) continue;
      let n = 0, only = -1;
      for (let i = 0; i < N * N; i++) if (st.regions[i] === g && st.cand[i]) { n++; only = i; }
      if (n === 1) return { r: (only / N) | 0, c: only % N, why: 'region' };
    }
    return null;
  }
  // Every cell a unit's queen would wipe out, no matter which of its squares
  // the queen ends up on. "This colour has to sit in one of those two squares,
  // so the square beside them is out." Subsumes the row/colour confinement
  // rules and the ones that come from queens not touching.
  function elimSets(N, regions) {
    const touch = touching(N);
    const out = new Array(N * N);
    for (let i = 0; i < N * N; i++) {
      const r = (i / N) | 0, c = i % N, g = regions[i];
      const s = new Set();
      for (let k = 0; k < N; k++) { if (k !== c) s.add(r * N + k); if (k !== r) s.add(k * N + c); }
      for (let j = 0; j < N * N; j++) if (regions[j] === g && j !== i) s.add(j);
      for (const j of touch[i]) s.add(j);
      out[i] = Array.from(s);
    }
    return out;
  }
  function unitsOf(st) {
    if (st.units) return st.units;
    const N = st.N, units = [];
    for (let r = 0; r < N; r++) units.push({ kind: 'row', k: r, cells: Array.from({ length: N }, (_, c) => r * N + c) });
    for (let c = 0; c < N; c++) units.push({ kind: 'col', k: c, cells: Array.from({ length: N }, (_, r) => r * N + c) });
    for (let g = 0; g < N; g++) {
      const cells = [];
      for (let i = 0; i < N * N; i++) if (st.regions[i] === g) cells.push(i);
      units.push({ kind: 'reg', k: g, cells });
    }
    st.units = units;
    return units;
  }
  function unitDone(st, u) {
    return u.kind === 'row' ? st.queenCol[u.k] !== -1 : u.kind === 'col' ? !!st.colDone[u.k] : !!st.regDone[u.k];
  }
  // The classic first step past singles: a colour that only fits inside one
  // row owns that row, and a row whose squares are all one colour owns it.
  function linePass(st) {
    const N = st.N;
    let changed = 0;
    for (let g = 0; g < N; g++) {
      if (st.regDone[g]) continue;
      let row = -2, col = -2;
      for (let i = 0; i < N * N; i++) {
        if (st.regions[i] !== g || !st.cand[i]) continue;
        const r = (i / N) | 0, c = i % N;
        row = row === -2 ? r : (row === r ? row : -1);
        col = col === -2 ? c : (col === c ? col : -1);
      }
      if (row >= 0) for (let c = 0; c < N; c++) {
        const i = row * N + c;
        if (st.cand[i] && st.regions[i] !== g) { st.cand[i] = 0; changed++; }
      }
      if (col >= 0) for (let r = 0; r < N; r++) {
        const i = r * N + col;
        if (st.cand[i] && st.regions[i] !== g) { st.cand[i] = 0; changed++; }
      }
    }
    for (let r = 0; r < N; r++) {
      if (st.queenCol[r] !== -1) continue;
      let g = -2;
      for (let c = 0; c < N; c++) {
        const i = r * N + c;
        if (!st.cand[i]) continue;
        g = g === -2 ? st.regions[i] : (g === st.regions[i] ? g : -1);
      }
      if (g >= 0) for (let i = 0; i < N * N; i++) if (st.cand[i] && st.regions[i] === g && ((i / N) | 0) !== r) { st.cand[i] = 0; changed++; }
    }
    for (let c = 0; c < N; c++) {
      if (st.colDone[c]) continue;
      let g = -2;
      for (let r = 0; r < N; r++) {
        const i = r * N + c;
        if (!st.cand[i]) continue;
        g = g === -2 ? st.regions[i] : (g === st.regions[i] ? g : -1);
      }
      if (g >= 0) for (let i = 0; i < N * N; i++) if (st.cand[i] && st.regions[i] === g && (i % N) !== c) { st.cand[i] = 0; changed++; }
    }
    return changed;
  }

  function confinePass(st) {
    const N = st.N;
    if (!st.elim) st.elim = elimSets(N, st.regions);
    const es = st.elim, cnt = new Int16Array(N * N);
    let changed = 0;
    for (const u of unitsOf(st)) {
      if (unitDone(st, u)) continue;
      const live = u.cells.filter(i => st.cand[i]);
      if (live.length < 2) continue;
      cnt.fill(0);
      for (const x of live) for (const y of es[x]) cnt[y]++;
      for (let y = 0; y < N * N; y++) if (st.cand[y] && cnt[y] === live.length) { st.cand[y] = 0; changed++; }
    }
    return changed;
  }

  // "If the crown went here, that colour would have nowhere left" — a single
  // cell tried and disproved, never a guess left standing.
  function lookaheadPass(st) {
    const N = st.N;
    let changed = 0;
    for (let r = 0; r < N; r++) {
      if (st.queenCol[r] !== -1) continue;
      for (let c = 0; c < N; c++) {
        const i = r * N + c;
        if (!st.cand[i]) continue;
        const t = cloneState(st);
        if (!place(t, r, c) || singlesPass(t) < 0) { st.cand[i] = 0; changed++; }
      }
    }
    return changed;
  }

  // Solve with human techniques only, cheapest rule first, and record how
  // hard it had to work. Four tiers:
  //   1 singles           only one square left in a row, column or colour
  //   2 line confinement  a colour trapped in one line, or a line all one colour
  //   3 forced squares    a square every placement of some unit would wipe out
  //   4 disproof          put a crown down, watch a colour run out of room
  // The band that comes out is the technique band capped by the size profile:
  // a board with a colour under 3 squares can never be more than Easy, and one
  // under 4 squares, or with sizes spread wider than a CV of 0.35, can never be
  // Hard. Tier and score still order the ramp inside a band.
  function rate(N, regions) {
    const st = newState(N, regions);
    const rounds = [0, 0, 0, 0];
    const placed = [0, 0, 0, 0];
    let tier = 0, guard = 0;
    while (st.nQueens < N) {
      if (++guard > 400) return { solved: false, reason: 'guard' };
      const before = st.nQueens;
      const s = singlesPass(st);
      if (s < 0) return { solved: false, reason: 'contradiction' };
      if (s > 0) { rounds[0]++; placed[0] += s; tier = Math.max(tier, 1); continue; }
      if (linePass(st) > 0) { rounds[1]++; tier = Math.max(tier, 2); continue; }
      if (confinePass(st) > 0) { rounds[2]++; tier = Math.max(tier, 3); continue; }
      if (lookaheadPass(st) > 0) { rounds[3]++; tier = Math.max(tier, 4); continue; }
      return { solved: false, reason: 'stuck', rounds };
    }
    // Effort per row of board: how much work beyond plain singles it took.
    const effort = (rounds[1] + rounds[2] * 1.6 + rounds[3] * 6) / N;
    const techBand = rounds[3] > 0 ? 2 : (effort >= 0.32 ? 1 : 0);
    const band = Math.min(techBand, sizeCap(N, regions));
    return {
      solved: true, rounds, tier, effort: Math.round(effort * 100) / 100,
      techBand, band, score: Math.round(effort * 100), sol: Array.from(st.queenCol),
    };
  }

  // ---------------------------------------------------------------- hinting
  // queens: board indices the player has crowned. Returns the next square
  // that can be proved, or the wrong crown standing in the way.
  function hint(N, regions, sol, queens) {
    for (const i of queens) {
      const r = (i / N) | 0, c = i % N;
      if (sol[r] !== c) return { kind: 'wrong', r, c };
    }
    const st = newState(N, regions);
    for (const i of queens) if (!place(st, (i / N) | 0, i % N)) return { kind: 'wrong', r: (i / N) | 0, c: i % N };
    let guard = 0;
    while (guard++ < 400) {
      const found = findSingle(st);
      if (found) return { kind: 'place', r: found.r, c: found.c, why: found.why };
      if (singlesPass(st) < 0) break;
      if (findSingle(st)) continue;
      if (linePass(st) > 0) continue;
      if (confinePass(st) > 0) continue;
      if (lookaheadPass(st) > 0) continue;
      break;
    }
    for (let r = 0; r < N; r++) if (st.queenCol[r] === -1) return { kind: 'place', r, c: sol[r], why: 'solution' };
    return null;
  }

  // -------------------------------------------------------------- generator
  // A queen per row, none touching the row above.
  function randomPlacement(N, rnd) {
    const cols = new Array(N).fill(-1);
    const ok = (function rec(r, used) {
      if (r === N) return true;
      for (const c of shuffle(range(N), rnd)) {
        if (used & (1 << c)) continue;
        if (r > 0 && c >= cols[r - 1] - 1 && c <= cols[r - 1] + 1) continue;
        cols[r] = c;
        if (rec(r + 1, used | (1 << c))) return true;
        cols[r] = -1;
      }
      return false;
    })(0, 0);
    return ok ? cols : null;
  }

  // Each region is seeded on its queen and grown by flood fill, biased so it
  // stays a blob: a cell already touching the region on two sides wins.
  function growRegions(N, sol, rnd, opts) {
    opts = opts || {};
    const even = !!opts.even;
    const total = N * N;
    const reg = new Int8Array(total).fill(-1);
    const size = new Int32Array(N).fill(1);
    const nbr = neighbours(N);
    const front = Array.from({ length: N }, () => new Set());
    for (let r = 0; r < N; r++) {
      const i = r * N + sol[r];
      reg[i] = r;
      for (const j of nbr[i]) front[r].add(j);
    }
    let claimed = N;
    // First give every region a second cell, so no region is left a lone square.
    const firstPass = shuffle(range(N), rnd);
    const claim = (g, i) => {
      reg[i] = g; size[g]++; claimed++;
      for (const j of nbr[i]) if (reg[j] === -1) front[g].add(j);
    };
    const pickCell = g => {
      let best = [], bestScore = -1;
      for (const i of Array.from(front[g])) {
        if (reg[i] !== -1) { front[g].delete(i); continue; }
        let s = 0;
        for (const j of nbr[i]) if (reg[j] === g) s++;
        if (rnd() < 0.15) s = 0; // a little ragged, so regions are not all squares
        if (s > bestScore) { bestScore = s; best = [i]; }
        else if (s === bestScore) best.push(i);
      }
      if (!best.length) return -1;
      return best[(rnd() * best.length) | 0];
    };
    for (const g of firstPass) {
      const i = pickCell(g);
      if (i >= 0) claim(g, i);
    }
    let guard = 0;
    while (claimed < total && guard++ < total * 40) {
      // Prefer small regions, but not strictly, so sizes vary the way they do
      // in the real game.
      let pool = [];
      for (let g = 0; g < N; g++) if (front[g].size) pool.push(g);
      if (!pool.length) break;
      let g;
      if (even) {
        // Hard boards want colours all much of a muchness, so the smallest one
        // still growing always takes the next square.
        let least = Infinity;
        for (const h of pool) if (size[h] < least) least = size[h];
        const tied = pool.filter(h => size[h] === least);
        g = tied[(rnd() * tied.length) | 0];
      } else {
        const weights = pool.map(h => 1 / Math.pow(size[h], 1.7));
        const sum = weights.reduce((a, b) => a + b, 0);
        let pick = rnd() * sum;
        g = pool[pool.length - 1];
        for (let k = 0; k < pool.length; k++) { pick -= weights[k]; if (pick <= 0) { g = pool[k]; break; } }
      }
      const i = pickCell(g);
      if (i < 0) { front[g].clear(); continue; }
      claim(g, i);
    }
    if (claimed < total) return null;
    return reg;
  }

  // The first solution that differs from the intended one, or null.
  function altSolution(N, regions, sol) {
    let found = null;
    const cols = new Array(N).fill(-1);
    (function rec(r, uc, ug, prev) {
      if (found) return;
      if (r === N) {
        for (let k = 0; k < N; k++) if (cols[k] !== sol[k]) { found = cols.slice(); return; }
        return;
      }
      for (let c = 0; c < N; c++) {
        if (uc & (1 << c)) continue;
        if (prev >= 0 && c >= prev - 1 && c <= prev + 1) continue;
        const g = regions[r * N + c];
        if (ug & (1 << g)) continue;
        cols[r] = c;
        rec(r + 1, uc | (1 << c), ug | (1 << g), c);
        cols[r] = -1;
        if (found) return;
      }
    })(0, 0, 0, -1);
    return found;
  }

  // After a cell leaves a region, any piece of that region left stranded is
  // handed to whichever neighbour it touches, so every region stays one blob.
  // minRegion is the smallest the shrinking region may end up: below it the
  // repair is refused rather than shaving the colour down to a token square.
  // Returns true only if the region came out whole and still big enough.
  function repairRegion(N, regions, g, solCells, minRegion) {
    const floor = minRegion || 1;
    const nbr = neighbours(N);
    const cells = [];
    for (let i = 0; i < N * N; i++) if (regions[i] === g) cells.push(i);
    if (!cells.length) return false;
    let seed = cells.find(i => solCells.has(i));
    if (seed === undefined) seed = cells[0];
    const keep = new Set([seed]), stack = [seed];
    while (stack.length) {
      const i = stack.pop();
      for (const j of nbr[i]) if (regions[j] === g && !keep.has(j)) { keep.add(j); stack.push(j); }
    }
    if (keep.size < floor) return false;
    let orphans = cells.filter(i => !keep.has(i));
    let guard = 0;
    while (orphans.length && guard++ < N * N * 4) {
      let moved = false;
      for (let k = orphans.length - 1; k >= 0; k--) {
        const i = orphans[k];
        const hs = nbr[i].map(j => regions[j]).filter(h => h !== g);
        if (hs.length) { regions[i] = hs[0]; orphans.splice(k, 1); moved = true; }
      }
      if (!moved) break;
    }
    return orphans.length === 0;
  }

  // Walk the board toward a single answer: find a rival solution, move one of
  // its queen squares into a neighbouring colour, repeat. The intended
  // solution survives every move because only non-queen squares change hands.
  // minRegion is the size floor every colour keeps throughout: a move that
  // would shave a colour below it is rolled back and another rival row or
  // another neighbouring colour is tried instead. When no legal move is left
  // the candidate fails rather than shipping a board of slivers.
  function tighten(N, regions, sol, rnd, maxSteps, minRegion) {
    const floor = minRegion || 1;
    const nbr = neighbours(N);
    const solCells = new Set(sol.map((c, r) => r * N + c));
    for (let step = 0; step < maxSteps; step++) {
      const alt = altSolution(N, regions, sol);
      if (!alt) return step;
      const rows = shuffle(range(N).filter(r => alt[r] !== sol[r]), rnd);
      let done = false;
      for (const r of rows) {
        const x = r * N + alt[r], g = regions[x];
        const hs = shuffle(Array.from(new Set(nbr[x].map(j => regions[j]).filter(h => h !== g))), rnd);
        for (const h of hs) {
          // Try the move on a copy: the repair can strand cells or eat the
          // colour, and only a move that leaves every floor intact is kept.
          const trial = regions.slice();
          trial[x] = h;
          if (!repairRegion(N, trial, g, solCells, floor)) continue;
          if (minSize(N, trial) < floor) continue;
          regions.set(trial);
          done = true;
          break;
        }
        if (done) break;
      }
      if (!done) return -1;
    }
    return -1;
  }

  // Would region g still be one blob if cell x left it?
  function regionWhole(N, regions, g, x) {
    const nbr = neighbours(N), cells = [];
    for (let i = 0; i < N * N; i++) if (regions[i] === g && i !== x) cells.push(i);
    if (!cells.length) return false;
    const seen = new Set([cells[0]]), st = [cells[0]];
    while (st.length) {
      const i = st.pop();
      for (const j of nbr[i]) if (j !== x && regions[j] === g && !seen.has(j)) { seen.add(j); st.push(j); }
    }
    return seen.size === cells.length;
  }

  // Even the colours up once the board already has its single answer. Tighten
  // works by taking squares off one colour and giving them to another, so it
  // leaves the sizes lopsided however evenly they started; squeezing it for
  // evenness at the same time as uniqueness just makes it fail. So this runs
  // after: hand single boundary squares from the big colours to the small ones,
  // steepest step first, keeping every colour whole and above the floor, never
  // moving an answer square, and rolling back any move that costs the board its
  // single answer. It stops at the first pass that cannot improve.
  function rebalance(N, regions, sol, rnd, minRegion, maxMoves) {
    const floor = minRegion || 1;
    const nbr = neighbours(N);
    const solCells = new Set(sol.map((c, r) => r * N + c));
    let moves = 0;
    for (let pass = 0; pass < (maxMoves || 400); pass++) {
      const size = regionSizes(N, regions);
      const cands = [];
      for (let i = 0; i < N * N; i++) {
        const g = regions[i];
        if (solCells.has(i) || size[g] - 1 < floor) continue;
        const seen = new Set();
        for (const j of nbr[i]) {
          const h = regions[j];
          if (h === g || seen.has(h)) continue;
          seen.add(h);
          // change in the sum of squared deviations; the mean is always N
          const d = (size[g] - 1 - N) * (size[g] - 1 - N) + (size[h] + 1 - N) * (size[h] + 1 - N)
            - (size[g] - N) * (size[g] - N) - (size[h] - N) * (size[h] - N);
          if (d < 0) cands.push({ i, h, d });
        }
      }
      if (!cands.length) break;
      shuffle(cands, rnd);
      cands.sort((a, b) => a.d - b.d);
      let did = false;
      for (const c of cands) {
        const g = regions[c.i];
        if (!regionWhole(N, regions, g, c.i)) continue;
        regions[c.i] = c.h;
        if (countSolutions(N, regions, 2) !== 1) { regions[c.i] = g; continue; }
        moves++; did = true; break;
      }
      if (!did) break;
    }
    return moves;
  }

  function regionSizes(N, regions) {
    const cnt = new Array(N).fill(0);
    for (let i = 0; i < N * N; i++) cnt[regions[i]]++;
    return cnt;
  }
  function minSize(N, regions) {
    const cnt = regionSizes(N, regions);
    let m = Infinity;
    for (const v of cnt) if (v < m) m = v;
    return m;
  }
  // sd / mean over the region sizes. N regions share N*N cells, so the mean is
  // always N and this is just the spread: 0 when every colour is the same size.
  function sizeCV(N, regions) {
    const cnt = regionSizes(N, regions);
    let ss = 0;
    for (const v of cnt) ss += (v - N) * (v - N);
    return Math.sqrt(ss / N) / N;
  }
  // The highest band these region sizes may claim, whatever the technique
  // solver had to do. A board with a one- or two-square colour is easy however
  // twisty the rest of it is, because that colour is a free crown.
  function sizeCap(N, regions) {
    const min = minSize(N, regions);
    if (min < SIZE_PROFILE[1].minRegion) return 0;
    if (min < SIZE_PROFILE[2].minRegion || sizeCV(N, regions) > SIZE_PROFILE[2].maxCV) return 1;
    return 2;
  }
  // The profile a call is generating to: an explicit minRegion/maxCV wins,
  // otherwise the target band's, otherwise the floor every band shares.
  function profileOf(opts) {
    const base = SIZE_PROFILE[opts && opts.band != null ? opts.band : 0] || SIZE_PROFILE[0];
    return {
      minRegion: opts && opts.minRegion != null ? opts.minRegion : base.minRegion,
      maxCV: opts && opts.maxCV != null ? opts.maxCV : base.maxCV,
    };
  }

  function makePuzzle(N, rnd, opts) {
    opts = opts || {};
    const prof = profileOf(opts);
    // Hard wants even colours from the first square, not evened up afterwards.
    const even = opts.even == null ? opts.band === 2 : !!opts.even;
    const sol = randomPlacement(N, rnd);
    if (!sol) return null;
    const regions = growRegions(N, sol, rnd, { even });
    if (!regions) return null;
    if (minSize(N, regions) < prof.minRegion) return null;
    if (tighten(N, regions, sol, rnd, opts.maxSteps || 600, prof.minRegion) < 0) return null;
    if (countSolutions(N, regions, 2) !== 1) return null;
    // Only the bands that ask for even colours pay for it. Easy and Medium are
    // meant to look scattered, and leaving them alone keeps them quick to make.
    if (isFinite(prof.maxCV)) {
      rebalance(N, regions, sol, rnd, prof.minRegion, opts.maxMoves || 400);
      if (countSolutions(N, regions, 2) !== 1) return null;
    }
    const sizes = regionSizes(N, regions);
    if (minSize(N, regions) < prof.minRegion) return null;
    const cv = sizeCV(N, regions);
    if (cv > prof.maxCV) return null;
    const r = rate(N, regions);
    if (!r.solved) return null;
    return { N, regions, sol, band: r.band, score: r.score, tier: r.tier, rounds: r.rounds, sizes, cv };
  }

  // opts: { band, budgetMs, tries, rng }
  function generate(N, opts) {
    opts = opts || {};
    const rnd = opts.rng || defaultRng;
    const stop = Date.now() + (opts.budgetMs || 1500);
    const maxTries = opts.tries || 100000;
    let fallback = null;
    for (let k = 0; k < maxTries; k++) {
      if (k % 8 === 7 && Date.now() > stop) break;
      const p = makePuzzle(N, rnd, opts);
      if (!p) continue;
      if (opts.band == null || p.band === opts.band) return p;
      if (!fallback || Math.abs(p.band - opts.band) < Math.abs(fallback.band - opts.band)) fallback = p;
    }
    return opts.strict ? null : fallback;
  }

  // Belt and braces before anything ships: exactly one solution, and the
  // stored answer is that solution.
  function verify(p) {
    if (countSolutions(p.N, p.regions, 2) !== 1) return false;
    const s = findSolution(p.N, p.regions);
    if (!s) return false;
    for (let r = 0; r < p.N; r++) if (s[r] !== p.sol[r]) return false;
    return true;
  }

  // ------------------------------------------------------- explained steps
  // The passes above prove things silently. Everything below proves the same
  // things one elimination at a time and writes down why: the units it looked
  // at, the squares that make the case, and the squares that fall out of it.
  // Nothing here deduces anything the passes cannot; it only records the
  // reason, so the page can say it out loud and a test can check it holds.
  //
  // The order is the solver's own, cheapest rule first: a unit down to one
  // square, a colour or a line confined on its own, the same confinement
  // shared between two, three or four colours, a square that every placement
  // of one unit would wipe out, and only then a crown tried and disproved.
  // Counting sits above plain confinement because a set of one *is* plain
  // confinement; the sets only get bigger.

  const COLOUR_NAMES = ['yellow', 'blue', 'pink', 'green', 'purple', 'orange', 'teal', 'sand', 'red', 'indigo'];
  const COUNT_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  const upper = c => LETTERS[c].toUpperCase();
  // squares are named the way the board is labelled: column letter, row number
  const cellName = (N, i) => upper(i % N) + (((i / N) | 0) + 1);
  const lineName = (kind, k) => kind === 'row' ? 'row ' + (k + 1) : 'column ' + upper(k);
  const unitName = (kind, k) => kind === 'reg' ? COLOUR_NAMES[k] : lineName(kind, k);
  const cap1 = s => s.charAt(0).toUpperCase() + s.slice(1);
  const countWord = n => COUNT_WORDS[n] || String(n);
  function listWords(a, join) {
    const last = join || 'and';
    if (a.length <= 1) return a[0] || '';
    if (a.length === 2) return a[0] + ' ' + last + ' ' + a[1];
    return a.slice(0, -1).join(', ') + ' ' + last + ' ' + a[a.length - 1];
  }
  function namesOf(N, cells, cap, join) {
    const a = cells.slice().sort((x, y) => x - y).map(i => cellName(N, i));
    if (!cap || a.length <= cap) return listWords(a, join);
    return a.slice(0, cap).join(', ') + ' and ' + (a.length - cap) + ' more';
  }
  // "row 8", "rows 3 and 4", "columns F to H", "columns A, C and E"
  function linesPhrase(kind, ks) {
    const s = ks.slice().sort((x, y) => x - y);
    const label = k => kind === 'row' ? String(k + 1) : upper(k);
    if (s.length === 1) return lineName(kind, s[0]);
    const head = kind === 'row' ? 'rows ' : 'columns ';
    const run = s[s.length - 1] - s[0] === s.length - 1;
    if (run && s.length > 2) return head + label(s[0]) + ' to ' + label(s[s.length - 1]);
    return head + listWords(s.map(label));
  }
  const coloursPhrase = gs => listWords(gs.slice().sort((a, b) => a - b).map(g => COLOUR_NAMES[g]));
  // the one sentence that names the crosses. The page rebuilds it from the
  // squares she has not already crossed herself, so it lives on its own.
  function sayCrosses(N, cells) {
    if (!cells || !cells.length) return '';
    return 'That crosses out ' + namesOf(N, cells, 6) + '.';
  }

  const liveOf = (st, cells) => cells.filter(i => st.cand[i]);
  function regionCells(st, g) {
    const N = st.N, out = [];
    for (let i = 0; i < N * N; i++) if (st.regions[i] === g) out.push(i);
    return out;
  }

  // 1. a row, a column or a colour with one square left
  function stepSingle(st) {
    const f = findSingle(st);
    if (!f) return null;
    const N = st.N, i = f.r * N + f.c;
    const kind = f.why === 'row' ? 'row' : f.why === 'col' ? 'col' : 'reg';
    const k = kind === 'row' ? f.r : kind === 'col' ? f.c : st.regions[i];
    return {
      rule: 'single', why: f.why, place: { r: f.r, c: f.c },
      units: [{ kind: kind, k: k }], colours: kind === 'reg' ? [k] : [],
      cells: [i], ring: [], elim: [],
    };
  }

  // 2. a colour whose last squares share a line owns it; a line with one
  //    colour left owns that colour
  function stepLine(st) {
    const N = st.N;
    for (let g = 0; g < N; g++) {
      if (st.regDone[g]) continue;
      const live = liveOf(st, regionCells(st, g));
      if (live.length < 2) continue;             // one square left is a single
      const rows = new Set(live.map(i => (i / N) | 0));
      const cols = new Set(live.map(i => i % N));
      const tries = [[rows, 'row'], [cols, 'col']];
      for (const pair of tries) {
        if (pair[0].size !== 1) continue;
        const kind = pair[1], k = pair[0].values().next().value;
        const elim = [];
        for (let j = 0; j < N; j++) {
          const i = kind === 'row' ? k * N + j : j * N + k;
          if (st.cand[i] && st.regions[i] !== g) elim.push(i);
        }
        if (elim.length) return {
          rule: 'line', dir: 'colour-in-line', colours: [g],
          lines: [{ kind: kind, k: k }], units: [{ kind: kind, k: k }],
          cells: live, ring: [], elim: elim,
        };
      }
    }
    for (const kind of ['row', 'col']) {
      for (let k = 0; k < N; k++) {
        if (kind === 'row' ? st.queenCol[k] !== -1 : st.colDone[k]) continue;
        const live = [];
        for (let j = 0; j < N; j++) {
          const i = kind === 'row' ? k * N + j : j * N + k;
          if (st.cand[i]) live.push(i);
        }
        if (live.length < 2) continue;
        const g = st.regions[live[0]];
        if (!live.every(i => st.regions[i] === g)) continue;
        const elim = regionCells(st, g).filter(i => st.cand[i] && live.indexOf(i) < 0);
        if (elim.length) return {
          rule: 'line', dir: 'line-in-colour', colours: [g],
          lines: [{ kind: kind, k: k }], units: [{ kind: kind, k: k }],
          cells: live, ring: [], elim: elim,
        };
      }
    }
    return null;
  }

  const popcount = m => { let n = 0; while (m) { m &= m - 1; n++; } return n; };
  const bitsOf = m => { const a = []; for (let k = 0; m; k++, m >>>= 1) if (m & 1) a.push(k); return a; };

  // 3. counting. |G| colours whose squares all fall inside |G| lines own those
  //    lines, and |L| lines holding only |L| colours use those colours up.
  //    Sets of two, three and four; a set of one is stepLine above.
  function stepCount(st, size) {
    const N = st.N;
    const orders = ['row', 'col'];
    // colours -> lines
    for (const kind of orders) {
      const mask = [], keys = [];
      for (let g = 0; g < N; g++) {
        if (st.regDone[g]) continue;
        let m = 0;
        for (const i of regionCells(st, g)) if (st.cand[i]) m |= 1 << (kind === 'row' ? (i / N) | 0 : i % N);
        if (!m || popcount(m) > size) continue;
        mask.push(m); keys.push(g);
      }
      const found = subsetHit(mask, size, size);
      for (const pick of found) {
        const gs = pick.map(x => keys[x]);
        let union = 0;
        for (const x of pick) union |= mask[x];
        const ks = bitsOf(union);
        if (ks.some(k => kind === 'row' ? st.queenCol[k] !== -1 : !!st.colDone[k])) continue;
        const elim = [];
        for (const k of ks) for (let j = 0; j < N; j++) {
          const i = kind === 'row' ? k * N + j : j * N + k;
          if (st.cand[i] && gs.indexOf(st.regions[i]) < 0) elim.push(i);
        }
        if (!elim.length) continue;
        const cells = [];
        for (const g of gs) for (const i of regionCells(st, g)) if (st.cand[i]) cells.push(i);
        return {
          rule: 'count', dir: 'colours-in-lines', colours: gs,
          lines: ks.map(k => ({ kind: kind, k: k })), units: ks.map(k => ({ kind: kind, k: k })),
          cells: cells, ring: [], elim: elim,
        };
      }
    }
    // lines -> colours
    for (const kind of orders) {
      const mask = [], keys = [];
      for (let k = 0; k < N; k++) {
        if (kind === 'row' ? st.queenCol[k] !== -1 : !!st.colDone[k]) continue;
        let m = 0;
        for (let j = 0; j < N; j++) {
          const i = kind === 'row' ? k * N + j : j * N + k;
          if (st.cand[i]) m |= 1 << st.regions[i];
        }
        if (!m || popcount(m) > size) continue;
        mask.push(m); keys.push(k);
      }
      const found = subsetHit(mask, size, size);
      for (const pick of found) {
        const ks = pick.map(x => keys[x]);
        let union = 0;
        for (const x of pick) union |= mask[x];
        const gs = bitsOf(union);
        if (gs.some(g => !!st.regDone[g])) continue;
        const inLine = new Set();
        for (const k of ks) for (let j = 0; j < N; j++) inLine.add(kind === 'row' ? k * N + j : j * N + k);
        const elim = [];
        const cells = [];
        for (const g of gs) for (const i of regionCells(st, g)) {
          if (!st.cand[i]) continue;
          if (inLine.has(i)) cells.push(i); else elim.push(i);
        }
        if (!elim.length) continue;
        return {
          rule: 'count', dir: 'lines-in-colours', colours: gs,
          lines: ks.map(k => ({ kind: kind, k: k })), units: ks.map(k => ({ kind: kind, k: k })),
          cells: cells, ring: [], elim: elim,
        };
      }
    }
    return null;
  }
  // every subset of exactly `size` masks whose union covers exactly `want`
  // bits. The union can only grow, so a branch already too wide is dropped.
  function subsetHit(mask, size, want) {
    const out = [];
    const pick = [];
    (function rec(start, union) {
      if (popcount(union) > want) return;
      if (pick.length === size) { if (popcount(union) === want) out.push(pick.slice()); return; }
      for (let i = start; i < mask.length; i++) {
        pick.push(i);
        rec(i + 1, union | mask[i]);
        pick.pop();
        if (out.length > 40) return;
      }
    })(0, 0);
    return out;
  }

  // 4. a square that every square a unit could still use would rule out
  function stepConfine(st) {
    const N = st.N;
    if (!st.elim) st.elim = elimSets(N, st.regions);
    const es = st.elim, cnt = new Int16Array(N * N);
    for (const u of unitsOf(st)) {
      if (unitDone(st, u)) continue;
      const live = u.cells.filter(i => st.cand[i]);
      if (live.length < 2) continue;
      cnt.fill(0);
      for (const x of live) for (const y of es[x]) cnt[y]++;
      const elim = [];
      for (let y = 0; y < N * N; y++) if (st.cand[y] && cnt[y] === live.length) elim.push(y);
      if (elim.length) return {
        rule: 'confine', units: [{ kind: u.kind, k: u.k }],
        colours: u.kind === 'reg' ? [u.k] : [], cells: live, ring: live, elim: elim,
      };
    }
    return null;
  }

  // 5. a crown tried on one square, and the unit that runs out of room
  function stepLookahead(st) {
    const N = st.N;
    for (let r = 0; r < N; r++) {
      if (st.queenCol[r] !== -1) continue;
      for (let c = 0; c < N; c++) {
        const i = r * N + c;
        if (!st.cand[i]) continue;
        const t = cloneState(st);
        const trace = { steps: [], empty: null };
        if (place(t, r, c) && singlesPass(t, trace) >= 0) continue;
        const emptied = trace.empty || { kind: 'row', k: r };
        return {
          rule: 'lookahead', trigger: i, emptied: emptied, cascade: trace.steps,
          units: [emptied], colours: emptied.kind === 'reg' ? [emptied.k] : [],
          cells: [i].concat(trace.steps.map(s => s.r * N + s.c)),
          ring: [i].concat(trace.steps.map(s => s.r * N + s.c)), elim: [i],
        };
      }
    }
    return null;
  }

  // the cheapest rule that makes progress, with its witness
  function nextStep(st, sol) {
    if (st.nQueens >= st.N) return null;
    let w = stepSingle(st);
    if (!w) w = stepLine(st);
    if (!w) for (let size = 2; size <= 4 && !w; size++) w = stepCount(st, size);
    if (!w) w = stepConfine(st);
    if (!w) w = stepLookahead(st);
    if (!w && sol) {
      for (let r = 0; r < st.N; r++) if (st.queenCol[r] === -1) {
        w = { rule: 'solution', why: 'solution', place: { r: r, c: sol[r] }, units: [{ kind: 'row', k: r }], colours: [], cells: [r * st.N + sol[r]], ring: [], elim: [] };
        break;
      }
    }
    if (w) describe(st, w);
    return w;
  }
  function applyStep(st, w) {
    if (w.place) return place(st, w.place.r, w.place.c);
    for (const i of w.elim) st.cand[i] = 0;
    return true;
  }


  // ----------------------------------------------------------- the wording
  // One plain sentence per rule, said the way it would be said out loud over
  // the board. The squares are named by their label, column letter then row
  // number, so a hint can be read to somebody holding the iPad.
  function describe(st, w) {
    const N = st.N;
    if (w.rule === 'single') {
      const u = w.units[0];
      w.text = cap1(unitName(u.kind, u.k)) + ' is down to one square, so its crown goes on '
        + cellName(N, w.place.r * N + w.place.c) + '.';
    } else if (w.rule === 'solution') {
      w.text = cellName(N, w.place.r * N + w.place.c) + " is this row's square.";
    } else if (w.rule === 'line') {
      const ln = w.lines[0], g = COLOUR_NAMES[w.colours[0]];
      w.text = w.dir === 'colour-in-line'
        ? cap1(g) + "'s last squares are all in " + lineName(ln.kind, ln.k) + '.'
        : 'Every square left in ' + lineName(ln.kind, ln.k) + ' is ' + g + ', so ' + g
          + "'s crown is in that " + (ln.kind === 'row' ? 'row' : 'column') + '.';
    } else if (w.rule === 'count') {
      const ks = w.lines.map(l => l.k), kind = w.lines[0].kind;
      const lines = linesPhrase(kind, ks), cols = coloursPhrase(w.colours);
      w.text = w.dir === 'colours-in-lines'
        ? cap1(cols) + (w.colours.length === 2 ? ' both live in ' : ' all live in ') + lines + ', so those '
          + (kind === 'row' ? 'rows' : 'columns') + ' are theirs.'
        : cap1(lines) + ' have nothing left but ' + cols + ', so those ' + countWord(w.colours.length)
          + ' colours belong there.';
    } else if (w.rule === 'confine') {
      const u = w.units[0], n = w.cells.length;
      const where = n <= 3
        ? 'has to go on ' + namesOf(N, w.cells, 3, 'or')
        : 'has to go on one of ' + countWord(n) + ' squares';
      const both = n === 2 ? 'both of those squares' : 'all ' + countWord(n) + ' of them';
      w.text = cap1(unitName(u.kind, u.k)) + "'s crown " + where + '. Anything ' + both + ' attack is out.';
    } else if (w.rule === 'lookahead') {
      const at = cellName(N, w.trigger), gone = unitName(w.emptied.kind, w.emptied.k);
      const n = w.cascade.length;
      let forced = '';
      if (n === 1) forced = ' forces a crown at ' + cellName(N, w.cascade[0].r * N + w.cascade[0].c) + ',';
      else if (n > 1 && n <= 4) forced = ' forces crowns at ' + namesOf(N, w.cascade.map(s => s.r * N + s.c), 4) + ',';
      else if (n > 4) forced = ' forces ' + countWord(n) + ' more crowns,';
      w.text = forced
        ? 'A crown at ' + at + forced + ' and then ' + gone + ' has nowhere to go.'
        : 'A crown at ' + at + ' would leave ' + gone + ' with nowhere to go.';
    }
    w.crossText = sayCrosses(N, w.elim);
    return w;
  }

  // ------------------------------------------------------ the staged hint
  // The next step from the board as she has it, with its witness. A crown in
  // the wrong place is still reported first and nothing else is looked at.
  // `known` is the squares already crossed off; a step she has already made
  // every cross for is applied quietly and the next one comes back instead.
  function explain(N, regions, sol, queens, known) {
    for (const i of queens) {
      const r = (i / N) | 0, c = i % N;
      if (sol && sol[r] !== c) return { rule: 'wrong', kind: 'wrong', r: r, c: c };
    }
    const st = newState(N, regions);
    for (const i of queens) if (!place(st, (i / N) | 0, i % N)) return { rule: 'wrong', kind: 'wrong', r: (i / N) | 0, c: i % N };
    const seen = known ? (known instanceof Set ? known : new Set(known)) : null;
    let guard = 0, w = null;
    while (guard++ < 400) {
      w = nextStep(st, sol);
      if (!w) return null;
      if (w.place || !seen || w.elim.some(i => !seen.has(i))) break;
      applyStep(st, w);   // she has made every one of those crosses already
      w = null;
    }
    if (!w) return null;
    // if the crosses hand her a crown straight away, the hint can end on it
    if (!w.place) {
      applyStep(st, w);
      const nx = nextStep(st, sol);
      if (nx && nx.place) w.then = nx;
    }
    return w;
  }

  // Every step from an empty board to the finished one, in order. Used by the
  // replay after a win, and by the tests that check each witness holds up.
  function chain(N, regions, sol, queens) {
    const st = newState(N, regions);
    for (const i of queens || []) if (!place(st, (i / N) | 0, i % N)) return null;
    const out = [];
    let guard = 0;
    while (st.nQueens < N && guard++ < 600) {
      const w = nextStep(st, sol);
      if (!w) break;
      out.push(w);
      if (!applyStep(st, w)) break;
    }
    return out;
  }

  return {
    LETTERS, makeRng, shuffle, neighbours, touching,
    countSolutions, findSolution, conflicts,
    encode, decode,
    newState, cloneState, place, singlesPass, linePass, confinePass, lookaheadPass, findSingle,
    elimSets, unitsOf, rate, hint,
    explain, chain, nextStep, applyStep, sayCrosses, cellName, unitName, COLOUR_NAMES,
    randomPlacement, growRegions, altSolution, tighten, repairRegion, rebalance, regionWhole,
    SIZE_PROFILE, regionSizes, minSize, sizeCV, sizeCap, profileOf,
    makePuzzle, generate, verify,
  };
});
