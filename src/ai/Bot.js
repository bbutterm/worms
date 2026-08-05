import { CFG } from '../config.js';
import { WEAPONS } from '../weapons/index.js';
import { simulateShot, muzzle } from './ballistics.js';

/**
 * Бот.
 *
 * Ход бота выглядит как ход человека: он поворачивается к цели, поднимает
 * ствол, набирает силу и стреляет — теми же методами сцены, что и игрок.
 * Отдельного «читерского» пути в игру у него нет: он не двигает снаряд
 * руками и не знает, где окажется взрыв, — только считает.
 *
 * Как выбирается выстрел:
 *   1. цель — живой чужой боец, ближние и раненые ценнее;
 *   2. по сетке углов и сил гоняется настоящая траектория (ballistics.js),
 *      каждая оценивается по тому, куда снаряд реально прилетел;
 *   3. лучший вариант уточняется мелким шагом вокруг найденного;
 *   4. к нему добавляется промах по уровню сложности — иначе снайпер
 *      попадал бы всегда, и играть было бы не с кем.
 *
 * Уровни различаются не «читом», а точностью и терпением: слабый бот
 * перебирает грубее, ошибается сильнее и стреляет только базукой.
 */

export const BOT_LEVELS = {
  rookie: {
    id: 'rookie', name: 'Новичок',
    angleErr: 0.10, powerErr: 0.13, coarse: 7, refine: 0,
    weapons: ['bazooka'], selfRisk: 90,
  },
  fighter: {
    id: 'fighter', name: 'Боец',
    angleErr: 0.045, powerErr: 0.06, coarse: 11, refine: 1,
    weapons: ['bazooka', 'grenade', 'cluster'], selfRisk: 70,
  },
  sniper: {
    id: 'sniper', name: 'Снайпер',
    angleErr: 0.015, powerErr: 0.02, coarse: 15, refine: 2,
    weapons: ['bazooka', 'grenade', 'cluster', 'mole'], selfRisk: 55,
  },
};

export class Bot {
  constructor(scene, level = 'fighter') {
    this.scene = scene;
    this.level = BOT_LEVELS[level] ?? BOT_LEVELS.fighter;
    this.reset();
  }

  reset() {
    this.plan = null;
    this.phase = 'idle';
    this.timer = 0;
  }

  /**
   * Ход бота по шагам, чтобы он не «телепортировал» выстрел: сначала пауза
   * на раздумье, потом видимый доворот прицела, потом сам выстрел.
   */
  update(dt) {
    const scene = this.scene;
    const worm = scene.turn.activeWorm;
    if (!worm || !worm.alive) return;

    this.timer += dt;

    switch (this.phase) {
      case 'idle':
        this.phase = 'think';
        this.timer = 0;
        break;

      case 'think':
        if (this.timer < CFG.BOT_THINK) break;
        this.plan = this.decide(worm);
        if (!this.plan) { this.phase = 'give-up'; this.timer = 0; break; }
        worm.facing = this.plan.facing;
        scene.turn.setWeaponIndex(this.plan.weapon);
        this.phase = 'aim';
        this.timer = 0;
        break;

      case 'aim': {
        // Доводим ствол с той же скоростью, с какой это делает игрок
        const diff = this.plan.angle - scene.aimAngle;
        const step = CFG.AIM_ANGLE_RATE * dt;
        if (Math.abs(diff) <= step) {
          scene.aimAngle = this.plan.angle;
          this.phase = 'charge';
          this.timer = 0;
        } else {
          scene.aimAngle += Math.sign(diff) * step;
        }
        break;
      }

      case 'charge':
        // Заряд копится видимо, как у игрока на удержании кнопки
        if (!scene.charging) scene.beginCharge();
        if (scene.charge >= this.plan.power) {
          scene.releaseCharge();
          this.phase = 'done';
        }
        break;

      case 'give-up':
        // Стрелять некуда — не зависаем, отдаём ход
        if (this.timer > 0.6) { scene.turn.endTurn(); this.phase = 'done'; }
        break;

      default:
        break;
    }
  }

  /** @returns {{angle:number, power:number, facing:number, weapon:number}|null} */
  decide(worm) {
    const targets = this.scene.worms
      .filter((w) => w.alive && w.team !== worm.team)
      .sort((a, b) => this.targetScore(worm, a) - this.targetScore(worm, b));
    if (!targets.length) return null;

    let best = null;
    for (const target of targets.slice(0, 2)) {
      for (const weaponIndex of this.weaponChoices()) {
        const shot = this.solve(worm, target, weaponIndex);
        if (shot && (!best || shot.score < best.score)) best = shot;
        // Хорошее попадание искать дальше незачем
        if (best && best.score < 12) break;
      }
      if (best && best.score < 12) break;
    }
    if (!best) return null;

    // Промах по уровню. Врать в оценке нельзя — врём в исполнении, ровно
    // как человек, у которого дрогнула рука.
    const rng = this.scene.turnRng;
    const angle = best.angle + (rng() * 2 - 1) * this.level.angleErr;
    const power = Math.min(1, Math.max(CFG.CHARGE_MIN + 0.05,
      best.power * (1 + (rng() * 2 - 1) * this.level.powerErr)));
    return { angle, power, facing: best.facing, weapon: best.weapon };
  }

  /** Меньше — привлекательнее: ближние и раненые. */
  targetScore(worm, target) {
    const d = Math.hypot(target.x - worm.x, target.y - worm.y);
    return d + target.health * 4;
  }

  /** Доступное оружие этого уровня, в порядке предпочтения. */
  weaponChoices() {
    const out = [];
    for (let i = 0; i < WEAPONS.length; i++) {
      if (!this.level.weapons.includes(WEAPONS[i].id)) continue;
      if (this.scene.turn.ammoOf(i) <= 0) continue;
      out.push(i);
    }
    return out;
  }

  /**
   * Перебор углов и сил с уточнением вокруг лучшего.
   * Считается на одном ходу один раз, не в каждом кадре.
   */
  solve(worm, target, weaponIndex) {
    const weapon = WEAPONS[weaponIndex];
    const facing = target.x >= worm.x ? 1 : -1;
    const lo = -CFG.AIM_ANGLE_LIMIT, hi = CFG.AIM_ANGLE_LIMIT;

    let best = null;
    const tryShot = (angle, power) => {
      const dx = Math.cos(angle) * facing;
      const dy = -Math.sin(angle);
      const m = muzzle(this.scene, worm, dx, dy);
      const speed = power * CFG.AIM_MAX_POWER;
      const res = simulateShot(this.scene, m.x, m.y, dx * speed, dy * speed, weapon, worm);
      const score = this.scoreShot(res, target, worm, weapon);
      if (!best || score < best.score) best = { angle, power, facing, weapon: weaponIndex, score };
    };

    const n = this.level.coarse;
    for (let i = 0; i < n; i++) {
      const angle = lo + ((hi - lo) * i) / (n - 1);
      for (let p = 0.35; p <= 1.001; p += 0.1625) tryShot(angle, p);
    }
    if (!best) return null;

    let stepA = (hi - lo) / (n - 1) / 2;
    let stepP = 0.08;
    for (let r = 0; r < this.level.refine; r++) {
      const { angle, power } = best;
      for (const da of [-stepA, 0, stepA]) {
        for (const dp of [-stepP, 0, stepP]) {
          const a = Math.min(hi, Math.max(lo, angle + da));
          const p = Math.min(1, Math.max(0.2, power + dp));
          tryShot(a, p);
        }
      }
      stepA /= 2; stepP /= 2;
    }
    return best;
  }

  /**
   * Оценка результата: насколько близко к цели легло и не заденет ли своих.
   * Меряется расстояние от точки разрыва до центра цели — прямое попадание
   * в бойца отдельно поощряется.
   */
  scoreShot(res, target, self, weapon) {
    if (res.kind === 'out') return 5000;
    const dist = Math.hypot(res.x - target.x, res.y - target.centerY);
    let score = res.kind === 'water' ? dist + 800 : dist;
    if (res.kind === 'worm') {
      score = res.worm.team === self.team ? 4000 : Math.max(0, dist - 30);
    }

    // Самоподрыв: попадание рядом со своими хуже промаха
    const r = weapon.explosion.damageRadius;
    for (const w of this.scene.worms) {
      if (!w.alive || w.team !== self.team) continue;
      const d = Math.hypot(res.x - w.x, res.y - w.centerY);
      if (d < r) score += (1 - d / r) * this.level.selfRisk * 10;
    }
    return score;
  }
}
