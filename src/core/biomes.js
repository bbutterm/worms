/**
 * Типы окружения (темы ландшафта).
 *
 * Текстуры взяты из рипов Worms Armageddon: у каждой темы есть soil (тайл
 * земли 256x256), grass (полоса верхнего слоя), back (слой параллакса) и
 * sky (вертикальный градиент неба). Файлы раскладывает tools/build_assets.py.
 *
 * Чтобы добавить тему: положить папку в THEMES сборщика, пересобрать ассеты
 * и дописать объект сюда. Никакой другой код править не нужно.
 *
 * Поля:
 *   id           — совпадает с именем папки в assets/terrain/
 *   name         — подпись в HUD
 *   fallback     — цвета на случай, если спрайты темы не загрузились
 *   water        — цвет и прозрачность воды
 *   rimH         — сколько пикселей верхнего слоя рисовать (0 = вся высота grass)
 *   gen          — генерация рельефа:
 *       octaves  — [[частота, амплитуда], ...] — 3-4 синусоиды
 *       noiseAmp — амплитуда шума поверх синусоид
 *       noiseCell— шаг опорных точек шума (крупнее = глаже)
 *       baseH    — средняя высота острова над базовой линией
 *       edge     — доля ширины, на которой остров уходит под воду
 *       caves    — сколько пещер вырезать (0 = без пещер)
 */
export const BIOMES = [
  {
    id: 'jungle',
    name: 'Джунгли',
    fallback: { sky: ['#24284a', '#0a0d16'], fill: '#6a4a2c', fillDark: '#3a2718', rim: '#4aa03a' },
    water: 0x1f5f8f, waterAlpha: 0.55,
    scorch: '#241a12',
    rimH: 0,
    gen: {
      octaves: [[0.0016, 92], [0.0043, 44], [0.0097, 17], [0.0215, 7]],
      noiseAmp: 24, noiseCell: 34, baseH: 168, edge: 0.16, caves: 3,
    },
  },
  {
    id: 'desert',
    name: 'Пустыня',
    fallback: { sky: ['#2a2a1e', '#4a1e10'], fill: '#a8783c', fillDark: '#5c3f1e', rim: '#d8b464' },
    water: 0x2b7a8e, waterAlpha: 0.5,
    scorch: '#3d2a12',
    rimH: 0,
    gen: {
      octaves: [[0.0011, 70], [0.0029, 52], [0.0068, 22], [0.0180, 9]],
      noiseAmp: 14, noiseCell: 60, baseH: 150, edge: 0.20, caves: 1,
    },
  },
  {
    id: 'snow',
    name: 'Снега',
    fallback: { sky: ['#10142a', '#2e1700'], fill: '#5a6472', fillDark: '#2c343f', rim: '#e8f2ff' },
    water: 0x14496e, waterAlpha: 0.6,
    scorch: '#3a4450',
    rimH: 0,
    gen: {
      octaves: [[0.0019, 104], [0.0051, 50], [0.0124, 24], [0.0270, 10]],
      noiseAmp: 30, noiseCell: 28, baseH: 180, edge: 0.13, caves: 4,
    },
  },
  {
    id: 'hell',
    name: 'Преисподняя',
    fallback: { sky: ['#241a2a', '#2e1802'], fill: '#4c3232', fillDark: '#221414', rim: '#8d3f2a' },
    water: 0xb03a12, waterAlpha: 0.65,
    scorch: '#120c0c',
    rimH: 0,
    gen: {
      octaves: [[0.0014, 110], [0.0037, 38], [0.0105, 30], [0.0240, 12]],
      noiseAmp: 34, noiseCell: 24, baseH: 172, edge: 0.15, caves: 5,
    },
  },
  {
    id: 'forest',
    name: 'Лес',
    fallback: { sky: ['#24284a', '#0a0d16'], fill: '#7a5a3a', fillDark: '#3d2c1c', rim: '#5aa83f' },
    water: 0x1c5a7c, waterAlpha: 0.55,
    scorch: '#2a1e14',
    rimH: 0,
    gen: {
      octaves: [[0.0013, 84], [0.0035, 46], [0.0088, 20], [0.0205, 8]],
      noiseAmp: 22, noiseCell: 38, baseH: 164, edge: 0.17, caves: 2,
    },
  },
  {
    id: 'urban',
    name: 'Мегаполис',
    fallback: { sky: ['#24284a', '#0a0d16'], fill: '#5c5c66', fillDark: '#2a2a30', rim: '#8a8a94' },
    water: 0x24506a, waterAlpha: 0.6,
    scorch: '#1a1a1e',
    rimH: 0,
    gen: {
      octaves: [[0.0018, 96], [0.0047, 40], [0.0110, 22], [0.0230, 9]],
      noiseAmp: 26, noiseCell: 30, baseH: 176, edge: 0.14, caves: 3,
    },
  },
];

export function pickBiome(rng) {
  return BIOMES[rng.int(0, BIOMES.length - 1)];
}
