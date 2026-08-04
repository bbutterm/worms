/**
 * Манифест спрайтов.
 *
 * Любого файла может не быть — тогда движок молча рисует цветной
 * плейсхолдер, и игра остаётся играбельной. Когда придёт архив со
 * спрайтами: разложить файлы по путям ниже (или поправить пути здесь) —
 * больше ничего менять не надо.
 *
 * Ожидаемые размеры — рекомендация, всё равно масштабируется под
 * логические размеры сущностей.
 */
export const IMAGES = {
  // Персонаж (24x32 логически; спрайт может быть крупнее, впишется по высоте)
  worm: 'assets/worm.png',

  // Фон и параллакс (тайлится по горизонтали)
  bg_sky: 'assets/bg_sky.png',
  bg_hills: 'assets/bg_hills.png',

  // Тайловые текстуры земли — по одной на биом (repeat, лучше бесшовные 128x128)
  terrain_meadow: 'assets/terrain_meadow.png',
  terrain_desert: 'assets/terrain_desert.png',
  terrain_tundra: 'assets/terrain_tundra.png',
  terrain_volcano: 'assets/terrain_volcano.png',

  // Снаряды (~16x16, центр = центр снаряда)
  proj_bazooka: 'assets/proj_bazooka.png',
  proj_grenade: 'assets/proj_grenade.png',
  proj_cluster: 'assets/proj_cluster.png',
  proj_bomblet: 'assets/proj_bomblet.png',
  proj_drill: 'assets/proj_drill.png',

  // Прочее
  crosshair: 'assets/crosshair.png',
};

/**
 * Спрайтшиты (кадровая анимация). Если файла нет — анимация просто не создаётся.
 * Формат: [путь, ширина кадра, высота кадра, { анимации }]
 */
export const SHEETS = {
  explosion: {
    path: 'assets/explosion.png',
    frameWidth: 96,
    frameHeight: 96,
    anims: { explode: { start: 0, end: -1, frameRate: 24, repeat: 0 } },
  },
  worm_walk: {
    path: 'assets/worm_walk.png',
    frameWidth: 32,
    frameHeight: 40,
    anims: { walk: { start: 0, end: -1, frameRate: 12, repeat: -1 } },
  },
};

/** Ключи, которые не удалось загрузить. Заполняется в BootScene. */
export const missing = new Set();

export function has(scene, key) {
  return !missing.has(key) && scene.textures.exists(key);
}

/** Ключ реального спрайта либо плейсхолдера. */
export function keyOr(scene, key, fallback) {
  return has(scene, key) ? key : fallback;
}
