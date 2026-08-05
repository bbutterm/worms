import { CFG } from '../config.js';

/**
 * Просчёт полёта снаряда без самого снаряда.
 *
 * Бот не «знает» правильный ответ и не читает его из формулы: он гоняет тот
 * же интегратор, что и настоящий снаряд, по той же маске земли. Формулы
 * баллистики тут не хватило бы — остров дырявый, между стволом и целью
 * бывает холм, и попадание решает именно рельеф.
 *
 * Считается только прямой полёт: отскоки гранаты и бурение крота не
 * моделируются, поэтому бот и стреляет ими лишь тогда, когда прямая
 * траектория и так упирается в цель.
 */

const DT = 1 / 60;
const SUBSTEPS = 2;              // вдвое меньше, чем в игре: точности хватает
const MAX_TIME = 8;              // дольше снаряд всё равно не живёт

/**
 * @returns {{kind:'terrain'|'worm'|'water'|'out', x:number, y:number,
 *            worm:object|null, time:number}}
 */
export function simulateShot(scene, x0, y0, vx, vy, weapon, ignoreWorm = null) {
  const terrain = scene.terrain;
  const p = weapon.projectile;
  const wind = scene.wind;

  let x = x0, y = y0;
  const sub = DT / SUBSTEPS;

  for (let t = 0; t < MAX_TIME; t += DT) {
    for (let s = 0; s < SUBSTEPS; s++) {
      vx += wind * (p.windScale ?? 1) * sub;
      vy += CFG.GRAVITY * (p.gravityScale ?? 1) * sub;
      if (p.drag > 0) {
        const f = Math.exp(-p.drag * sub);
        vx *= f; vy *= f;
      }

      const nx = x + vx * sub;
      const ny = y + vy * sub;

      if (nx < -80 || nx > terrain.width + 80 || ny > terrain.height + 120) {
        const kind = ny > CFG.WATER_Y && nx > 0 && nx < terrain.width ? 'water' : 'out';
        return { kind, x: nx, y: ny, worm: null, time: t };
      }

      const hitWorm = wormAt(scene, nx, ny, ignoreWorm);
      if (hitWorm) return { kind: 'worm', x: nx, y: ny, worm: hitWorm, time: t };

      const ray = terrain.raycast(x, y, nx, ny);
      if (ray.hit) {
        const kind = ray.y >= CFG.WATER_Y ? 'water' : 'terrain';
        return { kind, x: ray.x, y: ray.y, worm: null, time: t };
      }
      x = nx; y = ny;
    }
  }
  return { kind: 'out', x, y, worm: null, time: MAX_TIME };
}

function wormAt(scene, x, y, ignore) {
  for (const w of scene.worms) {
    if (!w.alive || w === ignore) continue;
    if (w.containsPoint(x, y)) return w;
  }
  return null;
}

/**
 * Точка вылета: та же, что у настоящего выстрела, — иначе бот считал бы
 * траекторию из точки, в которой снаряда никогда не будет.
 */
export function muzzle(scene, worm, dx, dy) {
  const ray = scene.terrain.raycast(
    worm.x, worm.centerY,
    worm.x + dx * CFG.MUZZLE_OFFSET, worm.centerY + dy * CFG.MUZZLE_OFFSET,
  );
  return ray.hit ? { x: ray.freeX, y: ray.freeY } : { x: ray.x, y: ray.y };
}
