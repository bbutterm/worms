/**
 * Кампания.
 *
 * Миссия — это данные, а не код: карта задаётся зерном и биомом, стороны —
 * числом бойцов и уровнем бота, особые условия — полем rules. Добавить
 * миссию значит дописать сюда объект.
 *
 * Зерно фиксировано намеренно: миссия должна быть одинаковой у всех, иначе
 * «интересная» расстановка получится случайно один раз из десяти.
 *
 * rules:
 *   wind        — фиксированный ветер вместо случайного (px/s²)
 *   windRange   — свой диапазон случайного ветра [min, max]
 *   crateChance — вероятность ящика на ходу (0 = ящиков нет)
 *   ammo        — стартовые патроны игрока по id оружия
 *   enemyAmmo   — то же для бота
 *   turnTime    — своя длительность хода
 */

export const MISSIONS = [
  {
    id: 'range',
    title: 'Пристрелка',
    subtitle: '2 против 1 · ветра нет',
    brief: [
      'Полигон. Ветра нет, противник один и стреляет плохо.',
      'Задача простая: понять, как связаны угол, сила и дальность.',
      'Держи «ОГОНЬ» дольше — снаряд летит дальше.',
    ],
    biome: 'forest',
    seed: 20250811,
    teams: [
      { worms: 2, control: 'human' },
      { worms: 1, control: 'bot', level: 'rookie' },
    ],
    rules: { wind: 0, crateChance: 0.25 },
  },

  {
    id: 'storm',
    title: 'Шторм',
    subtitle: '2 против 2 · сильный боковой ветер',
    brief: [
      'Ветер здесь не «немного сносит», а решает всё.',
      'Смотри на стрелку вверху: она показывает силу и сторону.',
      'Против ветра бей выше и сильнее, по ветру — наоборот.',
    ],
    biome: 'snow',
    seed: 771203,
    teams: [
      { worms: 2, control: 'human' },
      { worms: 2, control: 'bot', level: 'fighter' },
    ],
    rules: { windRange: [190, 300], crateChance: 0.5 },
  },

  {
    id: 'siege',
    title: 'В меньшинстве',
    subtitle: '2 против 3 · ящики выручают',
    brief: [
      'Их больше, и они умеют считать траекторию.',
      'В лоб не выйдет: разбирай землю под ними и роняй вниз.',
      'Ящики падают часто — без них не вытянуть.',
    ],
    biome: 'hell',
    seed: 4410077,
    teams: [
      { worms: 2, control: 'human' },
      { worms: 3, control: 'bot', level: 'fighter' },
    ],
    rules: { crateChance: 0.75, ammo: { grenade: 4, cluster: 3, mole: 2 }, turnTime: 40 },
  },
];

export const MISSION_BY_ID = Object.fromEntries(MISSIONS.map((m) => [m.id, m]));

const STORE_KEY = 'worms.campaign.v1';

/** Пройденные миссии. Хранилище может быть недоступно — это не повод падать. */
export function loadProgress() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const data = raw ? JSON.parse(raw) : null;
    return new Set(Array.isArray(data?.done) ? data.done : []);
  } catch {
    return new Set();
  }
}

export function markDone(id) {
  try {
    const done = loadProgress();
    done.add(id);
    localStorage.setItem(STORE_KEY, JSON.stringify({ done: [...done] }));
  } catch { /* режим инкогнито и прочее — просто не сохраняем */ }
}

/** Открыта ли миссия: первая всегда, дальше — после предыдущей. */
export function isUnlocked(index, done = loadProgress()) {
  if (index <= 0) return true;
  return done.has(MISSIONS[index - 1].id);
}
