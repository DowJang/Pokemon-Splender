// UI 컨트롤러
import { COLORS, BALL, WIN_SCORE, TOKEN_LIMIT, HAND_LIMIT, spriteUrl, DEX } from './data.js';
import {
  newGame, newPlayer, clone, cur, bonuses, score, tokenCount,
  canAfford, payment, legalMoves, evolutions, applyMove, applyEvolution,
  autoDiscard, endTurn, findCard,
} from './engine.js';
import { chooseMove, chooseEvolution, LEVEL_NAMES } from './ai.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};

let G = null;              // 게임 상태
let ME = 0;                // 내 플레이어 인덱스
let pick = [];             // 선택한 토큰 색
let busy = false;

// ── 로비 ──────────────────────────────────────────────────────
let rivalLevel = 'adept';

function renderRivals() {
  const box = $('#rivals');
  box.innerHTML = '';
  const row = el('div', 'rival');
  row.appendChild(el('span', 'nm', 'AI 상대'));
  const seg = el('div', 'seg');
  for (const [key, name] of Object.entries(LEVEL_NAMES)) {
    const b = el('button', rivalLevel === key ? 'on' : '', name);
    b.onclick = () => { rivalLevel = key; renderRivals(); };
    seg.appendChild(b);
  }
  row.appendChild(seg);
  box.appendChild(row);
}

renderRivals();

$('#start').onclick = () => {
  const name = ($('#myname').value || '나').trim().slice(0, 8);
  const players = [
    newPlayer(0, name, 'human', null),
    newPlayer(1, LEVEL_NAMES[rivalLevel], 'ai', rivalLevel),
  ];
  ME = 0;
  G = newGame({ players });
  $('#lobby').classList.add('hidden');
  $('#game').classList.remove('hidden');
  render();
  step();
};

$('#how').onclick = showRules;
$('#menu').onclick = showMenu;

// ── 렌더 ──────────────────────────────────────────────────────
function pip(color, n, cls = '') {
  return `<span class="pip ${color} ${cls}">${n}</span>`;
}

/** 실물 카드 우상단의 '볼' 아이콘 — CSS만으로 그린 포켓볼 모양 */
function pball(color, cls = '') {
  return `<span class="pball ${color} ${cls}"></span>`;
}

function cardNode(c, opts = {}) {
  if (!c) return el('div', 'card empty');

  const me = G.players[ME];
  const affordable = canAfford(me, c);
  const n = el('div', `card fam-${c.color} ${affordable && opts.interactive ? 'buy' : ''}`);

  // ── 상단 색 리본: 실물 카드처럼 승점 + 볼 아이콘(보너스 1이면 1개, 2면 2개)
  const ribbon = el('div', 'ribbon');
  ribbon.innerHTML =
    `<span class="vp">${c.vp || ''}</span>` +
    `<span class="balls">${pball(c.color)}${c.bonus === 2 ? pball(c.color) : ''}</span>`;
  n.appendChild(ribbon);

  // ── 진화 예고 배지: 다음 단계 미니 아이콘 + 필요 보너스(오각형 배지)
  if (c.to && c.need) {
    const row = el('div', 'evorow');
    const k = Object.keys(c.need)[0];
    row.innerHTML =
      `<img class="evomini" src="${spriteUrl(DEX[c.to].dex)}" loading="lazy" alt="">` +
      `<span class="evobadge ${k}">${c.need[k]}${pball(k, 'tiny')}</span>`;
    n.appendChild(row);
  }

  // ── 흰 바탕 아트 영역 (실물 카드는 그림 배경이 거의 무채색)
  const art = el('div', 'art');
  const img = el('img');
  img.src = spriteUrl(c.dex);
  img.alt = c.label;
  img.loading = 'lazy';
  art.appendChild(img);
  n.appendChild(art);

  // ── 좌하단에 겹쳐지는 비용 코인 스택
  const cost = el('div', 'cost');
  const bon = bonuses(me);
  for (const k of ['m', ...COLORS]) {
    const v = c.cost[k];
    if (!v) continue;
    const covered = k !== 'm' && bon[k] >= v;
    cost.innerHTML += `<span class="coin ${k}${covered ? ' paid' : ''}">${v}</span>`;
  }
  n.appendChild(cost);

  // ── 바닥의 색 테두리 이름 알약
  n.appendChild(el('div', 'nm', `<span class="pill fam-${c.color}">${c.label}</span>`));

  if (opts.interactive) n.onclick = () => onCardTap(c);
  return n;
}

/** 고정 현황 패널용 카드. 작은 크기에서도 이름·점수·보너스가 읽히게 단순화한다. */
function collectionCardNode(c, opts = {}) {
  const interactive = Boolean(opts.interactive);
  const evolution = opts.showEvolution && c.to && c.need;
  const n = el(interactive ? 'button' : 'div', `collection-card fam-${c.color}${opts.kept ? ' kept-card' : ''}${evolution ? ' has-evo' : ''}`);
  if (interactive) n.type = 'button';
  const evolutionTitle = evolution
    ? ` · 진화 조건 ${Object.entries(c.need).map(([color, amount]) => `${BALL[color].name} 보너스 ${amount}`).join(', ')}`
    : '';
  n.title = `${c.label} · ${c.vp}점 · ${BALL[c.color].name} 보너스 ${c.bonus}${evolutionTitle}`;
  n.setAttribute('aria-label', n.title);
  const evolutionBadge = evolution
    ? `<span class="collection-evo"><span class="evo-label">진화→</span>${Object.entries(c.need).map(([color, amount]) =>
        `<span class="evo-need ${color}">${pball(color, 'tiny')}<b>${amount}</b></span>`).join('')}</span>`
    : '';
  n.innerHTML =
    `<span class="collection-vp">${c.vp}</span>` +
    `<span class="collection-bonus">${pball(c.color)}${c.bonus === 2 ? pball(c.color) : ''}</span>` +
    `<img src="${spriteUrl(c.dex)}" loading="lazy" alt="">` +
    evolutionBadge +
    `<span class="collection-name">${c.label}</span>`;
  if (interactive) n.onclick = () => onCardTap(c);
  return n;
}

function renderCollection(selector, cards, opts = {}) {
  const strip = $(selector);
  strip.innerHTML = '';
  if (!cards.length) {
    strip.appendChild(el('span', 'empty-collection', '없음'));
    return;
  }
  for (const c of cards) strip.appendChild(collectionCardNode(c, opts));
}

function render() {
  if (!G) return;
  const me = G.players[ME];
  const rival = G.players.find((p) => p.id !== me.id);
  const myTurn = G.turn === ME && !G.over;

  // 상대 고정 패널 — 획득 카드와 찜 카드를 항상 공개한다.
  const rb = $('#rivalbar');
  rb.classList.toggle('active', G.turn === rival.id && !G.over);
  const rivalBonus = bonuses(rival);
  const rivalTokens = [...COLORS, 'm'].filter((c) => rival.tokens[c]).map((c) => pip(c, rival.tokens[c], 'sm')).join('');
  $('#rival-summary').innerHTML =
    `<span class="dock-name">${rival.name}</span>` +
    `<strong class="dock-score">${score(rival)}점</strong>` +
    `<span class="dock-meta">진화 ${rival.buried.length}</span>` +
    `<span class="dock-stat"><em>토큰</em>${rivalTokens || '<i>없음</i>'}</span>` +
    `<span class="dock-stat"><em>보너스</em>${COLORS.filter((c) => rivalBonus[c]).map((c) => pip(c, rivalBonus[c], 'sm')).join('') || '<i>없음</i>'}</span>` +
    `<span class="turn-flag">${G.turn === rival.id && !G.over ? '상대 차례' : ''}</span>`;
  $('#rival-owned-count').textContent = rival.board.length;
  $('#rival-kept-count').textContent = rival.hand.length;
  renderCollection('#rival-owned', rival.board, { showEvolution: true });
  renderCollection('#rival-kept', rival.hand, { kept: true, showEvolution: true });

  // 시장 — 전설·환상·희귀는 한 줄로 합쳐 다른 단계와 같은 카드 크기로 표시
  const spec = $('#row-special');
  spec.innerHTML = '';
  for (const c of [...G.market.L, ...G.market.R]) spec.appendChild(cardNode(c, { interactive: myTurn }));

  for (const t of [3, 2, 1]) {
    const row = $('#row-' + t);
    row.innerHTML = '';
    const slots = G.market[t];
    for (const c of slots) row.appendChild(cardNode(c, { interactive: myTurn }));
    if (!slots.length) row.appendChild(el('div', 'card empty'));

    const label = $('#label-' + t);
    const left = G.decks[t].length;
    const canBlindReserve = myTurn && left > 0 && me.hand.length < HAND_LIMIT;
    label.textContent = `${t}단계 (덱${left})`;
    label.classList.toggle('tappable', canBlindReserve);
    label.onclick = canBlindReserve ? () => reserveFromDeck(t) : null;
  }

  // 은행
  const bank = $('#bank');
  bank.innerHTML = '';
  for (const c of [...COLORS, 'm']) {
    const t = el('div', `tok ${c}`);
    t.textContent = G.bank[c];
    const picks = pick.filter((x) => x === c).length;
    if (picks) t.innerHTML += `<span class="badge">+${picks}</span>`;
    if (c === 'm') { t.classList.add('dead'); t.title = '마스터볼은 예약할 때만 받습니다'; }
    else if (myTurn && canPick(c)) t.classList.add('pickable');
    else if (!G.bank[c]) t.classList.add('dead');
    if (c !== 'm' && myTurn) t.onclick = () => onTokenTap(c);
    bank.appendChild(t);
  }

  // 내 영역
  $('#me').classList.toggle('active', myTurn);
  $('#me-name').textContent = me.name;
  $('#me-score').textContent = score(me);
  const tk = $('#me-tokens');
  tk.innerHTML = '<span class="lb">토큰</span>' +
    [...COLORS, 'm'].filter((c) => me.tokens[c]).map((c) => pip(c, me.tokens[c])).join('') +
    `<span class="lb" style="width:auto;margin-left:6px">${tokenCount(me)}/${TOKEN_LIMIT}</span>`;
  const bn = $('#me-bonus');
  const mb = bonuses(me);
  bn.innerHTML = '<span class="lb">보너스</span>' +
    (COLORS.some((c) => mb[c]) ? COLORS.filter((c) => mb[c]).map((c) => pip(c, mb[c])).join('') : '<span class="lb" style="width:auto">없음</span>');
  $('#me-owned-count').textContent = me.board.length;
  $('#me-kept-count').textContent = me.hand.length;
  renderCollection('#me-owned', me.board, { showEvolution: true });
  renderCollection('#me-kept', me.hand, { interactive: myTurn, kept: true, showEvolution: true });

  // 액션바 — 고른 토큰은 눌러서 뺄 수 있다
  const pk = $('#picks');
  pk.innerHTML = '';
  pick.forEach((c, i) => {
    const n = el('span', `pip ${c}`, '');
    n.onclick = () => { pick.splice(i, 1); render(); };
    pk.appendChild(n);
  });
  const conf = $('#confirm');
  const canc = $('#cancel');
  conf.disabled = !(myTurn && pickMove() !== null);
  canc.disabled = !(myTurn && pick.length > 0);
  if (G.over) {
    $('#status').textContent = '게임 종료';
  } else if (myTurn) {
    $('#status').textContent = pick.length
      ? (pickMove() ? '확정하세요' : '다른 색 3개 또는 같은 색 2개')
      : (G.finalRound ? '마지막 라운드! 당신의 차례' : '당신의 차례');
  } else {
    $('#status').textContent = `${cur(G).name} 생각 중…`;
  }
}

// ── 토큰 선택 ─────────────────────────────────────────────────
function canPick(c) {
  if (!G.bank[c]) return false;
  const same = pick.filter((x) => x === c).length;
  const capacity = TOKEN_LIMIT - tokenCount(G.players[ME]);
  if (pick.length >= Math.min(3, capacity)) return false;
  if (same === 1 && pick.length === 1) return G.bank[c] >= 4;     // 같은 색 2개 규칙
  if (same >= 1) return false;
  if (pick.length === 2 && pick[0] === pick[1]) return false;
  return G.bank[c] - same > 0;
}

function onTokenTap(c) {
  if (busy || G.turn !== ME) return;
  if (!canPick(c)) {
    const i = pick.lastIndexOf(c);
    if (i >= 0) pick.splice(i, 1);          // 더 못 담으면 탭이 취소로 동작
    render();
    return;
  }
  pick.push(c);
  render();
}

/** 지금 고른 토큰이 합법적인 한 수인지 — 아니면 null */
function pickMove() {
  if (!pick.length) return null;
  const mv = pick.length === 2 && pick[0] === pick[1]
    ? { type: 'take2', color: pick[0] }
    : { type: 'take3', colors: pick.slice().sort() };
  const legal = legalMoves(G).some((m) => {
    if (m.type !== mv.type) return false;
    if (m.type === 'take2') return m.color === mv.color;
    return m.colors.slice().sort().join('') === mv.colors.join('');
  });
  return legal ? mv : null;
}

$('#cancel').onclick = () => { pick = []; render(); };
$('#confirm').onclick = () => {
  const mv = pickMove();
  if (!mv) return;
  pick = [];
  doHumanMove(mv);
};

// ── 카드 탭 ───────────────────────────────────────────────────
function onCardTap(c) {
  if (busy || G.turn !== ME) return;
  const me = G.players[ME];
  const inHand = me.hand.some((x) => x.id === c.id);
  const afford = canAfford(me, c);
  const reservable = !inHand && (c.tier === 1 || c.tier === 2 || c.tier === 3) && me.hand.length < HAND_LIMIT;

  const box = el('div');
  box.innerHTML = `<h3>${c.label}</h3>`;
  const info = el('p');
  const pay = payment(me, c);
  info.innerHTML =
    `승점 <b>${c.vp}</b> · 보너스 ${BALL[c.color].name} ×${c.bonus}<br>` +
    `비용 ${Object.keys(c.cost).map((k) => pip(k, c.cost[k], 'sm')).join(' ')}<br>` +
    (pay ? `<span style="color:var(--ok)">지불: ${[...COLORS, 'm'].filter((k) => pay[k]).map((k) => pip(k, pay[k], 'sm')).join(' ') || '보너스만으로 무료'}</span>`
         : '<span style="color:#e8746a">토큰이 부족합니다</span>') +
    (c.to ? `<br>진화 → ${c.to} (${Object.keys(c.need).map((k) => pip(k, c.need[k], 'sm')).join('')} 보너스 필요)` : '');
  box.appendChild(info);

  const g2 = el('div', 'grid2');
  const buyB = el('button', 'primary', '잡기');
  buyB.disabled = !afford;
  buyB.onclick = () => { closeModal(); doHumanMove({ type: 'buy', id: c.id }); };
  g2.appendChild(buyB);

  if (reservable) {
    const rB = el('button', 'ghost', `예약${G.bank.m ? ' +마스터볼' : ''}`);
    rB.onclick = () => { closeModal(); doHumanMove({ type: 'reserve', id: c.id }); };
    g2.appendChild(rB);
  } else {
    const x = el('button', 'ghost', '닫기');
    x.onclick = closeModal;
    g2.appendChild(x);
  }
  box.appendChild(g2);
  if (reservable) {
    const x = el('button', 'ghost big', '닫기');
    x.style.marginTop = '8px';
    x.onclick = closeModal;
    box.appendChild(x);
  }
  openModal(box);
}

function reserveFromDeck(tier) {
  if (busy || G.turn !== ME) return;
  doHumanMove({ type: 'reserveDeck', tier });
}

// ── 턴 진행 ───────────────────────────────────────────────────
async function doHumanMove(mv) {
  if (busy) return;
  busy = true;
  pick = [];
  applyMove(G, mv);
  playSound(mv.type === 'take2' || mv.type === 'take3' ? 'coin' : mv.type === 'buy' ? 'card' : 'reserve');
  render();
  await askEvolution(G.players[ME]);
  await finishTurn();
}

function askEvolution(p) {
  const evos = evolutions(G, p);
  if (!evos.length) return Promise.resolve();
  return new Promise((resolve) => {
    const box = el('div');
    box.innerHTML = '<h3>진화시킬까요?</h3><p>행동을 쓰지 않습니다. 이전 단계 카드는 트레이너 타일 밑으로 들어가 효력을 잃습니다.</p>';
    // 같은 포켓몬의 사본이 여럿 보일 수 있으므로 "무엇→무엇" 기준으로 한 번만 보여 준다
    const seen = new Set();
    for (const e of evos) {
      const from = p.board.find((c) => c.id === e.from);
      const to = findCard(G, e.to).card;
      const key = `${e.from}>${to.mon}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const b = el('button', 'evochoice');
      b.innerHTML =
        `<img src="${spriteUrl(from.dex)}"><span>${from.label} <small>(${from.vp}점)</small></span>` +
        `<span class="arrow">→</span>` +
        `<img src="${spriteUrl(to.dex)}"><span>${to.label} <small>(${to.vp}점)</small></span>`;
      b.onclick = () => { applyEvolution(G, e, p); playSound('evolution'); closeModal(); resolve(); };
      box.appendChild(b);
    }
    const skip = el('button', 'ghost big', '진화하지 않기');
    skip.onclick = () => { closeModal(); resolve(); };
    box.appendChild(skip);
    openModal(box, true);
  });
}

async function finishTurn() {
  autoDiscard(G, cur(G));
  endTurn(G);
  render();
  busy = false;
  if (G.over) return showResult();
  step();
}

async function step() {
  if (!G || G.over) return;
  if (G.turn === ME) { render(); return; }
  busy = true;
  render();
  await sleep(['pro', 'kimmawi', 'nylongmusk', 'marsgod', 'spacegod'].includes(cur(G).level) ? 260 : 200);
  const p = cur(G);
  const mv = chooseMove(G);
  showAction(`${p.name}: ${describeMove(mv)}`);
  await sleep(1000);
  applyMove(G, mv);
  playSound(mv.type === 'take2' || mv.type === 'take3' ? 'coin' : mv.type === 'buy' ? 'card' : 'reserve');
  render();
  await sleep(220);
  const evo = chooseEvolution(G);
  if (evo) {
    applyEvolution(G, evo, p);
    playSound('evolution');
    toast(`${p.name}: 진화!`);
    render();
    await sleep(320);
  }
  await finishTurn();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 모달 / 토스트 ─────────────────────────────────────────────
function openModal(node, sticky = false) {
  const m = $('#modal');
  const inner = $('#modal-in');
  inner.innerHTML = '';
  inner.appendChild(node);
  m.classList.remove('hidden');
  m.onclick = sticky ? null : (e) => { if (e.target === m) closeModal(); };
}
function closeModal() { $('#modal').classList.add('hidden'); }

let toastT = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.add('hidden'), 1400);
}

function describeMove(mv) {
  if (mv.type === 'take2') return '코인 2개 가져가기';
  if (mv.type === 'take3') return `코인 ${mv.colors.length}개 가져가기`;
  if (mv.type === 'pass') return '패스';
  const found = mv.id ? findCard(G, mv.id) : null;
  if (mv.type === 'buy') return `${found?.card?.label || '카드'} 획득`;
  if (mv.type === 'reserve' || mv.type === 'reserveDeck') return `${found?.card?.label || `${mv.tier}단계 카드`} 찜하기`;
  return '행동';
}

let audioCtx = null;
function playSound(kind) {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const tones = { coin: [620, 880], card: [220, 330], reserve: [440, 660], evolution: [392, 523, 784] };
    const now = audioCtx.currentTime;
    tones[kind].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = kind === 'coin' ? 'sine' : 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.16, now + i * 0.09 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.09 + 0.16);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + i * 0.09); osc.stop(now + i * 0.09 + 0.18);
    });
  } catch (_) { /* 사운드를 지원하지 않는 브라우저에서도 게임은 계속 진행 */ }
}

let actionTimer = null;
function showAction(msg) {
  const node = $('#action-popup');
  node.textContent = msg;
  node.classList.remove('hidden');
  clearTimeout(actionTimer);
  actionTimer = setTimeout(() => node.classList.add('hidden'), 1200);
}

function showResult() {
  const box = el('div');
  box.innerHTML = `<h3>게임 종료</h3>`;
  const ranked = G.ranking.map((id) => G.players.find((p) => p.id === id));
  ranked.forEach((p, i) => {
    const row = el('div', 'result-row' + (i === 0 ? ' win' : ''));
    row.innerHTML = `<span>${i + 1}위 · ${p.name}</span><span>${score(p)}점 · 진화 ${p.buried.length} · 카드 ${p.board.length}</span>`;
    box.appendChild(row);
  });
  const again = el('button', 'primary big', '다시 하기');
  again.style.marginTop = '12px';
  again.onclick = () => location.reload();
  box.appendChild(again);
  openModal(box, true);
}

function showMenu() {
  const box = el('div');
  box.innerHTML = '<h3>메뉴</h3>';
  const g2 = el('div', 'grid2');
  const r = el('button', 'ghost', '규칙 보기');
  r.onclick = () => { closeModal(); showRules(); };
  const q = el('button', 'ghost', '로비로');
  q.onclick = () => location.reload();
  g2.append(r, q);
  box.appendChild(g2);
  const lg = el('div');
  lg.innerHTML = '<h4>최근 기록</h4>' +
    G.log.slice(-12).reverse().map((l) => `<div style="font-size:12px;color:var(--dim)">R${l.round} ${l.text}</div>`).join('');
  box.appendChild(lg);
  const x = el('button', 'ghost big', '닫기');
  x.style.marginTop = '10px';
  x.onclick = closeModal;
  box.appendChild(x);
  openModal(box);
}

function showRules() {
  const box = el('div');
  box.innerHTML = `
  <h3>포켓몬 스플렌더 규칙</h3>
  <h4>목표</h4>
  <p>가장 먼저 <b>${WIN_SCORE}점</b>에 도달하면 그 라운드를 끝까지 진행한 뒤 게임이 끝납니다.
  동점이면 진화를 많이 시킨 사람, 그다음 앞에 놓인 카드가 많은 사람이 이깁니다.</p>
  <h4>차례에 할 수 있는 행동 (하나만)</h4>
  <ul>
    <li>서로 다른 색 볼 토큰 <b>3개</b> 가져오기</li>
    <li>같은 색 볼 토큰 <b>2개</b> 가져오기 (그 색이 4개 이상 남아 있을 때)</li>
    <li>카드 1장을 <b>손에 들고</b> 마스터볼 1개 받기 (손은 최대 ${HAND_LIMIT}장, 희귀·전설은 예약 불가)</li>
    <li><b>포켓몬 잡기</b> — 비용만큼 토큰을 내고 카드를 자기 앞에 놓기</li>
  </ul>
  <p>카드 보너스는 같은 색 비용을 영구히 깎아 줍니다. 마스터볼은 어떤 색으로도 쓸 수 있습니다.
  차례를 마칠 때 토큰이 ${TOKEN_LIMIT}개를 넘으면 자동으로 반납합니다.</p>
  <h4>진화</h4>
  <p>행동이 아닙니다. 차례를 마칠 때 <b>한 마리만</b> 진화할 수 있습니다.
  진화 조건은 <b>카드 보너스</b>로만 판정하며 토큰이나 카드를 소모하지 않습니다.
  다음 단계 카드가 테이블 중앙이나 내 손에 있어야 하고, 그 카드로 교체하면
  이전 단계 카드는 트레이너 타일 밑으로 들어가 점수·보너스를 잃습니다.
  희귀·전설 카드는 보너스를 2개로 칩니다.</p>
  <h4>토큰</h4>
  <p>${COLORS.map((c) => BALL[c].name).join(' · ')} + 마스터볼(만능) 5개.
  1:1 게임에서는 일반 볼을 색마다 4개씩 사용합니다.</p>`;
  const x = el('button', 'primary big', '닫기');
  x.style.marginTop = '14px';
  x.onclick = closeModal;
  box.appendChild(x);
  openModal(box);
}

// 디버그용 훅 (콘솔에서 상태를 들여다볼 때 쓴다)
window.PS = { get game() { return G; }, render, askEvolution, evolutions };

// ── PWA ───────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
