import { supabaseConfig } from './supabase.js';
import { tgApi, inTelegram } from '../platform/telegram.js';
import { adoptServer, player } from '../platform/player.js';

/**
 * Сервер рейтинга: Edge Function worms-result и таблица worms_player.
 *
 * Сервер знает только игроков Telegram: личность он берёт из подписанного
 * initData, а анонима из браузера подтвердить нечем. Поэтому:
 *   • отчёт о бое и синхронизация профиля идут только из Telegram;
 *   • таблица лидеров читается кем угодно — публичным ключом напрямую из
 *     REST, функция для этого не нужна.
 *
 * Локальный рейтинг остаётся предварительным: на экране итога он считается
 * сразу, а когда сервер подтверждает бой (оба сообщили одно и то же), его
 * числа становятся главными и переписывают локальные.
 */

const FN = 'worms-result';

export function serverAvailable() {
  return Boolean(supabaseConfig()) && inTelegram() && Boolean(tgApi()?.initData);
}

async function call(action, payload = {}) {
  const cfg = supabaseConfig();
  if (!serverAvailable()) throw new Error('сервер только для Telegram');
  const res = await fetch(`${cfg.url}/functions/v1/${FN}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: cfg.anonKey,
      Authorization: `Bearer ${cfg.anonKey}`,
    },
    body: JSON.stringify({ action, initData: tgApi().initData, ...payload }),
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) throw new Error(data?.error ?? `сервер ответил ${res.status}`);
  if (data?.player) adoptServer(data.player);
  return data;
}

let synced = false;

/**
 * Подтянуть свой профиль с сервера: рейтинг, победы, поражения. Один раз
 * за запуск; ошибки глотаются — без сервера игра живёт на локальном.
 */
export async function syncMe() {
  if (synced || !serverAvailable()) return null;
  synced = true;
  try {
    const data = await call('me');
    return data?.player ?? null;
  } catch (e) {
    console.warn('[server] профиль не синхронизирован', e.message);
    synced = false;
    return null;
  }
}

/**
 * Сообщить итог сетевого боя.
 * @returns {Promise<{status:string, delta?:number}|null>}
 *   status: pending — ждём отчёт соперника; confirmed — засчитано;
 *   disputed — стороны разошлись; unrated — соперник без Telegram.
 */
export async function reportResult({ room, seed, opponent, won }) {
  if (!serverAvailable() || !opponent) return null;
  try {
    return await call('result', { room, seed, opponent, won });
  } catch (e) {
    console.warn('[server] итог не принят', e.message);
    return { status: 'error', error: e.message };
  }
}

/** Таблица лидеров. Доступна всем: читается публичным ключом из REST. */
export async function fetchTop(limit = 20) {
  const cfg = supabaseConfig();
  if (!cfg) return [];
  const url = `${cfg.url}/rest/v1/worms_player?select=id,name,rating,wins,losses`
    + `&order=rating.desc,wins.desc&limit=${limit}`;
  const res = await fetch(url, { headers: { apikey: cfg.anonKey, Authorization: `Bearer ${cfg.anonKey}` } });
  if (!res.ok) throw new Error(`сервер ответил ${res.status}`);
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

/** Моё место в таблице: null, если меня там нет. */
export function myRank(rows) {
  const i = rows.findIndex((r) => r.id === player().id);
  return i >= 0 ? i + 1 : null;
}
