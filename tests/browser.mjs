/**
 * Где взять Chromium.
 *
 * Playwright ищет браузер по ревизии, зашитой в свою версию, и если в
 * образе лежит другая — падает с «Executable doesn't exist», хотя рабочий
 * Chromium стоит рядом. Поэтому путь ищем сами: сначала явный
 * CHROMIUM_PATH, потом типовые места предустановленных браузеров, и только
 * если ничего не нашли — отдаём пустые опции и пусть playwright решает сам.
 */

import { existsSync } from 'node:fs';

const CANDIDATES = [
  '/opt/pw-browsers/chromium',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
];

export function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  return CANDIDATES.find((p) => existsSync(p)) ?? null;
}

/**
 * Флаги против «фонового» режима.
 *
 * Обычный Chromium (не headless-shell) считает невидимое окно фоновым и
 * душит в нём таймеры и requestAnimationFrame: игра начинает крутиться на
 * нескольких кадрах в секунду, и тесты, которые ждут события в игре, тянутся
 * не минуты, а десятки минут. Проверки при этом проходят — просто очень
 * долго, и понять, тест завис или считает, невозможно.
 */
const NO_THROTTLE = [
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-features=CalculateNativeWinOcclusion',
  '--mute-audio',
];

/** Опции для chromium.launch(): путь, флаги и всё, что передали сверху. */
export function launchOptions(extra = {}) {
  const path = chromiumPath();
  return {
    ...(path ? { executablePath: path } : {}),
    ...extra,
    args: [...NO_THROTTLE, ...(extra.args ?? [])],
  };
}
