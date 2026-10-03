import { Worker } from 'node:worker_threads';
import { aiObservation, applyAiTurn } from './ai.js';

// Strategy runs off the HTTP thread, so difficult searches don't freeze other rooms.
export async function runAi(game) {
  if (game.status !== 'playing' || !game.players[game.current]?.isBot) return game;
  const turn = await new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./ai-worker.js', import.meta.url), {
      workerData: { observation: aiObservation(game), difficulty: game.difficulty }
    });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', code => { if (code !== 0) reject(new Error('AI strategy could not finish. Please retry.')); });
  });
  return applyAiTurn(game, turn);
}
