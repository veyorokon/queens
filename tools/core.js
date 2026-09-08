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
  function singlesPass(st) {
    const N = st.N;
    let placed = 0, again = true;
    while (again) {
      again = false;
      for (let r = 0; r < N; r++) {
        if (st.queenCol[r] !== -1) continue;
        let n = 0, only = -1;
        for (let c = 0; c < N; c++) if (st.cand[r * N + c]) { n++; only = c; }
        if (n === 0) return -1;
        if (n === 1) { if (!place(st, r, only)) return -1; placed++; again = true; }
      }
      for (let c = 0; c < N; c++) {
        if (st.colDone[c]) continue;
        let n = 0, only = -1;
        for (let r = 0; r < N; r++) if (st.cand[r * N + c]) { n++; only = r; }
        if (n === 0) return -1;
        if (n === 1) { if (!place(st, only, c)) return -1; placed++; again = true; }
      }
      for (let g = 0; g < N; g++) {
        if (st.regDone[g]) continue;
        let n = 0, only = -1;
        for (let i = 0; i < N * N; i++) if (st.regions[i] === g && st.cand[i]) { n++; only = i; }
        if (n === 0) return -1;
        if (n === 1) { if (!place(st, (only / N) | 0, only % N)) return -1; placed++; again = true; }
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
    const band = rounds[3] > 0 ? 2 : (effort >= 0.32 ? 1 : 0);
    return { solved: true, rounds, tier, effort: Math.round(effort * 100) / 100, band, score: Math.round(effort * 100), sol: Array.from(st.queenCol) };
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
  function growRegions(N, sol, rnd) {
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
      let weights = pool.map(g => 1 / Math.pow(size[g], 1.7));
      let sum = weights.reduce((a, b) => a + b, 0), pick = rnd() * sum, g = pool[pool.length - 1];
      for (let k = 0; k < pool.length; k++) { pick -= weights[k]; if (pick <= 0) { g = pool[k]; break; } }
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
  function repairRegion(N, regions, g, solCells) {
    const nbr = neighbours(N);
    const cells = [];
    for (let i = 0; i < N * N; i++) if (regions[i] === g) cells.push(i);
    if (!cells.length) return;
    let seed = cells.find(i => solCells.has(i));
    if (seed === undefined) seed = cells[0];
    const keep = new Set([seed]), stack = [seed];
    while (stack.length) {
      const i = stack.pop();
      for (const j of nbr[i]) if (regions[j] === g && !keep.has(j)) { keep.add(j); stack.push(j); }
    }
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
  }

  // Walk the board toward a single answer: find a rival solution, move one of
  // its queen squares into a neighbouring colour, repeat. The intended
  // solution survives every move because only non-queen squares change hands.
  function tighten(N, regions, sol, rnd, maxSteps) {
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
        if (!hs.length) continue;
        regions[x] = hs[0];
        repairRegion(N, regions, g, solCells);
        done = true;
        break;
      }
      if (!done) return -1;
    }
    return -1;
  }

  function regionSizes(N, regions) {
    const cnt = new Array(N).fill(0);
    for (let i = 0; i < N * N; i++) cnt[regions[i]]++;
    return cnt;
  }

  function makePuzzle(N, rnd, opts) {
    opts = opts || {};
    const sol = randomPlacement(N, rnd);
    if (!sol) return null;
    const regions = growRegions(N, sol, rnd);
    if (!regions) return null;
    if (tighten(N, regions, sol, rnd, opts.maxSteps || 600) < 0) return null;
    if (countSolutions(N, regions, 2) !== 1) return null;
    const sizes = regionSizes(N, regions);
    const tiny = sizes.filter(v => v <= 1).length;
    if (tiny > (opts.maxTiny == null ? 1 : opts.maxTiny)) return null;
    const r = rate(N, regions);
    if (!r.solved) return null;
    return { N, regions, sol, band: r.band, score: r.score, tier: r.tier, rounds: r.rounds, sizes };
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

  return {
    LETTERS, makeRng, shuffle, neighbours, touching,
    countSolutions, findSolution, conflicts,
    encode, decode,
    newState, cloneState, place, singlesPass, linePass, confinePass, lookaheadPass, findSingle,
    rate, hint,
    randomPlacement, growRegions, altSolution, tighten, repairRegion, regionSizes, makePuzzle, generate, verify,
  };
});
