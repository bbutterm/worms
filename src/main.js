import { CFG } from './config.js';
import BootScene from './scenes/BootScene.js';
import GameScene from './scenes/GameScene.js';
import { initTelegram } from './platform/telegram.js';

initTelegram();

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
    activePointers: 2,
  },
  scene: [BootScene, GameScene],
});

window.__WORMS__ = game;
