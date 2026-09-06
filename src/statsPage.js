// statsPage.js — точка входа для stats.html. Читает данные ЧЕРЕЗ тот же
// statsProvider, что и main.js, так что при переходе на другое хранилище
// (Cloudflare Worker) эта страница переделки не потребует вообще.

import { statsProvider } from "./stats/index.js";

const CHART_GAMES_COUNT = 20; // сколько последних партий показываем на графике

const summaryCardsEl = document.getElementById("summary-cards");
const chartEl = document.getElementById("chart");
const modeBreakdownEl = document.getElementById("mode-breakdown");
const colorsBreakdownEl = document.getElementById("colors-breakdown");
const historyBodyEl = document.getElementById("history-body");
const emptyStateEl = document.getElementById("empty-state");
const historyTableEl = document.getElementById("history-table");
const clearHistoryBtn = document.getElementById("clear-history");
const exportBtn = document.getElementById("export-history");
const importBtn = document.getElementById("import-history");
const importFileInput = document.getElementById("import-file-input");
const importStatusEl = document.getElementById("import-status");

const MODE_LABELS = { classic: "Обычная игра", custom: "Своя игра" };

async function render() {
  const [summary, history] = await Promise.all([
    statsProvider.getSummary(),
    statsProvider.getHistory(),
  ]);

  renderSummaryCards(summary);
  renderChart(history);
  renderModeBreakdown(summary);
  renderColorsBreakdown(summary);
  renderHistoryTable(history);
}

function renderSummaryCards(summary) {
  summaryCardsEl.innerHTML = "";
  const cards = [
    { label: "Партий сыграно", value: summary.gamesPlayed },
    { label: "Лучший счёт", value: summary.bestScore },
    { label: "Средний счёт", value: summary.avgScore },
    { label: "Лучшее комбо", value: summary.bestCombo },
    { label: "Спецфишек активировано", value: summary.totalSpecialsActivated },
  ];
  for (const card of cards) {
    const el = document.createElement("div");
    el.className = "summary-card";
    el.innerHTML = `<div class="summary-card-value">${card.value}</div><div class="summary-card-label">${card.label}</div>`;
    summaryCardsEl.appendChild(el);
  }
}

function renderChart(history) {
  chartEl.innerHTML = "";

  const recent = history.slice(-CHART_GAMES_COUNT);
  if (recent.length === 0) {
    chartEl.classList.add("empty");
    chartEl.textContent = "Пока нечего показывать.";
    return;
  }
  chartEl.classList.remove("empty");

  const maxScore = Math.max(...recent.map((g) => g.score), 1);

  for (const game of recent) {
    const barWrap = document.createElement("div");
    barWrap.className = "chart-bar-wrap";
    barWrap.title = `${formatDate(game.finishedAt)} — ${game.score} очков`;

    const bar = document.createElement("div");
    bar.className = "chart-bar";
    const heightPercent = Math.max(4, Math.round((game.score / maxScore) * 100));
    bar.style.height = `${heightPercent}%`;

    barWrap.appendChild(bar);
    chartEl.appendChild(barWrap);
  }
}

function renderModeBreakdown(summary) {
  modeBreakdownEl.innerHTML = "";
  for (const mode of ["classic", "custom"]) {
    const stat = summary.byMode?.[mode];
    const el = document.createElement("div");
    el.className = "summary-card";
    if (!stat || stat.gamesPlayed === 0) {
      el.innerHTML = `<div class="summary-card-value">—</div><div class="summary-card-label">${MODE_LABELS[mode]}</div>`;
    } else {
      el.innerHTML =
        `<div class="summary-card-value">${stat.bestScore}</div>` +
        `<div class="summary-card-label">${MODE_LABELS[mode]}<br>${stat.gamesPlayed} партий, ср. ${stat.avgScore}</div>`;
    }
    modeBreakdownEl.appendChild(el);
  }
}

function renderColorsBreakdown(summary) {
  colorsBreakdownEl.innerHTML = "";
  const entries = Object.entries(summary.bestByColorsCount ?? {}).sort(
    (a, b) => Number(a[0]) - Number(b[0])
  );
  if (entries.length === 0) {
    const p = document.createElement("p");
    p.className = "empty-state";
    p.textContent = "Пока нечего показывать.";
    colorsBreakdownEl.appendChild(p);
    return;
  }
  for (const [colorsCount, bestScore] of entries) {
    const el = document.createElement("div");
    el.className = "summary-card";
    el.innerHTML = `<div class="summary-card-value">${bestScore}</div><div class="summary-card-label">${colorsCount} цвета(ов)</div>`;
    colorsBreakdownEl.appendChild(el);
  }
}

function renderHistoryTable(history) {
  historyBodyEl.innerHTML = "";

  if (history.length === 0) {
    historyTableEl.hidden = true;
    emptyStateEl.hidden = false;
    return;
  }
  historyTableEl.hidden = false;
  emptyStateEl.hidden = true;

  const newestFirst = [...history].reverse();
  for (const game of newestFirst) {
    const row = document.createElement("tr");
    const modeLabel = game.mode === "custom" ? `Своя (${game.colorsCount ?? "?"} цв.)` : "Обычная";
    row.innerHTML = `
      <td>${formatDate(game.finishedAt)}</td>
      <td>${modeLabel}</td>
      <td>${game.score}</td>
      <td>${game.movesUsed}</td>
      <td>${game.maxCombo ?? "—"}</td>
      <td>${game.specialsActivated ?? "—"}</td>
    `;
    historyBodyEl.appendChild(row);
  }
}

function formatDate(isoString) {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

clearHistoryBtn.addEventListener("click", async () => {
  const confirmed = confirm("Точно очистить всю историю партий? Это необратимо.");
  if (!confirmed) return;
  await statsProvider.clearHistory();
  await render();
});

exportBtn.addEventListener("click", async () => {
  const json = await statsProvider.exportHistory();
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `match3-history-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

importBtn.addEventListener("click", () => importFileInput.click());

importFileInput.addEventListener("change", async () => {
  const file = importFileInput.files[0];
  importFileInput.value = ""; // сбрасываем, чтобы повторный выбор того же файла тоже сработал
  if (!file) return;

  try {
    const text = await file.text();
    const result = await statsProvider.importHistory(text);
    importStatusEl.classList.remove("error");
    importStatusEl.textContent =
      `Импортировано новых партий: ${result.added}.` +
      (result.skipped > 0 ? ` Пропущено (дубли/некорректные записи): ${result.skipped}.` : "");
    importStatusEl.hidden = false;
    await render();
  } catch (err) {
    importStatusEl.classList.add("error");
    importStatusEl.textContent = `Ошибка импорта: ${err.message}`;
    importStatusEl.hidden = false;
  }
});

render();
