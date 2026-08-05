import { CFG, DEPTH, TEAM_COLORS } from '../config.js';
import { has, meta } from '../core/assets.js';
import { font } from '../ui/theme.js';

/**
 * Боец. Прямоугольник CFG.WORM_W x CFG.WORM_H.
 *
 * Координата (x, y): x — центр по горизонтали, y — нижняя грань (ноги).
 * Занимаемые строки: y - H + 1 ... y. Опора — строка y + 1.
 *
 * Коллизия — попиксельно по маске ландшафта:
 *   • подъём по склону не выше CFG.STEP_UP за шаг, иначе стена;
 *   • падение выше CFG.FALL_SAFE наносит урон.
 */
export class Worm {
  constructor(scene, x, y, team, index) {
    this.scene = scene;
    this.terrain = scene.terrain;
    this.team = team;
    this.index = index;
    this.name = `${team + 1}-${index + 1}`;

    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;

    this.health = CFG.MAX_HEALTH;
    this.alive = true;
    this.grounded = false;
    this.facing = 1;
    this.walking = false;
    this.fallStartY = y;

    this._buildView();
  }

  _buildView() {
    const s = this.scene;
    const color = TEAM_COLORS[this.team % TEAM_COLORS.length];
    this.sprited = has(s, 'worm_idle');

    if (this.sprited) {
      // Спрайты WA нарисованы «мордой влево», ноги — не по низу кадра,
      // поэтому точка привязки берётся из sprite-meta.
      const m = meta('worm');
      this.view = s.add.sprite(this.x, this.y, 'worm_idle');
      this.view.setOrigin(0.5, m.originY);
      this.view.play('worm_idle');
      this.anim = 'worm_idle';
    } else {
      this.view = s.add.rectangle(this.x, this.y, CFG.WORM_W, CFG.WORM_H, color);
      this.view.setStrokeStyle(2, 0x141821, 0.85);
      this.view.setOrigin(0.5, 1);
      this.eye = s.add.rectangle(this.x, this.y - CFG.WORM_H + 9, 5, 5, 0x141821)
        .setDepth(DEPTH.WORM + 1);
    }
    s.rig.world(this.view.setDepth(DEPTH.WORM));
    if (this.eye) s.rig.world(this.eye);

    // Червяки в оригинале одинаковые, поэтому команду показываем цветом
    // числа здоровья и полоской под ним — как в самой игре.
    this.label = s.add.text(this.x, this.y - CFG.WORM_H - 20, `${this.health}`,
      font(15, 800, hexColor(color))).setOrigin(0.5, 0.5).setDepth(DEPTH.WORM + 2);
    s.rig.world(this.label);

    this.barBg = s.add.rectangle(this.x, this.y - CFG.WORM_H - 6, HP_BAR_W + 2, 5, 0x101420, 0.85)
      .setOrigin(0.5, 0.5).setDepth(DEPTH.WORM + 2);
    s.rig.world(this.barBg);
    this.bar = s.add.rectangle(this.x - HP_BAR_W / 2, this.y - CFG.WORM_H - 6, HP_BAR_W, 3, color)
      .setOrigin(0, 0.5).setDepth(DEPTH.WORM + 3);
    s.rig.world(this.bar);

    const markerKey = `marker_${this.team % 2}`;
    if (has(s, markerKey)) {
      this.marker = s.add.sprite(this.x, this.y - CFG.WORM_H - 40, markerKey)
        .setDepth(DEPTH.WORM + 2).setVisible(false);
      s.rig.world(this.marker);
      this.marker.play(markerKey);
      this.markerSprited = true;
    } else {
      this.marker = s.rig.world(s.add.triangle(this.x, this.y - CFG.WORM_H - 40, 0, 0, 14, 0, 7, 12, color)
        .setDepth(DEPTH.WORM + 2).setVisible(false));
    }
  }

  /** Переключить анимацию, если она отличается от текущей. */
  _setAnim(key) {
    if (!this.sprited || this.anim === key) return;
    this.anim = key;
    this.view.play(key, true);
  }

  // ------------------------------------------------------------ геометрия

  get left() { return Math.round(this.x) - (CFG.WORM_W >> 1); }
  get right() { return Math.round(this.x) + (CFG.WORM_W >> 1) - 1; }
  get top() { return Math.round(this.y) - CFG.WORM_H + 1; }
  get centerY() { return this.y - CFG.WORM_H / 2; }

  containsPoint(px, py) {
    return px >= this.left && px <= this.right && py >= this.top && py <= this.y;
  }

  /** Свободен ли прямоугольник бойца в позиции (cx, cy). */
  rectClear(cx, cy) {
    const hw = CFG.WORM_W >> 1;
    return !this.terrain.solidInRect(
      Math.round(cx) - hw + 1, Math.round(cy) - CFG.WORM_H + 1,
      Math.round(cx) + hw - 1, Math.round(cy),
    );
  }

  /** Есть ли твердь прямо под ногами. */
  supported(cx, cy) {
    const hw = CFG.WORM_W >> 1;
    return this.terrain.solidInRow(
      Math.round(cx) - hw + 2, Math.round(cx) + hw - 2, Math.round(cy) + 1,
    );
  }

  // ------------------------------------------------------------- механика

  update(dt) {
    if (!this.alive) return;

    if (this.grounded && !this.supported(this.x, this.y)) {
      // Под ногами взорвали землю
      this.grounded = false;
      this.fallStartY = this.y;
    }

    if (this.grounded) {
      this.vy = 0;
      const damp = Math.exp(-CFG.GROUND_FRICTION * dt);
      this.vx *= damp;
      if (Math.abs(this.vx) < 6) this.vx = 0;
      if (this.vx !== 0) this._slideStep(dt);
    } else {
      this._airStep(dt);
    }

    if (this.y > CFG.DROWN_Y) this._drown();

    this._syncView();
  }

  /** Ходьба по команде игрока. Возвращает true, если сдвинулся. */
  walk(dir, dt) {
    if (!this.alive || !this.grounded) return false;
    this.facing = dir;
    this.walking = true;

    let remaining = CFG.WALK_SPEED * dt;
    let moved = false;

    while (remaining > 0) {
      const step = Math.min(1, remaining);
      remaining -= step;
      const nx = this.x + dir * step;

      // 1. Ровно / вверх по склону, не выше STEP_UP
      let done = false;
      for (let dy = 0; dy >= -CFG.STEP_UP; dy--) {
        const ny = this.y + dy;
        if (this.rectClear(nx, ny) && this.supported(nx, ny)) {
          this.x = nx; this.y = ny; moved = true; done = true; break;
        }
      }
      if (done) continue;

      // 2. Вниз по склону, не глубже STEP_UP — иначе начинаем падать
      if (this.rectClear(nx, this.y)) {
        let landed = false;
        for (let dy = 1; dy <= CFG.STEP_UP; dy++) {
          const ny = this.y + dy;
          if (this.rectClear(nx, ny) && this.supported(nx, ny)) {
            this.x = nx; this.y = ny; landed = true; moved = true; break;
          }
        }
        if (landed) continue;

        this.x = nx;
        this.grounded = false;
        this.fallStartY = this.y;
        return true;
      }

      // 3. Стена
      break;
    }

    this._clampToWorld();
    return moved;
  }

  jump(dir = this.facing) {
    if (!this.alive || !this.grounded) return;
    this.grounded = false;
    this.fallStartY = this.y;
    this.vy = CFG.JUMP_VY;
    this.vx = dir * CFG.JUMP_VX;
  }

  /** Импульс от взрыва. */
  applyImpulse(ix, iy) {
    if (!this.alive) return;
    if (this.grounded) this.fallStartY = this.y;
    this.grounded = false;
    this.vx += ix;
    this.vy += iy;
  }

  /** Скольжение по земле после несильного толчка. */
  _slideStep(dt) {
    const dir = Math.sign(this.vx);
    let remaining = Math.abs(this.vx) * dt;
    while (remaining > 0) {
      const step = Math.min(1, remaining);
      remaining -= step;
      const nx = this.x + dir * step;
      let done = false;
      for (let dy = 0; dy >= -CFG.STEP_UP; dy--) {
        const ny = this.y + dy;
        if (this.rectClear(nx, ny) && this.supported(nx, ny)) {
          this.x = nx; this.y = ny; done = true; break;
        }
      }
      if (done) continue;
      if (this.rectClear(nx, this.y)) {
        this.x = nx;
        this.grounded = false;
        this.fallStartY = this.y;
        return;
      }
      this.vx = 0;
      break;
    }
    this._clampToWorld();
  }

  /** Полёт: те же мелкие подшаги, что и у снаряда. */
  _airStep(dt) {
    const sdt = dt / CFG.SUBSTEPS;
    for (let i = 0; i < CFG.SUBSTEPS && this.alive && !this.grounded; i++) {
      this.vy += CFG.GRAVITY * sdt;
      this.vx *= Math.exp(-CFG.AIR_FRICTION * sdt);

      const dx = this.vx * sdt;
      const dy = this.vy * sdt;
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
      const stepX = dx / steps;
      const stepY = dy / steps;

      for (let s = 0; s < steps; s++) {
        // Горизонталь
        const nx = this.x + stepX;
        if (this.rectClear(nx, this.y)) {
          this.x = nx;
        } else {
          // Пробуем перешагнуть выступ, иначе гасим горизонтальную скорость
          let slid = false;
          for (let dyy = -1; dyy >= -CFG.STEP_UP; dyy--) {
            if (this.rectClear(nx, this.y + dyy)) {
              this.x = nx; this.y += dyy; slid = true; break;
            }
          }
          if (!slid) this.vx *= -0.25;
        }

        // Вертикаль
        const ny = this.y + stepY;
        if (this.rectClear(this.x, ny)) {
          this.y = ny;
        } else if (stepY > 0) {
          this._land();
          break;
        } else {
          this.vy = 0;
          break;
        }
      }
      this._clampToWorld();
    }
  }

  _land() {
    this.grounded = true;
    const drop = this.y - this.fallStartY;
    this.vy = 0;
    this.vx *= 0.3;
    if (drop > CFG.FALL_SAFE) {
      const dmg = Math.min(CFG.FALL_DMG_MAX, (drop - CFG.FALL_SAFE) * CFG.FALL_DMG_PER_PX);
      this.damage(Math.round(dmg), 'падение');
    }
  }

  _clampToWorld() {
    const hw = CFG.WORM_W >> 1;
    if (this.x < hw) { this.x = hw; this.vx = 0; }
    if (this.x > this.terrain.width - hw) { this.x = this.terrain.width - hw; this.vx = 0; }
  }

  _drown() {
    this.scene.fx.splash(this.x, CFG.WATER_Y);
    this.health = 0;
    this.kill('утонул');
  }

  damage(amount, cause = '') {
    if (!this.alive || amount <= 0) return;
    this.health = Math.max(0, this.health - amount);
    this.scene.fx.damageNumber(this.x, this.centerY - 10, amount);
    if (this.health <= 0) this.kill(cause);
  }

  heal(amount) {
    if (!this.alive) return;
    this.health = Math.min(CFG.MAX_HEALTH, this.health + amount);
  }

  kill(cause = '') {
    if (!this.alive) return;
    this.alive = false;
    this.health = 0;
    this.marker.setVisible(false);
    this.scene.onWormDied(this, cause);

    const s = this.scene;
    const gx = Math.round(this.x), gy = Math.round(this.y);
    s.tweens.add({
      targets: [this.view, this.label, this.bar, this.barBg, this.eye].filter(Boolean),
      alpha: 0,
      y: '+=6',
      duration: 400,
      onComplete: () => {
        this.view.destroy();
        this.label.destroy();
        this.bar.destroy();
        this.barBg.destroy();
        if (this.eye) this.eye.destroy();
        this.marker.destroy();
        this._placeGrave(gx, gy);
      },
    });
  }

  /** Надгробие на месте гибели — если под ним осталась земля. */
  _placeGrave(x, y) {
    const s = this.scene;
    if (!has(s, 'grave')) return;
    const top = this.terrain.surfaceYAt(x, Math.max(0, y - 60));
    if (top === null || top > CFG.DROWN_Y) return;
    const grave = s.rig.world(s.add.image(x, top + 1, 'grave')
      .setOrigin(0.5, 1).setDepth(DEPTH.WORM - 1).setAlpha(0));
    s.tweens.add({ targets: grave, alpha: 1, duration: 300 });
  }

  setActiveMarker(on) {
    if (!this.alive) return;
    this.marker.setVisible(on);
  }

  get settled() {
    return !this.alive || (this.grounded && Math.abs(this.vx) < 4);
  }

  _syncView() {
    const rx = Math.round(this.x);
    const ry = Math.round(this.y);
    this.view.setPosition(rx, ry);

    // Спрайты нарисованы мордой влево, поэтому отражаем при движении вправо
    if (this.view.setFlipX) this.view.setFlipX(this.sprited ? this.facing > 0 : this.facing < 0);

    if (this.sprited) {
      if (!this.grounded) this._setAnim('worm_fall');
      else if (this.walking) this._setAnim('worm_walk');
      else this._setAnim('worm_idle');
    }

    if (this.eye) this.eye.setPosition(rx + this.facing * 6, ry - CFG.WORM_H + 9);

    this.label.setPosition(rx, ry - CFG.WORM_H - 20);
    this.label.setText(`${this.health}`);
    this.barBg.setPosition(rx, ry - CFG.WORM_H - 7);
    this.bar.setPosition(rx - HP_BAR_W / 2, ry - CFG.WORM_H - 7);
    this.bar.width = HP_BAR_W * (this.health / CFG.MAX_HEALTH);

    if (this.marker.visible) {
      const bob = Math.sin(this.scene.time.now / 220) * 4;
      const dx = this.markerSprited ? 0 : -7;
      this.marker.setPosition(rx + dx, ry - CFG.WORM_H - 30 + bob);
    }
    this.walking = false;
  }
}

/** Ширина полоски здоровья над бойцом. */
const HP_BAR_W = 26;

function hexColor(n) {
  return `#${n.toString(16).padStart(6, '0')}`;
}
