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
