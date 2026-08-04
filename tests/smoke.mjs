/**
 * Смоук-тест: поднимает игру в headless-браузере и прогоняет основной цикл.
 *
 *   npm run test          (сам поднимет статику на 5173)
 *   node tests/smoke.mjs http://localhost:5173
 *
 * Нужен playwright: npm i -D playwright && npx playwright install chromium
 * Если браузер лежит вне стандартного места — путь в CHROMIUM_PATH.
 * Тест намеренно не мокает ничего — гоняется настоящая игра целиком.
 */
import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://127.0.0.1:5173';
const BIOME = 'forest';

const failures = [];
const errors = [];

function check(name, ok, detail = '') {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
}

// Путь можно навязать снаружи: в некоторых окружениях предустановленный
// Chromium не совпадает с ревизией, которую ждёт playwright.
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, hasTouch: true });

page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  const t = m.text();
  // Сбои загрузки внешних ресурсов не считаем: недостающие спрайты игра
  // штатно заменяет плейсхолдерами, а CDN может быть недоступен (у Phaser
  // есть локальный фолбэк). Настоящие поломки — это исключения и прочие
  // ошибки консоли, они ловятся ниже и в pageerror.
  if (m.type() === 'error' && !t.includes('Failed to load resource')) {
    errors.push(`console: ${t}`);
  }
});

await page.goto(`${URL}/?biome=${BIOME}`, { waitUntil: 'domcontentloaded' });

const ready = () => page.waitForFunction(
  () => window.__WORMS__?.scene.isActive('Game')
    && window.__WORMS__.scene.getScene('Game').turn?.activeWorm,
  null, { timeout: 40000 },
);
const state = () => page.evaluate(() => {
  const s = window.__WORMS__.scene.getScene('Game');
  return {
    turn: s.turn.turnNumber,
    phase: s.turn.state,
    alive: s.worms.filter((w) => w.alive).length,
    angle: Math.round((s.aimAngle * 180) / Math.PI),
    solid: s.terrain.solid.reduce((a, v) => a + v, 0),
    charge: s.charge,
    manual: s.rig.manual,
    zoom: +s.rig.zoom.toFixed(3),
    viewLeft: Math.round(s.rig.viewLeft),
  };
});
const waitAim = () => page.waitForFunction(
  () => ['aim', 'over'].includes(window.__WORMS__.scene.getScene('Game').turn.state),
  null, { timeout: 40000 },
);

await ready();
await page.waitForTimeout(1500);

const start = await state();
check('игра стартовала', start.alive === 4 && start.phase === 'aim');
check('прицел на 45°', start.angle === 45, `${start.angle}°`);

// --- каждое оружие стреляет через кнопку и рвёт землю ---
const WEAPONS = ['базука', 'граната', 'кассета', 'крот'];
for (let i = 0; i < WEAPONS.length; i++) {
  await waitAim();
  const before = await page.evaluate((wi) => {
    const s = window.__WORMS__.scene.getScene('Game');
    s.turn.setWeaponIndex(wi);
    // Целимся в сторону ближайшего противника под пологим углом: при
    // фиксированном заряде снаряд гарантированно падает на остров, а не
    // улетает в воду — иначе проверка воронки мигала бы от карты к карте.
    const w = s.turn.activeWorm;
    const e = s.worms.find((o) => o.alive && o.team !== w.team);
    if (e) w.facing = e.x >= w.x ? 1 : -1;
    s.aimAngle = 0.44;
    return { turn: s.turn.turnNumber, solid: s.terrain.solid.reduce((a, v) => a + v, 0) };
  }, i);

  await page.mouse.move(1192, 640);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();

  await page.waitForFunction(
    (t) => {
      const s = window.__WORMS__.scene.getScene('Game');
      return s.turn.turnNumber > t || s.turn.state === 'over';
    }, before.turn, { timeout: 40000 },
  );
  const after = await page.evaluate(
    () => window.__WORMS__.scene.getScene('Game').terrain.solid.reduce((a, v) => a + v, 0),
  );
  check(`${WEAPONS[i]}: воронка в земле`, before.solid - after > 200,
    `${before.solid - after} px`);
}

// --- короткое касание не тратит ход ---
await waitAim();
const beforeTap = await state();
await page.mouse.click(1192, 640, { delay: 20 });
await page.waitForTimeout(500);
const afterTap = await state();
check('короткий тап не тратит ход',
  afterTap.turn === beforeTap.turn && afterTap.phase === 'aim');

// --- кнопки угла ---
await page.mouse.move(1082, 604);
await page.mouse.down();
await page.waitForTimeout(400);
await page.mouse.up();
const aimed = await state();
check('кнопка ▲ поднимает прицел', aimed.angle > beforeTap.angle,
  `${beforeTap.angle}° → ${aimed.angle}°`);

// --- протяжка камеры и возврат кнопкой ---
await page.mouse.move(640, 300);
await page.mouse.down();
await page.mouse.move(300, 300, { steps: 10 });
await page.mouse.up();
const panned = await state();
check('камера тянется пальцем', panned.manual && panned.viewLeft !== aimed.viewLeft,
  `${aimed.viewLeft} → ${panned.viewLeft}`);
await page.mouse.click(128, 600);          // кнопка «к бойцу»
await page.waitForTimeout(300);
const focused = await state();
check('кнопка «к бойцу» возвращает камеру', !focused.manual);

// --- зум ---
const zoomState = await page.evaluate(() => {
  const s = window.__WORMS__.scene.getScene('Game');
  const before = s.rig.zoom;
  s.rig.toggleOverview();
  return { before, after: s.rig.zoom, fit: s.rig.fitZoom };
});
check('обзор отдаляет камеру', zoomState.after < zoomState.before,
  `${zoomState.before} → ${zoomState.after.toFixed(2)}`);

// Самое хрупкое место всей затеи с зумом: экранные и мировые координаты
// должны сходиться, иначе прицел начнёт врать тихо и не сразу.
const roundTrip = await page.evaluate(() => {
  const s = window.__WORMS__.scene.getScene('Game');
  const r = s.rig;
  const out = [];
  for (const z of [0.5, 1, 1.6]) {
    r.setZoom(z);
    const w = s.turn.activeWorm;
    const p = s.input.activePointer;
    p.x = r.screenX(w.x);
    p.y = 300;
    out.push({ z, err: Math.abs(r.worldPoint(p).x - w.x) });
  }
  r.setZoom(1);
  r.focus(s.turn.activeWorm);
  return out;
});
for (const t of roundTrip) {
  check(`координаты сходятся при зуме ${t.z}`, t.err < 1.5, `ошибка ${t.err.toFixed(2)} px`);
}

// --- пинч двумя пальцами ---
// Playwright умеет только одиночные касания, поэтому два пальца шлём
// напрямую через CDP.
const cdp = await page.context().newCDPSession(page);
const touch = async (type, pts) => {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i })),
  });
  await page.waitForTimeout(70);
};
const zoomNow = () => page.evaluate(() => window.__WORMS__.scene.getScene('Game').rig.zoom);

await page.evaluate(() => window.__WORMS__.scene.getScene('Game').rig.setZoom(1));
await touch('touchStart', [[400, 300], [880, 300]]);
for (const d of [400, 300, 200, 130]) await touch('touchMove', [[640 - d / 2, 300], [640 + d / 2, 300]]);
await touch('touchEnd', []);
const pinchedIn = await zoomNow();
check('пинч двумя пальцами отдаляет', pinchedIn < 0.95, `зум ${pinchedIn.toFixed(2)}`);

await touch('touchStart', [[570, 300], [710, 300]]);
for (const d of [140, 300, 460, 640]) await touch('touchMove', [[640 - d / 2, 300], [640 + d / 2, 300]]);
await touch('touchEnd', []);
const pinchedOut = await zoomNow();
check('пинч двумя пальцами приближает', pinchedOut > pinchedIn,
  `${pinchedIn.toFixed(2)} → ${pinchedOut.toFixed(2)}`);

await page.evaluate(() => {
  const s = window.__WORMS__.scene.getScene('Game');
  s.rig.setZoom(1);
  s.rig.focus(s.turn.activeWorm);
});

// --- указатели на бойцов за краем экрана ---
const markers = await page.evaluate(() => {
  const s = window.__WORMS__.scene.getScene('Game');
  const r = s.rig;
  r.setViewLeft(0);
  s.offscreen.update();
  const off = s.worms.filter((w) => w.alive && r.screenX(w.x) > 1280 - 70).length;
  const shown = s.offscreen.labels.filter((l) => l.visible).length;
  r.focus(s.turn.activeWorm);
  return { off, shown };
});
check('указатели показывают бойцов вне экрана', markers.shown === markers.off,
  `за краем ${markers.off}, показано ${markers.shown}`);

// --- свайп по бойцу всё ещё стреляет ---
await waitAim();
const wormPos = await page.evaluate(() => {
  const s = window.__WORMS__.scene.getScene('Game');
  const w = s.turn.activeWorm; const r = s.rig;
  return { x: r.screenX(w.x), y: (w.centerY - r.viewTop) * r.zoom };
});
await page.mouse.move(wormPos.x, wormPos.y);
await page.mouse.down();
await page.mouse.move(wormPos.x + 70, wormPos.y - 90, { steps: 8 });
await page.waitForTimeout(120);
await page.mouse.up();
await page.waitForTimeout(400);
check('свайп по бойцу стреляет', (await state()).phase === 'flying');

// --- победа и рестарт ---
await waitAim();
await page.evaluate(() => {
  const s = window.__WORMS__.scene.getScene('Game');
  s.worms.filter((w) => w.team === 1).forEach((w) => w.damage(999));
});
await page.waitForFunction(
  () => window.__WORMS__.scene.getScene('Game').turn.state === 'over',
  null, { timeout: 40000 },
);
check('победа засчитана', true);

await page.waitForTimeout(1000);
await page.mouse.click(640, 300);
await ready();
await page.waitForTimeout(1200);
const restarted = await state();
check('рестарт создаёт новую партию',
  restarted.turn === 1 && restarted.alive === 4 && restarted.angle === 45);

check('нет ошибок в консоли', errors.length === 0, errors.slice(0, 5).join(' | '));

await browser.close();

console.log(failures.length
  ? `\nПРОВАЛЕНО: ${failures.length} — ${failures.join(', ')}`
  : '\nвсе проверки пройдены');
process.exit(failures.length ? 1 : 0);
