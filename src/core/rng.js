// Детерминированный ГПСЧ (mulberry32) + сглаженный value-noise для ландшафта.

export function makeRng(seed) {
  let a = seed >>> 0;
  const rng = function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.range = (min, max) => min + rng() * (max - min);
  rng.int = (min, max) => Math.floor(rng.range(min, max + 1));
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  rng.sign = () => (rng() < 0.5 ? -1 : 1);
  return rng;
}

/**
 * Производный генератор от пары (зерно, соль).
 *
 * Нужен для сети: полагаться на общий поток случайных чисел нельзя — стоит
 * одному клиенту дёрнуть генератор лишний раз, и разъедется всё дальнейшее.
 * Случайность берётся как функция от номера хода, а не из running-потока.
 */
export function subRng(seed, salt) {
  let h = (seed >>> 0) ^ Math.imul(salt + 1, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return makeRng((h ^ (h >>> 16)) >>> 0);
}

/**
 * Одномерный value-noise: случайные опорные точки через каждые `cell` пикселей,
 * между ними — интерполяция smoothstep. Возвращает функцию x -> [-1, 1].
 */
export function makeNoise1D(rng, length, cell) {
  const count = Math.ceil(length / cell) + 2;
  const pts = new Float32Array(count);
  for (let i = 0; i < count; i++) pts[i] = rng() * 2 - 1;

  return function noise(x) {
    const fx = x / cell;
    const i = Math.floor(fx);
    const t = fx - i;
    const a = pts[((i % count) + count) % count];
    const b = pts[(((i + 1) % count) + count) % count];
    const s = t * t * (3 - 2 * t);
    return a + (b - a) * s;
  };
}
