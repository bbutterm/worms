/**
 * Интеграция с Telegram Mini App. В обычном браузере всё здесь — no-op.
 *
 * Что живёт в этом файле:
 *   • запуск: ready/expand, полный экран, блокировка свайпов;
 *   • безопасная область: под кнопками Telegram и под «чёлкой» игру
 *     не рисуем, игровое поле сжимается на эти отступы;
 *   • ссылка-приглашение вида t.me/бот?startapp=КОД и «позвать друга»
 *     родным выбором чата;
 *   • «На экран Домой»: Telegram сам ставит иконку, которая открывает
 *     игру внутри клиента сразу в полный экран;
 *   • CloudStorage — хранилище, привязанное к аккаунту, а не к устройству.
 */

/**
 * Имя бота из BotFather (без @). Из него собирается ссылка-приглашение.
 * Пусто — ссылка ведёт на сайт, как вне Telegram. Можно навязать из
 * index.html через window.WORMS_TG = { bot: 'имя', app: 'короткое_имя' }:
 * app нужен, только если Mini App заведён через /newapp, а не как главный.
 */
export const TELEGRAM = {
  bot: 'Cybercouch77bot',
  app: '',
};

export function telegramConfig() {
  return { ...TELEGRAM, ...(globalThis.WORMS_TG ?? {}) };
}

export function tgApi() {
  return globalThis.Telegram?.WebApp ?? null;
}

export function inTelegram() {
  return Boolean(tgApi()?.initData || tgApi()?.initDataUnsafe?.user);
}

/** Версия клиента не младше нужной. Старые клиенты просто без этих функций. */
export function tgSupports(version) {
  const tg = tgApi();
  if (!tg) return false;
  if (typeof tg.isVersionAtLeast === 'function') {
    try { return tg.isVersionAtLeast(version); } catch { /* ниже */ }
  }
  const [a, b] = String(tg.version ?? '0').split('.').map(Number);
  const [x, y] = version.split('.').map(Number);
  return a > x || (a === x && (b ?? 0) >= (y ?? 0));
}

// ----------------------------------------------------------------- запуск

let started = false;

/** Вызывается один раз до старта игры. */
export function initTelegram() {
  const tg = tgApi();
  if (!tg || started) return tg;
  started = true;

  try {
    tg.ready();
    tg.expand();
    if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
    if (tg.setHeaderColor) tg.setHeaderColor('#0b1021');
    if (tg.setBackgroundColor) tg.setBackgroundColor('#0b1021');
    if (tg.setBottomBarColor) tg.setBottomBarColor('#0b1021');
    // Полный экран появился в Bot API 8.0; в компактном режиме ландшафтной
    // игре тесно, поэтому просим его всегда, а не только с иконки.
    if (tg.requestFullscreen) tg.requestFullscreen();
    // Игра ландшафтная — просим клиент не крутить экран. Работает только в
    // полноэкранном режиме, поэтому идёт после requestFullscreen.
    if (tg.lockOrientation) tg.lockOrientation();
  } catch (e) {
    console.warn('[telegram] init failed', e);
  }

  // Отступы приходят не сразу и меняются при входе в полный экран
  for (const ev of ['safeAreaChanged', 'contentSafeAreaChanged', 'fullscreenChanged', 'viewportChanged']) {
    try { tg.onEvent?.(ev, applySafeArea); } catch { /* старый клиент */ }
  }
  try { tg.onEvent?.('homeScreenAdded', () => setHomeState('added')); } catch { /* — */ }
  applySafeArea();
  refreshHomeState();
  return tg;
}

// ------------------------------------------------------ безопасная область

/**
 * Отступы, под которыми игру рисовать нельзя, в CSS-пикселях.
 *
 * Их два вида, и нужны оба: safeAreaInset — «чёлка» и скруглённые углы
 * устройства, contentSafeAreaInset — кнопки самого Telegram («закрыть»,
 * «ещё»), которые в полноэкранном режиме висят поверх игры.
 */
export function safeArea() {
  const tg = tgApi();
  const a = tg?.safeAreaInset ?? {};
  const b = tg?.contentSafeAreaInset ?? {};
  const n = (v) => (Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
  return {
    top: n(a.top) + n(b.top),
    bottom: n(a.bottom) + n(b.bottom),
    left: n(a.left) + n(b.left),
    right: n(a.right) + n(b.right),
  };
}

let lastInset = '';

/**
 * Игровое поле (#game) прижато к краям экрана; здесь его края сдвигаются
 * внутрь на отступы. Фон страницы тёмный, так что под кнопками Telegram
 * остаётся просто тёмная полоса, а Phaser вписывает канвас в то, что
 * осталось. Снаружи Telegram отступы задаёт CSS через env(): тот же приём
 * для «чёлки» в PWA.
 */
export function applySafeArea() {
  const el = globalThis.document?.getElementById('game');
  if (!el || !tgApi()) return;
  const s = safeArea();
  const inset = `${s.top}px ${s.right}px ${s.bottom}px ${s.left}px`;
  if (inset === lastInset) return;
  lastInset = inset;
  el.style.inset = inset;
  globalThis.dispatchEvent(new Event('worms-safearea'));
}

// ------------------------------------------------------------- приглашение

/**
 * Комната из ссылки-приглашения.
 *
 * В Telegram ссылка выглядит как t.me/бот?startapp=КОД, и код приезжает в
 * start_param — адресной строки, куда можно дописать ?room=, внутри
 * клиента просто нет. Снаружи работает обычный ?room=.
 */
export function startRoom() {
  const p = tgApi()?.initDataUnsafe?.start_param;
  if (p && /^[A-Z0-9]{4,10}$/i.test(p)) return p.toUpperCase();
  return new URLSearchParams(location.search).get('room');
}

/**
 * Ссылка-приглашение в комнату.
 *
 * В Telegram, если бот назван, — глубокая ссылка t.me: друг откроет игру
 * внутри клиента под своим аккаунтом. Ссылка на сайт открыла бы Safari,
 * где он был бы анонимом с другим рейтингом. Вне Telegram — адрес сайта
 * с ?room=, как и раньше.
 */
export function inviteLink(room) {
  const { bot, app } = telegramConfig();
  if (bot && inTelegram()) {
    const base = app ? `https://t.me/${bot}/${app}` : `https://t.me/${bot}`;
    return `${base}?startapp=${encodeURIComponent(room)}`;
  }
  const url = new URL(location.href);
  url.searchParams.set('room', room);
  return url.toString();
}

/**
 * Позвать друга в бой.
 *
 * В Telegram — родным выбором чата: жмёшь, выбираешь, туда улетает ссылка.
 * Это две-три секунды против «скопируй и куда-то вставь». Инлайн-режим
 * (switchInlineQuery) сюда не годится: на инлайн-запрос должен ответить
 * сервер бота, а его нет. Снаружи Telegram возвращаем false, и вызывающий
 * копирует ссылку сам.
 */
export function shareRoom(room, link = inviteLink(room)) {
  const tg = tgApi();
  if (!tg?.openTelegramLink) return false;
  const text = `Го в Worms! Комната ${room}`;
  try {
    const url = `https://t.me/share/url?url=${encodeURIComponent(link)}`
      + `&text=${encodeURIComponent(text)}`;
    tg.openTelegramLink(url);
    return true;
  } catch (e) {
    console.warn('[telegram] поделиться не вышло', e);
    return false;
  }
}

// --------------------------------------------------------- на экран Домой

/**
 * Состояние иконки на домашнем экране:
 *   unsupported — клиент без Bot API 8.0 или платформа не умеет;
 *   unknown     — платформа не может сказать (тогда предлагать можно);
 *   added       — уже стоит;
 *   missed      — не стоит, можно предложить.
 */
let homeState = 'unsupported';
const homeListeners = new Set();

export function homeScreenState() { return homeState; }

export function onHomeScreenChange(fn) {
  homeListeners.add(fn);
  return () => homeListeners.delete(fn);
}

function setHomeState(state) {
  if (state === homeState) return;
  homeState = state;
  for (const fn of homeListeners) {
    try { fn(state); } catch (e) { console.warn('[telegram] home listener', e); }
  }
}

function refreshHomeState() {
  const tg = tgApi();
  if (!tg?.checkHomeScreenStatus || !tg.addToHomeScreen) return setHomeState('unsupported');
  try {
    tg.checkHomeScreenStatus((status) => setHomeState(status || 'unknown'));
  } catch {
    setHomeState('unsupported');
  }
}

/** Можно ли сейчас предложить иконку. */
export function canOfferHomeScreen() {
  return inTelegram() && (homeState === 'missed' || homeState === 'unknown');
}

/** Показать родное предложение Telegram поставить иконку. */
export function addToHomeScreen() {
  const tg = tgApi();
  if (!canOfferHomeScreen()) return false;
  try {
    tg.addToHomeScreen();
    return true;
  } catch (e) {
    console.warn('[telegram] addToHomeScreen', e);
    return false;
  }
}

const OFFERED_KEY = 'worms.home.offered';

/**
 * Предложить иконку один раз — после первой доигранной партии. Отметка
 * «уже предлагали» лежит в CloudStorage: иначе после переустановки
 * клиента предложение всплывало бы снова.
 */
export async function offerHomeScreenOnce() {
  if (!canOfferHomeScreen()) return false;
  if (await cloudGet(OFFERED_KEY)) return false;
  await cloudSet(OFFERED_KEY, '1');
  return addToHomeScreen();
}

// ---------------------------------------------------------- CloudStorage

/**
 * Хранилище Telegram, привязанное к аккаунту: рейтинг едет за человеком
 * на другой телефон и в веб-клиент. Вне Telegram — localStorage под тем
 * же ключом, чтобы вызывающему было всё равно, где он.
 */
export function cloudGet(key) {
  const cs = tgApi()?.CloudStorage;
  if (!cs?.getItem) {
    try { return Promise.resolve(localStorage.getItem(key)); } catch { return Promise.resolve(null); }
  }
  return new Promise((resolve) => {
    // Хранилище может не ответить (нет сети, старый клиент): игра не
    // должна ждать его вечно
    const timer = setTimeout(() => resolve(null), 1500);
    try {
      cs.getItem(key, (err, value) => {
        clearTimeout(timer);
        resolve(err ? null : (value || null));
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

export function cloudSet(key, value) {
  const cs = tgApi()?.CloudStorage;
  if (!cs?.setItem) {
    try { localStorage.setItem(key, value); } catch { /* инкогнито */ }
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 1500);
    try {
      cs.setItem(key, String(value), (err, ok) => {
        clearTimeout(timer);
        resolve(!err && ok !== false);
      });
    } catch {
      clearTimeout(timer);
      resolve(false);
    }
  });
}

/** Короткая вибрация на попадание и на нажатие — в Telegram это родное. */
export function haptic(kind = 'light') {
  const h = tgApi()?.HapticFeedback;
  if (!h) return;
  try {
    if (kind === 'hit') h.impactOccurred('medium');
    else if (kind === 'win') h.notificationOccurred('success');
    else if (kind === 'lose') h.notificationOccurred('error');
    else h.impactOccurred('light');
  } catch { /* старый клиент — просто без отдачи */ }
}
