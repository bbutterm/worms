import { CFG, fitViewToScreen } from './config.js';
import BootScene from './scenes/BootScene.js';
import MenuScene from './scenes/MenuScene.js';
import GameScene from './scenes/GameScene.js';
import { initTelegram } from './platform/telegram.js';

initTelegram();

// Логическая ширина подгоняется под пропорции экрана ДО создания игры:
// иначе на вытянутом телефоне 16:9 вписывается с чёрными полями по бокам
// (на замере — 29% ширины впустую). Высота остаётся 720, поэтому вся
// геометрия мира, физика и генерация ландшафта не меняются вовсе.
fitViewToScreen(window.innerWidth, window.innerHeight);

// Шрифт должен приехать ДО первого текста: Phaser меряет и кеширует
// метрики при создании, и текст, созданный на запасном шрифте, так и
// останется криво расположенным.
await loadUiFont();

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
const online = new URLSearchParams(location.search).has('room');

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
