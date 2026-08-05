import { MISSION_BY_ID } from '../campaign/missions.js';

/**
 * Описание партии: что именно строить сцене.
 *
 * Меню кладёт такой объект в registry, сцена его читает. Прямой заход по
 * адресу (или тест) описания не даёт — тогда берётся обычный хотсит, ровно
 * как было до всяких меню.
 */

export const HOTSEAT = {
  mode: 'quick',
  teams: [
    { worms: 2, control: 'human' },
    { worms: 2, control: 'human' },
  ],
  rules: {},
};

/** Быстрая игра: случайная карта, соперник — человек рядом или бот. */
export function quickMatch(botLevel = null) {
  return {
    mode: 'quick',
    teams: [
      { worms: 2, control: 'human' },
      botLevel
        ? { worms: 2, control: 'bot', level: botLevel }
        : { worms: 2, control: 'human' },
    ],
    rules: {},
  };
}

/** Миссия кампании: карта, стороны и особые условия из описания миссии. */
export function campaignMatch(missionId) {
  const m = MISSION_BY_ID[missionId];
  if (!m) return quickMatch(null);
  return {
    mode: 'campaign',
    missionId: m.id,
    seed: m.seed,
    biome: m.biome,
    teams: m.teams.map((t) => ({ ...t })),
    rules: { ...m.rules },
  };
}

/** Сетевая партия: обе стороны — люди, состав как в обычной быстрой игре. */
export function onlineMatch() {
  return { ...HOTSEAT, mode: 'online' };
}

/** Есть ли в партии хоть один бот. */
export function hasBots(match) {
  return match.teams.some((t) => t.control === 'bot');
}
