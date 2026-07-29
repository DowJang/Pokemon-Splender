// 최고 난이도 튜닝: 장프로 < 김마귀 < 나일롱머스크 < 화성신 < 우주신을 비교한다.
//   node tools/tune_hard.mjs [자리당 판수]
import { performance } from 'node:perf_hooks';
import {
  newGame, newPlayer, cur, score,
  applyMove, applyEvolution, autoDiscard, endTurn,
} from '../app/js/engine.js';
import { chooseMove, chooseEvolution, PROFILE } from '../app/js/ai.js';

const N = +(process.argv[2] || 8);
const SEED_BASE = +(process.env.SEED_BASE || 21000);
if (process.env.KIM_PATCH) Object.assign(PROFILE.kimmawi, JSON.parse(process.env.KIM_PATCH));
if (process.env.MUSK_PATCH) Object.assign(PROFILE.nylongmusk, JSON.parse(process.env.MUSK_PATCH));
if (process.env.MARS_PATCH) Object.assign(PROFILE.marsgod, JSON.parse(process.env.MARS_PATCH));
if (process.env.SPACE_PATCH) Object.assign(PROFILE.spacegod, JSON.parse(process.env.SPACE_PATCH));

function play(levels, seed) {
  const players = levels.map((lv, i) => newPlayer(i, `${lv}${i}`, 'ai', lv));
  const g = newGame({ players, seed });
  let turns = 0;
  let thinkMs = 0;
  let maxThinkMs = 0;
  while (!g.over && turns < 600) {
    const p = cur(g);
    const started = performance.now();
    const move = chooseMove(g);
    const elapsed = performance.now() - started;
    thinkMs += elapsed;
    maxThinkMs = Math.max(maxThinkMs, elapsed);
    applyMove(g, move);
    const evo = chooseEvolution(g);
    if (evo) applyEvolution(g, evo, p);
    autoDiscard(g, p);
    endTurn(g);
    turns++;
  }
  return { g, turns, thinkMs, maxThinkMs };
}

function duel(stronger, weaker) {
  let wins = 0;
  let games = 0;
  let scoreSum = 0;
  let thinkMs = 0;
  let thinkTurns = 0;
  let maxThinkMs = 0;
  for (let seat = 0; seat < 2; seat++) {
    const order = seat ? [weaker, stronger] : [stronger, weaker];
    for (let i = 0; i < N; i++) {
      const r = play(order, SEED_BASE + i * 97 + seat * 31);
      const idx = order.indexOf(stronger);
      if (r.g.over && r.g.winner === idx) wins++;
      scoreSum += score(r.g.players[idx]);
      thinkMs += r.thinkMs;
      thinkTurns += r.turns;
      maxThinkMs = Math.max(maxThinkMs, r.maxThinkMs);
      games++;
    }
  }
  return {
    winRate: wins / games,
    avgScore: scoreSum / games,
    avgThinkMs: thinkMs / thinkTurns,
    maxThinkMs,
  };
}

const matchups = process.env.MATCH === 'kim'
  ? [['kimmawi', 'pro']]
  : process.env.MATCH === 'musk'
    ? [['nylongmusk', 'kimmawi']]
    : process.env.MATCH === 'mars'
      ? [['marsgod', 'nylongmusk']]
      : process.env.MATCH === 'space'
        ? [['spacegod', 'marsgod']]
        : [
            ['kimmawi', 'pro'],
            ['nylongmusk', 'kimmawi'],
            ['marsgod', 'nylongmusk'],
            ['spacegod', 'marsgod'],
          ];

for (const [stronger, weaker] of matchups) {
  const r = duel(stronger, weaker);
  console.log(
    `${stronger} vs ${weaker}: ${(r.winRate * 100).toFixed(0)}%` +
    ` · ${r.avgScore.toFixed(1)}점 · 평균 ${r.avgThinkMs.toFixed(1)}ms · 최악 ${r.maxThinkMs.toFixed(1)}ms`,
  );
}

// 콘솔에서 import한 뒤 프로파일을 덮어쓰며 비교할 수 있도록 명시적으로 참조한다.
void PROFILE;
