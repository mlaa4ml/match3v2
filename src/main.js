import { GameSession } from "./game/session.js";
import { BoardRenderer, setTileTheme } from "./render.js";
import { statsProvider } from "./stats/index.js";
import { findAvailableMove, SHAPES, clampShapeSize } from "./game/board.js";

const boardEl = document.getElementById("board");
const scoreEl = document.getElementById("score");
const movesEl = document.getElementById("moves");
const movesBlockEl = document.getElementById("moves-block");
const modeInfoEl = document.getElementById("mode-info");
const summaryEl = document.getElementById("summary");
const newGameBtn = document.getElementById("new-game");
const modeRadios = document.querySelectorAll('input[name="mode"]');
const customOptionsEl = document.getElementById("custom-options");
const customColorsEl = document.getElementById("custom-colors");
const customMovesEl = document.getElementById("custom-moves");
const customShapeEl = document.getElementById("custom-shape");
const customSizeEl = document.getElementById("custom-size");
const customSizeLabelEl = document.getElementById("custom-size-label");
const customWidthEl = document.getElementById("custom-width");
const customWidthLabelEl = document.getElementById("custom-width-label");
const customHeightEl = document.getElementById("custom-height");
const customHeightLabelEl = document.getElementById("custom-height-label");
const customSpecialRuleEl = document.getElementById("custom-special-rule");
const customComboRuleEl = document.getElementById("custom-combo-rule");
const themeRadios = document.querySelectorAll('input[name="theme"]');
const colorSchemeRadios = document.querySelectorAll('input[name="color-scheme"]');

for (const [id, { name }] of Object.entries(SHAPES)) {
  const option = document.createElement("option");
  option.value = id;
  option.textContent = name;
  customShapeEl.appendChild(option);
}

const HINT_IDLE_MS = 6000; // сколько ждать без действий, прежде чем показать подсказку
const LOW_MOVES_THRESHOLD = 3; // при таком остатке ходов включаем предупреждение
const SETTINGS_STORAGE_KEY = "match3:settings";
const THEME_STORAGE_KEY = "match3:theme";
const COLOR_SCHEME_STORAGE_KEY = "match3:color-scheme";

let session;
let renderer;
let hintTimer = null;

function loadSavedSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // localStorage недоступен (приватный режим и т.п.) — просто работаем без сохранения
  }
}

function saveSettings(settings) {
  try {
    const existing = loadSavedSettings() || {};
    const merged = {
      mode: settings.mode,
      // цвета/ходы сохраняем всегда, даже когда выбрана "обычная игра" —
      // чтобы при следующем переключении на "свою игру" не терять то,
      // что человек уже подбирал раньше.
      colorsCount: settings.colorsCount ?? existing.colorsCount,
      movesLimit: settings.movesLimit ?? existing.movesLimit,
      shapeId: settings.shapeId ?? existing.shapeId,
    };
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // недоступно — не критично, просто не запомнится
  }
}

function loadSavedTheme() {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null; // localStorage недоступен — используем тему по умолчанию
  }
}

function saveTheme(theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // недоступно — не критично, просто не запомнится
  }
}

/** Применяет тему оформления: красит фон/HUD через CSS (body[data-theme=...])
 * и переключает то, как render.js рисует SVG фишек (обводка золото/цвет). */
function applyTheme(theme) {
  document.body.dataset.theme = theme;
  setTileTheme(theme);
  if (renderer && session) renderer.draw(session.grid); // перерисовать уже нарисованные фишки в новой теме
}

function currentTheme() {
  const selected = document.querySelector('input[name="theme"]:checked');
  return selected ? selected.value : "gem";
}

function applySavedTheme() {
  const saved = loadSavedTheme();
  if (saved === "gem" || saved === "hybrid") {
    const radio = document.querySelector(`input[name="theme"][value="${saved}"]`);
    if (radio) radio.checked = true;
  }
  applyTheme(currentTheme());
}

function loadSavedColorScheme() {
  try {
    return localStorage.getItem(COLOR_SCHEME_STORAGE_KEY);
  } catch {
    return null; // localStorage недоступен — используем схему по умолчанию
  }
}

function saveColorScheme(scheme) {
  try {
    localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, scheme);
  } catch {
    // недоступно — не критично, просто не запомнится
  }
}

/** Тёмная/светлая — независимо от темы фишек (самоцветы/гибрид определяют
 * только акцентный цвет, см. style.css). Меняет только фон/панели через
 * body[data-color-scheme=...] — сами фишки рисуются одинаково в обеих. */
function applyColorScheme(scheme) {
  document.body.dataset.colorScheme = scheme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", scheme === "light" ? "#f6efe0" : "#1b1b1b");
}

function currentColorScheme() {
  const selected = document.querySelector('input[name="color-scheme"]:checked');
  return selected ? selected.value : "dark";
}

function applySavedColorScheme() {
  const saved = loadSavedColorScheme();
  if (saved === "light" || saved === "dark") {
    const radio = document.querySelector(`input[name="color-scheme"][value="${saved}"]`);
    if (radio) radio.checked = true;
  }
  applyColorScheme(currentColorScheme());
}

for (const radio of themeRadios) {
  radio.addEventListener("change", () => {
    const theme = currentTheme();
    saveTheme(theme);
    applyTheme(theme);
  });
}
applySavedTheme();

for (const radio of colorSchemeRadios) {
  radio.addEventListener("change", () => {
    const scheme = currentColorScheme();
    saveColorScheme(scheme);
    applyColorScheme(scheme);
  });
}
applySavedColorScheme();

/** Показывает поля размера, подходящие выбранной форме: прямоугольнику —
 * ширина+высота, всем остальным формам — одна сторона квадрата. */
function updateShapeSizeVisibility() {
  const def = SHAPES[customShapeEl.value] || SHAPES.square;
  const isRect = def.sizing === "wh";
  customSizeLabelEl.hidden = isRect;
  customWidthLabelEl.hidden = !isRect;
  customHeightLabelEl.hidden = !isRect;
}

customShapeEl.addEventListener("change", updateShapeSizeVisibility);
updateShapeSizeVisibility();

function applySavedSettings() {
  const saved = loadSavedSettings();
  if (!saved) return;

  if (saved.mode === "custom" || saved.mode === "classic") {
    const radio = document.querySelector(`input[name="mode"][value="${saved.mode}"]`);
    if (radio) radio.checked = true;
  }

  if (Number.isFinite(saved.colorsCount)) {
    const clamped = Math.min(6, Math.max(3, Math.round(saved.colorsCount)));
    if ([...customColorsEl.options].some((o) => Number(o.value) === clamped)) {
      customColorsEl.value = String(clamped);
    }
  }
  if (Number.isFinite(saved.movesLimit)) {
    customMovesEl.value = String(Math.max(3, Math.round(saved.movesLimit)));
  }
  if (saved.shapeId && SHAPES[saved.shapeId]) {
    customShapeEl.value = saved.shapeId;
  }
  if (Number.isFinite(saved.shapeSize)) customSizeEl.value = String(clampShapeSize(saved.shapeSize, 9));
  if (Number.isFinite(saved.shapeWidth)) customWidthEl.value = String(clampShapeSize(saved.shapeWidth, 6));
  if (Number.isFinite(saved.shapeHeight)) customHeightEl.value = String(clampShapeSize(saved.shapeHeight, 9));
  if (saved.specialColorRule) {
    if ([...customSpecialRuleEl.options].some((o) => o.value === saved.specialColorRule)) {
      customSpecialRuleEl.value = saved.specialColorRule;
    }
  }
  if (saved.superComboRule) {
    if ([...customComboRuleEl.options].some((o) => o.value === saved.superComboRule)) {
      customComboRuleEl.value = saved.superComboRule;
    }
  }

  updateShapeSizeVisibility();
  updateCustomVisibility();
}

function currentSettings() {
  const selectedMode = document.querySelector('input[name="mode"]:checked');
  const mode = selectedMode ? selectedMode.value : "classic";

  if (mode === "custom") {
    const colorsCount = parseInt(customColorsEl.value, 10);
    const movesLimit = parseInt(customMovesEl.value, 10);
    return {
      mode,
      colorsCount: Number.isFinite(colorsCount) ? colorsCount : 3,
      movesLimit: Number.isFinite(movesLimit) ? movesLimit : 3,
      shapeId: customShapeEl.value || "square",
      shapeSize: clampShapeSize(customSizeEl.value, 9),
      shapeWidth: clampShapeSize(customWidthEl.value, 6),
      shapeHeight: clampShapeSize(customHeightEl.value, 9),
      specialColorRule: customSpecialRuleEl.value,
      superComboRule: customComboRuleEl.value,
    };
  }

  return { mode }; // классический режим — используются значения по умолчанию
}

function updateCustomVisibility() {
  const selectedMode = document.querySelector('input[name="mode"]:checked');
  const mode = selectedMode ? selectedMode.value : "classic";
  customOptionsEl.hidden = mode !== "custom";
}

for (const radio of modeRadios) {
  radio.addEventListener("change", updateCustomVisibility);
}
applySavedSettings();
updateCustomVisibility();

function startNewGame() {
  const settings = currentSettings();
  saveSettings(settings);
  session = new GameSession(settings);
  const width = session.grid[0].length;
  const height = session.grid.length;
  renderer = new BoardRenderer(boardEl, width, height, handleSwapAttempt, scheduleHint);
  renderer.draw(session.grid);
  summaryEl.textContent = "";
  updateHud(0);
  updateModeInfo(settings.mode);
  scheduleHint();
}

/** Показывает в HUD, какая именно партия сейчас идёт — обычная или своя (с параметрами). */
function updateModeInfo(mode) {
  modeInfoEl.textContent =
    mode === "custom"
      ? `Своя игра: ${session.shape.name}, ${session.colorsCount} цвета(ов), ${session.movesLimit} ходов`
      : "Обычная игра";
}

/** Сбрасывает таймер бездействия и планирует показ подсказки хода через HINT_IDLE_MS. */
function scheduleHint() {
  clearTimeout(hintTimer);
  renderer.clearHint();
  if (session.isOver) return;
  hintTimer = setTimeout(() => {
    const move = findAvailableMove(session.grid);
    if (move) renderer.showHint(move.a, move.b);
  }, HINT_IDLE_MS);
}

async function handleSwapAttempt(a, b) {
  const result = session.trySwap(a, b);

  if (!result.accepted) {
    if (result.reason === "no-match") renderer.flashInvalidSwap(a, b);
    return;
  }

  renderer.setInteractive(false);
  renderer.paintSwapResult(result.swappedCells);

  const pointsBeforeAllWaves = result.waves.reduce((sum, w) => sum + w.points, 0);
  let runningScore = session.score - pointsBeforeAllWaves;

  for (const wave of result.waves) {
    await renderer.playWave(wave);
    runningScore += wave.points;
    updateHud(runningScore);
  }

  if (result.boardWasReshuffled) {
    // Поле пересобрано целиком (не было доступных ходов) — данные и то,
    // что нарисовано на экране, теперь совсем разные, нужна полная
    // перерисовка, а не точечные анимации.
    renderer.draw(session.grid);
  }

  renderer.setInteractive(true);

  if (result.isOver) {
    finishGame();
  } else {
    scheduleHint();
  }
}

function updateHud(score) {
  scoreEl.textContent = String(score);
  movesEl.textContent = String(session.movesLeft);
  const isRunningLow = !session.isOver && session.movesLeft > 0 && session.movesLeft <= LOW_MOVES_THRESHOLD;
  movesBlockEl.classList.toggle("low-moves", isRunningLow);
}

async function finishGame() {
  clearTimeout(hintTimer);
  renderer.clearHint();
  await statsProvider.recordGame({
    score: session.score,
    movesUsed: session.movesLimit - session.movesLeft,
    finishedAt: new Date().toISOString(),
    mode: session.mode,
    colorsCount: session.colorsCount,
    maxCombo: session.maxCombo,
    specialsActivated: session.specialsActivated,
  });
  const summary = await statsProvider.getSummary();
  summaryEl.textContent =
    `Игра окончена! Счёт: ${session.score}, макс. комбо: ${session.maxCombo}. ` +
    `Партий сыграно: ${summary.gamesPlayed}, ` +
    `лучший результат: ${summary.bestScore}, ` +
    `средний: ${summary.avgScore}.`;
}

newGameBtn.addEventListener("click", startNewGame);
startNewGame();
