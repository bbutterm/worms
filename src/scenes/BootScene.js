import { IMAGES, SHEETS, missing } from '../core/assets.js';

/**
 * Загрузка спрайтов. Отсутствие любого файла не ломает игру:
 * ключ помечается как missing, и вместо спрайта рисуется плейсхолдер.
 */
export default class BootScene extends Phaser.Scene {
  constructor() { super('Boot'); }

  preload() {
    const W = this.scale.width, H = this.scale.height;
    this.add.rectangle(0, 0, W, H, 0x0b1021).setOrigin(0, 0);
    const label = this.add.text(W / 2, H / 2, 'Загрузка…', {
      fontFamily: 'monospace', fontSize: '20px', color: '#93a4bd',
    }).setOrigin(0.5);

    this.load.on('loaderror', (file) => missing.add(file.key));
    this.load.on('progress', (p) => label.setText(`Загрузка… ${Math.round(p * 100)}%`));

    for (const [key, path] of Object.entries(IMAGES)) {
      this.load.image(key, path);
    }
    for (const [key, def] of Object.entries(SHEETS)) {
      this.load.spritesheet(key, def.path, {
        frameWidth: def.frameWidth,
        frameHeight: def.frameHeight,
      });
    }
  }

  create() {
    for (const [key, def] of Object.entries(SHEETS)) {
      if (missing.has(key) || !this.textures.exists(key)) continue;
      const frames = this.textures.get(key).frameTotal - 1; // минус служебный __BASE
      for (const [animKey, a] of Object.entries(def.anims)) {
        if (this.anims.exists(animKey)) continue;
        const end = a.end < 0 ? frames - 1 : a.end;
        if (end < a.start) continue;
        this.anims.create({
          key: animKey,
          frames: this.anims.generateFrameNumbers(key, { start: a.start, end }),
          frameRate: a.frameRate,
          repeat: a.repeat,
        });
      }
    }

    const total = Object.keys(IMAGES).length + Object.keys(SHEETS).length;
    if (missing.size) {
      console.info(
        `[assets] загружено ${total - missing.size}/${total}. ` +
        `Плейсхолдеры для: ${[...missing].join(', ')}`,
      );
    }

    this.scene.start('Game');
  }
}
