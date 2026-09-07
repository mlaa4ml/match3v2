// board.js — вся логика поля. Никакого DOM тут нет: только данные и правила.
// Клетка теперь объект { color, special }, а не просто число — это нужно,
// чтобы хранить спецфишки (ракеты/бомбы), рождённые из комбо 4/5+.
//
// Поле больше не обязано быть 8x8-квадратом: ширина/высота теперь всегда
// берутся из реальных размеров grid (grid.length — высота, grid[0].length —
// ширина), а не из константы. Плюс к этому можно передать НЕОБЯЗАТЕЛЬНУЮ
// маску (см. buildShape/SHAPES ниже) — это 2D-массив true/false, которым
// помечаются клетки, которых на поле вообще нет ("дыры" для нестандартных
// форм — ромб, крест, кольцо и т.п.). Клетка-дыра в grid — это всегда
// `null`, причём НАВСЕГДА, в отличие от `null`, который бывает у обычной
// клетки на долю секунды между "очистили" и "досыпали" — эта секундная
// разница и есть причина, почему маску нужно передавать explicit-но в
// createBoard/collapseAndRefill: только они умеют отличать "дыра" от
// "временно пусто, сейчас досыплю".

export const BOARD_SIZE = 8;
export const TILE_TYPES = 6;

// Границы размера поля для режима "своя игра" (см. buildShape ниже).
// Меньше 4 клеток в стороне играть нечем (нужно место под ряд из 3),
// больше 12 уже не влезает на телефон.
export const MIN_SHAPE_SIZE = 4;
export const MAX_SHAPE_SIZE = 12;

// Правила "бонус vs цвет" (issue #1, п.2) — что происходит со спецфишкой,
// которая попала в обычное цветовое совпадение:
//  'activate'  — (по умолчанию, поведение как раньше) она сначала срабатывает,
//                и только потом исчезает вместе с совпадением;
//  'consume'   — просто исчезает вместе с цветом, эффект НЕ срабатывает
//                (сработать может только от свапа игроком или от чужого взрыва);
//  'colorless' — спецфишка вообще теряет цвет (color === null), поэтому
//                никогда не попадает в цветовые совпадения и спокойно ждёт,
//                пока её активируют свапом или соседним взрывом.
export const SPECIAL_COLOR_RULES = ["activate", "consume", "colorless"];
export const DEFAULT_SPECIAL_COLOR_RULE = "activate";

// Правила комбо при свапе ДВУХ спецфишек друг с другом (issue #1, п.3):
//  'matrix'   — (по умолчанию) полная таблица комбо в getComboEffectCells:
//               у каждой пары свой усиленный эффект, 🌈+🌈 чистит всё поле;
//  'off'      — никаких особых пар: обе фишки просто срабатывают сами по себе;
//  'wipe-all' — супер-бонус: ЛЮБОЕ соединение двух спецфишек стирает поле
//               целиком, и оно заполняется новыми фишками.
export const SUPER_COMBO_RULES = ["matrix", "off", "wipe-all"];
export const DEFAULT_SUPER_COMBO_RULE = "matrix";

// Виды спецфишек:
//  'lineH' — рождается из горизонтального совпадения 4 — при активации чистит всю СТРОКУ
//  'lineV' — рождается из вертикального совпадения 4 — чистит весь СТОЛБЕЦ
//  'bomb'  — рождается из совпадения 5 подряд — чистит блок 3x3 вокруг себя
//  'cross' — рождается из Г/Т-образного совпадения (горизонтальный ран 3+ и
//            вертикальный ран 3+ с общей клеткой, т.е. минимум 3 по вертикали
//            и 2 дополнительных по горизонтали = 5 клеток) — чистит и всю
//            СТРОКУ, и весь СТОЛБЕЦ через точку пересечения.
//  'colorbomb' — рождается из совпадения 6+ подряд — "радужная" фишка, чистит
//            ВСЕ клетки одного цвета на поле. Если её свапнули с обычной
//            цветной клеткой — целится в цвет именно этой клетки (см.
//            colorBombTarget в resolveWave); если активировалась сама по
//            себе (цепная реакция, без прямого свапа с цветной клеткой) —
//            целится в самый частый на данный момент цвет на поле.
//
// Комбо: если игрок свапает две спецфишки ДРУГ С ДРУГОМ, некоторые пары
// дают увеличенный эффект вместо суммы двух самостоятельных — см.
// getComboEffectCells ниже (bomb+bomb → взрыв 5x5, bomb+line → тройная
// строка/столбец, colorbomb+colorbomb → очистка всего поля). Остальные пары
// (line+line, cross+что угодно) и так уже получают нужный результат через
// обычную цепную активацию по отдельности.

function isActive(mask, row, col) {
  return !mask || Boolean(mask[row] && mask[row][col]);
}

/**
 * @param {number} [colorsCount]
 * @param {?{width:number, height:number, mask:?Array<Array<boolean>>}} [shape] —
 *   если не передан, поле — обычный прямоугольник BOARD_SIZE x BOARD_SIZE без
 *   дыр (старое поведение). Если передан, размеры поля берутся из
 *   shape.width/shape.height (а не из mask!) — иначе безмасочные прямоугольные
 *   формы вроде "6x9 без дыр" были бы неотличимы от старого дефолта 8x8.
 *   shape.mask, если задан, — клетки с mask[r][c] === false — дыры (null
 *   навсегда, никогда не заполняются). Обычно shape — это результат
 *   buildShape(shapeId) ниже.
 */
export function createBoard(colorsCount = TILE_TYPES, shape = null) {
  const height = shape ? shape.height : BOARD_SIZE;
  const width = shape ? shape.width : BOARD_SIZE;
  const mask = shape ? shape.mask : null;
  const grid = [];
  for (let r = 0; r < height; r++) {
    const row = [];
    for (let c = 0; c < width; c++) {
      if (!isActive(mask, r, c)) {
        row.push(null);
        continue;
      }
      let color;
      do {
        color = randomTileType(colorsCount);
      } while (
        (c >= 2 && row[c - 1] && row[c - 2] && row[c - 1].color === color && row[c - 2].color === color) ||
        (r >= 2 && grid[r - 1][c] && grid[r - 2][c] && grid[r - 1][c].color === color && grid[r - 2][c].color === color)
      );
      row.push({ color, special: null });
    }
    grid.push(row);
  }
  return grid;
}

function randomTileType(colorsCount = TILE_TYPES) {
  return Math.floor(Math.random() * colorsCount);
}

export function areAdjacent(a, b) {
  const dr = Math.abs(a.row - b.row);
  const dc = Math.abs(a.col - b.col);
  return (dr === 1 && dc === 0) || (dr === 0 && dc === 1);
}

export function swapCells(grid, a, b) {
  const tmp = grid[a.row][a.col];
  grid[a.row][a.col] = grid[b.row][b.col];
  grid[b.row][b.col] = tmp;
}

/**
 * Находит все "раны" (непрерывные последовательности одного цвета длиной 3+)
 * отдельно по горизонтали и вертикали. Дыры (null) обрывают ран сами по
 * себе — они никогда не бывают частью совпадения, ни в начале, ни в конце.
 */
export function findColorRuns(grid) {
  const height = grid.length;
  const width = grid[0] ? grid[0].length : 0;
  const runs = [];

  for (let r = 0; r < height; r++) {
    let runStart = 0;
    let runColor = null;
    for (let c = 0; c <= width; c++) {
      const cell = c < width ? grid[r][c] : null;
      const color = cell ? cell.color : null;
      const continuesRun = cell && color === runColor;
      if (!continuesRun) {
        const length = c - runStart;
        if (length >= 3 && runColor !== null) {
          const cells = [];
          for (let k = runStart; k < c; k++) cells.push({ row: r, col: k });
          runs.push({ cells, orientation: "h", length });
        }
        runStart = c;
        runColor = color;
      }
    }
  }

  for (let c = 0; c < width; c++) {
    let runStart = 0;
    let runColor = null;
    for (let r = 0; r <= height; r++) {
      const cell = r < height ? grid[r][c] : null;
      const color = cell ? cell.color : null;
      const continuesRun = cell && color === runColor;
      if (!continuesRun) {
        const length = r - runStart;
        if (length >= 3 && runColor !== null) {
          const cells = [];
          for (let k = runStart; k < r; k++) cells.push({ row: k, col: c });
          runs.push({ cells, orientation: "v", length });
        }
        runStart = r;
        runColor = color;
      }
    }
  }

  return runs;
}

/**
 * Какие клетки задевает спецфишка при активации (сама клетка включена).
 * @param {Object} [context] — доп. контекст для 'colorbomb': { targetColor }.
 *   Если не передан, radar-фишка целится в самый частый на поле цвет —
 *   разумный запасной вариант для цепной активации без прямого свапа.
 */
export function getSpecialEffectCells(grid, row, col, context = {}) {
  const cell = grid[row][col];
  if (!cell || !cell.special) return [];
  const height = grid.length;
  const width = grid[0].length;
  const cells = [];

  if (cell.special === "lineH") {
    for (let c = 0; c < width; c++) cells.push({ row, col: c });
  } else if (cell.special === "lineV") {
    for (let r = 0; r < height; r++) cells.push({ row: r, col });
  } else if (cell.special === "bomb") {
    for (let r = row - 1; r <= row + 1; r++) {
      for (let c = col - 1; c <= col + 1; c++) {
        if (r >= 0 && r < height && c >= 0 && c < width) {
          cells.push({ row: r, col: c });
        }
      }
    }
  } else if (cell.special === "cross") {
    for (let c = 0; c < width; c++) cells.push({ row, col: c });
    for (let r = 0; r < height; r++) cells.push({ row: r, col });
  } else if (cell.special === "colorbomb") {
    const targetColor = context.targetColor ?? mostFrequentColor(grid);
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        if (grid[r][c] && grid[r][c].color === targetColor) cells.push({ row: r, col: c });
      }
    }
  }
  return cells;
}

/** Самый часто встречающийся цвет на поле сейчас (запасная цель для colorbomb). */
function mostFrequentColor(grid) {
  const counts = new Array(TILE_TYPES).fill(0);
  for (const row of grid) {
    for (const cell of row) {
      if (cell) counts[cell.color] = (counts[cell.color] || 0) + 1;
    }
  }
  let best = 0;
  for (let c = 1; c < counts.length; c++) {
    if (counts[c] > counts[best]) best = c;
  }
  return best;
}

/**
 * Комбо двух спецфишек, свапнутых игроком друг с другом (не с обычной
 * клеткой). Часть пар (line+line, cross+что-угодно) и так уже дают нужный
 * результат через обычную цепную активацию каждой фишки по отдельности —
 * для них тут возвращается пустой список, ничего досчитывать не нужно.
 * Отдельного взрывного бонуса заслуживают только пары с "bomb": вместо двух
 * скромных самостоятельных эффектов получается один заметно больший.
 * Возвращает [] , если обе клетки — не спецфишки (значит, это не комбо-свап).
 */
export function getComboEffectCells(grid, a, b, superComboRule = DEFAULT_SUPER_COMBO_RULE) {
  const typeA = grid[a.row][a.col].special;
  const typeB = grid[b.row][b.col].special;
  if (!typeA || !typeB) return [];

  const rule = SUPER_COMBO_RULES.includes(superComboRule) ? superComboRule : DEFAULT_SUPER_COMBO_RULE;
  // 'off' — никакого особого комбо: каждая фишка просто сработает сама по себе
  // (обычная цепная активация в resolveWave).
  if (rule === "off") return [];
  if (rule === "wipe-all") {
    // супер-бонус: любое соединение двух бонусных клеток стирает поле целиком
    const all = [];
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < grid[0].length; c++) all.push({ row: r, col: c });
    }
    return all;
  }

  const height = grid.length;
  const width = grid[0].length;
  const cells = [];

  const addBlock5 = (center) => {
    for (let r = center.row - 2; r <= center.row + 2; r++) {
      for (let c = center.col - 2; c <= center.col + 2; c++) {
        if (r >= 0 && r < height && c >= 0 && c < width) cells.push({ row: r, col: c });
      }
    }
  };

  const addTripleRow = (row) => {
    for (let r = row - 1; r <= row + 1; r++) {
      if (r < 0 || r >= height) continue;
      for (let c = 0; c < width; c++) cells.push({ row: r, col: c });
    }
  };

  const addTripleCol = (col) => {
    for (let c = col - 1; c <= col + 1; c++) {
      if (c < 0 || c >= width) continue;
      for (let r = 0; r < height; r++) cells.push({ row: r, col: c });
    }
  };

  const addRow = (row) => {
    if (row < 0 || row >= height) return;
    for (let c = 0; c < width; c++) cells.push({ row, col: c });
  };

  const addCol = (col) => {
    if (col < 0 || col >= width) return;
    for (let r = 0; r < height; r++) cells.push({ row: r, col });
  };

  const addAll = () => {
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) cells.push({ row: r, col: c });
    }
  };

  /** Клетки указанного цвета (цель радужной фишки при комбо с ней). */
  const cellsOfColor = (color) => {
    const found = [];
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        if (grid[r][c] && grid[r][c].color === color) found.push({ row: r, col: c });
      }
    }
    return found;
  };

  const otherOf = (type) => (typeA === type ? b : a);
  const types = [typeA, typeB].sort().join("+");

  // Полная таблица комбо (issue #1, п.3). Раньше большинство пар давало []
  // и срабатывала лишь одна фишка из двух — теперь у каждой пары свой
  // усиленный эффект, а не "одно действие одной клетки".
  if (types === "bomb+bomb") {
    // вместо двух скромных 3x3 — один большой взрыв 5x5 через обе точки
    addBlock5(a);
    addBlock5(b);
  } else if (types === "bomb+lineH") {
    // "тройная строка": не одна чищенная строка, а сразу три подряд
    addTripleRow(otherOf("bomb").row);
  } else if (types === "bomb+lineV") {
    // аналогично — "тройной столбец"
    addTripleCol(otherOf("bomb").col);
  } else if (types === "bomb+cross") {
    // крест + бомба — тройная строка И тройной столбец через уголковую фишку
    const cross = otherOf("bomb");
    addTripleRow(cross.row);
    addTripleCol(cross.col);
  } else if (types === "lineH+lineH" || types === "lineH+lineV" || types === "lineV+lineV") {
    // две линии — полноценный крест через ОБЕ клетки (а не одна линия)
    addRow(a.row);
    addCol(a.col);
    addRow(b.row);
    addCol(b.col);
  } else if (types === "cross+lineH" || types === "cross+lineV") {
    // уголок + линия — крест через обе клетки плюс "утолщение" у уголка
    const cross = typeA === "cross" ? a : b;
    addRow(a.row);
    addCol(a.col);
    addRow(b.row);
    addCol(b.col);
    addTripleRow(cross.row);
  } else if (types === "cross+cross") {
    // два уголка — по три строки и три столбца через каждую клетку
    addTripleRow(a.row);
    addTripleCol(a.col);
    addTripleRow(b.row);
    addTripleCol(b.col);
  } else if (types === "colorbomb+colorbomb") {
    // двойная радуга — самый эффектный комбо, чистим поле целиком
    addAll();
  } else if (typeA === "colorbomb" || typeB === "colorbomb") {
    // радуга + любая другая спецфишка: все клетки цвета партнёра как бы
    // становятся такой же спецфишкой и срабатывают разом.
    const partner = typeA === "colorbomb" ? b : a;
    const partnerType = typeA === "colorbomb" ? typeB : typeA;
    const partnerCell = grid[partner.row][partner.col];
    const targetColor = partnerCell.color === null || partnerCell.color === undefined
      ? mostFrequentColor(grid)
      : partnerCell.color;
    const targets = cellsOfColor(targetColor);
    cells.push(...targets, partner);
    for (const t of targets) {
      if (partnerType === "lineH") addRow(t.row);
      else if (partnerType === "lineV") addCol(t.col);
      else if (partnerType === "bomb") addBlock5(t);
      else if (partnerType === "cross") {
        addRow(t.row);
        addCol(t.col);
      }
    }
  }

  return cells;
}

/**
 * Считает одну "волну" обработки: по цветовым ранам решает, что очищается
 * и какие спецфишки рождаются, плюс принудительно активирует спецфишки на
 * forcedPositions (клетки, которые игрок только что свапнул вручную —
 * спецфишка активируется, даже если сама по себе не попала в цветовое
 * совпадение), а дальше цепно активирует спецфишки, которые сами попали
 * под очистку (цепная реакция).
 *
 * Ничего не мутирует — только считает. Применение (applyWave) — отдельно.
 *
 * @param {Object} [options.colorBombTarget] — { row, col, color }: если
 *   игрок свапнул colorbomb именно с этой клеткой, при её активации нужно
 *   целиться в этот цвет, а не в "самый частый на поле" (запасной вариант
 *   для цепной активации без прямого свапа с цветной клеткой).
 */
export function resolveWave(grid, { forcedPositions = [], originPositions = [], colorBombTarget = null } = {}) {
  const clearSet = new Map(); // "r,c" -> {row,col}
  const spawns = [];
  const spawnKeys = new Set();

  const addClear = (row, col) => clearSet.set(`${row},${col}`, { row, col });

  const runs = findColorRuns(grid);
  for (const run of runs) {
    for (const cell of run.cells) addClear(cell.row, cell.col);
  }

  // Г/Т-образные совпадения: горизонтальный ран (3+) и вертикальный ран (3+)
  // одного цвета, у которых есть общая клетка. Вместе они рождают одну
  // "уголковую" спецфишку вместо двух отдельных линейных — поэтому
  // задействованные раны помечаем как consumedRuns и ниже пропускаем для них
  // обычный спавн lineH/lineV/bomb.
  const consumedRuns = new Set();
  const hRuns = runs.filter((r) => r.orientation === "h");
  const vRuns = runs.filter((r) => r.orientation === "v");

  for (const hRun of hRuns) {
    for (const vRun of vRuns) {
      const shared = hRun.cells.find((hc) =>
        vRun.cells.some((vc) => vc.row === hc.row && vc.col === hc.col)
      );
      if (!shared) continue;

      consumedRuns.add(hRun);
      consumedRuns.add(vRun);

      const candidates = [...hRun.cells, ...vRun.cells];
      let spawnCell = candidates.find((c) =>
        originPositions.some((o) => o.row === c.row && o.col === c.col)
      );
      if (!spawnCell) spawnCell = shared;

      spawns.push({
        row: spawnCell.row,
        col: spawnCell.col,
        special: "cross",
        color: grid[spawnCell.row][spawnCell.col].color,
      });
      spawnKeys.add(`${spawnCell.row},${spawnCell.col}`);
    }
  }

  for (const run of runs) {
    if (consumedRuns.has(run)) continue;
    if (run.length >= 4) {
      let spawnCell = run.cells.find((c) =>
        originPositions.some((o) => o.row === c.row && o.col === c.col)
      );
      if (!spawnCell) spawnCell = run.cells[Math.floor(run.cells.length / 2)];

      const special =
        run.length >= 6 ? "colorbomb" : run.length >= 5 ? "bomb" : run.orientation === "h" ? "lineH" : "lineV";
      spawns.push({
        row: spawnCell.row,
        col: spawnCell.col,
        special,
        color: grid[spawnCell.row][spawnCell.col].color,
      });
      spawnKeys.add(`${spawnCell.row},${spawnCell.col}`);
    }
  }

  // Клетки, чей бонус имеет право сработать. При правиле 'activate' (как
  // было раньше) — вообще любая попавшая под очистку клетка. При правиле
  // 'consume' бонус, который просто попал в цветовое совпадение, молча
  // исчезает, и активироваться могут только те, кого игрок свапнул сам
  // (forcedPositions) или кого задел чужой взрыв (добавляются ниже).
  const allowActivation = new Set();
  for (const pos of forcedPositions) {
    addClear(pos.row, pos.col);
    allowActivation.add(`${pos.row},${pos.col}`);
  }

  // цепная активация: любая спецфишка, попавшая под очистку, добавляет свою зону
  const seen = new Set();
  const activated = new Set();
  let activatedSpecialsCount = 0;
  let frontier = [...clearSet.keys()];
  while (frontier.length > 0) {
    const key = frontier.pop();
    if (seen.has(key) && !(allowActivation.has(key) && !activated.has(key))) continue;
    seen.add(key);
    if (spawnKeys.has(key)) continue; // спавнящаяся клетка не может сама себя чистить
    if (activated.has(key)) continue;
    if (rule === "consume" && !allowActivation.has(key)) continue;

    const [r, c] = key.split(",").map(Number);
    const cell = grid[r][c];
    if (cell && cell.special) {
      activated.add(key);
      activatedSpecialsCount += 1;
      const context =
        colorBombTarget && colorBombTarget.row === r && colorBombTarget.col === c
          ? { targetColor: colorBombTarget.color }
          : undefined;
      for (const affected of getSpecialEffectCells(grid, r, c, context)) {
        const aKey = `${affected.row},${affected.col}`;
        const isNew = !clearSet.has(aKey);
        if (isNew) addClear(affected.row, affected.col);
        // клетку задел взрыв, а не просто цвет — её бонус вправе сработать
        // даже при правиле 'consume'
        const newlyAllowed = !allowActivation.has(aKey);
        allowActivation.add(aKey);
        if (isNew || newlyAllowed) frontier.push(aKey);
      }
    }
  }

  for (const key of spawnKeys) clearSet.delete(key);

  if (clearSet.size === 0) return null;

  return { clearedPositions: [...clearSet.values()], spawns, activatedSpecials: activatedSpecialsCount };
}

/** Мутирует grid: ставит спецфишки и обнуляет очищенные клетки. */
export function applyWave(grid, wave) {
  for (const spawn of wave.spawns) {
    grid[spawn.row][spawn.col] = { color: spawn.color, special: spawn.special };
  }
  for (const pos of wave.clearedPositions) {
    grid[pos.row][pos.col] = null;
  }
}

/**
 * Гравитация + досыпка новых фишек. Мутирует grid.
 * Возвращает список перемещений — для каждой клетки, которая изменилась
 * (упала или появилась новой), сколько "рядов" она условно упала. Это
 * чистые данные для рендерера, чтобы он мог анимировать падение.
 *
 * @param {?Array<Array<boolean>>} [mask] — та же маска, что была передана в
 *   createBoard. Без неё collapseAndRefill не смог бы отличить "дыра,
 *   никогда не заполнять" от "временно пусто после очистки, надо досыпать" —
 *   обе выглядят как null в grid. Дыры полностью выключены из гравитации:
 *   фишки в столбце "падают" только относительно других активных клеток
 *   этого же столбца, перепрыгивая дыры, как будто их нет.
 */
export function collapseAndRefill(grid, colorsCount = TILE_TYPES, mask = null) {
  const height = grid.length;
  const width = grid[0].length;
  const dropInfo = [];

  for (let c = 0; c < width; c++) {
    const activeRows = [];
    for (let r = 0; r < height; r++) if (isActive(mask, r, c)) activeRows.push(r);
    if (activeRows.length === 0) continue;

    const remaining = [];
    for (let i = activeRows.length - 1; i >= 0; i--) {
      const r = activeRows[i];
      if (grid[r][c] !== null) remaining.push({ cell: grid[r][c], oldRow: r });
    }

    for (let i = activeRows.length - 1, k = 0; i >= 0; i--, k++) {
      const r = activeRows[i];
      if (k < remaining.length) {
        const { cell, oldRow } = remaining[k];
        grid[r][c] = cell;
        const dropDistance = r - oldRow;
        if (dropDistance > 0) dropInfo.push({ row: r, col: c, dropDistance, isNew: false });
      } else {
        grid[r][c] = { color: randomTileType(colorsCount), special: null };
        dropInfo.push({ row: r, col: c, dropDistance: r + 1, isNew: true });
      }
    }
  }

  return dropInfo;
}

/** Есть ли на поле хоть один осмысленный ход? Спецфишка на поле — всегда ход. */
export function hasAvailableMove(grid) {
  return findAvailableMove(grid) !== null;
}

/**
 * Находит один доступный ход (для подсказки игроку) — пару соседних клеток,
 * своп которых даёт результат. Возвращает { a, b } или null, если ходов нет.
 * Порядок перебора совпадает с hasAvailableMove: сначала любая спецфишка
 * (её своп с любым соседом всегда даёт эффект), потом обычные цветовые ходы.
 * Дыры (null) пропускаются — и как стартовая клетка, и как сосед.
 */
export function findAvailableMove(grid) {
  const height = grid.length;
  const width = grid[0].length;

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (!grid[r][c] || !grid[r][c].special) continue;
      const neighbors = [
        { row: r, col: c + 1 },
        { row: r, col: c - 1 },
        { row: r + 1, col: c },
        { row: r - 1, col: c },
      ];
      for (const n of neighbors) {
        if (
          n.row >= 0 && n.row < height && n.col >= 0 && n.col < width &&
          grid[n.row][n.col]
        ) {
          return { a: { row: r, col: c }, b: n };
        }
      }
    }
  }

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (!grid[r][c]) continue;
      const neighbors = [
        { row: r, col: c + 1 },
        { row: r + 1, col: c },
      ];
      for (const n of neighbors) {
        if (n.row >= height || n.col >= width || !grid[n.row][n.col]) continue;
        swapCells(grid, { row: r, col: c }, n);
        const hasMatch = findColorRuns(grid).length > 0;
        swapCells(grid, { row: r, col: c }, n);
        if (hasMatch) return { a: { row: r, col: c }, b: n };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------
// Формы поля. Каждая форма — { width, height, mask } (mask === null для
// обычного прямоугольника — тогда createBoard/collapseAndRefill работают
// без единой лишней проверки, как раньше). Заданы на фиксированной
// "рамке" 9x9 (кроме отдельных прямоугольников), чтобы формы были узнаваемы
// и одновременно разного размера — так наглядно видно, что меняется и
// размер поля, и его форма, не только цвета.
// ---------------------------------------------------------------------

function rectShape(width, height) {
  return { width, height, mask: null };
}

function diamondShape(size) {
  const center = (size - 1) / 2;
  const radius = Math.floor(size / 2);
  const mask = Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) => Math.abs(r - center) + Math.abs(c - center) <= radius)
  );
  return { width: size, height: size, mask };
}

function crossShape(size) {
  const center = Math.floor(size / 2);
  const halfBand = Math.floor(Math.floor(size / 3) / 2) || 1;
  const mask = Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) => Math.abs(c - center) <= halfBand || Math.abs(r - center) <= halfBand)
  );
  return { width: size, height: size, mask };
}

function ringShape(size) {
  const t = 2; // толщина рамки
  const mask = Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) => !(r >= t && r < size - t && c >= t && c < size - t))
  );
  return { width: size, height: size, mask };
}

function triangleShape(size) {
  const center = Math.floor((size - 1) / 2);
  const mask = Array.from({ length: size }, (_, r) => {
    const half = r;
    const left = Math.max(0, center - half);
    const right = Math.min(size - 1, center + half);
    return Array.from({ length: size }, (_, c) => c >= left && c <= right);
  });
  return { width: size, height: size, mask };
}

function hexShape(size) {
  const cut = Math.floor(size / 3);
  const mask = Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) => {
      if (r + c < cut) return false;
      if (r + c > 2 * (size - 1) - cut) return false;
      if (r - c > size - 1 - cut) return false;
      if (c - r > size - 1 - cut) return false;
      return true;
    })
  );
  return { width: size, height: size, mask };
}

// Реестр форм: id -> { name, build() }. main.js использует его, чтобы
// построить выпадающий список — новая форма добавляется только тут,
// больше нигде трогать не нужно.
export const SHAPES = {
  square: { name: "Квадрат 8×8", build: () => rectShape(BOARD_SIZE, BOARD_SIZE) },
  rect_narrow: { name: "Прямоугольник 6×9", build: () => rectShape(6, 9) },
  rect_wide: { name: "Прямоугольник 9×6", build: () => rectShape(9, 6) },
  diamond: { name: "Ромб", build: () => diamondShape(9) },
  cross: { name: "Крест", build: () => crossShape(9) },
  ring: { name: "Кольцо", build: () => ringShape(9) },
  triangle: { name: "Треугольник", build: () => triangleShape(9) },
  hex: { name: "Восьмиугольник", build: () => hexShape(9) },
};

/** Собирает форму по id из SHAPES; неизвестный/отсутствующий id → "square". */
export function buildShape(shapeId) {
  const entry = SHAPES[shapeId] ? shapeId : "square";
  const { name, build } = SHAPES[entry];
  return { id: entry, name, ...build() };
}
