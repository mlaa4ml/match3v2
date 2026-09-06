// session.js — обвязка над board.js: очки, счётчик ходов, разрешение волн
// совпадений (включая цепные реакции от спецфишек) за один ход игрока.

import {
  createBoard,
  areAdjacent,
  swapCells,
  resolveWave,
  applyWave,
  collapseAndRefill,
  hasAvailableMove,
  getComboEffectCells,
  buildShape,
  TILE_TYPES,
} from "./board.js";

const POINTS_PER_TILE = 10;
const POINTS_PER_SPAWN = 30; // бонус за рождение спецфишки — поощряем большие комбо
const MOVES_LIMIT = 25;
const MIN_COLORS = 3;
const MIN_MOVES = 3;

export class GameSession {
  /**
   * @param {Object} [options]
   * @param {number} [options.colorsCount] - кол-во цветов фишек (для режима "своя игра"), не меньше 3
   * @param {number} [options.movesLimit] - лимит ходов на партию, не меньше 3
   * @param {string} [options.mode] - "classic" или "custom", только для отображения/статистики
   * @param {string} [options.shapeId] - id формы поля из board.js:SHAPES (только
   *   для режима "custom"; "classic" всегда использует обычный квадрат 8x8,
   *   как и раньше).
   */
  constructor({ colorsCount = TILE_TYPES, movesLimit = MOVES_LIMIT, mode = "classic", shapeId = "square" } = {}) {
    this.mode = mode === "custom" ? "custom" : "classic";
    this.colorsCount = clamp(Math.round(colorsCount), MIN_COLORS, TILE_TYPES);
    this.movesLimit = Math.max(MIN_MOVES, Math.round(movesLimit));
    this.shape = buildShape(this.mode === "custom" ? shapeId : "square");
    this.grid = createBoard(this.colorsCount, this.shape);
    this.score = 0;
    this.movesLeft = this.movesLimit;
    this.isOver = false;
    this.maxCombo = 0; // самая длинная цепочка волн за один ход за всю партию
    this.specialsActivated = 0; // сколько спецфишек сработало за всю партию (свап + цепные активации)
  }

  /**
   * Пытается свапнуть две клетки.
   * Свап валиден, если а) получилось цветовое совпадение 3+, либо
   * б) одна из свапаемых клеток — спецфишка (тогда она активируется
   * принудительно, даже без совпадения — это стандартная механика "три в ряд").
   * @returns {{accepted:boolean, reason?:string, waves?:Array, isOver?:boolean, score?:number}}
   */
  trySwap(a, b) {
    if (this.isOver) return { accepted: false, reason: "game-over" };
    if (!areAdjacent(a, b)) return { accepted: false, reason: "not-adjacent" };

    swapCells(this.grid, a, b);

    const forced = [];
    if (this.grid[a.row][a.col].special) forced.push(a);
    if (this.grid[b.row][b.col].special) forced.push(b);

    // Игрок свапнул две спецфишки друг с другом — некоторые пары (например,
    // bomb+lineV) дают увеличенный комбо-эффект вместо двух самостоятельных.
    const comboCells = getComboEffectCells(this.grid, a, b);

    // Радужная фишка (colorbomb), свапнутая с обычной цветной клеткой,
    // целится именно в цвет этой клетки — а не в "самый частый цвет",
    // который используется как запасной вариант при цепной активации.
    let colorBombTarget = null;
    const aSpecial = this.grid[a.row][a.col].special;
    const bSpecial = this.grid[b.row][b.col].special;
    if (aSpecial === "colorbomb" && !bSpecial) {
      colorBombTarget = { row: a.row, col: a.col, color: this.grid[b.row][b.col].color };
    } else if (bSpecial === "colorbomb" && !aSpecial) {
      colorBombTarget = { row: b.row, col: b.col, color: this.grid[a.row][a.col].color };
    }

    const firstWave = resolveWave(this.grid, {
      forcedPositions: [...forced, ...comboCells],
      originPositions: [a, b],
      colorBombTarget,
    });

    if (!firstWave) {
      swapCells(this.grid, a, b); // невалидный ход — откатываем
      return { accepted: false, reason: "no-match" };
    }

    // Снимок сразу после свапа, ДО применения волны. Нужен рендереру: если
    // потом волна не заденет одну из двух свапнутых клеток (например, когда
    // ход сделан за счёт принудительной активации спецфишки, а не за счёт
    // цветового совпадения), то без этого снимка клетка так и останется
    // на экране со старой картинкой, хотя в данных там уже другая фишка.
    const swappedCells = [
      { row: a.row, col: a.col, cell: { ...this.grid[a.row][a.col] } },
      { row: b.row, col: b.col, cell: { ...this.grid[b.row][b.col] } },
    ];

    this.movesLeft -= 1;
    const waves = this._runAllWaves(firstWave);

    if (waves.length > 0) {
      this.maxCombo = Math.max(this.maxCombo, waves[waves.length - 1].combo);
      this.specialsActivated += waves.reduce((sum, w) => sum + w.activatedSpecials, 0);
    }

    let boardWasReshuffled = false;
    if (this.movesLeft <= 0) {
      this.isOver = true;
    } else if (!hasAvailableMove(this.grid)) {
      this.grid = createBoard(this.colorsCount, this.shape); // тупик — честно пересобираем поле
      boardWasReshuffled = true; // рендерер ДОЛЖЕН перерисовать поле целиком — оно теперь совсем другое
    }

    return {
      accepted: true,
      swappedCells,
      waves,
      boardWasReshuffled,
      isOver: this.isOver,
      score: this.score,
    };
  }

  /**
   * Гоняет цепочку волн (совпадение → очистка → гравитация → новое совпадение
   * от досыпанных фишек → ...) пока волны не закончатся. Каждая волна даёт
   * снимок сетки и данные о падении — этого достаточно, чтобы рендерер
   * проиграл анимацию шаг за шагом.
   */
  _runAllWaves(firstWave) {
    const waves = [];
    let wave = firstWave;
    let combo = 1;

    while (wave) {
      applyWave(this.grid, wave);
      const dropInfo = collapseAndRefill(this.grid, this.colorsCount, this.shape.mask);

      const points =
        wave.clearedPositions.length * POINTS_PER_TILE * combo + wave.spawns.length * POINTS_PER_SPAWN;
      this.score += points;

      waves.push({
        clearedPositions: wave.clearedPositions,
        spawns: wave.spawns,
        dropInfo,
        points,
        combo,
        activatedSpecials: wave.activatedSpecials,
        gridSnapshot: cloneGrid(this.grid),
      });

      combo += 1;
      wave = resolveWave(this.grid, {});
    }

    return waves;
  }
}

function cloneGrid(grid) {
  return grid.map((row) => row.map((cell) => ({ ...cell })));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
