/**
 * Кто играет.
 *
 * В Telegram личность берётся из initData — имя и идентификатор уже есть,
 * ничего спрашивать не нужно. В обычном браузере игрок анонимный: ему
 * выдаётся случайный идентификатор и имя «Боец NNNN», которое он может
 * поменять; всё это лежит в localStorage.
 *
 * Рейтинг хранится у игрока. В Telegram — в CloudStorage, привязанном к
 * аккаунту: он едет за человеком на другой телефон и в веб-клиент. Вне
 * Telegram — в localStorage этого устройства. Это честный MMR ровно до
 * того момента, пока никто не захочет его подкрутить: результат сообщает
 * клиент, проверить его некому. Серверная часть описана в
 * docs/rating.sql — там же объяснено, почему без неё рейтинг остаётся
 * «для своих».
 */

import { inTelegram, cloudGet, cloudSet } from './telegram.js';

const KEY = 'worms.player.v1';

let cached = null;

/** Стартовый рейтинг: 1000 — привычная точка отсчёта для Эло. */
export const START_RATING = 1000;

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function save(p) {
  const raw = JSON.stringify(p);
  try {
    localStorage.setItem(KEY, raw);
  } catch { /* инкогнито — играем без сохранения */ }
  // В облако — не дожидаясь: игре ответ не нужен, а хранилище может
  // и промолчать
  if (inTelegram()) cloudSet(KEY, raw);
}

/**
 * Подтянуть профиль из CloudStorage до первого обращения к player().
 *
 * Вызывается один раз при запуске, до создания игры. Облако главнее
 * локальной копии: локальная — это то, что наиграли на этом устройстве
 * до того, как профиль стал облачным, облачная — то, что у аккаунта.
 * Если в облаке пусто, локальная копия отправляется туда сама при
 * первом сохранении.
 */
export async function loadCloudProfile() {
  if (!inTelegram()) return null;
  const raw = await cloudGet(KEY);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    if (!p || typeof p !== 'object') return null;
    localStorage.setItem(KEY, raw);
    cached = null;
    return p;
  } catch {
    return null;
  }
}

function randomId() {
  return `g${Math.random().toString(36).slice(2, 10)}`;
}

/** Данные Telegram, если игра открыта внутри клиента. */
function telegramUser() {
  const tg = globalThis.Telegram?.WebApp;
  const u = tg?.initDataUnsafe?.user;
  if (!u?.id) return null;
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ')
    || u.username || `Игрок ${u.id}`;
  return { id: `tg${u.id}`, name, photo: u.photo_url ?? null, telegram: true };
}


/**
 * Профиль игрока. Telegram главнее сохранённого: если человек зашёл под
 * своим аккаунтом, имя должно быть его, а не выдуманное когда-то в браузере.
 */
export function player() {
  if (cached) return cached;

  const stored = load() ?? {};
  const tg = telegramUser();

  cached = {
    id: tg?.id ?? stored.id ?? randomId(),
    name: tg?.name ?? stored.name ?? `Боец ${Math.floor(1000 + Math.random() * 9000)}`,
    photo: tg?.photo ?? null,
    telegram: Boolean(tg),
    rating: Number.isFinite(stored.rating) ? stored.rating : START_RATING,
    wins: stored.wins ?? 0,
    losses: stored.losses ?? 0,
  };
  save(cached);
  return cached;
}

export function setName(name) {
  const p = player();
  p.name = String(name).trim().slice(0, 20) || p.name;
  save(p);
  return p;
}

/** Записать итог боя. Возвращает изменение рейтинга. */
export function recordResult(won, delta) {
  const p = player();
  p.rating = Math.max(100, Math.round(p.rating + delta));
  if (won) p.wins += 1; else p.losses += 1;
  save(p);
  return p;
}

/**
 * Эло. K=24 — сдвиг заметный, но не швыряет рейтинг после одного боя.
 * Считают обе стороны у себя, независимо: формула симметричная, и при
 * одинаковых входных данных результат совпадает без всякой сверки.
 */
export function eloDelta(mine, theirs, won) {
  const expected = 1 / (1 + 10 ** ((theirs - mine) / 400));
  return Math.round(24 * ((won ? 1 : 0) - expected));
}

/** Звание по рейтингу — то, что видно в лобби рядом с именем. */
export function rankName(rating) {
  if (rating < 900) return 'новобранец';
  if (rating < 1100) return 'боец';
  if (rating < 1300) return 'ветеран';
  if (rating < 1500) return 'снайпер';
  return 'легенда';
}
