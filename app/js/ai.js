// AI — 초보자(novice) / 수련자(adept) / 장프로(pro)
//      / 김마귀(kimmawi) / 나일롱머스크(nylongmusk)
//      / 화성신(marsgod) / 우주신(spacegod)
//
// 일곱 난이도의 차이는 "무엇을 볼 수 있는가"이다.
//   초보자 : 눈앞의 점수와 토큰만 본다. 보너스의 장기 가치·진화 계획을 못 본다. 가끔 아무거나 집는다.
//   수련자 : 보너스 가치와 진화 가능성까지 보고, 상대 한 턴을 내다본다.
//   장프로 : 후보 수마다 자기 턴을 여러 번 굴려 "18점까지 몇 턴"을 직접 재고 최단 경로를 고른다.
//   김마귀 : 자기 레이스뿐 아니라 상대의 최선 응수까지 읽고 방해 수를 함께 고른다.
//   나일롱머스크 : 더 넓은 후보와 장기 맞대결 롤아웃으로 김마귀의 후속 계획까지 읽는다.
//   화성신 : 시장의 거의 모든 유력 수를 대상으로 더 긴 대국을 예측한다.
//   우주신 : 가장 넓은 후보와 가장 긴 대국 예측으로 화성신의 장기 계획까지 읽는다.
import { COLORS, WIN_SCORE } from './data.js';
import {
  clone, cur, bonuses, score, tokenCount, canAfford,
  legalMoves, evolutions, applyMove, applyEvolution, autoDiscard, endTurn,
} from './engine.js';

// ── 난이도 프로파일 ───────────────────────────────────────────
const PROFILE = {
  novice: {
    vp: 12, bonus: 1.2, earliness: 0, market: 0.35, evo: 0, buried: 0,
    rival: 0, token: 0.7, master: 0.8, hand: 0.2,
    lookahead: 0, rollout: 0, blunder: 0.28, noise: 9,
  },
  adept: {
    vp: 12, bonus: 3.6, earliness: 2.6, market: 1.7, evo: 1.6, buried: 2.0,
    rival: 3.0, token: 0.45, master: 1.1, hand: 0.6,
    lookahead: 1, rollout: 0, blunder: 0.04, noise: 2.5,
  },
  // 장프로 = 수련자와 같은 평가 기준에 실수를 없애고, 후보마다 자기 턴을
  // 여러 번 굴려 "18점까지 몇 턴"을 재서 최단 경로를 고른다.
  pro: {
    vp: 12, bonus: 3.6, earliness: 2.6, market: 1.7, evo: 1.6, buried: 2.0,
    rival: 3.0, token: 0.45, master: 1.1, hand: 0.6,
    lookahead: 1, rollout: 7, pace: 7, blunder: 0, noise: 0,
  },
  // 김마귀 = 장프로의 완주 속도를 유지하면서 상대의 최선 응수를 최소화한다.
  kimmawi: {
    vp: 12, bonus: 3.6, earliness: 2.6, market: 1.7, evo: 1.6, buried: 2.0,
    rival: 3.0, token: 0.45, master: 1.1, hand: 0.6,
    lookahead: 0, rollout: 8, pace: 7.5, blunder: 0, noise: 0,
    searchDepth: 2, rootBeam: 16, searchBeam: 11, opponentWeight: 0.20, searchPace: 1.5,
  },
  // 나일롱머스크 = 김마귀의 응수 탐색에 장기 맞대결 롤아웃을 더한 최고 난이도.
  nylongmusk: {
    vp: 12, bonus: 3.6, earliness: 2.6, market: 1.7, evo: 1.6, buried: 2.0,
    rival: 3.0, token: 0.45, master: 1.1, hand: 0.6,
    lookahead: 0, rollout: 10, pace: 8, blunder: 0, noise: 0,
    searchDepth: 2, rootBeam: 20, searchBeam: 12, opponentWeight: 0.20, searchPace: 1.5,
    versusRollout: 16, versusWeight: 0.90,
  },
  // 화성신 = 나일롱머스크보다 넓은 후보를 24수 맞대결로 검증한다.
  marsgod: {
    vp: 12, bonus: 3.6, earliness: 2.6, market: 1.7, evo: 1.6, buried: 2.0,
    rival: 3.0, token: 0.45, master: 1.1, hand: 0.6,
    lookahead: 0, rollout: 12, pace: 8.5, blunder: 0, noise: 0,
    searchDepth: 2, rootBeam: 26, searchBeam: 14, opponentWeight: 0.22, searchPace: 1.55,
    versusRollout: 24, versusWeight: 0.92,
  },
  // 우주신 = 가장 넓은 후보를 40수 맞대결로 검증하는 진짜 최고 난이도.
  spacegod: {
    vp: 12, bonus: 3.6, earliness: 2.6, market: 1.7, evo: 1.6, buried: 2.0,
    rival: 3.0, token: 0.45, master: 1.1, hand: 0.6,
    lookahead: 0, rollout: 16, pace: 9.5, blunder: 0, noise: 0,
    searchDepth: 2, rootBeam: 36, searchBeam: 18, opponentWeight: 0.18, searchPace: 1.7,
    versusRollout: 40, versusWeight: 0.90,
  },
};

export { PROFILE };   // 튜닝 스크립트에서 덮어쓸 수 있게 열어 둔다
const prof = (p) => PROFILE[p.level] || PROFILE.adept;

// ── 보조 계산 ─────────────────────────────────────────────────
/** 이 카드를 살 때까지 대략 몇 턴 걸리는가 */
function turnsToBuy(p, bon, card) {
  let missing = 0;
  for (const c of COLORS) {
    const owe = Math.max(0, (card.cost[c] || 0) - bon[c]);
    missing += Math.max(0, owe - p.tokens[c]);
  }
  const wild = Math.max(0, (card.cost.m || 0) - p.tokens.m);
  const total = Math.max(0, missing - p.tokens.m + wild * 2);
  return total / 2.4;
}

/** 진화가 얼마나 임박했는가 + 다음 단계 카드가 실제로 보이는가 */
function evoPotential(g, p, bon) {
  let v = 0;
  for (const card of p.board) {
    if (!card.to || !card.need) continue;
    let short = 0;
    for (const c of Object.keys(card.need)) short += Math.max(0, card.need[c] - bon[c]);
    let target = null;
    for (const t of [1, 2, 3]) for (const nx of g.market[t]) if (nx && nx.mon === card.to) target = nx;
    for (const nx of p.hand) if (nx.mon === card.to) target = nx;
    if (!target) { v += Math.max(0, 3 - short) * 0.25; continue; }  // 조건은 되는데 카드가 없음
    const gain = Math.max(0, target.vp - card.vp);
    v += (gain + 1.5) * (short === 0 ? 3.2 : 1 / (1 + short));
  }
  return v;
}

/** 한 색에만 몰리면 감점 */
function spread(bon) {
  const vals = COLORS.map((c) => bon[c]);
  const tot = vals.reduce((a, b) => a + b, 0);
  if (!tot) return 0;
  const mean = tot / 5;
  return -(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / 5) * 0.14;
}

/** 상태 평가 — w 프로파일에 따라 보이는 범위가 달라진다 */
export function evaluate(g, pid, w) {
  const p = g.players.find((x) => x.id === pid);
  const bon = bonuses(p);
  const sc = score(p);
  let v = sc * w.vp;

  const bonusTotal = COLORS.reduce((s, c) => s + bon[c], 0);
  const early = Math.max(0, 1 - sc / WIN_SCORE);
  v += bonusTotal * (w.bonus + w.earliness * early);
  if (w.bonus > 2) v += spread(bon);

  v += COLORS.reduce((s, c) => s + p.tokens[c], 0) * w.token + p.tokens.m * w.master;
  if (tokenCount(p) > 9) v -= 1.5;

  if (w.market) {
    let best = 0;
    for (const t of [1, 2, 3, 'R', 'L']) {
      for (const c of g.market[t]) {
        if (!c) continue;
        best = Math.max(best, (c.vp * 2.2 + c.bonus * 2.0) / (1 + turnsToBuy(p, bon, c)));
      }
    }
    for (const c of p.hand) {
      best = Math.max(best, (c.vp * 2.2 + c.bonus * 2.0) / (1 + turnsToBuy(p, bon, c)) + 1.0);
    }
    v += best * w.market;
  }

  if (w.evo) v += evoPotential(g, p, bon) * w.evo;
  v += p.buried.length * w.buried;
  v += p.hand.length * w.hand;

  if (w.rival) {
    let rivalMax = 0;
    for (const q of g.players) if (q.id !== pid) rivalMax = Math.max(rivalMax, score(q));
    v -= rivalMax * w.rival;
    if (rivalMax >= WIN_SCORE - 2) v -= 14;
  }
  return v;
}

// ── 한 수 시뮬레이션 (수 + 최선의 진화 + 반납) ────────────────
function simulate(g0, mv, w) {
  const g = clone(g0);
  const me = cur(g);
  const pid = me.id;
  applyMove(g, mv);
  const evos = evolutions(g);
  if (evos.length) {
    const base = evaluate(g, pid, w);
    let bestE = null; let bestV = base;
    for (const e of evos) {
      const h = clone(g);
      applyEvolution(h, e, h.players[h.turn]);
      const v = evaluate(h, pid, w);
      if (v > bestV) { bestV = v; bestE = e; }
    }
    if (bestE) applyEvolution(g, bestE, g.players[g.turn]);
  }
  autoDiscard(g, g.players[g.turn]);
  return g;
}

/** 롤아웃용 축약 수 목록 — 살 수 있는 카드 전부 + 유망한 토큰 수 몇 개 */
function pruned(g, w) {
  const p = cur(g);
  const bon = bonuses(p);
  const all = legalMoves(g);
  const buys = all.filter((m) => m.type === 'buy');

  // 가장 사고 싶은 카드를 정해 그 색을 우선 모은다
  let target = null; let bestScore = -1;
  for (const t of [1, 2, 3]) {
    for (const c of g.market[t]) {
      if (!c) continue;
      const s = (c.vp * 2.2 + c.bonus * 2.0) / (1 + turnsToBuy(p, bon, c));
      if (s > bestScore) { bestScore = s; target = c; }
    }
  }
  const want = {};
  for (const c of COLORS) {
    want[c] = target ? Math.max(0, (target.cost[c] || 0) - bon[c] - p.tokens[c]) : 1;
  }
  const takes = all.filter((m) => m.type === 'take3' || m.type === 'take2');
  takes.sort((a, b) => {
    const val = (m) => (m.type === 'take2'
      ? want[m.color] * 2 + 0.1
      : m.colors.reduce((s, c) => s + want[c], 0));
    return val(b) - val(a);
  });
  const res = all.filter((m) => m.type === 'reserve').slice(0, 2);
  const out = [...buys, ...takes.slice(0, 3), ...res];
  return out.length ? out : all;
}

/** 탐욕 정책으로 내 턴만 계속 굴려 18점까지 몇 턴 걸리는지 잰다 */
function turnsToWin(g0, pid, w, horizon) {
  let h = clone(g0);
  const myIdx = h.players.findIndex((x) => x.id === pid);
  for (let i = 0; i < horizon; i++) {
    if (score(h.players[myIdx]) >= WIN_SCORE) return i;
    h.turn = myIdx;
    const ms = pruned(h, w);
    let bm = ms[0]; let bv = -Infinity;
    for (const m of ms) {
      const v = evaluate(simulate(h, m, w), pid, w);
      if (v > bv) { bv = v; bm = m; }
    }
    h = simulate(h, bm, w);
  }
  return score(h.players[myIdx]) >= WIN_SCORE ? horizon : horizon + (WIN_SCORE - score(h.players[myIdx])) / 2.5;
}

/** 상대 한 턴을 가볍게 진행 */
function quickTurn(g, w) {
  const pid = cur(g).id;
  const ms = pruned(g, w);
  let bm = ms[0]; let bv = -Infinity;
  for (const m of ms) {
    const v = evaluate(simulate(g, m, w), pid, w);
    if (v > bv) { bv = v; bm = m; }
  }
  const out = simulate(g, bm, w);
  out.turn = (out.turn + 1) % out.players.length;
  return out;
}

/** 행동·최선 진화·반납을 적용하고 다음 플레이어 차례까지 진행한다. */
function advanceTurn(g, mv, w) {
  const h = simulate(g, mv, w);
  endTurn(h);
  return h;
}

/** 1:1 대결용 상태 가치. 내 성장뿐 아니라 상대가 잃은 선택지까지 점수에 반영한다. */
function duelValue(g, pid, w) {
  if (g.over) return g.winner === pid ? 100000 : -100000;
  const me = g.players.find((p) => p.id === pid);
  const rival = g.players.find((p) => p.id !== pid);
  const mine = evaluate(g, pid, w);
  const theirs = evaluate(g, rival.id, w);
  const scoreGap = score(me) - score(rival);
  let v = mine - theirs * w.opponentWeight + scoreGap * 5;

  // 마지막 라운드에서는 장기 계획보다 실제 승패와 동점 규칙이 우선이다.
  if (g.finalRound) {
    v += scoreGap * 40;
    v += (me.buried.length - rival.buried.length) * 8;
    v += (me.board.length - rival.board.length) * 2;
  }
  return v;
}

/**
 * 현재 플레이어에게 유망한 후보부터 정렬한다.
 * 깊은 노드에서는 전체 합법 수 대신 구매 + 목적 토큰 + 방해 예약 후보를 사용해
 * 휴대폰에서도 탐색 시간을 일정하게 유지한다.
 */
function searchCandidates(g, w, limit) {
  const actor = cur(g).id;
  const moves = pruned(g, w);
  const ordered = moves.map((mv) => {
    const next = advanceTurn(g, mv, w);
    return { mv, next, v: duelValue(next, actor, w) };
  });
  ordered.sort((a, b) => b.v - a.v);
  return ordered.slice(0, limit);
}

/** 두 플레이어가 모두 최선의 수를 둔다고 가정하는 알파-베타 대결 탐색. */
function duelSearch(g, pid, w, depth, alpha, beta) {
  if (depth <= 0 || g.over) return duelValue(g, pid, w);
  const maximizing = cur(g).id === pid;
  const candidates = searchCandidates(g, w, w.searchBeam);
  if (!candidates.length) return duelValue(g, pid, w);

  if (maximizing) {
    let best = -Infinity;
    for (const o of candidates) {
      best = Math.max(best, duelSearch(o.next, pid, w, depth - 1, alpha, beta));
      alpha = Math.max(alpha, best);
      if (alpha >= beta) break;
    }
    return best;
  }

  let best = Infinity;
  for (const o of candidates) {
    best = Math.min(best, duelSearch(o.next, pid, w, depth - 1, alpha, beta));
    beta = Math.min(beta, best);
    if (alpha >= beta) break;
  }
  return best;
}

/** 양쪽이 현재 상태에서 가장 좋아 보이는 수를 둔다고 보고 실제 턴을 번갈아 굴린다. */
function duelPlayout(g, pid, w, plies) {
  let h = clone(g);
  for (let i = 0; i < plies && !h.over; i++) {
    const actor = cur(h);
    const actorW = prof(actor);
    const moves = pruned(h, actorW);
    let best = null;
    let bestV = -Infinity;
    for (const mv of moves) {
      const after = simulate(h, mv, actorW);
      const v = evaluate(after, actor.id, actorW);
      if (v > bestV) { bestV = v; best = after; }
    }
    h = best;
    endTurn(h);
  }
  return duelValue(h, pid, w);
}

// ── 수 선택 ───────────────────────────────────────────────────
export function chooseMove(g) {
  const p = cur(g);
  const w = prof(p);
  const moves = legalMoves(g);
  if (moves.length === 1) return moves[0];

  // 초보자는 가끔 아무 수나 고른다 (단, 살 수 있으면 사는 편)
  if (w.blunder && Math.random() < w.blunder) {
    const buys = moves.filter((m) => m.type === 'buy');
    const pool = buys.length && Math.random() < 0.5 ? buys : moves;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  let scored = moves.map((mv) => ({ mv, after: simulate(g, mv, w) }))
    .map((o) => ({ ...o, v: evaluate(o.after, p.id, w) }));

  if (w.lookahead) {
    for (const o of scored) {
      let h = clone(o.after);
      h.turn = (h.turn + 1) % h.players.length;
      const rounds = Math.min(g.players.length - 1, w.lookahead * (g.players.length - 1));
      for (let i = 0; i < rounds; i++) h = quickTurn(h, w);
      o.v = o.v * 0.55 + evaluate(h, p.id, w) * 0.45;
    }
  }

  if (w.searchDepth) {
    // 먼저 장프로식 완주 속도로 뿌리 후보를 거른 뒤, 상대의 최선 응수를 읽는다.
    scored.sort((a, b) => b.v - a.v);
    const roots = scored.slice(0, w.rootBeam);
    for (const o of roots) {
      o.paceV = turnsToWin(o.after, p.id, w, w.rollout) * w.pace;
      o.preV = duelValue(o.after, p.id, w) - o.paceV;
    }
    roots.sort((a, b) => b.preV - a.preV);

    let best = roots[0];
    let bestV = -Infinity;
    let alpha = -Infinity;
    for (const o of roots) {
      const next = clone(o.after);
      endTurn(next);
      // 탐색 값에 자기 완주 속도를 보조 지표로 섞어 수비 일변도의 플레이를 막는다.
      let v = duelSearch(next, p.id, w, w.searchDepth - 1, alpha, Infinity);
      if (w.versusRollout) {
        const rolloutV = duelPlayout(next, p.id, w, w.versusRollout);
        v = v * (1 - w.versusWeight) + rolloutV * w.versusWeight;
      }
      v -= o.paceV * w.searchPace;
      if (v > bestV) { bestV = v; best = o; }
      alpha = Math.max(alpha, bestV);
    }
    return best.mv;
  }

  if (w.rollout) {
    // 상위 후보만 깊게 판다: 수련자와 같은 평가에 "18점까지 몇 턴"을 감점으로 섞는다
    scored.sort((a, b) => b.v - a.v);
    const top = scored.slice(0, 10);
    for (const o of top) {
      o.v -= turnsToWin(o.after, p.id, w, w.rollout) * w.pace;
    }
    top.sort((a, b) => b.v - a.v);
    return top[0].mv;
  }

  if (w.noise) for (const o of scored) o.v += (Math.random() - 0.5) * w.noise;
  scored.sort((a, b) => b.v - a.v);
  return scored[0].mv;
}

/** 차례 종료 시 진화 선택 (없으면 null) */
export function chooseEvolution(g) {
  const p = cur(g);
  const w = prof(p);
  const evos = evolutions(g);
  if (!evos.length) return null;
  if (w.blunder && Math.random() < 0.25) return null;   // 초보자는 가끔 놓친다

  let best = null; let bestV = evaluate(g, p.id, w);
  for (const e of evos) {
    const h = clone(g);
    applyEvolution(h, e, h.players[h.turn]);
    const v = evaluate(h, p.id, w);
    if (v > bestV) { bestV = v; best = e; }
  }
  return best;
}

export const LEVEL_NAMES = {
  novice: '초보자',
  adept: '수련자',
  pro: '장프로',
  kimmawi: '김마귀',
  nylongmusk: '나일롱머스크',
  marsgod: '화성신',
  spacegod: '우주신',
};
export { canAfford };
