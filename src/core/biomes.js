/**
 * Типы окружения (биомы).
 *
 * Чтобы добавить новый — просто дописать объект в массив BIOMES.
 * Ничего больше править не нужно: генератор ландшафта, небо и вода
 * читают параметры отсюда.
 *
 * Поля:
 *   id, name        — идентификатор и подпись в HUD
 *   sky             — [верх, низ] градиента неба
 *   sun             — цвет солнца/луны (null = не рисовать)
 *   hills           — цвет дальних холмов параллакса
 *   water           — цвет воды (число) и прозрачность
 *   fill/fillDark   — вертикальный градиент тела земли
 *   rim/rimH        — цвет и толщина верхнего слоя (трава/песок/снег)
 *   scorch          — цвет опалённой кромки вокруг воронки
 *   texKey          — необязательный ключ тайловой текстуры земли (см. assets.js)
 *   gen             — параметры генерации:
 *       octaves     — [[частота, амплитуда], ...] — 3-4 синусоиды
 *       noiseAmp    — амплитуда шума поверх синусоид
 *       noiseCell   — шаг опорных точек шума (крупнее = глаже)
 *       baseH       — средняя высота острова над базовой линией
 *       edge        — доля ширины, на которой остров уходит под воду
 *       caves       — сколько пещер вырезать (0 = без пещер)
 */
export const BIOMES = [
  {
    id: 'meadow',
    name: 'Луговой остров',
    sky: ['#5fb8ef', '#c8ecff'],
    sun: 0xfff3c4,
    hills: 0x7fb7cf,
    water: 0x1f6ea8,
    waterAlpha: 0.55,
    fill: '#8a6440',
    fillDark: '#4a3320',
    rim: '#54b545',
    rimH: 14,
    scorch: '#2f2015',
    texKey: 'terrain_meadow',
    gen: {
      octaves: [[0.0016, 92], [0.0043, 44], [0.0097, 17], [0.0215, 7]],
      noiseAmp: 24, noiseCell: 34, baseH: 168, edge: 0.16, caves: 3,
    },
  },
  {
    id: 'desert',
    name: 'Пустынный шельф',
    sky: ['#f3a95f', '#ffe6b8'],
    sun: 0xffe9a8,
    hills: 0xd9a56e,
    water: 0x2b8a9e,
    waterAlpha: 0.5,
    fill: '#c99a55',
    fillDark: '#7a5a2e',
    rim: '#f0cf8a',
    rimH: 18,
    scorch: '#5d431f',
    texKey: 'terrain_desert',
    gen: {
      octaves: [[0.0011, 70], [0.0029, 52], [0.0068, 22], [0.0180, 9]],
      noiseAmp: 14, noiseCell: 60, baseH: 150, edge: 0.20, caves: 1,
    },
  },
  {
    id: 'tundra',
    name: 'Ледяная гряда',
    sky: ['#2e4a72', '#a9c9e8'],
    sun: 0xdfeeff,
    hills: 0x6d8bb0,
    water: 0x14496e,
    waterAlpha: 0.6,
    fill: '#6f7d90',
    fillDark: '#3a4452',
    rim: '#eaf4ff',
    rimH: 20,
    scorch: '#4a5666',
    texKey: 'terrain_tundra',
    gen: {
      octaves: [[0.0019, 104], [0.0051, 50], [0.0124, 24], [0.0270, 10]],
      noiseAmp: 32, noiseCell: 26, baseH: 180, edge: 0.13, caves: 4,
    },
  },
  {
    id: 'volcano',
    name: 'Вулканический кратер',
    sky: ['#3a1220', '#b8452c'],
    sun: 0xff9a4a,
    hills: 0x6b2a24,
    water: 0xb03a12,
    waterAlpha: 0.65,
    fill: '#4c3a3a',
    fillDark: '#241a1a',
    rim: '#8d3f2a',
    rimH: 12,
    scorch: '#120c0c',
    texKey: 'terrain_volcano',
    gen: {
      octaves: [[0.0014, 110], [0.0037, 38], [0.0105, 30], [0.0240, 12]],
      noiseAmp: 36, noiseCell: 22, baseH: 172, edge: 0.15, caves: 5,
    },
  },
];

export function pickBiome(rng) {
  return BIOMES[rng.int(0, BIOMES.length - 1)];
}
