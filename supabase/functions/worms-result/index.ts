// Edge Function worms-result: рейтинг игры Worms.
//
// Единственное место, которое пишет в worms_player и worms_match. Клиент
// присылает подписанный Telegram initData; личность берётся из него, а не
// из того, что клиент назвал сам. Бой засчитывается, когда обе стороны
// сообщили одно и то же: одиночная приписка победы не проходит.
//
// verify_jwt выключен намеренно: публикуемый ключ Supabase нового формата
// не JWT, и шлюз отверг бы его; подпись Telegram проверяется здесь сама.
//
// Секреты: TELEGRAM_BOT_TOKEN — задаётся в настройках функций проекта.
// SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY Supabase подставляет сам.

import { verifyInitData, displayName } from './verify.js';
import { settle, START_RATING } from './elo.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/** Запрос к PostgREST под service_role. */
async function db(path: string, init: RequestInit & { prefer?: string } = {}) {
  const headers: Record<string, string> = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
  if (init.prefer) headers.Prefer = init.prefer;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(data?.message ?? `db ${res.status}`) as Error & { code?: string; status?: number };
    err.code = data?.code; err.status = res.status;
    throw err;
  }
  return data;
}

type Player = { id: string; tg_id: number | null; name: string; rating: number; wins: number; losses: number };

async function upsertPlayer(p: { id: string; tg_id: number; name: string }): Promise<Player> {
  const rows = await db('worms_player?on_conflict=id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: JSON.stringify({ ...p, updated_at: new Date().toISOString() }),
  });
  return rows[0];
}

async function getPlayers(ids: string[]): Promise<Player[]> {
  const list = ids.map((id) => `"${id.replace(/"/g, '')}"`).join(',');
  return db(`worms_player?id=in.(${list})&select=id,tg_id,name,rating,wins,losses`);
}

async function ensurePlayer(id: string): Promise<Player> {
  const [p] = await getPlayers([id]);
  if (p) return p;
  // Соперник ещё ни разу не заходил сам — заводим строку с рейтингом по
  // умолчанию, имя узнаем, когда он придёт с подписью
  const rows = await db('worms_player?on_conflict=id', {
    method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation',
    body: JSON.stringify({ id, name: 'Игрок', rating: START_RATING }),
  });
  return rows[0] ?? (await getPlayers([id]))[0];
}

async function patchPlayer(id: string, patch: Partial<Player>) {
  await db(`worms_player?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', prefer: 'return=minimal',
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
}

type Match = {
  id: number; room: string; seed: number; p1: string; p2: string;
  p1_claim: 'win' | 'loss'; p2_claim: 'win' | 'loss' | null; status: string; delta: number | null;
};

async function findMatch(room: string, seed: number): Promise<Match | null> {
  const rows = await db(`worms_match?room=eq.${encodeURIComponent(room)}&seed=eq.${seed}&select=*`);
  return rows[0] ?? null;
}

/**
 * Отчёт о бое. Первый отчёт открывает запись, второй — закрывает: если
 * стороны согласны, кто победил, обоим пересчитывается Эло; если нет —
 * спор, рейтинг не трогаем. Повторный отчёт той же стороны ничего не
 * меняет и просто возвращает текущее состояние.
 */
async function report(me: Player, body: Record<string, unknown>) {
  const room = String(body.room ?? '').toUpperCase().slice(0, 16);
  const seed = Number(body.seed);
  const opponent = String(body.opponent ?? '');
  const won = Boolean(body.won);
  if (!/^[A-Z0-9]{4,16}$/.test(room) || !Number.isFinite(seed)) return json({ error: 'плохая комната' }, 400);
  if (!opponent || opponent === me.id) return json({ error: 'нет соперника' }, 400);
  if (!opponent.startsWith('tg')) return json({ status: 'unrated', reason: 'соперник без Telegram', player: me });

  const claim = won ? 'win' : 'loss';
  let match = await findMatch(room, seed);
  if (!match) {
    try {
      const rows = await db('worms_match', {
        method: 'POST', prefer: 'return=representation',
        body: JSON.stringify({ room, seed, p1: me.id, p2: opponent, p1_claim: claim }),
      });
      match = rows[0];
    } catch (e) {
      // Оба сообщили одновременно: второй упёрся в уникальность (room, seed)
      if ((e as { code?: string }).code !== '23505') throw e;
      match = await findMatch(room, seed);
    }
    if (match && match.p1 === me.id) return json({ status: 'pending', player: me });
  }
  if (!match) return json({ error: 'матч не записался' }, 500);

  if (match.status !== 'pending') {
    return json({ status: match.status, delta: match.delta, player: (await getPlayers([me.id]))[0] ?? me });
  }
  if (match.p1 === me.id) return json({ status: 'pending', player: me });
  if (match.p2 !== me.id) return json({ error: 'это не ваш бой' }, 403);

  // Вторая сторона: сверяем и закрываем
  const agree = match.p1_claim !== claim;   // у одного win, у другого loss
  if (!agree) {
    await db(`worms_match?id=eq.${match.id}`, {
      method: 'PATCH', prefer: 'return=minimal',
      body: JSON.stringify({ p2_claim: claim, status: 'disputed', confirmed_at: new Date().toISOString() }),
    });
    return json({ status: 'disputed', player: me });
  }

  const winnerId = match.p1_claim === 'win' ? match.p1 : match.p2;
  const loserId = winnerId === match.p1 ? match.p2 : match.p1;
  const winner = await ensurePlayer(winnerId);
  const loser = await ensurePlayer(loserId);
  const s = settle(winner.rating, loser.rating);
  await patchPlayer(winner.id, { rating: s.winner, wins: winner.wins + 1 });
  await patchPlayer(loser.id, { rating: s.loser, losses: loser.losses + 1 });
  await db(`worms_match?id=eq.${match.id}`, {
    method: 'PATCH', prefer: 'return=minimal',
    body: JSON.stringify({
      p2_claim: claim, status: 'confirmed', delta: s.delta, confirmed_at: new Date().toISOString(),
    }),
  });
  const [mine] = await getPlayers([me.id]);
  return json({ status: 'confirmed', delta: won ? s.delta : -s.delta, player: mine ?? me });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'только POST' }, 405);
  if (!BOT_TOKEN) return json({ error: 'сервер не настроен: нет TELEGRAM_BOT_TOKEN' }, 503);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'не JSON' }, 400); }

  const v = await verifyInitData(String(body.initData ?? ''), BOT_TOKEN);
  if (!v.ok) return json({ error: v.reason }, 401);
  const tgId = Number(v.user.id);
  const me = await upsertPlayer({ id: `tg${tgId}`, tg_id: tgId, name: displayName(v.user) });

  try {
    switch (body.action) {
      case 'me': return json({ player: me });
      case 'result': return await report(me, body);
      default: return json({ error: 'неизвестное действие' }, 400);
    }
  } catch (e) {
    console.error('[worms-result]', e);
    return json({ error: (e as Error).message ?? 'ошибка сервера' }, 500);
  }
});
