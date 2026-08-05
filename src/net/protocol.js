import { CFG } from '../config.js';
import { Crate } from '../entities/Crate.js';

/**
 * Формат обмена для сетевой игры.
 *
 * За ход передаётся две вещи, и обе нужны:
 *
 *   ПРИКАЗ (command) — что сделал игрок: кто стрелял, откуда, чем и куда.
 *   По нему второй клиент проигрывает выстрел с анимацией, иначе снаряд
 *   просто телепортировался бы в результат.
 *
 *   СНИМОК (state) — чем ход кончился: позиции и здоровье бойцов, воронки,
 *   патроны, ящики, ветер. Это истина.
 *
 * Одним приказом обойтись нельзя: физика идёт по кадровой дельте, и на
 * разных устройствах траектории неизбежно разойдутся. Одним снимком —
 * можно, но тогда чужой ход выглядел бы как мгновенная телепортация.
 * Поэтому: показываем по приказу, состояние берём из снимка.
 */

/** Приказ на выстрел: всё, что нужно, чтобы повторить его визуально. */
export function captureCommand(scene, vx, vy) {
  const w = scene.turn.activeWorm;
  return {
    type: 'shot',
    turn: scene.turn.turnNumber,
    worm: scene.worms.indexOf(w),
    x: Math.round(w.x),
    y: Math.round(w.y),
    facing: w.facing,
    weapon: scene.turn.weaponIndex,
    vx: Math.round(vx),
    vy: Math.round(vy),
  };
}

/** Показать чужой выстрел: без урона и разрушений, только картинка. */
export function applyCommand(scene, cmd) {
  const w = scene.worms[cmd.worm];
  if (!w || !w.alive) return false;

  w.x = cmd.x;
  w.y = cmd.y;
  w.facing = cmd.facing;
  scene.turn.weaponIndex = cmd.weapon;
  scene.hud.setWeaponIndex(cmd.weapon);

  scene.replaying = true;
  scene.fireActiveWorm(cmd.vx, cmd.vy);
  return true;
}

/** Снимок партии на конец хода. */
export function captureState(scene) {
  return {
    turn: scene.turn.turnNumber,
    team: scene.turn.currentTeam,
    weapon: scene.turn.weaponIndex,
    wind: Math.round(scene.wind),
    explosions: scene.explosionLog.slice(),
    worms: scene.worms.map((w) => ({
      x: Math.round(w.x),
      y: Math.round(w.y),
      hp: w.health,
      alive: w.alive,
      facing: w.facing,
    })),
    ammo: scene.turn.ammo.map((row) => row.slice()),
    crates: scene.crates
      .filter((c) => c.alive)
      .map((c) => ({ x: Math.round(c.x), y: Math.round(c.y), kind: c.kind, landed: c.landed })),
  };
}

/**
 * Привести партию к снимку. Взрывы применяются к земле здесь: во время
 * показа чужого хода они только рисовались.
 */
export function applyState(scene, state) {
  for (const e of state.explosions ?? []) {
    scene.terrain.destroyCircle(e.x, e.y, e.r);
  }

  state.worms.forEach((s, i) => {
    const w = scene.worms[i];
    if (!w) return;
    if (!s.alive) {
      if (w.alive) w.kill('сеть');
      return;
    }
    w.x = s.x;
    w.y = s.y;
    w.health = s.hp;
    w.facing = s.facing;
    w.vx = 0;
    w.vy = 0;
    w.grounded = w.supported(w.x, w.y);
  });

  scene.turn.ammo = state.ammo.map((row) => row.slice());
  scene.setWind(state.wind);

  // Ящики пересоздаём: они появляются и исчезают по ходу партии
  for (const c of scene.crates) c.destroy();
  scene.crates = (state.crates ?? []).map((c) => {
    const crate = new Crate(scene, c.x, c.kind);
    crate.y = c.y;
    if (c.landed) crate._land();
    return crate;
  });

  scene.replaying = false;
  scene.explosionLog = [];
}

/**
 * Короткая свёртка состояния — чтобы замечать расхождение раньше, чем оно
 * станет заметным игроку.
 */
export function stateHash(state) {
  let h = 2166136261;
  const mix = (n) => {
    h ^= n | 0;
    h = Math.imul(h, 16777619);
  };
  mix(state.turn);
  mix(state.wind);
  for (const w of state.worms) { mix(w.x); mix(w.y); mix(w.hp); mix(w.alive ? 1 : 0); }
  for (const row of state.ammo) for (const n of row) mix(n === null ? -1 : n);
  for (const e of state.explosions ?? []) { mix(e.x); mix(e.y); mix(e.r); }
  return (h >>> 0).toString(16);
}

/** Параметры партии, которые обязаны совпасть у обоих игроков. */
export function matchConfig(scene) {
  return {
    seed: scene.seed,
    biome: scene.terrain.biome.id,
    worldW: CFG.WORLD_W,
    worldH: CFG.WORLD_H,
  };
}
