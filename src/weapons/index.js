import { Weapon, ClusterWeapon } from './Weapon.js';

/**
 * Реестр оружия. Порядок = порядок кнопок в HUD и клавиш 1..N.
 * Добавить новое оружие = дописать сюда объект.
 *
 * spriteKey — спрайтшит снаряда, iconKey — иконка для панели.
 * rotational: true означает, что кадры спрайтшита это 32 предрассчитанных
 * поворота (кадр выбирается по направлению полёта), иначе кадры крутятся
 * как обычная анимация — снаряд кувыркается.
 */

const BOMBLET = new Weapon({
  id: 'bomblet',
  name: 'Бомблет',
  icon: '·',
  color: 0xffc36b,
  spriteKey: 'proj_bomblet',
  projectile: { radius: 3, windScale: 0.6, trail: false },
  explosion: { radius: 22, damageRadius: 40, damage: 18, knockback: 190, shake: 0.003 },
});

export const WEAPONS = [
  new Weapon({
    id: 'bazooka',
    name: 'Базука',
    icon: '➶',
    color: 0xffe066,
    spriteKey: 'proj_bazooka',
    iconKey: 'icon_bazooka',
    rotational: true,
    startAmmo: null,                       // базука всегда есть
    projectile: { radius: 5, windScale: 1, gravityScale: 1 },
    explosion: { radius: 40, damageRadius: 72, damage: 45, knockback: 300, shake: 0.006 },
  }),

  new Weapon({
    id: 'grenade',
    name: 'Граната',
    icon: '◕',
    color: 0x8ee06a,
    spriteKey: 'proj_grenade',
    iconKey: 'icon_grenade',
    startAmmo: 3,
    projectile: {
      radius: 5, windScale: 0.35, bounciness: 0.45, friction: 0.72, fuse: 3,
    },
    explosion: { radius: 46, damageRadius: 80, damage: 50, knockback: 340, shake: 0.007 },
  }),

  new ClusterWeapon({
    id: 'cluster',
    name: 'Кассета',
    icon: '❋',
    color: 0xff8ad4,
    spriteKey: 'proj_cluster',
    iconKey: 'icon_cluster',
    startAmmo: 2,
    projectile: { radius: 6, windScale: 0.8 },
    explosion: { radius: 26, damageRadius: 46, damage: 22, knockback: 180, shake: 0.004 },
    clusterCount: 5,
    clusterSpeed: 250,
    bombletWeapon: BOMBLET,
  }),

  new Weapon({
    id: 'mole',
    name: 'Крот',
    icon: '⇩',
    color: 0xc0c8d8,
    spriteKey: 'proj_mole',
    iconKey: 'icon_mole',
    startAmmo: 1,
    projectile: {
      radius: 6, windScale: 0.15, gravityScale: 1.15,
      digRadius: 9, digTime: 0.55,
    },
    explosion: { radius: 52, damageRadius: 78, damage: 40, knockback: 260, shake: 0.008 },
  }),
];

export const WEAPONS_BY_ID = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));
export { BOMBLET };
