(() => {
  const dialog = document.getElementById('tutorial');
  const content = document.getElementById('tutorial-content');
  let chapter = 0;
  let returnFocus;
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const card = (color, shape, number) => ({ color, shape, number });
  const describeCard = card => card.wild ? (card.as ? t('tut.wildcardAs', { card: SquareI18n.cardName(card.as) }) : t('tut.wildcard')) : SquareI18n.cardName(card);
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
    content.append(make('h3', '', t('tut.lines.title')));
    paragraph(t('tut.lines.body'));
    const examples = make('div', 'tutorial-reference');
    reference.forEach(([cards, same], i) => {
      const row = make('div', 'tutorial-reference-row');
      const tiles = make('div', 'tutorial-tile-row'); cards.forEach(c => tiles.append(tile(c)));
      const rules = make('div', 'tutorial-properties');
      ['color', 'shape', 'number'].forEach((property, index) => {
        const line = make('div', '');
        line.append(make('strong', '', t(same[index] ? 'tut.same' : 'tut.different', { property: t(`tut.${property}`) })), document.createTextNode(t('tut.eachTile')));
        rules.append(line);
      });
      row.setAttribute('aria-label', t('tut.example', { n: i + 1 }));
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
    grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', t('tut.boardLabel'));
    for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) {
      const cell = make('div', `tutorial-cell${x === proposed.x && y === proposed.y ? ' proposed' : ''}`);
      const c = x === proposed.x && y === proposed.y ? proposed : cards.find(c => c.x === x && c.y === y);
      if (c) cell.append(tile(c));
      cell.setAttribute('aria-label', t('tut.cell', { row: y + 1, col: x + 1, content: c ? `${describeCard(c)}${c === proposed ? t('tut.proposed') : ''}` : t('tut.empty') }));
      grid.append(cell);
    }
    return grid;
  }
  // Each case is [button key, board, proposed tile, result key, explanation key].
  function examplePicker(cases, keyText, titleClass) {
    const choices = make('div', 'tutorial-choices');
    const stage = make('div', 'tutorial-example');
    function choose(index) {
      const [, cards, proposed, title, explanation] = cases[index];
      [...choices.children].forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
      stage.replaceChildren(board(cards, proposed), make('p', 'tutorial-board-key', t(keyText)), make('strong', titleClass, t(title)), make('p', '', t(explanation)));
    }
    cases.forEach(([label], index) => { const button = make('button', 'secondary', t(label)); button.type = 'button'; button.onclick = () => choose(index); choices.append(button); });
    stage.setAttribute('aria-live', 'polite');
    content.append(choices, stage); choose(0);
  }
  function checkMoves() {
    content.append(make('h3', '', t('tut.check.title')));
    paragraph(t('tut.check.body'));
    examplePicker([
      ['tut.check.mixed', existing, { x: 3, y: 1, ...card('green', 'circle', 4) }, 'tut.check.mixedTitle', 'tut.check.mixedBody'],
      ['tut.check.five', [...existing, { x: 3, y: 1, ...card('red', 'circle', 4) }], { x: 4, y: 1, ...card('red', 'circle', 1) }, 'tut.check.fiveTitle', 'tut.check.fiveBody'],
      ['tut.check.diagonal', existing, { x: 4, y: 1, ...card('red', 'circle', 4) }, 'tut.check.diagonalTitle', 'tut.check.diagonalBody']
    ], 'tut.check.key', 'tutorial-invalid');
    paragraph(t('tut.check.note'), 'tutorial-note');
  }
  function scoring() {
    content.append(make('h3', '', t('tut.score.title')));
    paragraph(t('tut.score.body'));
    content.append(board(existing, { x: 3, y: 1, ...card('red', 'circle', 4) }));
    paragraph(t('tut.score.key'), 'tutorial-board-key');
    const sums = make('div', 'tutorial-sums');
    for (const [label, sum] of [[t('tut.score.redRow'), '1 + 2 + 3 + 4 = 10'], [t('tut.score.rightColumn'), '4 + 4 = 8'], [t('tut.score.lot'), t('tut.score.lotSum')]]) {
      const line = make('div', ''); line.append(make('span', '', label), make('strong', '', sum)); sums.append(line);
    }
    content.append(sums);
    paragraph(t('tut.score.unchanged'));
    const list = make('ul', 'tutorial-bonuses');
    for (const key of ['tut.score.bonus1', 'tut.score.bonus2', 'tut.score.bonus3']) list.append(make('li', '', t(key)));
    content.append(list);
    paragraph(t('tut.score.note'), 'tutorial-note');
  }
  function wildcards() {
    content.append(make('h3', '', t('tut.wild.title')));
    paragraph(t('tut.wild.body'));
    paragraph(t('tut.wild.note'), 'tutorial-note');
    const row = [card('green', 'circle', 1), card('green', 'square', 2), card('green', 'triangle', 3)].map((c, x) => ({ x, y: 1, ...c }));
    const replacement = { x: 3, y: 1, ...card('green', 'star', 4) };
    examplePicker([
      ['tut.wild.play', row, { x: 3, y: 1, wild: true, as: card('green', 'star', 4) }, 'tut.wild.playTitle', 'tut.wild.playBody'],
      ['tut.wild.recover', row, replacement, 'tut.wild.recoverTitle', 'tut.wild.recoverBody'],
      ['tut.wild.finish', [...row, replacement], { x: 0, y: 2, ...card('blue', 'circle', 1) }, 'tut.wild.finishTitle', 'tut.wild.finishBody']
    ], 'tut.wild.key', '');
    content.append(make('h3', '', t('tut.wild.howTitle')));
    const steps = make('ol', 'tutorial-bonuses');
    for (const key of ['tut.wild.step1', 'tut.wild.step2', 'tut.wild.step3', 'tut.wild.step4']) steps.append(make('li', '', t(key)));
    content.append(steps);
    paragraph(t('tut.wild.limits'), 'tutorial-note');
  }
  const chapters = [buildLines, checkMoves, scoring, wildcards];
  function renderChapter() {
    content.replaceChildren();
    chapters[chapter]();
    document.querySelectorAll('[data-chapter]').forEach(button => {
      button.setAttribute('aria-current', Number(button.dataset.chapter) === chapter ? 'step' : 'false');
    });
    document.getElementById('tutorial-progress').textContent = t('tut.progress', { n: chapter + 1, total: chapters.length });
    document.getElementById('tutorial-back').disabled = chapter === 0;
    document.getElementById('tutorial-next').textContent = chapter === chapters.length - 1 ? t('tut.done') : t('tut.next');
    content.scrollTop = 0;
  }
  function open() {
    if (dialog.open) return;
    returnFocus = document.activeElement;
    chapter = 0; renderChapter(); dialog.showModal();
    document.body.classList.add('tutorial-open');
  }
  SquareI18n.onChange(() => { if (dialog.open) renderChapter(); });
  document.getElementById('open-tutorial').onclick = open;
  document.getElementById('room-tutorial').onclick = open;
  document.getElementById('close-tutorial').onclick = () => dialog.close();
  document.getElementById('tutorial-back').onclick = () => { if (chapter > 0) { chapter--; renderChapter(); } };
  document.getElementById('tutorial-next').onclick = () => { if (chapter === chapters.length - 1) dialog.close(); else { chapter++; renderChapter(); } };
  document.querySelectorAll('[data-chapter]').forEach(button => { button.onclick = () => { chapter = Number(button.dataset.chapter); renderChapter(); }; });
  dialog.addEventListener('close', () => { document.body.classList.remove('tutorial-open'); if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true }); });
  if (sessionStorage.getItem('square-guest-tutorial-pending') === 'true') {
    sessionStorage.removeItem('square-guest-tutorial-pending');
    open();
  }
})();
