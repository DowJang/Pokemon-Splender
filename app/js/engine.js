// 규칙 엔진 — 순수 함수. 상태는 평범한 객체이고 clone() 으로 복제해 AI 탐색에 재사용한다.
import {
  COLORS, DECKS, TOKEN_SUPPLY, WIN_SCORE, TOKEN_LIMIT, HAND_LIMIT,
  ROW_SIZE, SPECIAL_ROW,
} from './data.js';

// ── 난수: 시드 고정으로 같은 게임을 재현할 수 있게 한다 ────────────
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const zero = () => ({ r: 0, b: 0, y: 0, p: 0, k: 0, m: 0 });

export function newPlayer(id, name, kind, level) {
  return {
    id, name,
    kind,            // 'human' | 'ai'
    level,           // novice / adept / pro / kimmawi / nylongmusk
    tokens: zero(),
    board: [],       // 앞에 놓인 카드 (보너스·승점 유효)
    hand: [],        // 손에 든 예약 카드 (최대 3)
    buried: [],      // 트레이너 타일 밑 (진화로 밀려난 카드 — 효력 없음)
  };
}

export function newGame({ players, seed = Date.now() }) {
  if (!Array.isArray(players) || players.length !== 2) {
    throw new Error('포켓몬 스플렌더는 1:1 전용입니다. 플레이어는 정확히 2명이어야 합니다.');
  }
  const rand = rng(seed);

  const decks = {
    1: shuffle(DECKS[1], rand),
    2: shuffle(DECKS[2], rand),
    3: shuffle(DECKS[3], rand),
    R: shuffle(DECKS.R, rand),
    L: shuffle(DECKS.L, rand),
  };
  const market = {};
  for (const t of [1, 2, 3]) market[t] = decks[t].splice(0, ROW_SIZE);
  for (const t of ['R', 'L']) market[t] = decks[t].splice(0, SPECIAL_ROW);

  return {
    seed,
    players,
    decks,
    market,
    bank: { r: TOKEN_SUPPLY, b: TOKEN_SUPPLY, y: TOKEN_SUPPLY, p: TOKEN_SUPPLY, k: TOKEN_SUPPLY, m: 5 },
    turn: 0,               // 현재 차례 플레이어 인덱스
    round: 1,
    startPlayer: 0,
    finalRound: false,     // 18점 도달 후 마지막 한 바퀴
    over: false,
    winner: null,
    log: [],
  };
}

export function clone(g) {
  return {
    ...g,
    decks: { 1: g.decks[1].slice(), 2: g.decks[2].slice(), 3: g.decks[3].slice(), R: g.decks.R.slice(), L: g.decks.L.slice() },
    market: { 1: g.market[1].slice(), 2: g.market[2].slice(), 3: g.market[3].slice(), R: g.market.R.slice(), L: g.market.L.slice() },
    bank: { ...g.bank },
    players: g.players.map((p) => ({
      ...p,
      tokens: { ...p.tokens },
      board: p.board.slice(),
      hand: p.hand.slice(),
      buried: p.buried.slice(),
    })),
    log: g.log.slice(-40),
  };
}

// ── 조회 헬퍼 ──────────────────────────────────────────────────
export const cur = (g) => g.players[g.turn];

export function bonuses(p) {
  const b = zero();
  for (const c of p.board) b[c.color] += c.bonus;
  return b;
}

export function score(p) {
  return p.board.reduce((s, c) => s + c.vp, 0);
}

export function tokenCount(p) {
  return COLORS.reduce((s, c) => s + p.tokens[c], 0) + p.tokens.m;
}

/** 카드 결제에 필요한 실제 토큰. 부족하면 null. */
export function payment(p, card) {
  const bon = bonuses(p);
  const pay = zero();
  let wild = 0;
  for (const c of Object.keys(card.cost)) {
    if (c === 'm') { pay.m += card.cost.m; continue; }   // 마스터볼 지정 비용
    const owe = Math.max(0, card.cost[c] - bon[c]);
    const use = Math.min(owe, p.tokens[c]);
    pay[c] = use;
    wild += owe - use;
  }
  pay.m += wild;
  if (pay.m > p.tokens.m) return null;
  return pay;
}

export const canAfford = (p, card) => payment(p, card) !== null;

/** 시장 + 내 손패에서 카드 찾기 */
export function findCard(g, id) {
  for (const t of [1, 2, 3, 'R', 'L']) {
    const i = g.market[t].findIndex((c) => c && c.id === id);
    if (i >= 0) return { where: 'market', tier: t, idx: i, card: g.market[t][i] };
  }
  for (const p of g.players) {
    const i = p.hand.findIndex((c) => c.id === id);
    if (i >= 0) return { where: 'hand', player: p.id, idx: i, card: p.hand[i] };
  }
  return null;
}

function refill(g, tier, idx) {
  const deck = g.decks[tier];
  if (deck.length) g.market[tier][idx] = deck.shift();
  else g.market[tier].splice(idx, 1);
}

// ── 합법 수 생성 ───────────────────────────────────────────────
function combos(list, k) {
  const out = [];
  const walk = (start, acc) => {
    if (acc.length === k) { out.push(acc.slice()); return; }
    for (let i = start; i < list.length; i++) { acc.push(list[i]); walk(i + 1, acc); acc.pop(); }
  };
  walk(0, []);
  return out;
}

export function legalMoves(g) {
  const p = cur(g);
  const moves = [];
  const held = tokenCount(p);

  // 1) 서로 다른 색 3개 (남은 색이 3개 미만이면 있는 만큼)
  const avail = COLORS.filter((c) => g.bank[c] > 0);
  // 차례 종료 시 토큰을 자동 반납하지 않도록, 현재 보유량을 넘지 않는
  // 선택지만 만든다. (예: 8개 보유 시에는 2개만 가져올 수 있음)
  const take = Math.min(3, avail.length, TOKEN_LIMIT - held);
  if (take > 0) {
    for (const set of combos(avail, take)) {
      moves.push({ type: 'take3', colors: set });
    }
  }
  // 2) 같은 색 2개 (해당 색이 4개 이상 남아 있을 때)
  for (const c of COLORS) {
    if (g.bank[c] >= 4 && held + 2 <= TOKEN_LIMIT) {
      moves.push({ type: 'take2', color: c });
    }
  }
  // 3) 예약 + 마스터볼 1개 (희귀/전설은 예약 불가)
  if (p.hand.length < HAND_LIMIT) {
    for (const t of [1, 2, 3]) {
      for (const c of g.market[t]) if (c) moves.push({ type: 'reserve', id: c.id });
      if (g.decks[t].length) moves.push({ type: 'reserveDeck', tier: t });
    }
  }
  // 4) 포켓몬 잡기 (시장 또는 손패)
  for (const t of [1, 2, 3, 'R', 'L']) {
    for (const c of g.market[t]) if (c && canAfford(p, c)) moves.push({ type: 'buy', id: c.id });
  }
  for (const c of p.hand) if (canAfford(p, c)) moves.push({ type: 'buy', id: c.id });

  if (!moves.length) moves.push({ type: 'pass' });
  return moves;
}

/** 차례 종료 시 가능한 진화 목록 (행동이 아니며 최대 1회) */
export function evolutions(g, player = cur(g)) {
  const bon = bonuses(player);
  const out = [];
  for (const card of player.board) {
    if (!card.to || !card.need) continue;
    const ok = Object.keys(card.need).every((c) => bon[c] >= card.need[c]);
    if (!ok) continue;
    // 다음 단계 카드가 시장 또는 내 손에 있어야 한다
    for (const t of [1, 2, 3]) {
      for (const nx of g.market[t]) {
        if (nx && nx.mon === card.to) out.push({ from: card.id, to: nx.id, src: 'market' });
      }
    }
    for (const nx of player.hand) {
      if (nx.mon === card.to) out.push({ from: card.id, to: nx.id, src: 'hand' });
    }
  }
  return out;
}

// ── 수 적용 ────────────────────────────────────────────────────
function say(g, text) { g.log.push({ round: g.round, turn: g.turn, text }); }

export function applyMove(g, mv) {
  const p = cur(g);
  switch (mv.type) {
    case 'take3':
    case 'take2': {
      const list = mv.type === 'take3' ? mv.colors : [mv.color, mv.color];
      for (const c of list) { g.bank[c]--; p.tokens[c]++; }
      say(g, `${p.name}: 토큰 ${list.join('')}`);
      break;
    }
    case 'reserve':
    case 'reserveDeck': {
      let card;
      if (mv.type === 'reserveDeck') {
        card = g.decks[mv.tier].shift();
      } else {
        const f = findCard(g, mv.id);
        card = f.card;
        g.market[f.tier][f.idx] = null;
        refill(g, f.tier, f.idx);
      }
      p.hand.push(card);
      if (g.bank.m > 0) { g.bank.m--; p.tokens.m++; }
      say(g, `${p.name}: ${card.label} 예약`);
      break;
    }
    case 'buy': {
      const f = findCard(g, mv.id);
      const card = f.card;
      const pay = payment(p, card);
      for (const c of Object.keys(pay)) { p.tokens[c] -= pay[c]; g.bank[c] += pay[c]; }
      if (f.where === 'market') { g.market[f.tier][f.idx] = null; refill(g, f.tier, f.idx); }
      else p.hand.splice(f.idx, 1);
      p.board.push(card);
      say(g, `${p.name}: ${card.label} 획득 (+${card.vp})`);
      break;
    }
    case 'pass':
      say(g, `${p.name}: 패스`);
      break;
    default:
      throw new Error('알 수 없는 행동: ' + mv.type);
  }
  return g;
}

/** 진화 실행 — 차례 종료 시 최대 1회. */
export function applyEvolution(g, evo, player = cur(g)) {
  const oldIdx = player.board.findIndex((c) => c.id === evo.from);
  if (oldIdx < 0) return g;
  const f = findCard(g, evo.to);
  if (!f) return g;
  const next = f.card;
  if (f.where === 'market') { g.market[f.tier][f.idx] = null; refill(g, f.tier, f.idx); }
  else {
    const hp = g.players.find((x) => x.id === f.player);
    hp.hand.splice(f.idx, 1);
  }
  const old = player.board[oldIdx];
  player.board[oldIdx] = next;
  player.buried.push(old);   // 트레이너 타일 밑으로 — 보너스·승점 소멸
  say(g, `${player.name}: ${old.label} → ${next.label} 진화!`);
  return g;
}

/** 토큰 10개 초과분 반납 — 가장 덜 쓰는 색부터 버린다. */
export function autoDiscard(g, player = cur(g)) {
  const bon = bonuses(player);
  while (tokenCount(player) > TOKEN_LIMIT) {
    let worst = null; let worstScore = Infinity;
    for (const c of COLORS) {
      if (!player.tokens[c]) continue;
      const s = need(g, player, c) - bon[c] * 0.1;
      if (s < worstScore) { worstScore = s; worst = c; }
    }
    if (!worst) { // 마스터볼밖에 없으면 어쩔 수 없이 반납
      player.tokens.m--; g.bank.m++; continue;
    }
    player.tokens[worst]--; g.bank[worst]++;
  }
  return g;
}

/** 앞으로의 구매 후보들이 이 색을 얼마나 요구하는지 (반납 우선순위용) */
function need(g, player, color) {
  const bon = bonuses(player);
  let sum = 0;
  for (const t of [1, 2, 3]) {
    for (const c of g.market[t]) {
      if (c) sum += Math.max(0, (c.cost[color] || 0) - bon[color]);
    }
  }
  return sum;
}

export function endTurn(g) {
  const p = cur(g);
  autoDiscard(g, p);
  if (score(p) >= WIN_SCORE) g.finalRound = true;

  const next = (g.turn + 1) % g.players.length;
  if (next === g.startPlayer) {
    g.round++;
    if (g.finalRound) return finish(g);
  }
  g.turn = next;
  return g;
}

function finish(g) {
  g.over = true;
  const ranked = g.players.slice().sort((a, b) => {
    const d = score(b) - score(a);
    if (d) return d;
    const e = b.buried.length - a.buried.length;   // 진화를 더 많이 시킨 쪽
    if (e) return e;
    return b.board.length - a.board.length;        // 그다음 카드가 많은 쪽
  });
  g.winner = ranked[0].id;
  g.ranking = ranked.map((p) => p.id);
  return g;
}

export { WIN_SCORE, TOKEN_LIMIT, HAND_LIMIT };
