import { CFG, DEPTH, TEAM_COLORS } from '../config.js';

/**
 * Указатели на бойцов, оказавшихся за краем экрана.
 *
 * Карта втрое шире вида, и без этого противник просто теряется: игрок не
 * знает, куда вести камеру. Стрелка прижимается к краю экрана в направлении
 * бойца, красится в цвет команды, рядом — расстояние в метрах (32 px = 1 м,
 * как в оригинале) и здоровье.
 */
export class OffscreenMarkers {
  constructor(scene) {
    this.scene = scene;
    this.gfx = scene.rig.ui(scene.add.graphics().setScrollFactor(0).setDepth(DEPTH.HUD - 1));
    this.labels = [];
  }

  update() {
    const scene = this.scene;
    const m = CFG.CAM_EDGE_MARGIN;
    this.gfx.clear();

    // Раскладываем по столбикам у краёв. Класть указатель на высоту бойца
    // нельзя: бойцы стоят примерно на одном уровне, и метки слипаются.
    const left = [];
    const right = [];
    for (const w of scene.worms) {
      if (!w.alive) continue;
      const sx = scene.rig.screenX(w.x);
      if (sx < m) left.push(w);
      else if (sx > CFG.VIEW_W - m) right.push(w);
    }

    const from = scene.turn.activeWorm;
    let used = 0;
    used = this._column(left, true, from, used);
    used = this._column(right, false, from, used);
    for (let i = used; i < this.labels.length; i++) this.labels[i].setVisible(false);
  }

  _column(worms, isLeft, from, used) {
    const dir = isLeft ? -1 : 1;
    const x = isLeft ? 30 : CFG.VIEW_W - 30;
    let y = 96;

    for (const w of worms) {
      const color = TEAM_COLORS[w.team % TEAM_COLORS.length];
      const active = w === this.scene.turn.activeWorm;

      // Треугольник остриём в сторону бойца
      this.gfx.fillStyle(color, active ? 1 : 0.85);
      this.gfx.beginPath();
      this.gfx.moveTo(x + dir * 13, y);
      this.gfx.lineTo(x - dir * 8, y - 11);
      this.gfx.lineTo(x - dir * 8, y + 11);
      this.gfx.closePath();
      this.gfx.fillPath();
      if (active) {
        this.gfx.lineStyle(2, 0xffffff, 0.9);
        this.gfx.strokePath();
      }

      // Расстояние считаем от того, кто ходит: это и есть нужная игроку цифра.
      // 32 px = 1 метр, как в оригинале.
      const dist = from ? Math.round(Math.abs(w.x - from.x) / 32) : 0;
      const text = from && w !== from ? `${w.health} · ${dist}м` : `${w.health}`;
      this._label(used++, x - dir * 24, y, text, color, isLeft ? 0 : 1);
      y += 30;
    }
    return used;
  }

  _label(i, x, y, text, color, originX) {
    if (!this.labels[i]) {
      this.labels[i] = this.scene.add.text(0, 0, '', {
        fontFamily: 'monospace', fontSize: '12px',
        stroke: '#0d1018', strokeThickness: 3,
      }).setScrollFactor(0).setDepth(DEPTH.HUD - 1);
      this.scene.rig.ui(this.labels[i]);
    }
    const l = this.labels[i];
    l.setOrigin(originX, 0.5);
    l.setVisible(true).setPosition(x, y).setText(text);
    l.setColor(`#${color.toString(16).padStart(6, '0')}`);
  }

  destroy() {
    this.gfx.destroy();
    for (const l of this.labels) l.destroy();
  }
}
