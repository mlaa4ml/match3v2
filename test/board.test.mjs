// Юнит-тесты игровой логики (board.js). Никакого DOM/браузера — чистые
// данные, поэтому гоняются обычным Node.js без сборки и без зависимостей:
//
//   node --test
//
// (встроенный test runner появился в Node 18+, тут используется node:test
// и node:assert/strict — ничего дополнительно ставить не нужно).

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  BOARD_SIZE,
  TILE_TYPES,
  createBoard,
  areAdjacent,
  swapCells,
  findColorRuns,
  getSpecialEffectCells,
  getComboEffectCells,
  resolveWave,
  applyWave,
  collapseAndRefill,
  hasAvailableMove,
  findAvailableMove,
} from "../src/game/board.js";

// ---- вспомогательные фабрики для тестовых полей ----------------------

/** Пустая заготовка BOARD_SIZE x BOARD_SIZE, цвет каждой клетки — по функции fn(r, c). */
function buildGrid(fn) {
  const grid = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    const row = [];
    for (let c = 0; c < BOARD_SIZE; c++) row.push({ color: fn(r, c), special: null });
    grid.push(row);
  }
  return grid;
}

/** Поле без единого совпадения при рождении и без доступных ходов (проверено перебором). */
function deadlockGrid() {
  return buildGrid((r, c) => (r + 2 * c) % 3);
}

/** Базовое "безопасное" поле — паттерн без случайных совпадений, colorsCount разных цветов. */
function safeGrid(colorsCount = TILE_TYPES) {
  return buildGrid((r, c) => ((r * 3 + c * 7) % 5) % colorsCount);
}

function cell(color, special = null) {
  return { color, special };
}

// ---- createBoard -------------------------------------------------------

describe("createBoard", () => {
  test("создаёт поле нужного размера", () => {
    const grid = createBoard();
    assert.equal(grid.length, BOARD_SIZE);
    for (const row of grid) assert.equal(row.length, BOARD_SIZE);
  });

  test("никогда не рождает поле с готовым совпадением 3+", () => {
    for (let i = 0; i < 50; i++) {
      const grid = createBoard();
      assert.equal(findColorRuns(grid).length, 0, `попытка #${i}`);
    }
  });

  test("уважает colorsCount — все цвета строго меньше переданного значения", () => {
    for (let i = 0; i < 20; i++) {
      const grid = createBoard(3);
      for (const row of grid) {
        for (const c of row) assert.ok(c.color >= 0 && c.color < 3);
      }
    }
  });

  test("новые клетки не имеют спецфишек", () => {
    const grid = createBoard();
    for (const row of grid) {
      for (const c of row) assert.equal(c.special, null);
    }
  });
});

// ---- areAdjacent --------------------------------------------------------

describe("areAdjacent", () => {
  test("соседи по горизонтали и вертикали — true", () => {
    assert.ok(areAdjacent({ row: 2, col: 2 }, { row: 2, col: 3 }));
    assert.ok(areAdjacent({ row: 2, col: 2 }, { row: 2, col: 1 }));
    assert.ok(areAdjacent({ row: 2, col: 2 }, { row: 3, col: 2 }));
    assert.ok(areAdjacent({ row: 2, col: 2 }, { row: 1, col: 2 }));
  });

  test("диагональ, та же клетка и дальние клетки — false", () => {
    assert.equal(areAdjacent({ row: 2, col: 2 }, { row: 3, col: 3 }), false);
    assert.equal(areAdjacent({ row: 2, col: 2 }, { row: 2, col: 2 }), false);
    assert.equal(areAdjacent({ row: 2, col: 2 }, { row: 2, col: 5 }), false);
  });
});

// ---- swapCells -----------------------------------------------------------

describe("swapCells", () => {
  test("меняет местами именно две указанные клетки и не трогает остальные", () => {
    const grid = safeGrid();
    const before = { a: grid[1][1], b: grid[1][2], untouched: grid[5][5] };
    swapCells(grid, { row: 1, col: 1 }, { row: 1, col: 2 });
    assert.deepEqual(grid[1][1], before.b);
    assert.deepEqual(grid[1][2], before.a);
    assert.deepEqual(grid[5][5], before.untouched);
  });
});

// ---- findColorRuns -------------------------------------------------------

describe("findColorRuns", () => {
  test("находит горизонтальный ран длины 3", () => {
    const grid = safeGrid();
    grid[0][0] = cell(9);
    grid[0][1] = cell(9);
    grid[0][2] = cell(9);
    const runs = findColorRuns(grid).filter((r) => r.orientation === "h" && r.cells[0].row === 0);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].length, 3);
  });

  test("находит вертикальный ран длины 4", () => {
    const grid = safeGrid();
    for (const r of [0, 1, 2, 3]) grid[r][0] = cell(9);
    const runs = findColorRuns(grid).filter((r) => r.orientation === "v" && r.cells[0].col === 0);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].length, 4);
  });

  test("не засчитывает пару одинаковых клеток (длина 2)", () => {
    const grid = safeGrid();
    grid[0][0] = cell(9);
    grid[0][1] = cell(9);
    const runs = findColorRuns(grid);
    assert.equal(runs.some((r) => r.cells.some((c) => c.row === 0 && c.col === 0)), false);
  });

  test("находит несколько ранов одновременно", () => {
    const grid = safeGrid();
    grid[0][0] = cell(9);
    grid[0][1] = cell(9);
    grid[0][2] = cell(9);
    grid[5][5] = cell(8);
    grid[6][5] = cell(8);
    grid[7][5] = cell(8);
    const runs = findColorRuns(grid);
    assert.equal(runs.length, 2);
  });
});

// ---- getSpecialEffectCells ------------------------------------------------

describe("getSpecialEffectCells", () => {
  test("lineH чистит всю строку", () => {
    const grid = safeGrid();
    grid[3][3] = cell(1, "lineH");
    const cells = getSpecialEffectCells(grid, 3, 3);
    assert.equal(cells.length, BOARD_SIZE);
    assert.ok(cells.every((c) => c.row === 3));
  });

  test("lineV чистит весь столбец", () => {
    const grid = safeGrid();
    grid[3][3] = cell(1, "lineV");
    const cells = getSpecialEffectCells(grid, 3, 3);
    assert.equal(cells.length, BOARD_SIZE);
    assert.ok(cells.every((c) => c.col === 3));
  });

  test("bomb чистит блок 3x3 и корректно обрезается у края поля", () => {
    const grid = safeGrid();
    grid[3][3] = cell(1, "bomb");
    assert.equal(getSpecialEffectCells(grid, 3, 3).length, 9);

    grid[0][0] = cell(1, "bomb");
    assert.equal(getSpecialEffectCells(grid, 0, 0).length, 4); // угол — только четверть блока
  });

  test("cross чистит строку и столбец без задвоения точки пересечения", () => {
    const grid = safeGrid();
    grid[3][3] = cell(1, "cross");
    const cells = getSpecialEffectCells(grid, 3, 3);
    const unique = new Set(cells.map((c) => `${c.row},${c.col}`));
    assert.equal(unique.size, BOARD_SIZE * 2 - 1);
  });

  test("обычная клетка без спецфишки — пустой список", () => {
    const grid = safeGrid();
    assert.deepEqual(getSpecialEffectCells(grid, 0, 0), []);
  });

  test("colorbomb с явным targetColor — чистит только клетки этого цвета по всему полю", () => {
    const grid = safeGrid(6);
    grid[0][0] = cell(0, "colorbomb"); // сама фишка — не участвует в подсчёте по цвету 2
    grid[1][1] = cell(2);
    grid[5][5] = cell(2);
    grid[7][7] = cell(3); // другой цвет — не должен попасть под очистку
    const cells = getSpecialEffectCells(grid, 0, 0, { targetColor: 2 });
    assert.ok(cells.some((c) => c.row === 1 && c.col === 1));
    assert.ok(cells.some((c) => c.row === 5 && c.col === 5));
    assert.ok(cells.every((c) => grid[c.row][c.col].color === 2));
  });

  test("colorbomb без targetColor — падает назад на самый частый цвет на поле", () => {
    const grid = buildGrid(() => 4); // весь board цвета 4 — он точно самый частый
    grid[3][3] = cell(4, "colorbomb");
    const cells = getSpecialEffectCells(grid, 3, 3);
    assert.equal(cells.length, BOARD_SIZE * BOARD_SIZE);
  });
});

// ---- mostFrequentColor (косвенно, через colorbomb без targetColor) --------

describe("colorbomb — выбор цвета по умолчанию", () => {
  test("реально выбирает именно самый частый цвет, а не первый попавшийся", () => {
    const grid = buildGrid((r, c) => (r === 0 ? 1 : 2)); // цвет 2 встречается заметно чаще
    grid[3][3] = cell(2, "colorbomb");
    const cells = getSpecialEffectCells(grid, 3, 3);
    assert.ok(cells.every((c) => grid[c.row][c.col].color === 2));
    assert.equal(cells.length, BOARD_SIZE * (BOARD_SIZE - 1)); // все строки, кроме нулевой
  });
});

// ---- getComboEffectCells ---------------------------------------------------

describe("getComboEffectCells", () => {
  test("если хотя бы одна из клеток не спецфишка — пустой список (это не комбо-свап)", () => {
    const grid = safeGrid();
    grid[3][3] = cell(1, "bomb");
    grid[3][4] = cell(1, null);
    assert.deepEqual(getComboEffectCells(grid, { row: 3, col: 3 }, { row: 3, col: 4 }), []);
  });

  test("bomb+bomb — большой взрыв 5x5 через обе точки, шире чем просто два 3x3", () => {
    const grid = safeGrid();
    grid[3][3] = cell(1, "bomb");
    grid[3][4] = cell(2, "bomb");
    const cells = getComboEffectCells(grid, { row: 3, col: 3 }, { row: 3, col: 4 });
    const unique = new Set(cells.map((c) => `${c.row},${c.col}`));
    // существенно больше, чем 9+9=18 (с учётом пересечения) — проверяем, что реально шире, чем просто сумма двух 3x3
    assert.ok(unique.size > 18, `ожидали заметно больше 18 клеток, получили ${unique.size}`);
    // и точно накрывает клетки, которых 3x3 вокруг (3,3) не достал бы — например (1,1)
    assert.ok(cells.some((c) => c.row === 1 && c.col === 1));
  });

  test("bomb+lineH — тройная строка (3 строки подряд вокруг строки lineH)", () => {
    const grid = safeGrid();
    grid[3][3] = cell(1, "bomb");
    grid[4][3] = cell(2, "lineH");
    const cells = getComboEffectCells(grid, { row: 3, col: 3 }, { row: 4, col: 3 });
    const rows = new Set(cells.map((c) => c.row));
    assert.deepEqual([...rows].sort(), [3, 4, 5]);
    // каждая из трёх строк вычищена целиком
    for (const r of [3, 4, 5]) {
      const inRow = cells.filter((c) => c.row === r).length;
      assert.equal(inRow, BOARD_SIZE);
    }
  });

  test("bomb+lineV — тройной столбец (3 столбца подряд вокруг столбца lineV)", () => {
    const grid = safeGrid();
    grid[3][3] = cell(1, "bomb");
    grid[3][4] = cell(2, "lineV");
    const cells = getComboEffectCells(grid, { row: 3, col: 3 }, { row: 3, col: 4 });
    const cols = new Set(cells.map((c) => c.col));
    assert.deepEqual([...cols].sort(), [3, 4, 5]);
  });

  test("lineH+lineV и другие пары без bomb — пустой список (default-активация и так справляется)", () => {
    const grid = safeGrid();
    grid[3][3] = cell(1, "lineH");
    grid[3][4] = cell(2, "lineV");
    assert.deepEqual(getComboEffectCells(grid, { row: 3, col: 3 }, { row: 3, col: 4 }), []);
  });

  test("colorbomb+colorbomb — двойная радуга чистит поле целиком", () => {
    const grid = safeGrid();
    grid[3][3] = cell(1, "colorbomb");
    grid[3][4] = cell(2, "colorbomb");
    const cells = getComboEffectCells(grid, { row: 3, col: 3 }, { row: 3, col: 4 });
    const unique = new Set(cells.map((c) => `${c.row},${c.col}`));
    assert.equal(unique.size, BOARD_SIZE * BOARD_SIZE);
  });

  test("не мутирует переданное поле", () => {
    const grid = safeGrid();
    grid[3][3] = cell(1, "bomb");
    grid[3][4] = cell(2, "bomb");
    const before = JSON.stringify(grid);
    getComboEffectCells(grid, { row: 3, col: 3 }, { row: 3, col: 4 });
    assert.equal(JSON.stringify(grid), before);
  });
});

// ---- resolveWave -----------------------------------------------------------

describe("resolveWave", () => {
  test("нет совпадений — null", () => {
    const grid = safeGrid();
    assert.equal(resolveWave(grid, {}), null);
  });

  test("простое совпадение из 3 — очищает ровно эти клетки, спецфишка не рождается", () => {
    const grid = safeGrid();
    grid[0][0] = cell(9);
    grid[0][1] = cell(9);
    grid[0][2] = cell(9);
    const wave = resolveWave(grid, {});
    assert.equal(wave.spawns.length, 0);
    assert.equal(wave.clearedPositions.length, 3);
    for (const c of [0, 1, 2]) {
      assert.ok(wave.clearedPositions.some((p) => p.row === 0 && p.col === c));
    }
  });

  test("совпадение из 4 по горизонтали — рождает lineH в точке хода (originPositions)", () => {
    const grid = safeGrid();
    for (const c of [1, 2, 3, 4]) grid[0][c] = cell(9);
    const wave = resolveWave(grid, { originPositions: [{ row: 0, col: 3 }] });
    assert.equal(wave.spawns.length, 1);
    assert.deepEqual(wave.spawns[0], { row: 0, col: 3, special: "lineH", color: 9 });
    // сама клетка спавна не входит в очищаемые — на ней остаётся спецфишка
    assert.equal(wave.clearedPositions.some((p) => p.row === 0 && p.col === 3), false);
    assert.equal(wave.clearedPositions.length, 3);
  });

  test("совпадение из 4 по вертикали без originPositions — спавн в середине рана", () => {
    const grid = safeGrid();
    for (const r of [0, 1, 2, 3]) grid[r][5] = cell(9);
    const wave = resolveWave(grid, {});
    assert.equal(wave.spawns.length, 1);
    assert.equal(wave.spawns[0].special, "lineV");
    assert.equal(wave.spawns[0].col, 5);
  });

  test("совпадение из 5 подряд — рождает bomb, а не lineH/lineV", () => {
    const grid = safeGrid();
    for (const r of [0, 1, 2, 3, 4]) grid[r][5] = cell(9);
    const wave = resolveWave(grid, {});
    assert.equal(wave.spawns.length, 1);
    assert.equal(wave.spawns[0].special, "bomb");
  });

  test("совпадение из 6+ подряд — рождает colorbomb, а не bomb", () => {
    const grid = safeGrid();
    for (const r of [0, 1, 2, 3, 4, 5]) grid[r][5] = cell(9);
    const wave = resolveWave(grid, {});
    assert.equal(wave.spawns.length, 1);
    assert.equal(wave.spawns[0].special, "colorbomb");
  });

  test("colorBombTarget — принудительно активированная colorbomb чистит именно указанный цвет", () => {
    const grid = safeGrid();
    grid[3][3] = cell(9, "colorbomb");
    grid[1][1] = cell(2);
    grid[6][6] = cell(2);
    grid[7][7] = cell(3); // другой цвет — должен остаться нетронутым
    const wave = resolveWave(grid, {
      forcedPositions: [{ row: 3, col: 3 }],
      colorBombTarget: { row: 3, col: 3, color: 2 },
    });
    assert.ok(wave.clearedPositions.some((p) => p.row === 1 && p.col === 1));
    assert.ok(wave.clearedPositions.some((p) => p.row === 6 && p.col === 6));
    assert.equal(wave.clearedPositions.some((p) => p.row === 7 && p.col === 7), false);
  });

  test("Г/Т-образное совпадение (3 вертикали + 2 горизонтали) — рождает ровно одну cross", () => {
    const grid = safeGrid();
    // вертикаль (2,2)(3,2)(4,2) + горизонталь (2,2)(2,3)(2,4), общая клетка (2,2)
    for (const [r, c] of [[2, 2], [2, 3], [2, 4], [3, 2], [4, 2]]) grid[r][c] = cell(9);
    const wave = resolveWave(grid, {});
    assert.equal(wave.spawns.length, 1);
    assert.equal(wave.spawns[0].special, "cross");
    // 5 клеток совпадения минус 1 клетка спавна = 4 очищенных
    assert.equal(wave.clearedPositions.length, 4);
  });

  test("forcedPositions активирует спецфишку даже без цветового совпадения", () => {
    const grid = safeGrid();
    grid[3][3] = cell(1, "lineV");
    const wave = resolveWave(grid, { forcedPositions: [{ row: 3, col: 3 }] });
    assert.notEqual(wave, null);
    // должен очиститься весь столбец 3 (включая саму клетку — она не спавн, значит чистится)
    const col3Cleared = wave.clearedPositions.filter((p) => p.col === 3);
    assert.equal(col3Cleared.length, BOARD_SIZE);
  });

  test("цепная реакция: одна активированная спецфишка задевает другую", () => {
    const grid = safeGrid();
    grid[3][3] = cell(1, "lineV"); // чистит весь столбец 3, включая (5,3)
    grid[5][3] = cell(2, "lineH"); // а эта, активировавшись, чистит всю строку 5
    const wave = resolveWave(grid, { forcedPositions: [{ row: 3, col: 3 }] });
    const row5Cleared = wave.clearedPositions.filter((p) => p.row === 5);
    assert.equal(row5Cleared.length, BOARD_SIZE, "цепная активация должна была вычистить всю строку 5");
  });
});

// ---- applyWave -----------------------------------------------------------

describe("applyWave", () => {
  test("очищенные клетки становятся null, клетки спавна получают спецфишку", () => {
    const grid = safeGrid();
    for (const c of [1, 2, 3, 4]) grid[0][c] = cell(9);
    const wave = resolveWave(grid, { originPositions: [{ row: 0, col: 3 }] });
    applyWave(grid, wave);

    assert.deepEqual(grid[0][3], { color: 9, special: "lineH" });
    for (const p of wave.clearedPositions) {
      assert.equal(grid[p.row][p.col], null);
    }
  });
});

// ---- collapseAndRefill -----------------------------------------------------

describe("collapseAndRefill", () => {
  test("фишки падают вниз, заполняя дыры, порядок сохраняется", () => {
    const grid = safeGrid();
    const bottom = grid[7][2];
    const middle = grid[4][2]; // это станет "верхней" из оставшихся после удаления двух клеток
    grid[5][2] = null;
    grid[6][2] = null;

    const dropInfo = collapseAndRefill(grid);

    // нижняя клетка не изменилась (падать было некуда)
    assert.deepEqual(grid[7][2], bottom);
    // то, что было на 4-й строке, должно было упасть на 6-ю (сдвиг на 2 вниз)
    assert.deepEqual(grid[6][2], middle);
    const dropEntry = dropInfo.find((d) => d.row === 6 && d.col === 2);
    assert.ok(dropEntry);
    assert.equal(dropEntry.dropDistance, 2);
    assert.equal(dropEntry.isNew, false);
  });

  test("новые фишки досыпаются сверху и помечены isNew", () => {
    const grid = safeGrid();
    for (let r = 0; r < BOARD_SIZE; r++) grid[r][0] = null; // весь столбец пуст

    const dropInfo = collapseAndRefill(grid);
    const col0Entries = dropInfo.filter((d) => d.col === 0);
    assert.equal(col0Entries.length, BOARD_SIZE);
    assert.ok(col0Entries.every((d) => d.isNew === true));
    for (let r = 0; r < BOARD_SIZE; r++) {
      assert.notEqual(grid[r][0], null);
      assert.equal(grid[r][0].special, null);
    }
  });

  test("непотревоженные клетки не попадают в dropInfo", () => {
    const grid = safeGrid();
    const dropInfo = collapseAndRefill(grid); // ничего не очищалось
    assert.equal(dropInfo.length, 0);
  });

  test("новые фишки укладываются в переданный colorsCount", () => {
    const grid = safeGrid();
    for (let r = 0; r < BOARD_SIZE; r++) grid[r][0] = null;
    collapseAndRefill(grid, 3);
    for (let r = 0; r < BOARD_SIZE; r++) {
      assert.ok(grid[r][0].color >= 0 && grid[r][0].color < 3);
    }
  });
});

// ---- hasAvailableMove ------------------------------------------------------

describe("hasAvailableMove", () => {
  test("true, если своп двух клеток создаёт совпадение", () => {
    const grid = safeGrid();
    // ...9,9,X,9... — свап X с соседом достроит ран из 3
    grid[0][0] = cell(9);
    grid[0][1] = cell(9);
    grid[0][2] = cell(1);
    grid[0][3] = cell(9);
    assert.equal(hasAvailableMove(grid), true);
  });

  test("true, если на поле есть хоть одна спецфишка (сам факт — уже ход)", () => {
    const grid = deadlockGrid(); // иначе гарантированно нет ходов
    grid[0][0].special = "bomb";
    assert.equal(hasAvailableMove(grid), true);
  });

  test("false на поле-тупике без единого доступного хода", () => {
    const grid = deadlockGrid();
    assert.equal(findColorRuns(grid).length, 0, "фикстура не должна начинаться с совпадения");
    assert.equal(hasAvailableMove(grid), false);
  });

  test("hasAvailableMove не портит переданное поле (возвращает его как было)", () => {
    const grid = deadlockGrid();
    const before = JSON.stringify(grid);
    hasAvailableMove(grid);
    assert.equal(JSON.stringify(grid), before);
  });
});

// ---- findAvailableMove ------------------------------------------------

describe("findAvailableMove", () => {
  test("находит реальный ход и возвращает соседнюю пару клеток", () => {
    const grid = safeGrid();
    grid[0][0] = cell(9);
    grid[0][1] = cell(9);
    grid[0][2] = cell(1);
    grid[0][3] = cell(9);
    const move = findAvailableMove(grid);
    assert.notEqual(move, null);
    assert.ok(areAdjacent(move.a, move.b));
  });

  test("найденный ход при реальном свапе действительно создаёт совпадение", () => {
    const grid = safeGrid();
    grid[0][0] = cell(9);
    grid[0][1] = cell(9);
    grid[0][2] = cell(1);
    grid[0][3] = cell(9);
    const move = findAvailableMove(grid);
    swapCells(grid, move.a, move.b);
    assert.ok(findColorRuns(grid).length > 0);
  });

  test("null на поле-тупике", () => {
    const grid = deadlockGrid();
    assert.equal(findAvailableMove(grid), null);
  });

  test("если есть спецфишка — возвращает её и соседа, даже без цветовых ранов", () => {
    const grid = deadlockGrid();
    grid[3][3].special = "bomb";
    const move = findAvailableMove(grid);
    assert.notEqual(move, null);
    assert.ok(
      (move.a.row === 3 && move.a.col === 3) || (move.b.row === 3 && move.b.col === 3)
    );
    assert.ok(areAdjacent(move.a, move.b));
  });

  test("не мутирует переданное поле", () => {
    const grid = safeGrid();
    grid[0][0] = cell(9);
    grid[0][1] = cell(9);
    grid[0][2] = cell(1);
    grid[0][3] = cell(9);
    const before = JSON.stringify(grid);
    findAvailableMove(grid);
    assert.equal(JSON.stringify(grid), before);
  });
});
