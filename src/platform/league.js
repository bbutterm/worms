/**
 * Лиги: во что превращается число рейтинга на экране.
 *
 * Голое «1147» игроку ничего не говорит — непонятно, много это или мало и
 * сколько осталось до следующей ступени. Поэтому рейтинг раскладывается на
 * лигу с именем и цветом, полосу прогресса внутри лиги и подпись «до
 * следующей столько-то». Это чистая функция от числа: никакого состояния,
 * ничего не сохраняет, одинаково считается и в меню, и в лобби, и на экране
 * итогов боя.
 *
 * Границы подобраны так, чтобы новичок был в средней лиге, а не в самой
 * нижней: стартовые 1000 попадают в «Бронзу». Падать ниже старта неприятно,
 * но нужно — иначе нижние лиги пустые и лестница начинается со второй
 * ступени.
 */

export const LEAGUES = [
  { id: 'wood',    name: 'Дерево',  min: 0,    color: 0x8d6e4a, text: '#c39b74' },
  { id: 'iron',    name: 'Железо',  min: 850,  color: 0x9aa3ad, text: '#c3ccd6' },
  { id: 'bronze',  name: 'Бронза',  min: 950,  color: 0xc07b3a, text: '#e6a463' },
  { id: 'silver',  name: 'Серебро', min: 1100, color: 0xc9d2dc, text: '#e8eef5' },
  { id: 'gold',    name: 'Золото',  min: 1250, color: 0xe0b53c, text: '#ffd766' },
  { id: 'ruby',    name: 'Рубин',   min: 1400, color: 0xd6455f, text: '#ff7d92' },
  { id: 'legend',  name: 'Легенда', min: 1600, color: 0x8b5cf6, text: '#c4a6ff' },
];

/** Лига по рейтингу. Ниже нуля не бывает, выше последней — тоже. */
export function leagueOf(rating) {
  let found = LEAGUES[0];
  for (const l of LEAGUES) if (rating >= l.min) found = l;
  return found;
}

/** Следующая лига или null, если игрок уже наверху. */
export function nextLeague(rating) {
  const i = LEAGUES.indexOf(leagueOf(rating));
  return LEAGUES[i + 1] ?? null;
}

/**
 * Прогресс внутри лиги от 0 до 1. В последней лиге расти уже некуда —
 * возвращаем 1, чтобы полоса была полной, а не пустой.
 */
export function leagueProgress(rating) {
  const cur = leagueOf(rating);
  const next = nextLeague(rating);
  if (!next) return 1;
  return Math.max(0, Math.min(1, (rating - cur.min) / (next.min - cur.min)));
}

/** Сколько очков до следующей лиги. null — выше некуда. */
export function toNextLeague(rating) {
  const next = nextLeague(rating);
  return next ? Math.max(0, next.min - rating) : null;
}

/** Подпись под именем в лобби: «Золото · 1274». */
export function leagueLabel(rating) {
  return `${leagueOf(rating).name} · ${Math.round(rating)}`;
}
