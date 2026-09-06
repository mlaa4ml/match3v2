// Тесты на LocalStorageStatsProvider (src/stats/localStorageProvider.js).
// В Node нет глобального localStorage, поэтому перед импортом модуля
// подставляем простой in-memory полифилл — этого достаточно, т.к. сам
// модуль работает только через стандартный интерфейс Storage.
//
//   node --test

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
  constructor() {
    this._data = new Map();
  }
  getItem(key) {
    return this._data.has(key) ? this._data.get(key) : null;
  }
  setItem(key, value) {
    this._data.set(key, String(value));
  }
  removeItem(key) {
    this._data.delete(key);
  }
  clear() {
    this._data.clear();
  }
}

globalThis.localStorage = new MemoryStorage();

const { LocalStorageStatsProvider } = await import("../src/stats/localStorageProvider.js");

function game({ score, movesUsed = 10, finishedAt, mode = "classic", colorsCount = 6 }) {
  return { score, movesUsed, finishedAt, mode, colorsCount };
}

describe("LocalStorageStatsProvider", () => {
  let provider;

  beforeEach(() => {
    globalThis.localStorage.clear();
    provider = new LocalStorageStatsProvider();
  });

  test("getSummary на пустой истории возвращает нули и пустые разбивки", async () => {
    const summary = await provider.getSummary();
    assert.equal(summary.gamesPlayed, 0);
    assert.equal(summary.bestScore, 0);
    assert.equal(summary.avgScore, 0);
    assert.deepEqual(summary.byMode, {});
    assert.deepEqual(summary.bestByColorsCount, {});
  });

  test("recordGame сохраняет партию, getHistory её возвращает", async () => {
    await provider.recordGame(game({ score: 100, finishedAt: "2026-01-01T10:00:00.000Z" }));
    const history = await provider.getHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0].score, 100);
  });

  test("getSummary считает общий bestScore/avgScore", async () => {
    await provider.recordGame(game({ score: 100, finishedAt: "2026-01-01T10:00:00.000Z" }));
    await provider.recordGame(game({ score: 300, finishedAt: "2026-01-02T10:00:00.000Z" }));
    const summary = await provider.getSummary();
    assert.equal(summary.gamesPlayed, 2);
    assert.equal(summary.bestScore, 300);
    assert.equal(summary.avgScore, 200);
  });

  test("getSummary разбивает по режимам (byMode)", async () => {
    await provider.recordGame(
      game({ score: 100, mode: "classic", finishedAt: "2026-01-01T10:00:00.000Z" })
    );
    await provider.recordGame(
      game({ score: 300, mode: "custom", colorsCount: 4, finishedAt: "2026-01-02T10:00:00.000Z" })
    );
    await provider.recordGame(
      game({ score: 200, mode: "custom", colorsCount: 4, finishedAt: "2026-01-03T10:00:00.000Z" })
    );
    const summary = await provider.getSummary();
    assert.equal(summary.byMode.classic.gamesPlayed, 1);
    assert.equal(summary.byMode.classic.bestScore, 100);
    assert.equal(summary.byMode.custom.gamesPlayed, 2);
    assert.equal(summary.byMode.custom.bestScore, 300);
    assert.equal(summary.byMode.custom.avgScore, 250);
  });

  test("getSummary считает лучший счёт по числу цветов (bestByColorsCount)", async () => {
    await provider.recordGame(
      game({ score: 100, colorsCount: 3, finishedAt: "2026-01-01T10:00:00.000Z" })
    );
    await provider.recordGame(
      game({ score: 250, colorsCount: 5, finishedAt: "2026-01-02T10:00:00.000Z" })
    );
    await provider.recordGame(
      game({ score: 150, colorsCount: 3, finishedAt: "2026-01-03T10:00:00.000Z" })
    );
    const summary = await provider.getSummary();
    assert.equal(summary.bestByColorsCount["3"], 150);
    assert.equal(summary.bestByColorsCount["5"], 250);
  });

  test("записи без mode/colorsCount (старый формат) не роняют getSummary", async () => {
    await provider.recordGame({ score: 100, movesUsed: 10, finishedAt: "2026-01-01T10:00:00.000Z" });
    const summary = await provider.getSummary();
    assert.equal(summary.gamesPlayed, 1);
    assert.equal(summary.byMode.classic.gamesPlayed, 1); // без mode считаем classic
    assert.deepEqual(summary.bestByColorsCount, {}); // без colorsCount не попадает в разбивку
  });

  test("clearHistory стирает всю историю", async () => {
    await provider.recordGame(game({ score: 100, finishedAt: "2026-01-01T10:00:00.000Z" }));
    await provider.clearHistory();
    assert.deepEqual(await provider.getHistory(), []);
  });

  test("exportHistory отдаёт валидный JSON со всеми партиями", async () => {
    await provider.recordGame(game({ score: 100, finishedAt: "2026-01-01T10:00:00.000Z" }));
    await provider.recordGame(game({ score: 200, finishedAt: "2026-01-02T10:00:00.000Z" }));
    const json = await provider.exportHistory();
    const parsed = JSON.parse(json);
    assert.equal(parsed.games.length, 2);
    assert.equal(parsed.version, 1);
    assert.ok(parsed.exportedAt);
  });

  test("importHistory добавляет новые партии из экспортированного JSON", async () => {
    await provider.recordGame(game({ score: 100, finishedAt: "2026-01-01T10:00:00.000Z" }));
    const otherProvider = new LocalStorageStatsProvider();
    // экспорт из "текущего" состояния имитируем напрямую, без второго хранилища:
    const exported = JSON.stringify({
      version: 1,
      games: [
        game({ score: 500, finishedAt: "2026-02-01T10:00:00.000Z" }),
        game({ score: 600, finishedAt: "2026-02-02T10:00:00.000Z" }),
      ],
    });
    const result = await provider.importHistory(exported);
    assert.equal(result.added, 2);
    assert.equal(result.skipped, 0);
    const history = await provider.getHistory();
    assert.equal(history.length, 3);
  });

  test("importHistory пропускает дубли по finishedAt", async () => {
    await provider.recordGame(game({ score: 100, finishedAt: "2026-01-01T10:00:00.000Z" }));
    const exported = JSON.stringify({
      games: [
        game({ score: 999, finishedAt: "2026-01-01T10:00:00.000Z" }), // тот же finishedAt — дубль
        game({ score: 200, finishedAt: "2026-01-02T10:00:00.000Z" }),
      ],
    });
    const result = await provider.importHistory(exported);
    assert.equal(result.added, 1);
    assert.equal(result.skipped, 1);
    const history = await provider.getHistory();
    assert.equal(history.length, 2);
    assert.equal(history.find((g) => g.finishedAt === "2026-01-01T10:00:00.000Z").score, 100); // старая запись не перезаписана
  });

  test("importHistory отбрасывает некорректные записи, не роняя импорт целиком", async () => {
    const exported = JSON.stringify({
      games: [
        game({ score: 100, finishedAt: "2026-01-01T10:00:00.000Z" }),
        { score: "не число", finishedAt: "2026-01-02T10:00:00.000Z" }, // невалидная запись
        { score: 50 }, // нет finishedAt
      ],
    });
    const result = await provider.importHistory(exported);
    assert.equal(result.added, 1);
    assert.equal(result.skipped, 2); // 2 некорректные записи не прошли валидацию

    const history = await provider.getHistory();
    assert.equal(history.length, 1);
  });

  test("importHistory кидает ошибку на некорректный JSON", async () => {
    await assert.rejects(() => provider.importHistory("не json{"));
  });

  test("importHistory кидает ошибку, если структура не массив партий", async () => {
    await assert.rejects(() => provider.importHistory(JSON.stringify({ foo: "bar" })));
  });
});
