// 장프로 튜닝: 후보 설정을 수련자와 맞붙여 승률을 비교한다.
//   node tools/tune.mjs [판수]
import { newGame, newPlayer, cur, score, applyMove, applyEvolution, autoDiscard, endTurn } from '../app/js/engine.js';
import { chooseMove, chooseEvolution, PROFILE } from '../app/js/ai.js';

const N = +(process.argv[2] || 25);
const BASE = JSON.parse(JSON.stringify(PROFILE.pro));

function play(levels, seed) {
  const players = levels.map((lv, i) => newPlayer(i, lv + i, 'ai', lv));
  const g = newGame({ players, seed });
  let t = 0;
  while (!g.over && t < 600) {
    const p = cur(g);
    applyMove(g, chooseMove(g));
    const e = chooseEvolution(g);
    if (e) applyEvolution(g, e, p);
    autoDiscard(g, p);
    endTurn(g);
    t++;
  }
  return g;
}

function duel(label, patch) {
  Object.assign(PROFILE.pro, BASE, patch);
  let w = 0; let n = 0; let sc = 0;
  for (let k = 0; k < 2; k++) {
    const order = k ? ['adept', 'pro'] : ['pro', 'adept'];
    for (let i = 0; i < N; i++) {
      const g = play(order, 5000 + i * 91 + k * 7);
      n++;
      if (g.over && order[g.winner] === 'pro') w++;
      sc += score(g.players[order.indexOf('pro')]);
    }
  }
  console.log(`${label.padEnd(30)} pro 승률 ${String(Math.round(w / n * 100)).padStart(3)}%   평균 ${(sc / n).toFixed(1)}점`);
}

console.log(`장프로 vs 수련자 (${N * 2}판, 자리 교대)`);
console.log('─'.repeat(56));
duel('현재 설정', {});
duel('pace 4', { pace: 4 });
duel('pace 6', { pace: 6 });
duel('pace 8', { pace: 8 });
duel('rollout 9 pace 5', { rollout: 9, pace: 5 });
