import { CFG, fitViewToScreen } from './config.js';
import BootScene from './scenes/BootScene.js';
import MenuScene from './scenes/MenuScene.js';
import GameScene from './scenes/GameScene.js';
import { initTelegram, startRoom } from './platform/telegram.js';
import { loadCloudProfile } from './platform/player.js';

initTelegram();

// Логическая ширина подгоняется под пропорции экрана ДО создания игры:
// иначе на вытянутом телефоне 16:9 вписывается с чёрными полями по бокам
// (на замере — 29% ширины впустую). Высота остаётся 720, поэтому вся
// геометрия мира, физика и генерация ландшафта не меняются вовсе.
fitViewToScreen(...gameArea());

// Шрифт должен приехать ДО первого текста: Phaser меряет и кеширует
// метрики при создании, и текст, созданный на запасном шрифте, так и
// останется криво расположенным. Профиль из облака Telegram — тоже до
// старта: имя и рейтинг читаются синхронно, второго шанса подменить их нет.
await Promise.all([loadUiFont(), loadCloudProfile()]);

/**
 * Размер игрового поля. Это не окно: #game отступает от краёв экрана на
 * безопасную область («чёлка», кнопки Telegram), и пропорции считаются
 * от того, что осталось.
 */
function gameArea() {
  const r = document.getElementById('game')?.getBoundingClientRect();
  if (r && r.width > 0 && r.height > 0) return [r.width, r.height];
  return [window.innerWidth, window.innerHeight];
}

async function loadUiFont() {
  if (!document.fonts) return;
  try {
    await Promise.all([
      document.fonts.load('800 32px "Worms UI"', 'Ход1'),
      document.fonts.load('700 32px "Worms UI"', 'Ход1'),
    ]);
  } catch (e) {
    console.warn('[ui] шрифт не загрузился, будет запасной', e);
  }
}

/**
 * Ни Arcade, ни Matter, ни Impact — блок `physics` в конфиге отсутствует
 * намеренно. Вся физика в src/entities и src/core написана вручную.
 */
// В одиночной игре пауза при уходе со вкладки — то, что нужно. В сетевой
// она вредна: соперник продолжает ходить, а у нас останавливается вообще
// всё, включая показ его выстрела и отправку собственного итога хода.
const online = Boolean(startRoom());

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: CFG.VIEW_W,
  height: CFG.VIEW_H,
  backgroundColor: '#0b1021',
  disableVisibilityChange: online,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: {
    antialias: true,
    roundPixels: false,
  },
  input: {
    // Три, а не два: Phaser отдаёт под касания указатели с индекса 1 и
    // строго меньше activePointers, поэтому при 2 второй палец не
    // регистрируется вовсе и пинч не работает.
    activePointers: 3,
  },
  scene: [BootScene, MenuScene, GameScene],
});

window.__WORMS__ = game;

/**
 * Пересчёт размера при смене экрана.
 *
 * Логический размер считается из пропорций окна, а окно на телефоне живёт
 * своей жизнью: панель браузера то появляется, то уезжает, телефон
 * поворачивают. Посчитать один раз при запуске мало — стоит высоте
 * измениться, и Phaser.Scale.FIT начинает вписывать старые пропорции в
 * новые, оставляя чёрные поля по краям.
 *
 * Мелкие колебания игнорируем: пересборка интерфейса не бесплатная, а
 * пара пикселей на глаз всё равно не видна.
 */
let refitTimer = 0;
function refit() {
  const before = CFG.VIEW_W;
  fitViewToScreen(...gameArea());
  // Сдвиг игрового поля меняет его размер без события resize у окна:
  // Phaser надо попросить перемерить родителя самому
  game.scale.refresh();
  if (Math.abs(CFG.VIEW_W - before) < 24) return;
  // Именно setGameSize: resize() меняет размер, но не пересчитывает
  // пропорции, под которые вписывается канвас, — поля остаются на месте.
  game.scale.setGameSize(CFG.VIEW_W, CFG.VIEW_H);
  game.events.emit('worms-resize', CFG.VIEW_W, CFG.VIEW_H);
}
function scheduleRefit(delay) {
  clearTimeout(refitTimer);
  refitTimer = setTimeout(refit, delay);
}
window.addEventListener('resize', () => scheduleRefit(200));
// Поворот телефона: размеры окна доезжают не сразу, поэтому ждём дольше
window.addEventListener('orientationchange', () => scheduleRefit(500));
// Telegram сообщил новые отступы безопасной области
window.addEventListener('worms-safearea', () => scheduleRefit(50));
