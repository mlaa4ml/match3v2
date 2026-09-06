// statsProvider.js — контракт хранилища статистики.
// Игровой код всегда работает ЧЕРЕЗ этот интерфейс и не знает,
// localStorage за ним стоит или Cloudflare Worker.
//
// Когда будешь готов подключить внешнее хранилище — просто создашь
// cloudflareStatsProvider.js с той же сигнатурой методов и подменишь
// экспорт в index.js. Ничего больше в проекте менять не придётся.

/**
 * @typedef {Object} GameResult
 * @property {number} score
 * @property {number} movesUsed
 * @property {string} finishedAt - ISO-строка времени
 * @property {string} [mode] - "classic" | "custom"
 * @property {number} [colorsCount] - кол-во цветов фишек в этой партии
 * @property {number} [maxCombo] - самая длинная цепочка волн за один ход в этой партии
 * @property {number} [specialsActivated] - сколько спецфишек сработало за эту партию
 */

/**
 * @typedef {Object} ModeSummary
 * @property {number} gamesPlayed
 * @property {number} bestScore
 * @property {number} avgScore
 */

/**
 * @typedef {Object} StatsSummary
 * @property {number} gamesPlayed
 * @property {number} bestScore
 * @property {number} avgScore
 * @property {number} bestCombo - лучшее макс.-комбо среди всех партий
 * @property {number} totalSpecialsActivated - сумма активированных спецфишек по всем партиям
 * @property {Object<string, ModeSummary>} byMode - ключи "classic"/"custom"
 * @property {Object<string, number>} bestByColorsCount - ключ — colorsCount (строкой), значение — лучший счёт
 */

export class StatsProvider {
  /** @param {GameResult} result */
  async recordGame(result) {
    throw new Error("not implemented");
  }

  /** @returns {Promise<GameResult[]>} */
  async getHistory() {
    throw new Error("not implemented");
  }

  /** @returns {Promise<StatsSummary>} */
  async getSummary() {
    throw new Error("not implemented");
  }

  /** Полностью стирает сохранённую историю. */
  async clearHistory() {
    throw new Error("not implemented");
  }

  /** @returns {Promise<string>} - вся история одной JSON-строкой, для скачивания */
  async exportHistory() {
    throw new Error("not implemented");
  }

  /**
   * Импортирует историю из JSON-строки (см. формат exportHistory), сливая
   * с уже сохранённой (дубли по finishedAt пропускаются).
   * @param {string} jsonText
   * @returns {Promise<{added: number, skipped: number, total: number}>}
   */
  async importHistory(jsonText) {
    throw new Error("not implemented");
  }
}
