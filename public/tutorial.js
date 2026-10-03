(() => {
  const dialog = document.getElementById('tutorial');
  const content = document.getElementById('tutorial-content');
  const seenKey = 'square-tutorial-seen-v1';
  let chapter = 0;
  let returnFocus;
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const card = (color, shape, number) => ({ color, shape, number });
  const describeCard = card => card.wild ? `wildcard${card.as ? ` representing ${card.as.color} ${card.as.shape} ${card.as.number}` : ''}` : `${card.color} ${card.shape} ${card.number}`;
  // Share the board/hand renderer so tutorial tiles always match the game.
  function tile(card) {
    const node = cardElement(card);
    node.classList.add('tutorial-tile');
    node.setAttribute('role', 'img');
    node.setAttribute('aria-label', describeCard(card));
    return node;
  }
  function paragraph(text, className = '') { content.append(make('p', className, text)); }
  const reference = [
    [Array.from(['triangle', 'star', 'circle', 'square'], shape => card('yellow', shape, 2)), [true, false, true]],
    [[1, 3, 2, 4].map(n => card('red', 'circle', n)), [true, true, false]],
    [[card('green', 'triangle', 2), card('green', 'star', 3), card('green', 'circle', 1), card('green', 'square', 4)], [true, false, false]],
    [['green', 'blue', 'yellow', 'red'].map(color => card(color, 'star', 2)), [false, true, true]],
    [[card('red', 'triangle', 2), card('blue', 'star', 2), card('green', 'circle', 2), card('yellow', 'square', 2)], [false, false, true]],
    [[card('blue', 'triangle', 2), card('red', 'triangle', 1), card('yellow', 'triangle', 4), card('green', 'triangle', 3)], [false, true, false]],
    [[card('yellow', 'square', 4), card('red', 'circle', 3), card('blue', 'star', 1), card('green', 'triangle', 2)], [false, false, false]]
  ];
  function buildLines() {
    content.append(make('h3', '', 'Three properties. One simple rule.'));
    paragraph('Every tile has a color, a shape, and a number (shown in the bottom-right corner). In each horizontal or vertical line, check each property separately: it must be all the same or all different. A mix of repeats and differences is invalid.');
    const examples = make('div', 'tutorial-reference');
    reference.forEach(([cards, same], i) => {
      const row = make('div', 'tutorial-reference-row');
      const tiles = make('div', 'tutorial-tile-row'); cards.forEach(c => tiles.append(tile(c)));
      const rules = make('div', 'tutorial-properties');
      ['color', 'shape', 'number'].forEach((property, index) => {
        const line = make('div', '');
        line.append(make('strong', '', `${same[index] ? 'Same' : 'Different'} ${property}${same[index] ? '' : 's'}`), document.createTextNode(' on each tile.'));
        rules.append(line);
      });
      row.setAttribute('aria-label', `Legal line example ${i + 1}`);
      row.append(tiles, rules); examples.append(row);
    });
    content.append(examples);
  }
  const existing = [
    { x: 2, y: 0, ...card('blue', 'circle', 3) }, { x: 3, y: 0, ...card('blue', 'circle', 4) },
    ...[1, 2, 3].map((n, x) => ({ x, y: 1, ...card('red', 'circle', n) }))
  ];
  function board(cards, proposed) {
    const grid = make('div', 'tutorial-board');
    grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', 'Example board. Dashed outline marks the proposed tile.');
    for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) {
      const cell = make('div', `tutorial-cell${x === proposed.x && y === proposed.y ? ' proposed' : ''}`);
      const c = x === proposed.x && y === proposed.y ? proposed : cards.find(c => c.x === x && c.y === y);
      if (c) cell.append(tile(c));
      cell.setAttribute('aria-label', `Row ${y + 1}, column ${x + 1}: ${c ? `${describeCard(c)}${c === proposed ? ', proposed tile' : ''}` : 'empty'}`);
      grid.append(cell);
    }
    return grid;
  }
  function checkMoves() {
    content.append(make('h3', '', 'Connect to the board. Check both directions.'));
    paragraph('On your turn, place 1–4 tiles in one row or column. Your move must touch an existing tile along an edge. Leave no gaps between the tiles you play (existing tiles can fill the spaces). Every line you create or extend must stay legal and contain at most four tiles.');
    const choices = make('div', 'tutorial-choices');
    const stage = make('div', 'tutorial-example');
    const cases = [
      ['Mixed colors', existing, { x: 3, y: 1, ...card('green', 'circle', 4) }, 'Invalid: red, red, red, green.', 'The row has repeated reds and a different green. Color is neither all the same nor all different. Shape and number passing their checks does not rescue the move.'],
      ['Five in a line', [...existing, { x: 3, y: 1, ...card('red', 'circle', 4) }], { x: 4, y: 1, ...card('red', 'circle', 1) }, 'Invalid: a fifth tile.', 'A line can hold at most four tiles. Once a four-tile lot is complete, you can build off its sides, but cannot extend its ends.'],
      ['Diagonal only', existing, { x: 4, y: 1, ...card('red', 'circle', 4) }, 'Invalid: no shared edge.', 'This tile only touches the blue 4 at a corner. A diagonal connection does not count; the proposed move needs an edge connection to the board.']
    ];
    function choose(index) {
      const [, cards, proposed, title, explanation] = cases[index];
      [...choices.children].forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
      stage.replaceChildren(board(cards, proposed), make('p', 'tutorial-board-key', 'Dashed tile = proposed move'), make('strong', 'tutorial-invalid', title), make('p', '', explanation));
    }
    cases.forEach(([label], index) => { const button = make('button', 'secondary', label); button.type = 'button'; button.onclick = () => choose(index); choices.append(button); });
    stage.setAttribute('aria-live', 'polite');
    content.append(choices, stage); choose(0);
    paragraph('In the real game, select a tile in your hand, then an empty board square. The move preview checks legality and shows your score before you press Play cards. Use Undo to revise it.', 'tutorial-note');
  }
  function scoring() {
    content.append(make('h3', '', 'Count the whole line, then multiply.'));
    paragraph('Add the numbers on every tile in each line you create or extend, including tiles already on the board. Count each affected line once; a crossing tile counts in both lines. Unchanged lines score nothing.');
    content.append(board(existing, { x: 3, y: 1, ...card('red', 'circle', 4) }));
    paragraph('Play the dashed red 4. It completes the red row and extends the right-hand column.', 'tutorial-board-key');
    const sums = make('div', 'tutorial-sums');
    for (const [label, sum] of [['Red row', '1 + 2 + 3 + 4 = 10'], ['Right column', '4 + 4 = 8'], ['One four-tile lot', '(10 + 8) × 2 = 36 points']]) {
      const line = make('div', ''); line.append(make('span', '', label), make('strong', '', sum)); sums.append(line);
    }
    content.append(sums);
    paragraph('The blue row and the blue 3 / red 3 column are unchanged, so they add no points.');
    const list = make('ul', 'tutorial-bonuses');
    for (const text of ['Each four-tile lot you create or extend doubles the entire turn. Two lots mean ×4; three mean ×8.', 'Play all four tiles from your hand in the main move: double again.', 'Empty your hand with the deck depleted: double again. The game ends; the higher total score wins.']) list.append(make('li', '', text));
    content.append(list);
    paragraph('After playing, draw back up to four tiles while the deck has cards. If you cannot play, pass; you can select tiles to trade when passing.', 'tutorial-note');
  }
  function wildcards() {
    content.append(make('h3', '', 'A flexible tile you can use again.'));
    paragraph('Select a wildcard in your hand, then an empty board square, just like a regular tile. The game automatically finds a color, shape, and number that keeps every line legal. Check the move preview, then press Play cards.');
    paragraph('A wild must represent one consistent tile in both directions. It cannot be a red circle in its row and a blue square in its column. The game can reinterpret its identity on later turns if all the lines still work.', 'tutorial-note');
    const row = [card('green', 'circle', 1), card('green', 'square', 2), card('green', 'triangle', 3)].map((c, x) => ({ x, y: 1, ...c }));
    const replacement = { x: 3, y: 1, ...card('green', 'star', 4) };
    const choices = make('div', 'tutorial-choices');
    const stage = make('div', 'tutorial-example');
    const cases = [
      ['Play a wild', row, { x: 3, y: 1, wild: true, as: card('green', 'star', 4) }, 'Represents a green star 4. Scores zero itself.', 'The row has the same color, four different shapes, and four different numbers. The purple wild fills the missing green star 4, but contributes 0 points: (1 + 2 + 3 + 0) × 2 = 12 points for the four-tile lot.'],
      ['Recover it', row, replacement, 'On a later turn, exchange a regular tile for the wild.', 'Select the green star 4 in your hand, then click the board wildcard before staging your main move. Your regular tile replaces it, and the wild goes into your hand. This exchange scores a base of 1 + 2 + 3 + 4 = 10 and adds one lot multiplier to this turn.'],
      ['Finish the turn', [...row, replacement], { x: 0, y: 2, ...card('blue', 'circle', 1) }, 'Add your main move, then apply the exchange bonus.', 'After that exchange, play a blue circle 1 below the green circle 1. The new column scores 1 + 1 = 2. Combine both bases, then double for the exchange’s lot: (10 + 2) × 2 = 24 points. The unchanged green row is not scored again by this main move.']
    ];
    function choose(index) {
      const [, cards, proposed, title, explanation] = cases[index];
      [...choices.children].forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
      stage.replaceChildren(board(cards, proposed), make('p', 'tutorial-board-key', 'Dashed tile = tile being played or exchanged'), make('strong', '', title), make('p', '', explanation));
    }
    cases.forEach(([label], index) => { const button = make('button', 'secondary', label); button.type = 'button'; button.onclick = () => choose(index); choices.append(button); });
    stage.setAttribute('aria-live', 'polite');
    content.append(choices, stage); choose(0);
    content.append(make('h3', '', 'How to exchange a board wild'));
    const steps = make('ol', 'tutorial-bonuses');
    for (const text of ['Do it on your turn, before placing tiles for your main move.', 'Select a regular tile from your hand, then click a wildcard on the board. The replacement must keep every affected line legal; it need not match the wild’s previously displayed identity.', 'Repeat to recover more wilds if you have legal replacements. You can play recovered wilds in your main move during the same turn.', 'Finish by playing your main move or passing. Exchange points and lot bonuses are included in the turn’s total. Each exchange scores its affected lines, even if a previous exchange already scored them.']) steps.append(make('li', '', text));
    content.append(steps);
    paragraph('Wildcards do not bypass the four-tile line limit, connection rule, or one-row-or-column rule. The room’s creator chooses how many wildcards are in the deck (0–10; two by default).', 'tutorial-note');
  }
  const chapters = [buildLines, checkMoves, scoring, wildcards];
  function renderChapter() {
    content.replaceChildren();
    chapters[chapter]();
    document.querySelectorAll('[data-chapter]').forEach(button => {
      button.setAttribute('aria-current', Number(button.dataset.chapter) === chapter ? 'step' : 'false');
    });
    document.getElementById('tutorial-progress').textContent = `${chapter + 1} of ${chapters.length}`;
    document.getElementById('tutorial-back').disabled = chapter === 0;
    document.getElementById('tutorial-next').textContent = chapter === chapters.length - 1 ? 'Let’s play' : 'Next →';
    content.scrollTop = 0;
  }
  function open() {
    if (dialog.open) return;
    returnFocus = document.activeElement;
    chapter = 0; renderChapter(); dialog.showModal();
    document.body.classList.add('tutorial-open');
    try { localStorage.setItem(seenKey, 'true'); } catch { /* Still usable without persistent storage. */ }
  }
  document.getElementById('open-tutorial').onclick = open;
  document.getElementById('close-tutorial').onclick = () => dialog.close();
  document.getElementById('tutorial-back').onclick = () => { if (chapter > 0) { chapter--; renderChapter(); } };
  document.getElementById('tutorial-next').onclick = () => { if (chapter === chapters.length - 1) dialog.close(); else { chapter++; renderChapter(); } };
  document.querySelectorAll('[data-chapter]').forEach(button => { button.onclick = () => { chapter = Number(button.dataset.chapter); renderChapter(); }; });
  dialog.addEventListener('close', () => { document.body.classList.remove('tutorial-open'); if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true }); });
  let seen = false;
  try { seen = localStorage.getItem(seenKey) === 'true'; } catch { /* Show the first-open help if storage is unavailable. */ }
  if (!seen) open();
})();
