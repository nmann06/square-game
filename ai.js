import { COLORS, SHAPES, createGame, joinGame, playCards, passTurn, swapWild, validateBoard, scoreLines } from './game.js';

export const DIFFICULTIES = ['easy', 'medium', 'hard', 'insane'];

export function createAiGame(input) {
  if (!DIFFICULTIES.includes(input.difficulty)) throw new Error('Choose a bot difficulty.');
  if (input.timerSeconds >= 86400) throw new Error('Bot games use minute timers.');
  const game = joinGame(createGame(input), { name: `${input.difficulty[0].toUpperCase()}${input.difficulty.slice(1)} Bot`, now: input.now });
  game.mode = 'ai';
  game.difficulty = input.difficulty;
  game.players[1].isBot = true;
  game.current = 0;
  return game;
}

// This is the entire information boundary for strategy: no opponent cards or deck order.
export function aiObservation(game) {
  const index = game.current;
  return structuredClone({ board: game.board, hand: game.players[index].hand,
    deckCount: game.deck.length, opponentCount: game.players[1 - index].hand.length,
    score: game.players[index].score, opponentScore: game.players[1 - index].score,
    pendingSwap: game.pendingSwap, consecutivePasses: game.consecutivePasses, wildcardCount: game.wildcardCount ?? 2 });
}

function model(observation) {
  return { status: 'playing', current: 0, board: structuredClone(observation.board),
    deck: Array.from({ length: observation.deckCount }, (_, i) => ({ id: `unknown-${i}`, wild: true })),
    players: [{ id: 'ai', name: 'AI', hand: structuredClone(observation.hand), score: observation.score },
      { id: 'other', hand: Array.from({ length: observation.opponentCount }, (_, i) => ({ id: `other-${i}`, wild: true })), score: observation.opponentScore }],
    pendingSwap: observation.pendingSwap, consecutivePasses: observation.consecutivePasses,
    timerSeconds: 300, deadline: 0, wildcardCount: observation.wildcardCount ?? 2 };
}

function locallyValid(board, x, y) {
  for (const [dx,dy] of [[1,0], [0,1]]) {
    const cards = [board[`${x},${y}`]];
    for (const sign of [-1,1]) {
      for (let step=1; step<=4; step++) {
        const card = board[`${x+sign*step*dx},${y+sign*step*dy}`];
        if (!card) break;
        cards.push(card);
      }
    }
    if (cards.length > 4) return false;
    const regular = cards.filter(c => !c.wild);
    if (regular.length >= 3 && ['color','shape','number'].some(field => {
      const size = new Set(regular.map(c => c[field])).size;
      return size !== 1 && size !== regular.length;
    })) return false;
  }
  return true;
}

// Every legal placement fits in a connected row/column window of at most four cells.
export function legalTurns(observation, includeSwaps = true) {
  const source = model(observation);
  const variants = [{ game: source, swap: null, swaps: [] }];
  const seenVariants = new Set();
  if (includeSwaps) for (let variantIndex=0; variantIndex<variants.length; variantIndex++) {
    const variant = variants[variantIndex];
    for (const [spot, card] of Object.entries(variant.game.board)) if (card.wild) {
      const [x, y] = spot.split(',').map(Number);
      for (const replacement of variant.game.players[0].hand) if (!replacement.wild) {
        const swap = { x, y, cardId: replacement.id };
        try {
          const game = swapWild(variant.game, 0, swap, 0);
          const swaps = [...variant.swaps, swap];
          const signature = JSON.stringify([swaps.map(p => [p.x,p.y,p.cardId]).sort(), game.pendingSwap.base, game.pendingSwap.lots]);
          if (!seenVariants.has(signature)) { seenVariants.add(signature); variants.push({ game, swap: swaps[0], swaps }); }
        } catch { /* Illegal replacement. */ }
      }
    }
  }
  const turns = [];
  for (const { game, swap, swaps } of variants) {
    const hand = game.players[0].hand;
    const frontier = new Set();
    for (const spot of Object.keys(game.board)) {
      const [x, y] = spot.split(',').map(Number);
      for (const [a, b] of [[x+1,y], [x-1,y], [x,y+1], [x,y-1]]) {
        if (Math.abs(a) <= 100 && Math.abs(b) <= 100 && !game.board[`${a},${b}`]) frontier.add(`${a},${b}`);
      }
    }
    const windows = new Map();
    for (const spot of frontier) {
      const [x, y] = spot.split(',').map(Number);
      for (const [dx, dy] of [[1,0], [0,1]]) for (let length = 1; length <= 4; length++) for (let offset = 0; offset < length; offset++) {
        const cells = Array.from({ length }, (_, i) => [x+(i-offset)*dx, y+(i-offset)*dy]);
        const empty = cells.filter(([a,b]) => !game.board[`${a},${b}`]);
        if (empty.length > hand.length || cells.some(([a,b]) => Math.abs(a)>100 || Math.abs(b)>100)) continue;
        // Existing endpoints produce duplicates; identical sets are searched once.
        windows.set(empty.map(p => p.join(',')).join(';'), empty);
      }
    }
    for (const cells of windows.values()) {
      const placements = [];
      const workingBoard = { ...game.board };
      function assign(remaining) {
        if (placements.length === cells.length) {
          const board = structuredClone(workingBoard);
          try {
            const score = scoreLines(validateBoard(board), new Set(placements.map(p => `${p.x},${p.y}`)));
            const points = ((game.pendingSwap?.base ?? 0) + score.base) * 2 ** ((game.pendingSwap?.lots ?? 0) + score.lots)
              * (placements.length === 4 ? 2 : 1) * (!observation.deckCount && placements.length === hand.length ? 2 : 1);
            turns.push({ swap, swaps, placements: placements.map(p => ({ ...p })), points });
          } catch { /* Not a legal line. */ }
          return;
        }
        const [x,y] = cells[placements.length];
        for (const card of remaining) {
          workingBoard[`${x},${y}`] = card;
          placements.push({ x, y, cardId: card.id });
          if (locallyValid(workingBoard, x, y)) assign(remaining.filter(c => c !== card));
          placements.pop();
          delete workingBoard[`${x},${y}`];
        }
      }
      assign(hand);
    }
    turns.push({ swap, swaps, placements: [], points: (game.pendingSwap?.base ?? 0) * 2 ** (game.pendingSwap?.lots ?? 0) });
  }
  return turns.sort((a,b) => b.points-a.points || b.placements.length-a.placements.length);
}

const identity = card => card.wild ? 'wild' : `${card.color}/${card.shape}/${card.number}`;
export function unseenCards(observation) {
  const cards = [];
  for (const color of COLORS) for (const shape of SHAPES) for (let number=1; number<=4; number++) cards.push({ id: `sample-${cards.length}`, color, shape, number });
  for (let i=0; i<(observation.wildcardCount ?? 2); i++) cards.push({ id: `sample-wild-${i}`, wild: true });
  for (const seen of [...Object.values(observation.board), ...observation.hand]) {
    const index = cards.findIndex(c => identity(c) === identity(seen));
    if (index >= 0) cards.splice(index, 1);
  }
  return cards;
}

function shuffled(cards, random) {
  const result = structuredClone(cards);
  for (let i=result.length-1; i>0; i--) { const j=Math.floor(random()*(i+1)); [result[i],result[j]]=[result[j],result[i]]; }
  return result;
}

export function applyAiTurn(game, turn, now = Date.now()) {
  const index = game.current;
  let swapped = game;
  for (const swap of turn.swaps ?? (turn.swap ? [turn.swap] : [])) swapped = swapWild(swapped, index, swap, now);
  return turn.placements.length ? playCards(swapped, index, turn.placements, now) : passTurn(swapped, index, turn.tradeIds ?? [], now);
}

export function chooseAiTurn(observation, difficulty, random = Math.random) {
  if (!DIFFICULTIES.includes(difficulty)) throw new Error('Unknown AI difficulty.');
  const turns = legalTurns(observation);
  const playable = turns.filter(t => t.placements.length || t.swap);
  if (!playable.length) {
    // Improve a blocked hand while preserving a wild and respecting the pile size.
    const tradeIds = observation.hand.filter(c => !c.wild).sort((a,b) => a.number-b.number)
      .slice(0, observation.deckCount).map(c => c.id);
    return { ...turns[0], tradeIds };
  }
  if (difficulty === 'hard') return turns[0];
  if (difficulty === 'easy' || difficulty === 'medium') {
    const suboptimal = playable.filter(t => t.points < turns[0].points);
    if (!suboptimal.length) return playable[Math.floor(random()*playable.length)];
    const pool = difficulty === 'medium' ? suboptimal.slice(0, Math.max(1, Math.ceil(suboptimal.length/3)))
      : suboptimal.slice(Math.floor(suboptimal.length/2));
    return pool[Math.floor(random()*pool.length)];
  }
  // Bounded determinization: count unseen cards, sample possible hidden hands,
  // then compare immediate score - opponent reply + discounted next-turn score.
  // Finite search is strong strategy, not a claim of a solved imperfect-information game.
  const candidates = [];
  const signatures = new Set();
  // Keep immediate leaders and a couple of lower-scoring alternatives, so the
  // lookahead can sacrifice points now to prevent a reply or preserve a better hand.
  const alternatives = turns.filter(t => t.points < turns[0].points);
  const shortlist = [...turns.slice(0, 4), ...alternatives.slice(0, 2), ...turns];
  for (const turn of shortlist) {
    const signature = JSON.stringify([turn.swaps, turn.placements.map(p => [p.x,p.y,p.cardId])]);
    if (!signatures.has(signature)) { signatures.add(signature); candidates.push(turn); }
    if (candidates.length === 6) break;
  }
  const pool = unseenCards(observation);
  const samples = Array.from({ length: 3 }, () => shuffled(pool, random));
  let best = candidates[0], bestValue = -Infinity;
  for (const turn of candidates) {
    let value = 0;
    for (const sample of samples) {
      const game = model(observation);
      game.players[1].hand = sample.slice(0, observation.opponentCount);
      game.deck = sample.slice(observation.opponentCount, observation.opponentCount + observation.deckCount);
      let next = applyAiTurn(game, turn, 0);
      if (next.status === 'finished') {
        value += (next.players[0].score-next.players[1].score) * 10000;
        continue;
      }
      const reply = legalTurns(aiObservation(next))[0];
      next = applyAiTurn(next, reply, 0);
      if (next.status === 'finished') { value += (next.players[0].score-next.players[1].score)*10000; continue; }
      const future = legalTurns(aiObservation(next))[0];
      const remainingWilds = next.players[0].hand.filter(c => c.wild).length;
      value += turn.points - reply.points + .65*future.points + 2*remainingWilds;
    }
    if (value > bestValue) { bestValue = value; best = turn; }
  }
  return best;
}
