/**
 * Подбор соперника по рейтингу — чистая функция, без сети и без состояния.
 *
 * Арбитра нет: оба клиента считают пару сами и должны получить один и тот
 * же ответ, иначе один уйдёт в комнату, а второй останется в лобби. Значит
 * решение обязано зависеть только от данных, которые видят обе стороны, и
 * ни от чего локального — ни от времени, ни от порядка прихода сообщений.
 *
 * Отсюда устройство:
 *   1. Берём всех ищущих (включая себя), сортируем по рейтингу, при равенстве
 *      по идентификатору — порядок получается одинаковым у всех.
 *   2. Разбиваем подряд: первый со вторым, третий с четвёртым. Соседи по
 *      отсортированному списку — это и есть ближайшие по рейтингу.
 *   3. Пару принимаем, только если разница рейтингов влезает в «коридор».
 *
 * Коридор расширяется со временем: сначала ищем равного, через полминуты
 * согласны на кого угодно — пустое лобби не должно кончаться вечным
 * «ищем соперника». Ширина считается не по локальным часам, а по счётчику
 * ожидания, который каждый шлёт в heartbeat, и берётся минимум из двух:
 * минимум — величина симметричная, обе стороны получат одинаковую.
 *
 * Расхождение всё же возможно: счётчик соперника приходит с задержкой в
 * один удар, и на самой границе один клиент шагнёт в следующую ступень
 * раньше. Это не ломает подбор, а лишь откладывает его: тот, кто шагнул
 * раньше, войдёт в комнату и подождёт секунду-полторы, пока второй досчитает
 * до той же ступени и войдёт следом — вход рассчитан от той же пары
 * идентификаторов, так что комната будет та же.
 */

/** Стартовый коридор: примерно одна лига. */
export const BAND_START = 120;
/** На сколько расширяется каждую ступень. */
export const BAND_STEP = 90;
/** Длина ступени в секундах ожидания. */
export const BAND_EVERY = 5;
/** После этого ждать бессмысленно — согласны на любого. */
export const BAND_OPEN_AFTER = 30;

/** Ширина коридора для пары, ждавшей столько-то секунд. */
export function band(waitedSeconds) {
  const w = Math.max(0, Math.floor(waitedSeconds));
  if (w >= BAND_OPEN_AFTER) return Infinity;
  return BAND_START + BAND_STEP * Math.floor(w / BAND_EVERY);
}

/**
 * Кого свести со мной прямо сейчас.
 *
 * @param {{id:string, rating:number, waited:number}} me
 * @param {Array<{id:string, rating:number, waited:number}>} others — только ищущие
 * @returns {{peer:object, gap:number, band:number}|null}
 */
export function findMatch(me, others) {
  const pool = [me, ...others].map((p) => ({
    id: p.id,
    rating: Number.isFinite(p.rating) ? p.rating : 1000,
    waited: Number.isFinite(p.waited) ? p.waited : 0,
    ref: p,
  }));
  if (pool.length < 2) return null;

  pool.sort((a, b) => (a.rating - b.rating) || (a.id < b.id ? -1 : 1));

  const i = pool.findIndex((p) => p.id === me.id);
  if (i < 0) return null;
  const partner = i % 2 === 0 ? pool[i + 1] : pool[i - 1];
  if (!partner) return null;

  const gap = Math.abs(partner.rating - pool[i].rating);
  // Минимум, а не максимум: обе стороны знают оба числа и получат один ответ.
  const width = band(Math.min(pool[i].waited, partner.waited));
  if (gap > width) return null;

  return { peer: partner.ref, gap, band: width };
}

/** Текст под кнопкой поиска: во что сейчас упирается подбор. */
export function searchStatus(waitedSeconds, poolSize) {
  const width = band(waitedSeconds);
  if (poolSize < 1) return 'Ищем соперника…';
  if (width === Infinity) return 'Ищем соперника: подойдёт любой';
  return `Ищем соперника: ±${width} рейтинга`;
}
