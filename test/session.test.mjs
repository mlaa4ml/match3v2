// Тесты на GameSession (src/game/session.js) — конкретно на пункт 10 плана:
// this.maxCombo (самая длинная цепочка волн за один ход за партию) и
// this.specialsActivated (сколько спецфишек сработало за партию).
//
// Игровое поле детерминировано (как и в board.test.mjs), но collapseAndRefill
// использует Math.random() для новых фишек — поэтому здесь Math.random
// подменяется на предсказуемую последовательность ПОСЛЕ создания сессии
// (сам конструктор GameSession вызывает createBoard(), которому нужен
// настоящий random, иначе его защита от случайных троек уйдёт в бесконечный
// цикл). После теста исходный Math.random всегда восстанавливается.
//
//   node --test

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import { GameSession } from "../src/game/session.js";
import { TILE_TYPES, BOARD_SIZE } from "../src/game/board.js";

function buildGrid(fn) {
  const grid = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    const row = [];
    for (let c = 0; c < BOARD_SIZE; c++) row.push({ color: fn(r, c), special: null });
    grid.push(row);
  }
  return grid;
}

function safeGrid(colorsCount = TILE_TYPES) {
  return buildGrid((r, c) => ((r * 3 + c * 7) % 5) % colorsCount);
}

function cell(color, special = null) {
  return { color, special };
}

/** Подменяет Math.random на последовательность fn(callIndex) -> [0,1). */
function mockRandomSequence(seqColors, colorsCount = TILE_TYPES) {
  const original = Math.random;
  let calls = 0;
  Math.random = () => {
    const color =
      calls < seqColors.length ? seqColors[calls] : (calls - seqColors.length) % colorsCount;
    calls += 1;
    return color / colorsCount + 0.001; // +0.001 чтобы не попасть ровно на границу floor
  };
  return original;
}

describe("GameSession — статистика за партию (maxCombo, specialsActivated)", () => {
  let restoreRandom = null;

  afterEach(() => {
    if (restoreRandom) {
      Math.random = restoreRandom;
      restoreRandom = null;
    }
  });

  test("новая партия начинается с нулевыми maxCombo/specialsActivated", () => {
    const session = new GameSession({ colorsCount: 6, movesLimit: 10 });
    assert.equal(session.maxCombo, 0);
    assert.equal(session.specialsActivated, 0);
  });

  test("прямая активация спецфишки без цепочки: specialsActivated=1, maxCombo=1", () => {
    const grid = safeGrid();
    grid[3][3] = cell(1, "lineV"); // чистит весь столбец 3 (8 клеток)

    const session = new GameSession({ colorsCount: 6, movesLimit: 10 });
    session.grid = grid;

    // рефилл столбца 3 (8 новых клеток) — цикл разных цветов, чтобы рефилл
    // сам по себе не создал случайное совпадение и не добавил вторую волну
    restoreRandom = mockRandomSequence([0, 1, 2, 3, 4, 5, 0, 1]);

    const result = session.trySwap({ row: 3, col: 3 }, { row: 3, col: 4 });

    assert.equal(result.accepted, true);
    assert.equal(result.waves.length, 1);
    assert.equal(session.specialsActivated, 1);
    assert.equal(session.maxCombo, 1);
  });

  test("рефилл, случайно создавший новое совпадение, увеличивает maxCombo до 2", () => {
    const grid = safeGrid();
    grid[3][3] = cell(1, "lineV"); // чистит весь столбец 3 (8 клеток)

    const session = new GameSession({ colorsCount: 6, movesLimit: 10 });
    session.grid = grid;

    // первые 3 рефилл-клетки столбца 3 (снизу вверх) получают один и тот же
    // цвет — вертикальная тройка, которая тут же породит вторую волну
    restoreRandom = mockRandomSequence([0, 0, 0]);

    const result = session.trySwap({ row: 3, col: 3 }, { row: 3, col: 4 });

    assert.equal(result.accepted, true);
    assert.equal(result.waves.length, 2);
    assert.equal(result.waves[0].combo, 1);
    assert.equal(result.waves[1].combo, 2);
    assert.equal(session.maxCombo, 2);
  });

  test("цепная активация нескольких спецфишек за один ход суммируется в specialsActivated", () => {
    const grid = safeGrid();
    grid[3][3] = cell(1, "lineV"); // после свапа с (3,4) активируется в столбце 4 (см. ниже)
    grid[5][4] = cell(2, "lineH"); // столбец 4, ряд 5 — попадёт под очистку и активируется цепью

    const session = new GameSession({ colorsCount: 6, movesLimit: 10 });
    session.grid = grid;

    restoreRandom = mockRandomSequence([0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5, 0, 1]);

    const result = session.trySwap({ row: 3, col: 3 }, { row: 3, col: 4 });

    assert.equal(result.accepted, true);
    assert.equal(session.specialsActivated, 2); // lineV (прямой свап) + lineH (цепь)
  });

  test("maxCombo и specialsActivated накапливаются за несколько ходов подряд", () => {
    const grid = safeGrid();
    grid[3][3] = cell(1, "lineV");

    const session = new GameSession({ colorsCount: 6, movesLimit: 10 });
    session.grid = grid;

    restoreRandom = mockRandomSequence([0, 1, 2, 3, 4, 5, 0, 1]);
    session.trySwap({ row: 3, col: 3 }, { row: 3, col: 4 }); // maxCombo=1, specialsActivated=1
    Math.random = restoreRandom;

    // второй ход: ставим ещё одну спецфишку и снова активируем её напрямую
    session.grid[4][4] = cell(1, "lineH");
    restoreRandom = mockRandomSequence([0, 1, 2, 3, 4, 5, 0, 1]);
    session.trySwap({ row: 4, col: 4 }, { row: 4, col: 5 });

    assert.equal(session.maxCombo, 1); // максимум за партию, не сумма
    assert.equal(session.specialsActivated, 2); // а это — суммарный счётчик
  });
});
