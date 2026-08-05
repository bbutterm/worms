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
    for (let i = 0; i < this.clusterCount; i++) {
      const t = this.clusterCount === 1 ? 0.5 : i / (this.clusterCount - 1);
      const a = -Math.PI / 2 - spread / 2 + spread * t;
      const s = this.clusterSpeed * (0.8 + Math.random() * 0.4);
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
