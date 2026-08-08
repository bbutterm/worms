import { Projectile } from '../entities/Projectile.js';

/**
 * Базовый класс оружия.
 *
 * Оружие — это описание снаряда + описание взрыва + поведение при попадании.
 * Чтобы добавить новое: наследуемся (или просто создаём Weapon с другим
 * конфигом) и регистрируем в weapons/index.js.
 */
export class Weapon {
  constructor(cfg) {
    this.id = cfg.id;
    this.name = cfg.name;
    this.icon = cfg.icon ?? '•';
    this.color = cfg.color ?? 0xffffff;
    this.spriteKey = cfg.spriteKey ?? null;
    this.iconKey = cfg.iconKey ?? null;
    // null = бесконечно (базука), число = стартовый запас на команду
    this.startAmmo = cfg.startAmmo ?? null;
    this.crateAmmo = cfg.crateAmmo ?? 2;   // сколько даёт ящик
    // Раздел в инвентаре: с четырьмя стволами хватало одного ряда,
    // с дюжиной нужны полки
    this.category = cfg.category ?? 'взрывное';
    // Сколько выстрелов даёт один ход. У дробовика два, ход после первого
    // не заканчивается.
    this.shots = cfg.shots ?? 1;
    // Мгновенное оружие: попадание считается лучом сразу, снаряда нет
    this.instant = cfg.instant ?? false;
    // Сколько секунд даётся на отход после применения. Нужно тому, что
    // кладётся под ноги: иначе ход кончается там же, где лежит заряд.
    this.retreat = cfg.retreat ?? 0;
    // Кадры спрайтшита — предрассчитанные повороты, а не анимация
    this.rotational = cfg.rotational ?? false;

    // Параметры полёта
    this.projectile = Object.assign({
      radius: 4,          // визуальный радиус
      gravityScale: 1,    // множитель к CFG.GRAVITY
      windScale: 1,       // множитель к ветру
      drag: 0,            // экспоненциальное сопротивление воздуха, 1/с
      bounciness: 0,      // 0 = взрывается от удара, >0 = отскакивает
      friction: 0.75,     // касательное трение при отскоке
      fuse: 0,            // сек до самоподрыва (0 = только от удара)
      digRadius: 0,       // >0 — бурит землю вместо взрыва при касании
      digTime: 0,         // сколько секунд бурит
      trail: true,
    }, cfg.projectile);

    // Параметры взрыва
    this.explosion = Object.assign({
      radius: 40,         // радиус воронки в земле
      damageRadius: 70,   // радиус поражения (обычно больше воронки)
      damage: 45,         // урон в эпицентре, дальше линейно спадает
      knockback: 300,     // импульс отбрасывания в эпицентре
      shake: 0.006,
    }, cfg.explosion);
  }

  /** Снаряды, вылетающие при выстреле. Обычно один. */
  fire(scene, x, y, vx, vy, owner) {
    return [new Projectile(scene, x, y, vx, vy, this, owner)];
  }

  /**
   * Реакция на касание земли / истечение фитиля.
   * По умолчанию — взрыв. Может вернуть массив новых снарядов.
   */
  onDetonate(scene, projectile, x, y) {
    scene.explode(x, y, this.explosion, projectile.owner);
    return null;
  }
}

/**
 * Мгновенное оружие: дробовик, бита.
 *
 * Снаряда нет вовсе — попадание считается лучом в тот же кадр. Луч идёт
 * шагами по 2 px и останавливается на первом, что встретит: чужом бойце
 * или земле. Своего стрелка пропускаем — ствол начинается внутри него.
 *
 * Возвращает пустой список снарядов, и это важно: сцена по нему поймёт,
 * что ждать нечего, и сразу перейдёт к разбору хода.
 */
export class InstantWeapon extends Weapon {
  constructor(cfg) {
    super({ ...cfg, instant: true });
    this.range = cfg.range ?? 600;
  }

  fire(scene, x, y, vx, vy, owner) {
    const len = Math.hypot(vx, vy) || 1;
    const dx = vx / len, dy = vy / len;

    let hx = x, hy = y;
    for (let d = 0; d <= this.range; d += 2) {
      hx = x + dx * d;
      hy = y + dy * d;
      if (hx < 0 || hx > scene.terrain.width || hy > scene.terrain.height) break;

      const worm = scene.worms.find(
        (w) => w.alive && w !== owner && w.containsPoint(hx, hy),
      );
      if (worm) break;
      if (scene.terrain.solidAt(hx, hy)) break;
    }

    scene.drawBeam(x, y, hx, hy, this.color);
    this.onBeamHit(scene, hx, hy, dx, dy, owner);
    return [];
  }

  /** Что происходит в точке попадания. По умолчанию — обычный взрыв. */
  onBeamHit(scene, x, y, dx, dy, owner) {
    scene.explode(x, y, this.explosion, owner);
  }
}

/**
 * Бита: земля цела, зато отправляет в полёт.
 *
 * Урон небольшой, весь смысл — в толчке: сбросить соседа в воду стоит
 * дешевле любого снаряда.
 */
export class BatWeapon extends InstantWeapon {
  /**
   * Бита бьёт не лучом, а размахом перед собой.
   *
   * Лучом она почти никогда не попадала: прицел в начале хода стоит на 45°,
   * и тонкая линия уходила соседу над головой. Игрок видел взмах и полное
   * отсутствие последствий. Поэтому цель ищется в секторе перед бойцом —
   * по дальности от него самого и по стороне, куда он повёрнут, — а угол
   * прицела задаёт только направление толчка.
   */
  fire(scene, x, y, vx, vy, owner) {
    const len = Math.hypot(vx, vy) || 1;
    const dx = vx / len, dy = vy / len;
    const side = dx >= 0 ? 1 : -1;
    const ox = owner ? owner.x : x;
    const oy = owner ? owner.centerY : y;

    scene.drawBeam(ox, oy, ox + side * this.range, oy - this.range * 0.3, this.color);

    let hit = 0;
    for (const w of scene.worms) {
      if (!w.alive || w === owner) continue;
      const gapX = (w.x - ox) * side;               // впереди, а не за спиной
      const gapY = Math.abs(w.centerY - oy);
      if (gapX < -6 || gapX > this.range) continue;
      if (gapY > this.range * 0.8) continue;
      // Бьём в сторону удара и вверх — иначе цель просто вжимается в землю
      w.applyImpulse(dx * this.explosion.knockback,
        -Math.abs(this.explosion.knockback) * 0.55);
      w.damage(this.explosion.damage, 'бита');
      hit++;
    }

    scene.fx.explosion(ox + side * 18, oy - 6, hit ? 16 : 8);
    scene.rig.shake(120, 0.003);
    return [];
  }
}

/**
 * Оружие, которое кладут под ноги, а не бросают: динамит, мина.
 *
 * Сила заряда для него не значит ничего — предмет появляется там, где
 * стоит боец, с нулевой скоростью. Точку вылета сцена всё равно посчитает,
 * но мы её игнорируем: иначе динамит улетал бы вперёд на длину ствола.
 */
export class PlacedWeapon extends Weapon {
  fire(scene, x, y, vx, vy, owner) {
    const px = owner ? owner.x : x;
    const py = owner ? owner.centerY : y;
    return [new Projectile(scene, px, py, 0, 0, this, owner)];
  }
}

/**
 * Мина: не снаряд, а предмет на карте.
 *
 * Возвращаем пустой список снарядов — ждать в этом ходу нечего, мина
 * сработает когда-нибудь потом. Сам предмет живёт в списке сцены, рядом
 * с ящиками: список снарядов чистится в конце хода, мина бы не пережила.
 */
export class MineWeapon extends Weapon {
  fire(scene, x, y, vx, vy, owner) {
    scene.addMine(owner ? owner.x : x, owner ? owner.y - 4 : y, this, owner);
    return [];
  }
}

/**
 * Кассетная бомба: взрывается и разбрасывает несколько бомблетов.
 * Пример того, как расширять поведение, не трогая физику.
 */
export class ClusterWeapon extends Weapon {
  constructor(cfg) {
    super(cfg);
    this.clusterCount = cfg.clusterCount ?? 5;
    this.clusterSpeed = cfg.clusterSpeed ?? 260;
    this.bombletWeapon = cfg.bombletWeapon;
  }

  onDetonate(scene, projectile, x, y) {
    scene.explode(x, y, this.explosion, projectile.owner);
    const out = [];
    const spread = Math.PI * 0.62;
    // Разброс бомблетов берём из ГПСЧ хода, а не из Math.random: иначе
    // у двух игроков по сети кассета разлетится по-разному.
    const rng = scene.turnRng;
    for (let i = 0; i < this.clusterCount; i++) {
      const t = this.clusterCount === 1 ? 0.5 : i / (this.clusterCount - 1);
      const a = -Math.PI / 2 - spread / 2 + spread * t;
      const s = this.clusterSpeed * (0.8 + rng() * 0.4);
      out.push(new Projectile(
        scene, x, y - 6,
        Math.cos(a) * s + projectile.vx * 0.15,
        Math.sin(a) * s,
        this.bombletWeapon, projectile.owner,
      ));
    }
    return out;
  }
}
