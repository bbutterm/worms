import { ChannelTransport, SupabaseTransport } from './transport.js';
import { supabaseConfig, loadCreateClient } from './supabase.js';

/**
 * Откуда брать транспорт.
 *
 * Раньше это жило в сцене, но подключений стало два: партия и лобби, —
 * и каждому нужен свой канал на том же сервисе. Общая точка выбора
 * заодно означает, что подменять транспорт в тестах надо в одном месте.
 *
 * Порядок: подмена снаружи (тесты, свой сервер) → Supabase, если заданы
 * ключи → вкладки одного браузера. Последнее не заглушка: за одним
 * компьютером в двух вкладках так реально играют.
 */
export async function makeTransport() {
  if (globalThis.WORMS_TRANSPORT) return globalThis.WORMS_TRANSPORT();
  const cfg = supabaseConfig();
  if (!cfg) return new ChannelTransport();
  const createClient = await loadCreateClient(cfg.lib);
  return new SupabaseTransport({
    url: cfg.url, keys: [cfg.anonKey, cfg.legacyKey], createClient,
  });
}
