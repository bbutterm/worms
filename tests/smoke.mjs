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
// Карта закреплена зерном: граната скачет, и на случайном острове она
// иногда укатывалась в воду — проверка воронки мигала от запуска к запуску.
// Пофаззить карту всё ещё можно: SEED=random npm test (или своё число).
const SEED = process.env.SEED || '777';

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
// Пропорции окна можно навязать: раскладка под них подстраивается, и
// проверять её надо не только на 16:9. Пример: VIEWPORT=932x430 npm test
const [vpW, vpH] = (process.env.VIEWPORT || '1280x720').split('x').map(Number);
const page = await browser.newPage({ viewport: { width: vpW, height: vpH }, hasTouch: true });

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

const seedParam = SEED === 'random' ? '' : `&seed=${SEED}`;
await page.goto(`${URL}/?biome=${BIOME}${seedParam}`, { waitUntil: 'domcontentloaded' });

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
    charging: s.charging,
    manual: s.rig.manual,
    zoom: +s.rig.zoom.toFixed(3),
    viewLeft: Math.round(s.rig.viewLeft),
  };
});
const waitAim = () => page.waitForFunction(
  () => ['aim', 'over'].includes(window.__WORMS__.scene.getScene('Game').turn.state),
  null, { timeout: 40000 },
);

// Игра теперь начинается с меню, и тест проходит его так же, как игрок:
// «Быстрая игра» → «Вдвоём на одном устройстве».
const menuReady = () => page.waitForFunction(
  () => window.__WORMS__?.scene.isActive('Menu')
    && Object.keys(window.__WORMS__.scene.getScene('Menu').buttons).length > 0,
  null, { timeout: 40000 },
);
const menuTap = async (key) => {
  const b = await page.evaluate((k) => {
    const m = window.__WORMS__.scene.getScene('Menu');
    return m.buttons[k] ?? null;
  }, key);
  if (!b) throw new Error(`нет кнопки меню: ${key}`);
  const g = await page.evaluate(() => {
    const game = window.__WORMS__;
    const r = game.canvas.getBoundingClientRect();
    return { w: game.scale.width, h: game.scale.height, left: r.left, top: r.top,
      cw: r.width, ch: r.height };
  });
  await page.mouse.click(
    Math.round(g.left + (b.x * g.cw) / g.w),
    Math.round(g.top + (b.y * g.ch) / g.h),
  );
  await page.waitForTimeout(300);
};

await menuReady();
check('меню открылось первым', true);
await menuTap('quick');
await menuTap('hotseat');

await ready();
await page.waitForTimeout(1500);

// Раскладка зависит от пропорций окна, поэтому координаты кнопок берём
// у самой игры, а не зашиваем в тест.
const BTN = await page.evaluate(() => window.__WORMS__.scene.getScene('Game').hud.buttons);
const view = await page.evaluate(() => {
  const g = window.__WORMS__;
  const r = g.canvas.getBoundingClientRect();
  return { w: g.scale.width, h: g.scale.height, left: r.left, top: r.top, cw: r.width, ch: r.height };
});
// Логические координаты игры не равны CSS-пикселям окна: канвас
// масштабируется под экран. Мышь и касания ходят в CSS-пикселях.
const px = (x, y) => [
  Math.round(view.left + (x * view.cw) / view.w),
  Math.round(view.top + (y * view.ch) / view.h),
];
check('логическая ширина подогнана под экран', view.w >= 1280 && view.h === 720,
  `${view.w}x${view.h}`);

// Кнопки не должны наезжать друг на друга: раскладка считается от размера
// экрана, и на нестандартных пропорциях это легко проглядеть.
const overlaps = await page.evaluate(() => {
  const r = window.__WORMS__.scene.getScene('Game').hud.uiRects;
  const bad = [];
  for (let i = 0; i < r.length; i++) {
    for (let j = i + 1; j < r.length; j++) {
      const a = r[i], b = r[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
        bad.push(`${Math.round(a.x)},${Math.round(a.y)} × ${Math.round(b.x)},${Math.round(b.y)}`);
      }
    }
  }
  return bad;
});
check('кнопки интерфейса не пересекаются', overlaps.length === 0, overlaps.slice(0, 3).join(' | '));

// Подсказка показывается на старте и перекрывает поле
await page.evaluate(() => window.__WORMS__.scene.getScene('Game').hud.setHelp(false));

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

  await page.mouse.move(...px(BTN.fire.x, BTN.fire.y));
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

// Четыре взрыва подряд иногда выбивают команду целиком, и партия
// заканчивается. Дальше проверяется интерфейс, а не бой, поэтому начинаем
// с чистого листа: иначе первый же тап уходил бы в «начать заново», и
// следующие проверки ехали бы по чужому состоянию.
await page.evaluate(() => window.__WORMS__.scene.getScene('Game').scene.restart());
await ready();
await page.waitForTimeout(1200);
await page.evaluate(() => window.__WORMS__.scene.getScene('Game').hud.setHelp(false));

// --- короткое касание не тратит ход ---
await waitAim();
const beforeTap = await state();
await page.mouse.click(...px(BTN.fire.x, BTN.fire.y), { delay: 20 });
await page.waitForTimeout(500);
const afterTap = await state();
check('короткий тап не тратит ход',
  afterTap.turn === beforeTap.turn && afterTap.phase === 'aim');

// --- кнопки угла ---
await page.mouse.move(...px(BTN.aimUp.x, BTN.aimUp.y));
await page.mouse.down();
await page.waitForTimeout(400);
await page.mouse.up();
const aimed = await state();
check('кнопка ▲ поднимает прицел', aimed.angle > beforeTap.angle,
  `${beforeTap.angle}° → ${aimed.angle}°`);

// --- протяжка камеры и возврат кнопкой ---
await page.mouse.move(...px(view.w / 2, 300));
await page.mouse.down();
await page.mouse.move(...px(view.w / 2 - 340, 300), { steps: 10 });
await page.mouse.up();
const panned = await state();
check('камера тянется пальцем', panned.manual && panned.viewLeft !== aimed.viewLeft,
  `${aimed.viewLeft} → ${panned.viewLeft}`);
await page.mouse.click(...px(BTN.focus.x, BTN.focus.y));   // кнопка «к бойцу»
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

// При зуме 1 мир по высоте ровно равен виду: любое смещение срезало бы
// небо сверху и показывало пустую воду снизу.
const topAt1 = await page.evaluate(() => {
  const r = window.__WORMS__.scene.getScene('Game').rig;
  r.setZoom(1);
  return Math.round(r.viewTop);
});
check('при зуме 1 вид не смещён по вертикали', topAt1 === 0, `viewTop ${topAt1}`);

// --- пинч двумя пальцами ---
// Playwright умеет только одиночные касания, поэтому два пальца шлём
// напрямую через CDP.
const cdp = await page.context().newCDPSession(page);
const touch = async (type, pts) => {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: pts.map((p, i) => {
      const [x, y] = px(p[0], p[1]);
      return { x, y, id: p[2] ?? i };
    }),
  });
  await page.waitForTimeout(70);
};
const zoomNow = () => page.evaluate(() => window.__WORMS__.scene.getScene('Game').rig.zoom);

await page.evaluate(() => window.__WORMS__.scene.getScene('Game').rig.setZoom(1));
await touch('touchStart', [[view.w / 2 - 240, 300], [view.w / 2 + 240, 300]]);
const cx = Math.round(view.w / 2);
for (const d of [400, 300, 200, 130]) await touch('touchMove', [[cx - d / 2, 300], [cx + d / 2, 300]]);
// Пальцы снимаем поимённо: в touchEnd перечисляются те, что убираются, и
// пустой список оставлял их «прижатыми» — следующие касания разъезжались.
await touch('touchEnd', [[cx - 65, 300], [cx + 65, 300]]);
const pinchedIn = await zoomNow();
check('пинч двумя пальцами отдаляет', pinchedIn < 0.95, `зум ${pinchedIn.toFixed(2)}`);

await touch('touchStart', [[view.w / 2 - 70, 300], [view.w / 2 + 70, 300]]);
for (const d of [140, 300, 460, 640]) await touch('touchMove', [[cx - d / 2, 300], [cx + d / 2, 300]]);
await touch('touchEnd', [[cx - 320, 300], [cx + 320, 300]]);
const pinchedOut = await zoomNow();
check('пинч двумя пальцами приближает', pinchedOut > pinchedIn,
  `${pinchedIn.toFixed(2)} → ${pinchedOut.toFixed(2)}`);

// --- угол правится прямо во время набора силы, как в оригинале ---
// Один палец держит «ОГОНЬ», второй жмёт ▲. Раньше на отпускании второго
// пальца срабатывало общее «отпустить всё», и выстрел уходил сам.
//
// Про CDP: в touchEnd перечисляются пальцы, которые СНИМАЮТСЯ, а не те,
// что остаются. На этом первая версия проверки и попалась — она снимала
// «ОГОНЬ» вместо ▲ и обвиняла игру в собственной ошибке.
// Окно короткое намеренно: шкала заряжается за 1.1 с и на максимуме
// стреляет сама. Первая версия проверки не укладывалась и ловила этот
// штатный выстрел, принимая его за сорванный курок.
await waitAim();
await page.evaluate(() => {
  const s = window.__WORMS__.scene.getScene('Game');
  s.rig.setZoom(1);
  s.aimAngle = 0.5;      // от прошлых шагов угол мог упереться в предел
});
const beforeCharge = await state();
const FINGER_FIRE = [BTN.fire.x, BTN.fire.y, 0];
const FINGER_AIM = [BTN.aimUp.x, BTN.aimUp.y, 1];

await touch('touchStart', [FINGER_FIRE]);
await page.waitForTimeout(60);
const charging1 = await state();

await touch('touchStart', [FINGER_FIRE, FINGER_AIM]);
await page.waitForTimeout(90);
await touch('touchEnd', [FINGER_AIM]);       // снимаем только второй палец
await page.waitForTimeout(60);
const aimedWhileCharging = await state();

check('угол меняется, пока держишь «ОГОНЬ»',
  aimedWhileCharging.angle > charging1.angle,
  `${charging1.angle}° → ${aimedWhileCharging.angle}°`);
check('второй палец не спускает курок',
  aimedWhileCharging.phase === 'aim'
    && aimedWhileCharging.turn === beforeCharge.turn
    && aimedWhileCharging.charging === true
    && aimedWhileCharging.charge > charging1.charge,
  `заряд ${charging1.charge.toFixed(2)} → ${aimedWhileCharging.charge.toFixed(2)}, `
  + `держим: ${aimedWhileCharging.charging}`);

await touch('touchEnd', [FINGER_FIRE]);
await page.waitForTimeout(220);
const afterRelease = await state();
check('выстрел уходит, когда отпущен «ОГОНЬ»',
  afterRelease.phase !== 'aim' || afterRelease.turn > beforeCharge.turn,
  `фаза ${afterRelease.phase}`);
await waitAim();

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
  const off = s.worms.filter((w) => w.alive && r.screenX(w.x) > s.scale.width - 70).length;
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
await page.mouse.move(...px(wormPos.x, wormPos.y));
await page.mouse.down();
await page.mouse.move(...px(wormPos.x + 70, wormPos.y - 90), { steps: 8 });
await page.waitForTimeout(120);
await page.mouse.up();
await page.waitForTimeout(400);
check('свайп по бойцу стреляет', (await state()).phase === 'flying');

// --- патроны ---
await waitAim();
const ammo = await page.evaluate(() => {
  const s = window.__WORMS__.scene.getScene('Game');
  const inf = s.turn.ammoOf(0);
  const before = s.turn.ammoOf(1);
  s.turn.setWeaponIndex(1);
  s.turn.spendAmmo();
  const after = s.turn.ammoOf(1);
  // выбрать пустое оружие нельзя
  s.turn.ammo[s.turn.currentTeam][2] = 0;
  s.turn.setWeaponIndex(2);
  return { inf, before, after, picked: s.turn.weaponIndex };
});
check('у базуки патроны бесконечны', ammo.inf === null || ammo.inf > 1e9);
check('выстрел тратит патрон', ammo.after === ammo.before - 1,
  `${ammo.before} → ${ammo.after}`);
check('пустое оружие не выбирается', ammo.picked !== 2);

// --- ящик: падает, приземляется, подбирается ---
const crate = await page.evaluate(() => new Promise((res) => {
  const s = window.__WORMS__.scene.getScene('Game');
  s.crates.forEach((c) => c.destroy());
  s.crates.length = 0;
  for (let i = 0; i < 80 && s.crates.length === 0; i++) s.maybeDropCrate();
  if (!s.crates.length) { res({ spawned: false }); return; }

  const c = s.crates[0];
  c.kind = 'health';
  const startY = c.y;
  // Досаживаем ящик на землю: в headless кадры редкие, ждать долго
  const ground = s.terrain.surfaceYAt(c.x, 0);
  c.y = ground - 1;
  c._land();

  const w = s.turn.activeWorm;
  w.health = 40;
  w.x = c.x;
  w.y = ground - 1;
  setTimeout(() => {
    res({
      spawned: true, startY: Math.round(startY), landed: c.landed,
      collected: !c.alive, health: w.health, crates: s.crates.length,
    });
  }, 600);
}));
check('ящик появляется и спускается сверху', crate.spawned && crate.startY < 60,
  `старт y=${crate.startY}`);
check('ящик приземляется', crate.landed === true);
check('боец подбирает аптечку', crate.collected && crate.health > 40,
  `здоровье ${crate.health}`);

// --- воспроизводимость по зерну (основа сетевой игры) ---
const repro = await page.evaluate(async () => {
  const s = window.__WORMS__.scene.getScene('Game');
  const snap = () => {
    const g = window.__WORMS__.scene.getScene('Game');
    return {
      seed: g.seed,
      biome: g.terrain.biome.id,
      terrain: g.terrain.hash(),
      spawns: g.worms.map((w) => `${Math.round(w.x)}`).join(','),
      // случайность хода не должна зависеть от порядка вызовов
      turn7: [0, 1, 2].map(() => {
        g.beginTurnRandom(7);
        return Math.round(g.turnRng() * 1e6);
      }).join('|'),
    };
  };
  s.registry.set('seed', 424242);
  s.scene.restart();
  await new Promise((r) => setTimeout(r, 2500));
  const a = snap();
  window.__WORMS__.scene.getScene('Game').scene.restart();
  await new Promise((r) => setTimeout(r, 2500));
  const b = snap();
  return { a, b };
});
check('одно зерно — одна карта', repro.a.terrain === repro.b.terrain,
  `${repro.a.terrain} / ${repro.b.terrain}`);
check('одно зерно — одна расстановка', repro.a.spawns === repro.b.spawns);
check('одно зерно — один биом', repro.a.biome === repro.b.biome);
check('случайность хода не зависит от порядка вызовов',
  repro.a.turn7.split('|').every((v, _, arr) => v === arr[0]), repro.a.turn7);

// --- протокол: приказ и снимок ---
await page.waitForFunction(() => window.__WORMS__.scene.getScene('Game').turn?.activeWorm,
  null, { timeout: 40000 });
await page.waitForTimeout(800);
const proto = await page.evaluate(async () => {
  const mod = await import('/src/net/protocol.js');
  const s = window.__WORMS__.scene.getScene('Game');
  s.hud.setHelp(false);

  // приказ формируется при выстреле
  let cmd = null;
  s.onShot = (c) => { cmd = c; };
  const w = s.turn.activeWorm;
  const e = s.worms.find((o) => o.alive && o.team !== w.team);
  if (e) w.facing = e.x >= w.x ? 1 : -1;
  s.aimAngle = 0.44;
  s.fireActiveWorm(400, -400);

  const before = mod.captureState(s);
  const h1 = mod.stateHash(before);

  // портим состояние и восстанавливаем из снимка
  s.worms.forEach((x) => { x.health = 7; x.x += 40; });
  s.turn.ammo[0][1] = 99;
  mod.applyState(s, before);
  const after = mod.captureState(s);

  return {
    cmd, h1, h2: mod.stateHash(after),
    hp: s.worms.map((x) => x.health).join(','),
    beforeHp: before.worms.map((x) => x.hp).join(','),
    cfg: mod.matchConfig(s),
  };
});
check('приказ формируется при выстреле',
  proto.cmd && proto.cmd.type === 'shot' && Number.isFinite(proto.cmd.vx),
  proto.cmd ? `оружие ${proto.cmd.weapon}, боец ${proto.cmd.worm}` : 'нет');
check('снимок восстанавливает состояние', proto.h1 === proto.h2,
  `${proto.h1} / ${proto.h2}`);
check('здоровье вернулось из снимка', proto.hp === proto.beforeHp,
  `${proto.hp} vs ${proto.beforeHp}`);
check('параметры партии содержат зерно и биом',
  Number.isFinite(proto.cfg.seed) && !!proto.cfg.biome);

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
await page.mouse.click(...px(view.w / 2, 300));
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
