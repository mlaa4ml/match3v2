import { StatsProvider } from "./statsProvider.js";

const STORAGE_KEY = "match3.history.v1";
const MAX_STORED_GAMES = 200; // чтобы localStorage не пух бесконечно

export class LocalStorageStatsProvider extends StatsProvider {
  async recordGame(result) {
    const history = this._readAll();
    history.push(result);
    if (history.length > MAX_STORED_GAMES) {
      history.splice(0, history.length - MAX_STORED_GAMES);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  }

  async getHistory() {
    return this._readAll();
  }

  async getSummary() {
    const history = this._readAll();
    if (history.length === 0) {
      return {
        gamesPlayed: 0,
        bestScore: 0,
        avgScore: 0,
        bestCombo: 0,
        totalSpecialsActivated: 0,
        byMode: {},
        bestByColorsCount: {},
      };
    }
    const scores = history.map((g) => g.score);
    const bestScore = Math.max(...scores);
    const avgScore = Math.round(
      scores.reduce((sum, s) => sum + s, 0) / scores.length
    );

    // старые записи (до появления этих полей) считаем нулевыми, а не роняем подсчёт
    let bestCombo = 0;
    let totalSpecialsActivated = 0;
    for (const game of history) {
      if (Number.isFinite(game.maxCombo)) bestCombo = Math.max(bestCombo, game.maxCombo);
      if (Number.isFinite(game.specialsActivated)) totalSpecialsActivated += game.specialsActivated;
    }

    const byMode = {};
    for (const game of history) {
      // старые записи (сохранённые до появления этого поля) считаем "classic"
      const mode = game.mode === "custom" ? "custom" : "classic";
      if (!byMode[mode]) byMode[mode] = { gamesPlayed: 0, bestScore: 0, sum: 0 };
      const bucket = byMode[mode];
      bucket.gamesPlayed += 1;
      bucket.sum += game.score;
      bucket.bestScore = Math.max(bucket.bestScore, game.score);
    }
    for (const mode of Object.keys(byMode)) {
      const bucket = byMode[mode];
      bucket.avgScore = Math.round(bucket.sum / bucket.gamesPlayed);
      delete bucket.sum;
    }

    const bestByColorsCount = {};
    for (const game of history) {
      if (!Number.isFinite(game.colorsCount)) continue; // у старых записей поля может не быть
      const key = String(game.colorsCount);
      bestByColorsCount[key] = Math.max(bestByColorsCount[key] ?? 0, game.score);
    }

    return {
      gamesPlayed: history.length,
      bestScore,
      avgScore,
      bestCombo,
      totalSpecialsActivated,
      byMode,
      bestByColorsCount,
    };
  }

  async clearHistory() {
    localStorage.removeItem(STORAGE_KEY);
  }

  async exportHistory() {
    const history = this._readAll();
    return JSON.stringify(
      { version: 1, exportedAt: new Date().toISOString(), games: history },
      null,
      2
    );
  }

  async importHistory(jsonText) {
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      throw new Error("файл повреждён или не является JSON");
    }

    const incoming = Array.isArray(parsed) ? parsed : parsed?.games;
    if (!Array.isArray(incoming)) {
      throw new Error('неверный формат: ожидался массив партий (поле "games")');
    }

    const valid = incoming.filter(isValidGameResult);
    const existing = this._readAll();
    const seenAt = new Set(existing.map((g) => g.finishedAt));

    let added = 0;
    for (const game of valid) {
      if (seenAt.has(game.finishedAt)) continue; // уже есть такая партия — пропускаем дубль
      seenAt.add(game.finishedAt);
      existing.push(game);
      added += 1;
    }

    existing.sort((a, b) => new Date(a.finishedAt) - new Date(b.finishedAt));
    const trimmed =
      existing.length > MAX_STORED_GAMES
        ? existing.slice(existing.length - MAX_STORED_GAMES)
        : existing;

    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    // skipped считает и дубли, и некорректные записи — пользователю важно
    // общее число "не долетевших" партий, а не только причина
    return { added, skipped: incoming.length - added, total: trimmed.length };
  }

  _readAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return []; // повреждённые данные — не роняем игру из-за этого
    }
  }
}

/** Проверяет, что объект похож на валидную запись GameResult (защита от битого/чужого JSON). */
function isValidGameResult(game) {
  return (
    game &&
    typeof game === "object" &&
    typeof game.score === "number" &&
    typeof game.movesUsed === "number" &&
    typeof game.finishedAt === "string" &&
    !Number.isNaN(Date.parse(game.finishedAt))
  );
}
