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
  url: 'https://ajltzwomvyvntvtjnrrf.supabase.co',
  // Сначала publishable-ключ: он отзывается отдельно, поэтому его ротация
  // не заденет то, что этим же проектом уже пользуется. Старый anon-ключ —
  // запасной: если Realtime проекта не принимает новый формат, транспорт
  // сам перейдёт на него.
  anonKey: 'sb_publishable_avfKy6YbDfLLYmjiUF7zcw_a3tLPdR6',
  legacyKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFqbHR6d29tdnl2bnR2dGpucnJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwOTk5NTEsImV4cCI6MjA5OTY3NTk1MX0.CfqS0XmMOrPG50viiBpwCCMoNkIOGKV2jQmJcCreqzk',
  // Клиент лежит рядом (vendor/), а не на CDN: одна внешняя точка отказа
  // на игру уже есть — Phaser, — и вторая тут не нужна. Грузится лениво,
  // только когда партия действительно сетевая.
  lib: 'vendor/supabase.min.js',
};

/** Настройки можно навязать из index.html через window.WORMS_NET. */
export function supabaseConfig() {
  const cfg = { ...SUPABASE, ...(globalThis.WORMS_NET ?? {}) };
  return cfg.url && cfg.anonKey ? cfg : null;
}

/**
 * Загружает клиент при первом обращении. Сборка UMD, а не модуль: она
 * одним файлом и без внутренних импортов, поэтому её достаточно положить
 * рядом и подключить тегом.
 */
export async function loadCreateClient(lib) {
  if (globalThis.supabase?.createClient) return globalThis.supabase.createClient;
  await new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = lib;
    el.onload = resolve;
    el.onerror = () => reject(new Error(`не загрузился ${lib}`));
    document.head.appendChild(el);
  });
  if (!globalThis.supabase?.createClient) throw new Error('supabase-js не отдал createClient');
  return globalThis.supabase.createClient;
}
