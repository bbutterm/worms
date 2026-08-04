import { CFG, DEPTH } from '../config.js';
import { has } from '../core/assets.js';

/** Визуальные эффекты: взрывы, брызги, всплывающие числа урона. */
export class Fx {
  constructor(scene) {
    this.scene = scene;
  }

  explosion(x, y, radius) {
    const s = this.scene;

    // Взрыв из оригинала собирается из двух примитивов: белая вспышка
    // (кадр 0 fx_flash), оранжевое кольцо (кадр 3) и облачка дыма.
    if (has(s, 'fx_flash')) {
      const flash = s.add.sprite(x, y, 'fx_flash', 0).setDepth(DEPTH.FX);
      flash.setDisplaySize(radius * 2.2, radius * 2.2).setScale(flash.scaleX * 0.35);
      const full = radius * 2.2;
      s.tweens.add({
        targets: flash, displayWidth: full, displayHeight: full, alpha: 0,
        duration: 260, ease: 'Quad.easeOut', onComplete: () => flash.destroy(),
      });

      const ring = s.add.sprite(x, y, 'fx_flash', 3).setDepth(DEPTH.FX);
      ring.setDisplaySize(radius * 0.7, radius * 0.7);
      s.tweens.add({
        targets: ring, displayWidth: radius * 3, displayHeight: radius * 3, alpha: 0,
        duration: 360, ease: 'Cubic.easeOut', onComplete: () => ring.destroy(),
      });

      if (has(s, 'fx_smoke') && s.anims.exists('fx_smoke')) {
        const puffs = Math.max(3, Math.round(radius / 12));
        for (let i = 0; i < puffs; i++) {
          const a = (i / puffs) * Math.PI * 2 + Math.random();
          const d = radius * (0.2 + Math.random() * 0.7);
          const puff = s.add.sprite(x + Math.cos(a) * d, y + Math.sin(a) * d, 'fx_smoke')
            .setDepth(DEPTH.FX - 1);
          puff.setDisplaySize(radius * 1.1, radius * 1.1);
          puff.play({ key: 'fx_smoke', startFrame: Math.floor(Math.random() * 4) });
          puff.once('animationcomplete', () => puff.destroy());
        }
      }
      return;
    }

    // Плейсхолдер: вспышка + разлетающиеся искры
    const flash = s.add.circle(x, y, radius, 0xfff1c1).setDepth(DEPTH.FX).setScale(0.4);
    s.tweens.add({
      targets: flash, scale: 1.5, alpha: 0, duration: 280,
      ease: 'Quad.easeOut', onComplete: () => flash.destroy(),
    });

    const ring = s.add.circle(x, y, radius).setDepth(DEPTH.FX).setScale(0.25);
    ring.setStrokeStyle(4, 0xff9a3c, 0.9);
    ring.setFillStyle(0xff6a2c, 0.35);
    s.tweens.add({
      targets: ring, scale: 1.7, alpha: 0,
      duration: 340, ease: 'Cubic.easeOut', onComplete: () => ring.destroy(),
    });

    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = radius * (0.6 + Math.random() * 1.1);
      const p = s.add.circle(x, y, 2 + Math.random() * 3, 0xffc46b).setDepth(DEPTH.FX);
      s.tweens.add({
        targets: p,
        x: x + Math.cos(a) * d,
        y: y + Math.sin(a) * d,
        alpha: 0,
        duration: 300 + Math.random() * 300,
        ease: 'Quad.easeOut',
        onComplete: () => p.destroy(),
      });
    }
  }

  splash(x, y = CFG.WATER_Y) {
    const s = this.scene;
    for (let i = 0; i < 8; i++) {
      const p = s.add.circle(x, y, 2 + Math.random() * 3, 0x9fd8ff, 0.9).setDepth(DEPTH.FX);
      s.tweens.add({
        targets: p,
        x: x + (Math.random() - 0.5) * 70,
        y: y - 30 - Math.random() * 50,
        alpha: 0,
        duration: 420 + Math.random() * 220,
        ease: 'Quad.easeOut',
        onComplete: () => p.destroy(),
      });
    }
  }

  damageNumber(x, y, amount) {
    const s = this.scene;
    const t = s.add.text(x, y, `-${amount}`, {
      fontFamily: 'monospace', fontSize: '18px', color: '#ff8a8a',
      stroke: '#20141a', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(DEPTH.FX + 1);
    s.tweens.add({
      targets: t, y: y - 46, alpha: 0, duration: 900,
      ease: 'Quad.easeOut', onComplete: () => t.destroy(),
    });
  }

  banner(text, color = '#ffffff', duration = 1600) {
    const s = this.scene;
    const t = s.add.text(CFG.VIEW_W / 2, 190, text, {
      fontFamily: 'monospace', fontSize: '34px', color,
      stroke: '#0d1018', strokeThickness: 7, align: 'center',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.HUD + 5);
    t.setScale(0.7);
    s.tweens.add({ targets: t, scale: 1, duration: 220, ease: 'Back.easeOut' });
    s.tweens.add({
      targets: t, alpha: 0, delay: duration - 400, duration: 400,
      onComplete: () => t.destroy(),
    });
    return t;
  }
}
