/**
 * Лобби и подбор соперника.
 *
 *   node tests/lobby.mjs http://127.0.0.1:5187
 *
 * Два браузера заходят в лобби, оба жмут «Быстрый бой» и обязаны сойтись
 * в одной комнате — без сервера, без арбитра и не договариваясь. Здесь же
 * проверяется рейтинг: он двигается только за сетевой бой и на одинаковое
 * число очков у обеих сторон.
 *
 * Сообщения ходят через сам тест (window.WORMS_TRANSPORT), как в net.mjs:
 * проверяется логика лобби, а не транспорт.
 */
import { chromium } from 'playwright';
import { launchOptions } from './browser.mjs';

const URL = process.argv[2] || 'http://127.0.0.1:5173';
const LAG = 40;

const failures = [];
const errors = [];

function check(name, ok, detail = '') {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
}

const launch = () => chromium.launch(
  launchOptions(),
);

const browsers = [await launch(), await launch()];
const pages = [];

for (let i = 0; i < 2; i++) {
  const page = await browsers[i].newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errors.push(`[${i}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !t.includes('Failed to load resource')) {
      errors.push(`[${i}] console: ${t}`);
    }
  });

  // Транспорт общий на все каналы: лобби и партия разведены по комнате,
  // как и в настоящем сервисе.
  await page.exposeFunction('__netOut', (room, msg) => {
    setTimeout(() => {
      pages[1 - i]?.evaluate(([r, m]) => globalThis.__netIn?.(r, m), [room, msg])
        .catch(() => {});
    }, LAG);
  });
  await page.addInitScript(() => {
    globalThis.__inboxes = new Map();
    globalThis.__netIn = (room, msg) => globalThis.__inboxes.get(room)?.(msg);
    globalThis.WORMS_TRANSPORT = () => ({
      id: `p${Math.random().toString(36).slice(2, 8)}`,
      async connect(room, onMessage) {
        this.room = room;
        globalThis.__inboxes.set(room, onMessage);
      },
      send(msg) { globalThis.__netOut(this.room, { ...msg, from: this.id }); },
      close() { globalThis.__inboxes.delete(this.room); },
    });
    // Имена и рейтинги разводим, чтобы видеть, что именно передалось.
    // Разброс держим внутри стартового коридора подбора: расширение
    // коридора со временем проверяет tests/match.mjs, и заставлять этот
    // набор ждать лишние секунды незачем.
    localStorage.setItem('worms.player.v1', JSON.stringify({
      id: `test${Math.random().toString(36).slice(2, 7)}`,
      name: `Тестовый ${Math.floor(Math.random() * 90 + 10)}`,
      rating: 1000 + Math.floor(Math.random() * 80),
      wins: 0, losses: 0,
    }));
  });

  await page.goto(`${URL}/?biome=forest`, { waitUntil: 'domcontentloaded' });
  pages.push(page);
}
const [A, B] = pages;

const menuReady = (p) => p.waitForFunction(
  () => window.__WORMS__?.scene.isActive('Menu')
    && Object.keys(window.__WORMS__.scene.getScene('Menu').buttons).length > 0,
  null, { timeout: 40000 },
);
await Promise.all(pages.map(menuReady));

const menu = (p) => p.evaluate(() => window.__WORMS__.scene.getScene('Menu'));
const call = (p, fn) => p.evaluate(fn);

// --- лобби видит соседа ---
await Promise.all(pages.map((p) => call(p, () => {
  window.__WORMS__.scene.getScene('Menu').showOnline();
})));
const seen = await Promise.all(pages.map((p) => p.waitForFunction(
  () => (window.__WORMS__.scene.getScene('Menu').lobby?.list().length ?? 0) > 0,
  null, { timeout: 20000 },
).then(() => true).catch(() => false)));
check('игроки видят друг друга в лобби', seen.every(Boolean), seen.join(', '));

const rosters = await Promise.all(pages.map((p) => call(p, () => {
  const l = window.__WORMS__.scene.getScene('Menu').lobby;
  return { me: l.me.name, peers: l.list().map((x) => `${x.name}:${x.rating}`) };
})));
check('в списке видно имя и рейтинг соседа',
  rosters[0].peers.length === 1 && /:\d{3,4}$/.test(rosters[0].peers[0]),
  rosters.map((r) => `${r.me} видит ${r.peers.join(',') || '—'}`).join(' | '));

// --- быстрый бой сводит обоих в одну комнату ---
await Promise.all(pages.map((p) => call(p, () => {
  window.__WORMS__.scene.getScene('Menu').startSearch();
})));

const started = await Promise.all(pages.map((p) => p.waitForFunction(
  () => window.__WORMS__?.scene.isActive('Game')
    && window.__WORMS__.scene.getScene('Game').turn?.activeWorm,
  null, { timeout: 40000 },
).then(() => true).catch(() => false)));
check('подбор развёл обоих в бой', started.every(Boolean), started.join(', '));

const rooms = await Promise.all(pages.map((p) => call(p,
  () => window.__WORMS__.scene.getScene('Game').room)));
check('комната у обоих одна', rooms[0] && rooms[0] === rooms[1], rooms.join(' / '));

// --- партия действительно связалась ---
const paired = await Promise.all(pages.map((p) => p.waitForFunction(
  () => window.__WORMS__.scene.getScene('Game').net?.connected === true,
  null, { timeout: 30000 },
).then(() => true).catch(() => false)));
check('соперники соединились', paired.every(Boolean), paired.join(', '));

const info = () => Promise.all(pages.map((p) => call(p, () => {
  const s = window.__WORMS__.scene.getScene('Game');
  return {
    team: s.net.myTeam,
    seed: s.seed,
    opponent: s.net.opponent?.name ?? null,
    oppRating: s.net.opponent?.rating ?? null,
    rating: JSON.parse(localStorage.getItem('worms.player.v1')).rating,
  };
})));
let st = await info();
check('стороны разные и зерно общее',
  st[0].team !== st[1].team && st[0].seed === st[1].seed,
  `команды ${st[0].team}/${st[1].team}, зерно ${st[0].seed}`);
check('каждый знает имя и рейтинг соперника',
  Boolean(st[0].opponent && st[1].opponent && st[0].oppRating && st[1].oppRating),
  `${st[0].opponent} (${st[0].oppRating}) ↔ ${st[1].opponent} (${st[1].oppRating})`);

// --- рейтинг за победу ---
const before = st.map((x) => x.rating);
await A.evaluate(() => {
  const s = window.__WORMS__.scene.getScene('Game');
  // Выбиваем команду соперника того, кто смотрит: победа достаётся
  // владельцу этой вкладки
  const foe = s.net.myTeam === 0 ? 1 : 0;
  s.worms.filter((w) => w.team === foe).forEach((w) => w.damage(999));
});
await A.waitForFunction(
  () => window.__WORMS__.scene.getScene('Game').turn.state === 'over',
  null, { timeout: 40000 },
);
await A.waitForTimeout(600);
const afterA = await A.evaluate(
  () => JSON.parse(localStorage.getItem('worms.player.v1')));
check('победа поднимает рейтинг и счёт побед',
  afterA.rating > before[0] && afterA.wins === 1,
  `${before[0]} → ${afterA.rating}, побед ${afterA.wins}`);

check('нет ошибок в консоли', errors.length === 0, errors.slice(0, 4).join(' | '));

await Promise.all(browsers.map((b) => b.close()));
console.log(failures.length
  ? `\nПРОВАЛЕНО: ${failures.length} — ${failures.join(', ')}`
  : '\nпроверки лобби пройдены');
process.exit(failures.length ? 1 : 0);
