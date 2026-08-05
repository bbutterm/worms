/**
 * Сетевой тест: два браузера играют одну партию.
 *
 *   node tests/net.mjs http://127.0.0.1:5187
 *
 * Почему два браузера, а не две вкладки: фоновая вкладка получает от одного
 * до двух кадров в секунду (замерено: 25 кадров против 245 за то же время),
 * и физика в ней ползёт. Играть так нельзя и проверять нечем.
 *
 * Транспорт подставляется снаружи через window.WORMS_TRANSPORT: сообщения
 * ходят через сам тест, с задержкой, как в сети. Supabase для проверки
 * протокола не нужен — сессия про транспорт ничего не знает.
 */
import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://127.0.0.1:5173';
const ROOM = 'TESTRM';
const LAG = 40;          // мс в одну сторону — чтобы порядок сообщений не был идеальным

const failures = [];
const errors = [];

function check(name, ok, detail = '') {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
}

const launch = () => chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);

const browsers = [await launch(), await launch()];
const pages = [];
const inbox = [];        // страница → её приёмник сообщений

for (let i = 0; i < 2; i++) {
  const page = await browsers[i].newPage({
    viewport: { width: 1280, height: 720 }, hasTouch: true,
  });
  page.on('pageerror', (e) => errors.push(`[${i}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !t.includes('Failed to load resource')) {
      errors.push(`[${i}] console: ${t}`);
    }
    if (t.startsWith('[net] состояние разошлось')) errors.push(`[${i}] ${t}`);
  });

  // Страница отдаёт сообщение сюда, тест кладёт его второй странице
  await page.exposeFunction('__netOut', (msg) => {
    const other = 1 - i;
    setTimeout(() => {
      pages[other]?.evaluate((m) => globalThis.__netIn?.(m), msg).catch(() => {});
    }, LAG);
  });
  await page.addInitScript(() => {
    globalThis.WORMS_TRANSPORT = () => ({
      id: `p${Math.random().toString(36).slice(2, 8)}`,
      async connect(room, onMessage) { globalThis.__netIn = onMessage; },
      send(msg) { globalThis.__netOut({ ...msg, from: this.id }); },
      close() { globalThis.__netIn = null; },
    });
  });

  await page.goto(`${URL}/?biome=forest&room=${ROOM}`, { waitUntil: 'domcontentloaded' });
  pages.push(page);
}
const [A, B] = pages;

const ready = (p) => p.waitForFunction(
  () => window.__WORMS__?.scene.isActive('Game')
    && window.__WORMS__.scene.getScene('Game').turn?.activeWorm,
  null, { timeout: 40000 },
);
await Promise.all(pages.map(ready));

// --- знакомство ---
await Promise.all(pages.map((p) => p.waitForFunction(
  () => window.__WORMS__.scene.getScene('Game').net?.connected === true,
  null, { timeout: 30000 },
)));
await Promise.all(pages.map(ready));
await Promise.all(pages.map((p) => p.waitForTimeout(1200)));

const info = (p) => p.evaluate(async () => {
  const mod = await import('/src/net/protocol.js');
  const s = window.__WORMS__.scene.getScene('Game');
  return {
    seed: s.seed,
    myTeam: s.net.myTeam,
    terrain: s.terrain.hash(),
    turn: s.turn.turnNumber,
    team: s.turn.currentTeam,
    worm: s.worms.indexOf(s.turn.activeWorm),
    hp: s.worms.map((w) => `${w.health}${w.alive ? '' : '†'}`).join(','),
    pos: s.worms.map((w) => `${Math.round(w.x)}:${Math.round(w.y)}`).join(','),
    ammo: JSON.stringify(s.turn.ammo),
    solid: s.terrain.solid.reduce((a, v) => a + v, 0),
    state: s.turn.state,
    hash: mod.stateHash(mod.captureState(s)),
    fps: Math.round(s.game.loop.actualFps),
  };
});

const fire = (p) => p.evaluate(() => {
  const s = window.__WORMS__.scene.getScene('Game');
  s.hud.setHelp(false);
  const w = s.turn.activeWorm;
  const e = s.worms.find((o) => o.alive && o.team !== w.team);
  const dir = e && e.x < w.x ? -1 : 1;
  s.fireActiveWorm(dir * 430, -360);
});

/** Дождаться, пока обе стороны придут к следующему ходу. */
const bothNextTurn = (n) => Promise.all(pages.map((p) => p.waitForFunction(
  (from) => {
    const s = window.__WORMS__.scene.getScene('Game');
    return s.turn.turnNumber > from && ['aim', 'over'].includes(s.turn.state);
  }, n, { timeout: 45000 },
)));

let a = await info(A), b = await info(B);
// Порог низкий намеренно: важно не «быстро», а «не придушено». Фоновая
// вкладка давала 1-2 кадра в секунду — вот что этот порог ловит.
check('ни одна сторона не придушена по кадрам', a.fps >= 8 && b.fps >= 8,
  `${a.fps} / ${b.fps} fps`);
check('оба клиента спарились', a.myTeam !== null && b.myTeam !== null,
  `${a.myTeam} / ${b.myTeam}`);
check('команды разные', a.myTeam !== b.myTeam, `${a.myTeam} vs ${b.myTeam}`);
check('зерно общее', a.seed === b.seed, `${a.seed} / ${b.seed}`);
check('карта одинаковая', a.terrain === b.terrain, `${a.terrain} / ${b.terrain}`);
check('очередь совпадает', a.turn === b.turn && a.team === b.team && a.worm === b.worm,
  `ход ${a.turn}/${b.turn}, команда ${a.team}/${b.team}, боец ${a.worm}/${b.worm}`);

const rights = await Promise.all(pages.map((p) => p.evaluate(
  () => window.__WORMS__.scene.getScene('Game').canPlayerAct(),
)));
check('право хода ровно у одного', rights.filter(Boolean).length === 1,
  `A=${rights[0]} B=${rights[1]}`);

// --- три хода по очереди ---
for (let round = 1; round <= 3; round++) {
  a = await info(A); b = await info(B);
  const shooter = a.team === a.myTeam ? A : B;
  const watcher = shooter === A ? B : A;
  const solidBefore = (await info(watcher)).solid;

  await fire(shooter);

  if (round === 1) {
    const replayed = await watcher.waitForFunction(
      () => window.__WORMS__.scene.getScene('Game').projectiles.length > 0,
      null, { timeout: 8000 },
    ).then(() => true).catch(() => false);
    check('чужой выстрел проигрывается снарядом, а не телепортом', replayed);
  }

  await bothNextTurn(a.turn);
  await Promise.all(pages.map((p) => p.waitForTimeout(700)));

  a = await info(A); b = await info(B);
  const w = await info(watcher);
  check(`ход ${round}: очередь одинакова`,
    a.turn === b.turn && a.team === b.team && a.worm === b.worm,
    `ход ${a.turn}/${b.turn}, боец ${a.worm}/${b.worm}`);
  check(`ход ${round}: земля одинакова`, a.terrain === b.terrain,
    `${a.terrain} / ${b.terrain}`);
  check(`ход ${round}: воронка появилась и у зрителя`, w.solid < solidBefore,
    `${solidBefore} → ${w.solid}`);
  check(`ход ${round}: здоровье и позиции совпадают`,
    a.hp === b.hp && a.pos === b.pos, `${a.hp} | ${b.hp}`);
  check(`ход ${round}: патроны совпадают`, a.ammo === b.ammo, `${a.ammo} / ${b.ammo}`);
  check(`ход ${round}: свёртка состояния совпадает`, a.hash === b.hash,
    `${a.hash} / ${b.hash}`);
  check(`ход ${round}: ходят по очереди`, a.team !== a.myTeam || b.team !== b.myTeam);
}

// --- ссылка-приглашение ---
const link = await A.evaluate(() => window.__WORMS__.scene.getScene('Game').inviteLink());
check('ссылка-приглашение содержит комнату', link.includes(`room=${ROOM}`), link);

check('нет ошибок и расхождений', errors.length === 0, errors.slice(0, 5).join(' | '));

await Promise.all(browsers.map((br) => br.close()));
console.log(failures.length
  ? `\nПРОВАЛЕНО: ${failures.length} — ${failures.join(', ')}`
  : '\nсетевые проверки пройдены');
process.exit(failures.length ? 1 : 0);
