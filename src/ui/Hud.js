import { CFG, DEPTH, TEAM_COLORS, TEAM_NAMES } from '../config.js';
import { WEAPONS } from '../weapons/index.js';

/**
 * Весь интерфейс: таймер хода, ветер, здоровье команд, выбор оружия, тач-кнопки.
 * Все элементы закреплены за камерой через setScrollFactor(0) —
 * без Container, чтобы хит-тест интерактивных кнопок был предсказуемым.
 */
export class Hud {
  constructor(scene) {
    this.scene = scene;
    this.uiRects = [];
    this.weaponButtons = [];
    this.moveButtons = [];

    const W = CFG.VIEW_W;
    const fix = (o, d = DEPTH.HUD) => o.setScrollFactor(0).setDepth(d);

    // --- верхняя панель ---
    // Раскладка по колонкам, чтобы блоки гарантированно не наезжали:
    //   16..300 ход · 320..430 таймер · 450..820 здоровье команд · 1000..1264 ветер
    fix(scene.add.rectangle(0, 0, W, 54, 0x0d1220, 0.78).setOrigin(0, 0));

    this.turnText = fix(scene.add.text(16, 8, '', {
      fontFamily: 'monospace', fontSize: '16px', color: '#ffffff',
    }));
    this.biomeText = fix(scene.add.text(16, 30, '', {
      fontFamily: 'monospace', fontSize: '12px', color: '#93a4bd',
    }));

    // Таймер
    const tx = 375;
    this.timerText = fix(scene.add.text(tx, 4, '30', {
      fontFamily: 'monospace', fontSize: '26px', color: '#ffffff',
    }).setOrigin(0.5, 0));
    fix(scene.add.rectangle(tx - 55, 44, 110, 5, 0x2b3550).setOrigin(0, 0.5));
    this.timerBar = fix(scene.add.rectangle(tx - 55, 44, 110, 5, 0x6ee36e).setOrigin(0, 0.5));
    this.timerBarWidth = 110;

    // Ветер
    fix(scene.add.text(W - 16, 4, 'ВЕТЕР', {
      fontFamily: 'monospace', fontSize: '12px', color: '#93a4bd',
    }).setOrigin(1, 0));
    this.windText = fix(scene.add.text(W - 16, 20, '0', {
      fontFamily: 'monospace', fontSize: '17px', color: '#ffffff',
    }).setOrigin(1, 0));
    this.windGfx = fix(scene.add.graphics());
    this.windCx = W - 190;

    // --- здоровье команд ---
    this.teamBars = [];
    for (let t = 0; t < CFG.TEAMS; t++) {
      const x = 460 + t * 190;
      fix(scene.add.text(x, 6, TEAM_NAMES[t], {
        fontFamily: 'monospace', fontSize: '13px', color: '#cfd8e8',
      }));
      fix(scene.add.rectangle(x, 34, 170, 11, 0x2b3550).setOrigin(0, 0.5));
      const bar = fix(scene.add.rectangle(x, 34, 170, 11, TEAM_COLORS[t]).setOrigin(0, 0.5));
      const cnt = fix(scene.add.text(x + 170, 6, '', {
        fontFamily: 'monospace', fontSize: '12px', color: '#93a4bd',
      }).setOrigin(1, 0));
      this.teamBars.push({ bar, cnt, max: CFG.MAX_HEALTH * CFG.WORMS_PER_TEAM, width: 170 });
    }

    // --- выбор оружия ---
    const bw = 92, bh = 46, gap = 8;
    const totalW = WEAPONS.length * bw + (WEAPONS.length - 1) * gap;
    let bx = (W - totalW) / 2;
    const by = CFG.VIEW_H - bh - 14;

    for (let i = 0; i < WEAPONS.length; i++) {
      const weapon = WEAPONS[i];
      const rect = fix(scene.add.rectangle(bx, by, bw, bh, 0x121a2c, 0.9).setOrigin(0, 0));
      rect.setStrokeStyle(2, 0x2f3d5c);
      rect.setInteractive({ useHandCursor: true });
      rect.on('pointerdown', () => scene.turn.setWeaponIndex(i));

      const icon = fix(scene.add.text(bx + bw / 2, by + 7, weapon.icon, {
        fontFamily: 'monospace', fontSize: '18px', color: '#ffffff',
      }).setOrigin(0.5, 0), DEPTH.HUD + 1);
      const name = fix(scene.add.text(bx + bw / 2, by + 29, weapon.name, {
        fontFamily: 'monospace', fontSize: '11px', color: '#a9b6cd',
      }).setOrigin(0.5, 0), DEPTH.HUD + 1);
      fix(scene.add.text(bx + 5, by + 3, `${i + 1}`, {
        fontFamily: 'monospace', fontSize: '10px', color: '#6b7a95',
      }), DEPTH.HUD + 1);

      this.weaponButtons.push({ rect, icon, name });
      this.uiRects.push({ x: bx, y: by, w: bw, h: bh });
      bx += bw + gap;
    }

    // --- тач-кнопки движения ---
    this._makeHoldButton(24, CFG.VIEW_H - 86, 64, 64, '◀', 'left');
    this._makeHoldButton(96, CFG.VIEW_H - 86, 64, 64, '▶', 'right');
    this._makeHoldButton(60, CFG.VIEW_H - 158, 64, 64, '▲', 'jump');

    this.hint = fix(scene.add.text(W - 16, CFG.VIEW_H - 16,
      'свайп по бойцу — выстрел\nтяни фон — камера · 1..4 — оружие', {
        fontFamily: 'monospace', fontSize: '12px', color: '#7c8aa5', align: 'right',
      }).setOrigin(1, 1));

    scene.input.on('pointerup', this._releaseAll, this);
    scene.input.on('pointerupoutside', this._releaseAll, this);
  }

  _makeHoldButton(x, y, w, h, glyph, action) {
    const s = this.scene;
    const rect = s.add.rectangle(x, y, w, h, 0x121a2c, 0.75).setOrigin(0, 0)
      .setScrollFactor(0).setDepth(DEPTH.HUD);
    rect.setStrokeStyle(2, 0x2f3d5c);
    rect.setInteractive({ useHandCursor: true });
    s.add.text(x + w / 2, y + h / 2, glyph, {
      fontFamily: 'monospace', fontSize: '22px', color: '#cfd8e8',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.HUD + 1);

    rect.on('pointerdown', () => {
      if (action === 'jump') s.moveInput.jumpQueued = true;
      else s.moveInput[action] = true;
      rect.setFillStyle(0x1e2a45, 0.9);
    });
    const release = () => {
      if (action !== 'jump') s.moveInput[action] = false;
      rect.setFillStyle(0x121a2c, 0.75);
    };
    rect.on('pointerup', release);
    rect.on('pointerout', release);

    this.moveButtons.push({ rect, release });
    this.uiRects.push({ x, y, w, h });
  }

  _releaseAll() {
    for (const b of this.moveButtons) b.release();
  }

  /** Попал ли указатель в интерфейс — тогда это не прицеливание и не камера. */
  isOverUI(pointer) {
    const px = pointer.x, py = pointer.y;
    if (py < 54) return true; // верхняя панель
    for (const r of this.uiRects) {
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return true;
    }
    return false;
  }

  setWeaponIndex(i) {
    for (let k = 0; k < this.weaponButtons.length; k++) {
      const b = this.weaponButtons[k];
      const on = k === i;
      b.rect.setStrokeStyle(2, on ? WEAPONS[k].color : 0x2f3d5c);
      b.rect.setFillStyle(on ? 0x1c2942 : 0x121a2c, 0.9);
      b.icon.setColor(on ? '#ffffff' : '#8f9db6');
      b.name.setColor(on ? '#e6ecf7' : '#7c8aa5');
    }
  }

  update() {
    const scene = this.scene;
    const turn = scene.turn;

    const team = turn.currentTeam;
    const worm = turn.activeWorm;
    this.turnText.setText(`Ход: ${TEAM_NAMES[team]}${worm ? ` · боец ${worm.name}` : ''}`);
    this.turnText.setColor(hex(TEAM_COLORS[team]));
    this.biomeText.setText(`${scene.terrain.biome.name} · ${turn.weapon.name}`);

    const left = Math.max(0, turn.timeLeft);
    this.timerText.setText(Math.ceil(left).toString());
    this.timerText.setColor(left <= 5 ? '#ff6b6b' : '#ffffff');
    this.timerBar.width = this.timerBarWidth * Phaser.Math.Clamp(left / CFG.TURN_TIME, 0, 1);
    this.timerBar.fillColor = left <= 5 ? 0xff6b6b : left <= 12 ? 0xffd166 : 0x6ee36e;

    const wind = scene.wind;
    this.windText.setText(`${wind > 0 ? '→' : wind < 0 ? '←' : '·'} ${Math.abs(Math.round(wind))}`);
    this.windGfx.clear();
    const cx = this.windCx, cy = 30, half = 55;
    this.windGfx.fillStyle(0x2b3550, 1).fillRect(cx - half, cy - 5, half * 2, 10);
    const k = Phaser.Math.Clamp(wind / CFG.WIND_MAX, -1, 1);
    this.windGfx.fillStyle(k >= 0 ? 0x6ecbff : 0xffa46e, 1);
    if (k >= 0) this.windGfx.fillRect(cx, cy - 5, half * k, 10);
    else this.windGfx.fillRect(cx + half * k, cy - 5, -half * k, 10);
    this.windGfx.fillStyle(0xffffff, 0.9).fillRect(cx - 1, cy - 9, 2, 18);

    for (let t = 0; t < CFG.TEAMS; t++) {
      const living = scene.worms.filter((w) => w.team === t && w.alive);
      const total = living.reduce((a, w) => a + w.health, 0);
      const b = this.teamBars[t];
      b.bar.width = b.width * Phaser.Math.Clamp(total / b.max, 0, 1);
      b.cnt.setText(`${living.length}/${CFG.WORMS_PER_TEAM}`);
    }
  }
}

function hex(n) {
  return `#${n.toString(16).padStart(6, '0')}`;
}
