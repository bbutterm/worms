/**
 * Подключение к Supabase Realtime — единственное место, где живут ключи.
 *
 * Что важно понимать про эти ключи: anon-ключ публичный по устройству
 * Supabase, он и так уходит в браузер любому игроку. Ключ service_role
 * сюда класть нельзя ни при каких условиях — он даёт полный доступ к базе.
 *
 * Используется только Broadcast: сообщения проходят через сервис и нигде
 * не сохраняются. Ни одной таблицы не читается, не пишется и не создаётся,
 * SQL не выполняется, миграций нет — соседние проекты в той же Supabase
 * этим тронуть невозможно.
 */

export const SUPABASE = {
  url: '',          // https://<проект>.supabase.co
  anonKey: '',      // публичный anon-ключ (НЕ service_role)
  // Клиент грузится с CDN и только когда ключи заданы
  esm: 'https://esm.sh/@supabase/supabase-js@2',
};

/** Настройки можно навязать из index.html через window.WORMS_NET. */
export function supabaseConfig() {
  const cfg = { ...SUPABASE, ...(globalThis.WORMS_NET ?? {}) };
  return cfg.url && cfg.anonKey ? cfg : null;
}

/** Загружает клиент только при первом обращении. */
export async function loadCreateClient(esm) {
  const mod = await import(/* webpackIgnore: true */ esm);
  return mod.createClient;
}
