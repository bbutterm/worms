/**
 * Интеграция с Telegram WebApp. В обычном браузере — no-op.
 * Вызывается один раз до старта игры.
 */
export function initTelegram() {
  const tg = window.Telegram && window.Telegram.WebApp;
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
