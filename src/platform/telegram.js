/**
 * Интеграция с Telegram WebApp. В обычном браузере — no-op.
 * Вызывается один раз до старта игры.
 */
export function initTelegram() {
  const tg = tgApi();
  if (!tg) return null;

  try {
    tg.ready();
    tg.expand();
    if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
    if (tg.setHeaderColor) tg.setHeaderColor('#0b1021');
    if (tg.setBackgroundColor) tg.setBackgroundColor('#0b1021');
    // Игра ландшафтная — просим клиент не крутить экран, если умеет
    if (tg.lockOrientation) tg.lockOrientation();
    // Полный экран появился в Bot API 8.0; на старых клиентах метода нет
    if (tg.requestFullscreen) tg.requestFullscreen();
  } catch (e) {
    console.warn('[telegram] init failed', e);
  }
  return tg;
}

export function tgApi() {
  return globalThis.Telegram?.WebApp ?? null;
}

export function inTelegram() {
  return Boolean(tgApi()?.initData || tgApi()?.initDataUnsafe?.user);
}

/**
 * Комната из ссылки-приглашения.
 *
 * В Telegram ссылка выглядит как t.me/бот/игра?startapp=КОД, и код
 * приезжает в start_param — адресной строки, куда можно дописать ?room=,
 * внутри клиента просто нет. Снаружи работает обычный ?room=.
 */
export function startRoom() {
  const p = tgApi()?.initDataUnsafe?.start_param;
  if (p && /^[A-Z0-9]{4,10}$/i.test(p)) return p.toUpperCase();
  return new URLSearchParams(location.search).get('room');
}

/**
 * Позвать друга в бой.
 *
 * В Telegram — родным выбором контакта: жмёшь, выбираешь чат, туда
 * улетает ссылка. Это две-три секунды против «скопируй и куда-то вставь».
 * Снаружи Telegram возвращаем false, и вызывающий копирует ссылку сам.
 */
export function shareRoom(room, link) {
  const tg = tgApi();
  if (!tg) return false;
  const text = `Го в Worms! Комната ${room}`;
  try {
    if (tg.switchInlineQuery) {
      tg.switchInlineQuery(room, ['users', 'groups']);
      return true;
    }
    if (tg.openTelegramLink) {
      const url = `https://t.me/share/url?url=${encodeURIComponent(link)}`
        + `&text=${encodeURIComponent(text)}`;
      tg.openTelegramLink(url);
      return true;
    }
  } catch (e) {
    console.warn('[telegram] поделиться не вышло', e);
  }
  return false;
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
