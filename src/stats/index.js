// index.js — единственное место в проекте, которое знает,
// КАКАЯ реализация StatsProvider используется прямо сейчас.
//
// Когда появится Cloudflare Worker backend, здесь будет:
//   import { CloudflareStatsProvider } from "./cloudflareProvider.js";
//   export const statsProvider = new CloudflareStatsProvider(WORKER_URL);
// и, например, композит-провайдер, который пишет в оба места на переходный
// период. Остальной код (main.js) импортирует только `statsProvider`
// и никогда — конкретный класс.

import { LocalStorageStatsProvider } from "./localStorageProvider.js";

export const statsProvider = new LocalStorageStatsProvider();
