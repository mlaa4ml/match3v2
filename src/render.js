// render.js — единственный файл, которому разрешено трогать DOM напрямую.
// Держим это изолированно, чтобы игровую логику можно было тестировать
// без браузера вообще.

const TILE_COLORS = [
  "#e74c3c", // красный
  "#3498db", // синий
  "#2ecc71", // зелёный
  "#f1c40f", // жёлтый
  "#9b59b6", // фиолетовый
  "#e67e22", // оранжевый
];

// У каждого цвета — своя геометрическая форма (так различать фишки можно
// не только по цвету, это ещё и удобнее для дальтоников). Индекс формы
// строго соответствует индексу цвета в TILE_COLORS.
const TILE_SHAPES = [
  '<circle cx="50" cy="50" r="38"/>', // 0 — круг
  '<rect x="14" y="14" width="72" height="72" rx="10"/>', // 1 — квадрат
  '<polygon points="50,10 90,84 10,84"/>', // 2 — треугольник
  '<polygon points="50,6 94,50 50,94 6,50"/>', // 3 — ромб
  '<polygon points="50,4 93,36 77,88 23,88 7,36"/>', // 4 — пятиугольник
  '<polygon points="50,4 61,37 96,37 68,58 79,92 50,71 21,92 32,58 4,37 39,37"/>', // 5 — звезда
];

// Текущая тема оформления фишек ("gem" — самоцветы с золотой огранкой,
// "hybrid" — те же гранёные фишки, но обводка в цвет самой фишки, а не
// золото). Меняется через setTileTheme(); влияет только на то, как рисуется
// SVG фишки — фон поля/HUD/шрифты стилизуются отдельно через CSS (body[data-theme]).
let currentTileTheme = "gem";

export function setTileTheme(theme) {
  currentTileTheme = theme === "hybrid" ? "hybrid" : "gem";
}

function shapeMarkup(colorIndex) {
  const shape = TILE_SHAPES[colorIndex] ?? TILE_SHAPES[0];
  const color = TILE_COLORS[colorIndex] ?? TILE_COLORS[0];
  // Общий для colorIndex id — определение градиента одинаковое для всех
  // клеток одного цвета, так что повтор id в разных <svg> безвреден.
  const gradId = `tileGrad-${colorIndex}`;
  const stroke = currentTileTheme === "hybrid" ? color : "#c9a227";
  return `<svg class="tile-shape" viewBox="0 0 100 100">
    <defs>
      <linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${color}" style="filter:brightness(1.55)" />
        <stop offset="0.55" stop-color="${color}" />
        <stop offset="1" stop-color="${color}" style="filter:brightness(0.55)" />
      </linearGradient>
    </defs>
    <g fill="url(#${gradId})" stroke="${stroke}" stroke-width="3">${shape}</g>
  </svg>`;
}

const SPECIAL_ICONS = {
  lineH: "\u2194", // ↔ — чистит строку
  lineV: "\u2195", // ↕ — чистит столбец
  bomb: "\u2739",  // ✹ — чистит блок 3x3
  cross: "\u271B", // ✛ — рождается из Г/Т-совпадения, чистит строку И столбец
  colorbomb: "\u{1F308}", // 🌈 — рождается из совпадения 6+, чистит все клетки одного цвета
};

const CLEAR_ANIM_MS = 180;
const DROP_ANIM_MS = 260;
const DRAG_THRESHOLD_PX = 14; // минимальный сдвиг пальца/мыши, чтобы считать это свайпом, а не тапом

export class BoardRenderer {
  /**
   * @param {HTMLElement} rootEl - контейнер, куда рисуем поле
   * @param {number} width - ширина поля в клетках (может отличаться от высоты
   *   и меняться от игры к игре — форма поля больше не обязана быть квадратом)
   * @param {number} height - высота поля в клетках
   * @param {(a: {row:number,col:number}, b: {row:number,col:number}) => void} onSwapAttempt
   */
  constructor(rootEl, width, height, onSwapAttempt, onInteraction = () => {}) {
    this.rootEl = rootEl;
    this.width = width;
    this.height = height;
    this.onSwapAttempt = onSwapAttempt;
    this.onInteraction = onInteraction;
    this.selected = null;
    this.hinted = null;
    this.cellEls = [];
    // true в позиции [r][c], если там дыра формы (клетки вообще нет) —
    // такие клетки не кликабельны и не участвуют в drag-свапе.
    this.holeFlags = [];
    this.dragState = null;
    this._suppressNextClick = false;

    this._onPointerMove = (e) => this._handlePointerMove(e);
    this._onPointerUp = (e) => this._handlePointerUp(e);

    this._buildGridSkeleton();
  }

  _buildGridSkeleton() {
    this.rootEl.innerHTML = "";
    const gap = 4;
    const padding = 16; // 8px padding с каждой стороны у #board
    const outerMargin = 32; // отступы body слева+справа, см. style.css
    // На телефоне с узким экраном фиксированные 44px на клетку не влезут
    // для широких форм (например, 9 клеток в ряд) — подбираем размер клетки
    // под реальную ширину экрана, но не крупнее 44px (комфортный десктопный размер).
    const availablePx = Math.min(window.innerWidth - outerMargin, 480) - padding - gap * (this.width - 1);
    const tileSize = Math.max(24, Math.min(44, Math.floor(availablePx / this.width)));
    this.rootEl.style.setProperty("--tile-size", `${tileSize}px`);
    this.rootEl.style.gridTemplateColumns = `repeat(${this.width}, var(--tile-size))`;
    this.rootEl.style.gridTemplateRows = `repeat(${this.height}, var(--tile-size))`;
    this.cellEls = [];
    this.holeFlags = [];
    for (let r = 0; r < this.height; r++) {
      const rowEls = [];
      const holeRow = [];
      for (let c = 0; c < this.width; c++) {
        const cell = document.createElement("button");
        cell.className = "tile";
        cell.type = "button";
        cell.dataset.row = String(r);
        cell.dataset.col = String(c);
        cell.addEventListener("click", () => this._handleClick(r, c));
        cell.addEventListener("pointerdown", (e) => this._handlePointerDown(e, r, c));
        this.rootEl.appendChild(cell);
        rowEls.push(cell);
        holeRow.push(false);
      }
      this.cellEls.push(rowEls);
      this.holeFlags.push(holeRow);
    }
  }

  _handleClick(row, col) {
    if (this.holeFlags[row][col]) return; // дыра формы — тут вообще нет фишки

    if (this._suppressNextClick) {
      // Этот клик — "эхо" от только что обработанного drag-свайпа
      // (браузер всё равно шлёт click после pointerup), просто игнорируем.
      this._suppressNextClick = false;
      return;
    }

    this.onInteraction();
    this.clearHint();
    const clicked = { row, col };

    if (!this.selected) {
      this.selected = clicked;
      this.cellEls[row][col].classList.add("selected");
      return;
    }

    this.cellEls[this.selected.row][this.selected.col].classList.remove("selected");

    if (this.selected.row === row && this.selected.col === col) {
      this.selected = null;
      return;
    }

    const prev = this.selected;
    this.selected = null;
    this.onSwapAttempt(prev, clicked);
  }

  /**
   * Drag-and-drop свап: тап-выбор (click) остаётся рабочим как и раньше,
   * а поверх него — перетаскивание фишки в сторону соседа одним жестом
   * (мышь и тач через Pointer Events). Направление определяем по тому,
   * какая ось (dx/dy) сдвинулась больше, конкретные координаты клеток
   * под пальцем не нужны — только направление свайпа.
   */
  _handlePointerDown(e, row, col) {
    if (this.holeFlags[row][col]) return; // дыра формы — начинать драг тут нечем

    this.dragState = {
      startRow: row,
      startCol: col,
      startX: e.clientX,
      startY: e.clientY,
      target: null,
    };
    window.addEventListener("pointermove", this._onPointerMove);
    window.addEventListener("pointerup", this._onPointerUp);
    window.addEventListener("pointercancel", this._onPointerUp);
  }

  _handlePointerMove(e) {
    const drag = this.dragState;
    if (!drag) return;

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    let target = null;

    if (Math.max(Math.abs(dx), Math.abs(dy)) >= DRAG_THRESHOLD_PX) {
      target =
        Math.abs(dx) > Math.abs(dy)
          ? { row: drag.startRow, col: drag.startCol + (dx > 0 ? 1 : -1) }
          : { row: drag.startRow + (dy > 0 ? 1 : -1), col: drag.startCol };

      if (
        target.row < 0 || target.row >= this.height ||
        target.col < 0 || target.col >= this.width ||
        this.holeFlags[target.row][target.col]
      ) {
        target = null;
      }
    }

    const prevKey = drag.target ? `${drag.target.row},${drag.target.col}` : null;
    const nextKey = target ? `${target.row},${target.col}` : null;
    if (prevKey === nextKey) return;

    if (prevKey === null && nextKey !== null && this.selected) {
      // Движение только что превысило порог — это уже настоящий свайп,
      // а не тап-выбор. Гасим случайно "зависшую" click-выбранную клетку,
      // чтобы она не осталась подсвеченной и не спутала следующий тап.
      this.cellEls[this.selected.row][this.selected.col].classList.remove("selected");
      this.selected = null;
    }

    if (drag.target) this.cellEls[drag.target.row][drag.target.col].classList.remove("drag-target");
    if (target) this.cellEls[target.row][target.col].classList.add("drag-target");
    this.cellEls[drag.startRow][drag.startCol].classList.toggle("dragging", Boolean(target));
    drag.target = target;
  }

  _handlePointerUp() {
    const drag = this.dragState;
    this.dragState = null;
    window.removeEventListener("pointermove", this._onPointerMove);
    window.removeEventListener("pointerup", this._onPointerUp);
    window.removeEventListener("pointercancel", this._onPointerUp);
    if (!drag) return;

    this.cellEls[drag.startRow][drag.startCol].classList.remove("dragging");
    if (drag.target) this.cellEls[drag.target.row][drag.target.col].classList.remove("drag-target");

    if (!drag.target) return; // недостаточный сдвиг — считаем это обычным тапом, click обработает сам

    this._suppressNextClick = true; // следом придёт "эхо"-click по стартовой клетке — гасим его
    this.onInteraction();
    this.clearHint();
    this.onSwapAttempt({ row: drag.startRow, col: drag.startCol }, drag.target);
  }

  /** Включает/выключает клики по полю — используем во время анимации. */
  setInteractive(enabled) {
    this.rootEl.style.pointerEvents = enabled ? "auto" : "none";
  }

  /** Полная мгновенная перерисовка (используется только при старте игры). */
  draw(grid) {
    this.clearHint();
    for (let r = 0; r < this.height; r++) {
      for (let c = 0; c < this.width; c++) {
        this._paintCell(r, c, grid[r][c]);
      }
    }
  }

  /** cellData === null означает дыру формы — там вообще нет клетки поля. */
  _paintCell(row, col, cellData) {
    const el = this.cellEls[row][col];
    this.holeFlags[row][col] = cellData === null;
    if (cellData === null) {
      el.innerHTML = "";
      el.classList.add("hole");
      el.classList.remove("special");
      return;
    }
    el.classList.remove("hole");
    const badge = cellData.special
      ? `<span class="special-badge">${SPECIAL_ICONS[cellData.special]}</span>`
      : "";
    el.innerHTML = shapeMarkup(cellData.color) + badge;
    el.classList.toggle("special", Boolean(cellData.special));
  }

  /**
   * Мгновенно перерисовывает клетки сразу после свапа, ДО начала анимации
   * волн (очистка/спавн/падение). Без этого шага клетка, которая физически
   * не попала под очистку в первой волне (например, вторая клетка при
   * принудительной активации спецфишки без цветового совпадения на ней),
   * так и оставалась бы на экране со старой картинкой.
   * @param {Array<{row:number, col:number, cell:{color:number, special:?string}}>} swappedCells
   */
  paintSwapResult(swappedCells) {
    for (const { row, col, cell } of swappedCells) {
      this._paintCell(row, col, cell);
    }
  }

  /** Короткая "тряска" двух клеток при невалидном свапе. */
  flashInvalidSwap(a, b) {
    for (const { row, col } of [a, b]) {
      const el = this.cellEls[row][col];
      el.classList.add("invalid");
      setTimeout(() => el.classList.remove("invalid"), 250);
    }
  }

  /** Подсвечивает пару клеток как подсказку хода (мягкая пульсация). */
  showHint(a, b) {
    this.clearHint();
    this.hinted = [a, b];
    for (const { row, col } of [a, b]) {
      this.cellEls[row][col].classList.add("hint");
    }
  }

  /** Убирает подсветку подсказки, если она сейчас показана. */
  clearHint() {
    if (!this.hinted) return;
    for (const { row, col } of this.hinted) {
      this.cellEls[row][col].classList.remove("hint");
    }
    this.hinted = null;
  }

  /**
   * Проигрывает одну волну целиком: гаснут очищенные клетки → появляются
   * рождённые спецфишки → оставшиеся/новые фишки "падают" на место.
   * Возвращает промис, который резолвится, когда анимация волны закончилась —
   * так main.js может обновлять счёт между волнами.
   */
  async playWave(wave) {
    await this._playClear(wave.clearedPositions);
    this._applySpawns(wave.spawns);
    await this._playDrop(wave.gridSnapshot, wave.dropInfo);
  }

  async _playClear(positions) {
    if (positions.length === 0) return;
    for (const { row, col } of positions) {
      this.cellEls[row][col].classList.add("clearing");
    }
    await wait(CLEAR_ANIM_MS);
    for (const { row, col } of positions) {
      const el = this.cellEls[row][col];
      el.classList.remove("clearing");
      el.innerHTML = "";
    }
  }

  _applySpawns(spawns) {
    for (const s of spawns) {
      this._paintCell(s.row, s.col, { color: s.color, special: s.special });
      const el = this.cellEls[s.row][s.col];
      el.classList.add("spawned");
      setTimeout(() => el.classList.remove("spawned"), 320);
    }
  }

  /**
   * Приём FLIP без перемещения DOM-узлов: клетки в CSS grid стоят на месте,
   * поэтому "падение" имитируем через transform — ставим фишку сразу в
   * финальный DOM-слот, но визуально сдвигаем её вверх на dropDistance
   * рядов без transition, затем следующим кадром убираем сдвиг С transition —
   * получается падение.
   */
  async _playDrop(gridSnapshot, dropInfo) {
    if (dropInfo.length === 0) return;
    const step = this._getCellStepPx();

    for (const { row, col, dropDistance } of dropInfo) {
      this._paintCell(row, col, gridSnapshot[row][col]);
      const el = this.cellEls[row][col];
      el.style.transition = "none";
      el.style.transform = `translateY(${-dropDistance * step}px)`;
    }

    void this.rootEl.offsetHeight; // форсируем reflow, чтобы браузер применил стартовую позицию

    for (const { row, col } of dropInfo) {
      const el = this.cellEls[row][col];
      el.style.transition = `transform ${DROP_ANIM_MS}ms cubic-bezier(0.3, 0.6, 0.4, 1)`;
      el.style.transform = "translateY(0)";
    }

    await wait(DROP_ANIM_MS);

    for (const { row, col } of dropInfo) {
      this.cellEls[row][col].style.transition = "";
    }
  }

  _getCellStepPx() {
    const rect = this.cellEls[0][0].getBoundingClientRect();
    const styles = getComputedStyle(this.rootEl);
    const gap = parseFloat(styles.getPropertyValue("gap")) || 4;
    return rect.height + gap;
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
