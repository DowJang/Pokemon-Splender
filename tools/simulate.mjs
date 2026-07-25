// 규칙/AI 자체 검증: AI끼리 여러 판 돌려 규칙 위반과 승률을 확인한다.
//   node tools/simulate.mjs [판수]
import { COLORS, ALL_CARDS, DECKS, TOKEN_SUPPLY, WIN_SCORE } from '../app/js/data.js';
import {
  newGame, newPlayer, cur, bonuses, score, tokenCount,
  legalMoves, applyMove, applyEvolution, autoDiscard, endTurn,
} from '../app/js/engine.js';
import { chooseMove, chooseEvolution } from '../app/js/ai.js';

// ── 데이터 무결성 ─────────────────────────────────────────────
function checkData() {
  const want = { 1: 35, 2: 30, 3: 15, R: 5, L: 5 };
  let bad = 0;
  for (const [t, n] of Object.entries(want)) {
    const got = DECKS[t].length;
    if (got !== n) { console.log(`  ✗ ${t}단계 ${got}장 (기대 ${n})`); bad++; }
  }
  // 2단계/3단계 포켓몬은 모두 진화 대상으로 도달 가능해야 한다
  const names = new Set(ALL_CARDS.map((c) => c.mon));
  for (const c of ALL_CARDS) {
    if (c.to && !names.has(c.to)) { console.log(`  ✗ ${c.mon} → ${c.to} 카드 없음`); bad++; }
  }
  const vp = ALL_CARDS.reduce((s, c) => s + c.vp, 0);
  console.log(`데이터: ${ALL_CARDS.length}장, 총 승점 ${vp}, 오류 ${bad}건`);
  return bad === 0;
}

// ── 규칙 검사 ─────────────────────────────────────────────────
function invariants(g, tag) {
  const errs = [];
  for (const c of [...COLORS, 'm']) {
    const held = g.players.reduce((s, p) => s + p.tokens[c], 0);
    const total = g.bank[c] + held;
    const expect = c === 'm' ? 5 : TOKEN_SUPPLY;
    if (total !== expect) errs.push(`${tag} ${c} 토큰 총합 ${total} ≠ ${expect}`);
    if (g.bank[c] < 0) errs.push(`${tag} ${c} 은행 음수`);
  }
  for (const p of g.players) {
    if (tokenCount(p) > 10) errs.push(`${tag} ${p.name} 토큰 ${tokenCount(p)}개`);
    if (p.hand.length > 3) errs.push(`${tag} ${p.name} 손패 ${p.hand.length}장`);
    for (const c of [...COLORS, 'm']) if (p.tokens[c] < 0) errs.push(`${tag} ${p.name} ${c} 음수`);
  }
  const ids = new Set();
  for (const t of [1, 2, 3, 'R', 'L']) for (const c of g.market[t]) if (c) {
    if (ids.has(c.id)) errs.push(`${tag} 시장 카드 중복 ${c.id}`);
    ids.add(c.id);
  }
  for (const p of g.players) for (const c of [...p.board, ...p.hand, ...p.buried]) {
    if (ids.has(c.id)) errs.push(`${tag} 카드 중복 ${c.id}`);
    ids.add(c.id);
  }
  return errs;
}

function playGame(levels, seed) {
  const players = levels.map((lv, i) => newPlayer(i, `${lv}${i}`, 'ai', lv));
  const g = newGame({ players, seed });
  let turns = 0;
  const errs = [];
  while (!g.over && turns < 600) {
    const p = cur(g);
    const mv = chooseMove(g);
    applyMove(g, mv);
    const evo = chooseEvolution(g);
    if (evo) applyEvolution(g, evo, p);
    autoDiscard(g, p);
    endTurn(g);
    turns++;
    if (turns % 7 === 0) errs.push(...invariants(g, `t${turns}`));
  }
  errs.push(...invariants(g, 'end'));
  return { g, turns, errs };
}

// ── 실행 ──────────────────────────────────────────────────────
const N = +(process.argv[2] || 30);
console.log('─'.repeat(52));
checkData();
console.log('─'.repeat(52));

const matchups = [
  ['novice', 'novice'],
  ['adept', 'novice'],
  ['pro', 'novice'],
  ['pro', 'adept'],
  ['kimmawi', 'pro'],
  ['nylongmusk', 'kimmawi'],
];

function rotate(a, k) { return a.map((_, i) => a[(i + k) % a.length]); }

let allErrs = 0;
for (const lv of matchups) {
  // 자리 순서 편향을 없애기 위해 모든 회전 배치로 같은 수만큼 돌린다
  const wins = {}; const scores = {}; const games = {};
  for (const l of lv) { wins[l] = 0; scores[l] = 0; games[l] = 0; }
  let totTurns = 0; let noWin = 0; let plays = 0;

  for (let k = 0; k < lv.length; k++) {
    const order = rotate(lv, k);
    for (let i = 0; i < N; i++) {
      const { g, turns, errs } = playGame(order, 1000 + i * 77 + k * 13);
      if (errs.length) { allErrs += errs.length; if (allErrs < 8) console.log('  !', errs[0]); }
      totTurns += turns; plays++;
      if (g.over) wins[order[g.winner]]++; else noWin++;
      g.players.forEach((p, j) => { scores[order[j]] += score(p); games[order[j]]++; });
    }
  }
  const uniq = [...new Set(lv)];
  console.log(
    `${lv.join(' vs ').padEnd(32)} ` +
    uniq.map((l) => {
      const share = lv.filter((x) => x === l).length;
      return `${l} ${String(Math.round(wins[l] / plays * 100)).padStart(3)}%(기대${Math.round(share / lv.length * 100)}) ` +
             `${(scores[l] / games[l]).toFixed(1)}점`;
    }).join('  ') +
    `  ${(totTurns / plays / lv.length).toFixed(1)}턴${noWin ? `  미결 ${noWin}` : ''}`,
  );
}
console.log('─'.repeat(52));
console.log(allErrs ? `규칙 위반 ${allErrs}건` : '규칙 위반 없음 ✓');
