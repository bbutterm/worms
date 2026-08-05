import { CFG, fitViewToScreen } from './config.js';
import BootScene from './scenes/BootScene.js';
import GameScene from './scenes/GameScene.js';
import { initTelegram } from './platform/telegram.js';

initTelegram();

// Логическая ширина подгоняется под пропорции экрана ДО создания игры:
// иначе на вытянутом телефоне 16:9 вписывается с чёрными полями по бокам
// (на замере — 29% ширины впустую). Высота остаётся 720, поэтому вся
// геометрия мира, физика и генерация ландшафта не меняются вовсе.
fitViewToScreen(window.innerWidth, window.innerHeight);

/**
 * Ни Arcade, ни Matter, ни Impact — блок `physics` в конфиге отсутствует
 * намеренно. Вся физика в src/entities и src/core написана вручную.
 */
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: CFG.VIEW_W,
  height: CFG.VIEW_H,
  backgroundColor: '#0b1021',
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
  scene: [BootScene, GameScene],
});

window.__WORMS__ = game;
