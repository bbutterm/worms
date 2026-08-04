import { CFG, DEPTH } from '../config.js';
import { has } from '../core/assets.js';

/**
 * Прицеливание и протяжка камеры.
 *
 * Схем две, работают одновременно:
 *
 * 1. Кнопочная (основная, удобна на телефоне): угол крутится кнопками ▲▼
 *    и хранится в сцене, сила набирается удержанием «Огонь». Здесь эта
 *    схема только рисуется — прицел на луче от бойца и траектория, пока
 *    идёт набор силы. Палец при этом лежит в углу экрана и ничего не
 *    закрывает.
 * 2. Свайп по бойцу: направление задаёт угол, длина — силу, отпустили =
 *    выстрел. Быстрее на мыши, но на тач-экране кисть накрывает поле.
 *
 * В обоих случаях подсказка — первые CFG.TRAJ_POINTS точек реальной
 * траектории (та же математика, что в Projectile, с учётом ветра и
 * параметров оружия), обрезанная по столкновению с землёй.
 */
export class AimController {
  constructor(scene) {
    this.scene = scene;
    this.mode = null;          // 'aim' | 'pan' | null
    this.startX = 0; this.startY = 0;
    this.dragX = 0; this.dragY = 0;
    this.camStart = 0;

    this.gfx = scene.add.graphics().setDepth(DEPTH.AIM);
    this.info = scene.add.text(0, 0, '', {
      fontFamily: 'monospace', fontSize: '14px', color: '#ffffff',
      stroke: '#0d1018', strokeThickness: 4,
    }).setOrigin(0.5, 1).setDepth(DEPTH.AIM);
    this.info.setVisible(false);

    scene.input.on('pointerdown', this.onDown, this);
    scene.input.on('pointermove', this.onMove, this);
    scene.input.on('pointerup', this.onUp, this);
    scene.input.on('pointerupoutside', this.onUp, this);
  }

  get worm() { return this.scene.turn.activeWorm; }

  origin() {
    const w = this.worm;
    return w ? { x: w.x, y: w.centerY } : { x: 0, y: 0 };
  }

  onDown(pointer) {
    if (this.scene.hud.isOverUI(pointer)) return;

    const w = this.worm;
    const canAim = this.scene.canPlayerAct() && w && w.alive;
    const o = this.origin();
    const near = canAim && Math.hypot(pointer.worldX - o.x, pointer.worldY - o.y) <= CFG.AIM_GRAB_RADIUS;

    if (near) {
      this.mode = 'aim';
      this.startX = pointer.worldX;
      this.startY = pointer.worldY;
      this.dragX = 0; this.dragY = 0;
    } else {
      this.mode = 'pan';
      this.startX = pointer.x;
      this.camStart = this.scene.cameras.main.scrollX;
      this.scene.setCameraManual(true);
    }
  }

  onMove(pointer) {
    if (!this.mode || !pointer.isDown) return;

    if (this.mode === 'pan') {
      const cam = this.scene.cameras.main;
      cam.scrollX = Phaser.Math.Clamp(
        this.camStart - (pointer.x - this.startX) / cam.zoom,
        0, this.scene.terrain.width - CFG.VIEW_W,
      );
      return;
    }

    this.dragX = pointer.worldX - this.startX;
    this.dragY = pointer.worldY - this.startY;
  }

  onUp() {
    if (this.mode === 'aim') {
      const shot = this.computeShot();
      if (shot) {
        // Синхронизируем угол кнопочной схемы со свайпом, иначе после
        // выстрела свайпом ▲▼ продолжали бы крутить со старого значения
        const w = this.worm;
        if (w) {
          w.facing = shot.vx >= 0 ? 1 : -1;
          this.scene.aimAngle = Phaser.Math.Clamp(
            Math.atan2(-shot.vy, Math.abs(shot.vx)),
            -CFG.AIM_ANGLE_LIMIT, CFG.AIM_ANGLE_LIMIT,
          );
        }
        this.scene.fireActiveWorm(shot.vx, shot.vy);
      }
    }
    this.mode = null;
    this.dragX = 0; this.dragY = 0;
    this.gfx.clear();
    this.info.setVisible(false);
  }

  cancel() {
    this.mode = null;
    this.dragX = 0; this.dragY = 0;
    this.gfx.clear();
    this.info.setVisible(false);
  }

  /** Вектор выстрела из текущего свайпа, либо null, если свайп слишком короткий. */
  computeShot() {
    const len = Math.hypot(this.dragX, this.dragY);
    if (len < CFG.AIM_MIN_DRAG) return null;

    const sign = CFG.AIM_INVERT ? -1 : 1;
    const dirX = (this.dragX / len) * sign;
    const dirY = (this.dragY / len) * sign;
    const power = Math.min(len, CFG.AIM_MAX_DRAG) / CFG.AIM_MAX_DRAG * CFG.AIM_MAX_POWER;

    return {
      vx: dirX * power,
      vy: dirY * power,
      power,
      angle: Math.atan2(-dirY, dirX),
    };
  }

  update() {
    this.gfx.clear();
    const w = this.worm;
    if (!w || !this.scene.canPlayerAct()) {
      this.info.setVisible(false);
      if (this.crosshair) this.crosshair.setVisible(false);
      return;
    }

    // Свайп имеет приоритет; иначе показываем прицел кнопочной схемы
    if (this.mode === 'aim') this._drawSwipe();
    else this._drawButtonAim();
  }

  /** Прицел и — во время набора силы — траектория для кнопочной схемы. */
  _drawButtonAim() {
    const scene = this.scene;
    const o = this.origin();
    const d = scene.aimDirection();
    const weapon = scene.turn.weapon;

    this._ensureCrosshair();
    this.crosshair.setVisible(true);
    this.crosshair.setPosition(o.x + d.x * CFG.AIM_RAY_LEN, o.y + d.y * CFG.AIM_RAY_LEN);

    this.gfx.lineStyle(2, 0xffffff, 0.28);
    this.gfx.lineBetween(o.x + d.x * 16, o.y + d.y * 16,
      o.x + d.x * (CFG.AIM_RAY_LEN - 12), o.y + d.y * (CFG.AIM_RAY_LEN - 12));

    if (!scene.charging || scene.charge <= 0) { this.info.setVisible(false); return; }

    const speed = scene.charge * CFG.AIM_MAX_POWER;
    const sx = o.x + d.x * CFG.MUZZLE_OFFSET;
    const sy = o.y + d.y * CFG.MUZZLE_OFFSET;
    this._drawTrajectory(sx, sy, d.x * speed, d.y * speed, weapon);

    const deg = Math.round((scene.aimAngle * 180) / Math.PI);
    this.info.setText(`${deg}°  ${Math.round(scene.charge * 100)}%`);
    this.info.setPosition(o.x, o.y - 42);
    this.info.setVisible(true);
  }

  _ensureCrosshair() {
    const s = this.scene;
    const team = s.turn.currentTeam % 2;
    if (this.crosshair && this.crosshairTeam === team) return;

    const key = `crosshair_${team}`;
    if (!this.crosshair) {
      this.crosshair = has(s, key)
        ? s.add.image(0, 0, key).setDepth(DEPTH.AIM)
        : s.add.circle(0, 0, 6).setStrokeStyle(2, 0xffffff, 0.8).setDepth(DEPTH.AIM);
    } else if (this.crosshair.setTexture && has(s, key)) {
      this.crosshair.setTexture(key); // прицел перекрашивается под команду
    }
    this.crosshairTeam = team;
  }

  _drawTrajectory(sx, sy, vx, vy, weapon) {
    const pts = this.simulate(sx, sy, vx, vy, weapon);
    for (let i = 0; i < pts.length; i++) {
      const a = 0.95 - (i / CFG.TRAJ_POINTS) * 0.6;
      const r = 3.4 - (i / CFG.TRAJ_POINTS) * 1.4;
      this.gfx.fillStyle(weapon.color, a);
      this.gfx.fillCircle(pts[i].x, pts[i].y, r);
    }
  }

  _drawSwipe() {
    if (this.crosshair) this.crosshair.setVisible(false);
    const shot = this.computeShot();
    if (!shot) { this.info.setVisible(false); return; }

    const o = this.origin();
    const weapon = this.scene.turn.weapon;
    const nx = shot.vx / Math.hypot(shot.vx, shot.vy);
    const ny = shot.vy / Math.hypot(shot.vx, shot.vy);
    const sx = o.x + nx * CFG.MUZZLE_OFFSET;
    const sy = o.y + ny * CFG.MUZZLE_OFFSET;

    // Пунктирная траектория — первые CFG.TRAJ_POINTS точек
    this._drawTrajectory(sx, sy, shot.vx, shot.vy, weapon);

    // Линия силы от бойца
    this.gfx.lineStyle(2, 0xffffff, 0.35);
    this.gfx.lineBetween(o.x, o.y, o.x + nx * 46, o.y + ny * 46);

    const pct = Math.round((shot.power / CFG.AIM_MAX_POWER) * 100);
    const deg = Math.round((shot.angle * 180) / Math.PI);
    this.info.setText(`${deg}°  ${pct}%`);
    this.info.setPosition(o.x, o.y - 42);
    this.info.setVisible(true);
  }

  /** Та же интеграция, что и у снаряда, но без разрушений. */
  simulate(x, y, vx, vy, weapon) {
    const p = weapon.projectile;
    const terrain = this.scene.terrain;
    const wind = this.scene.wind;
    const out = [];
    let px = x, py = y;

    for (let i = 0; i < CFG.TRAJ_POINTS; i++) {
      for (let s = 0; s < CFG.TRAJ_STEP; s++) {
        vx += wind * p.windScale * CFG.TRAJ_DT;
        vy += CFG.GRAVITY * p.gravityScale * CFG.TRAJ_DT;
        if (p.drag > 0) {
          const f = Math.exp(-p.drag * CFG.TRAJ_DT);
          vx *= f; vy *= f;
        }
        const nx2 = px + vx * CFG.TRAJ_DT;
        const ny2 = py + vy * CFG.TRAJ_DT;
        const ray = terrain.raycast(px, py, nx2, ny2);
        px = nx2; py = ny2;
        if (ray.hit || py > terrain.height || px < 0 || px > terrain.width) {
          out.push({ x: ray.x, y: ray.y });
          return out;
        }
      }
      out.push({ x: px, y: py });
    }
    return out;
  }

  destroy() {
    const i = this.scene.input;
    i.off('pointerdown', this.onDown, this);
    i.off('pointermove', this.onMove, this);
    i.off('pointerup', this.onUp, this);
    i.off('pointerupoutside', this.onUp, this);
    this.gfx.destroy();
    this.info.destroy();
    if (this.crosshair) this.crosshair.destroy();
  }
}
