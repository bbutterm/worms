/**
 * Игра внутри Telegram Mini App.
 *
 *   node tests/telegram.mjs http://127.0.0.1:5187
 *
 * Настоящего Telegram в тесте нет: вместо SDK подставляется поддельный
 * window.Telegram.WebApp, который помнит, что у него вызывали, и отвечает
 * так, как отвечает клиент с Bot API 8.0. Проверяется всё, что игра
 * делает по-своему внутри Telegram:
 *   • личность и рейтинг берутся из аккаунта: имя из initData, рейтинг
 *     из CloudStorage, и облако главнее локальной копии;
 *   • игровое поле отступает от кнопок Telegram и от «чёлки»;
 *   • ссылка-приглашение ведёт в t.me, а «позвать друга» открывает
 *     родной выбор чата;
 *   • startapp=КОД из приглашения ведёт прямо в комнату;
 *   • «На экран Домой»: кнопка в меню, предложение после первой партии
 *     ровно один раз, и кнопка пропадает, когда иконка стоит.
 */
import { chromium } from 'playwright';
import { launchOptions } from './browser.mjs';

const URL = process.argv[2] || 'http://127.0.0.1:5173';

const failures = [];
const errors = [];

function check(name, ok, detail = '') {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
}

const browser = await chromium.launch(launchOptions());

/**
 * Страница «внутри Telegram». Подделка ставится до загрузки страницы,
 * а настоящий SDK с telegram.org не пускаем: он бы её перезаписал.
 */
async function openPage({ startParam = null, cloud = {}, local = null, viewport, old = false } = {}) {
  const page = await browser.newPage({
    viewport: viewport ?? { width: 932, height: 430 },   // iPhone в ландшафте
    hasTouch: true,
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !t.includes('Failed to load resource')) errors.push(`console: ${t}`);
  });
  await page.route('**/telegram-web-app.js', (r) => r.abort());

  await page.addInitScript(({ startParam, cloud, local, old }) => {
    const calls = [];
    const listeners = new Map();
    const store = new Map(Object.entries(cloud));
    const fire = (ev, data) => (listeners.get(ev) ?? []).forEach((fn) => fn(data));
    const WebApp = {
      version: '8.0',
      platform: 'ios',
      initData: 'query_id=test&user=%7B%22id%22%3A42%7D&hash=deadbeef',
      initDataUnsafe: {
        user: { id: 42, first_name: 'Тест', last_name: 'Телеграмов' },
        ...(startParam ? { start_param: startParam } : {}),
      },
      isFullscreen: false,
      // «Чёлка» слева/справа в ландшафте плюс кнопки Telegram сверху
      safeAreaInset: { top: 0, bottom: 21, left: 47, right: 47 },
      contentSafeAreaInset: { top: 46, bottom: 0, left: 0, right: 0 },
      isVersionAtLeast: (v) => Number(v.split('.')[0]) <= 8,
      ready() { calls.push('ready'); },
      expand() { calls.push('expand'); },
      requestFullscreen() { calls.push('requestFullscreen'); this.isFullscreen = true; fire('fullscreenChanged'); },
      lockOrientation() { calls.push('lockOrientation'); },
      disableVerticalSwipes() { calls.push('disableVerticalSwipes'); },
      setHeaderColor() {}, setBackgroundColor() {}, setBottomBarColor() {},
      onEvent(ev, fn) { listeners.set(ev, [...(listeners.get(ev) ?? []), fn]); },
      offEvent(ev, fn) { listeners.set(ev, (listeners.get(ev) ?? []).filter((f) => f !== fn)); },
      openTelegramLink(url) { calls.push(`openTelegramLink:${url}`); },
      checkHomeScreenStatus(cb) { calls.push('checkHomeScreenStatus'); setTimeout(() => cb(WebApp.__home), 30); },
      addToHomeScreen() {
        calls.push('addToHomeScreen');
        WebApp.__home = 'added';
        setTimeout(() => fire('homeScreenAdded'), 30);
      },
      __home: 'missed',
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
      CloudStorage: {
        getItem(k, cb) { setTimeout(() => cb(null, store.get(k) ?? ''), 20); },
        setItem(k, v, cb) { store.set(k, String(v)); setTimeout(() => cb?.(null, true), 20); },
        __store: store,
      },
      __calls: calls,
      __fire: fire,
    };
    if (old) {
      // Клиент без Bot API 8.0: ни иконки, ни полного экрана
      WebApp.version = '7.0';
      delete WebApp.checkHomeScreenStatus;
      delete WebApp.addToHomeScreen;
      delete WebApp.requestFullscreen;
    }
    globalThis.Telegram = { WebApp };
    globalThis.WORMS_TG = { bot: 'worms_test_bot' };
    if (local) localStorage.setItem('worms.player.v1', JSON.stringify(local));
    // Сеть здесь не проверяется: транспорт-пустышка, чтобы лобби и
    // комната не ломились в настоящий сервис
    globalThis.WORMS_TRANSPORT = () => ({
      id: `p${Math.random().toString(36).slice(2, 8)}`,
      async connect() {}, send() {}, close() {},
    });
  }, { startParam, cloud, local, old });

  await page.goto(`${URL}/?biome=forest&seed=777`, { waitUntil: 'domcontentloaded' });
  return page;
}

const menuReady = (p) => p.waitForFunction(
  () => window.__WORMS__?.scene.isActive('Menu')
    && Object.keys(window.__WORMS__.scene.getScene('Menu').buttons).length > 0,
  null, { timeout: 40000 },
);
const gameReady = (p) => p.waitForFunction(
  () => window.__WORMS__?.scene.isActive('Game')
    && window.__WORMS__.scene.getScene('Game').turn?.activeWorm,
  null, { timeout: 40000 },
);
const calls = (p) => p.evaluate(() => [...Telegram.WebApp.__calls]);

// ================================================= запуск, профиль, отступы

const localProfile = { id: 'gold', name: 'Локальный', rating: 1000, wins: 0, losses: 0 };
const cloudProfile = { id: 'tg42', name: 'Тест Телеграмов', rating: 1234, wins: 5, losses: 2 };
const page = await openPage({
  local: localProfile,
  cloud: { 'worms.player.v1': JSON.stringify(cloudProfile) },
});
await menuReady(page);

const boot = await calls(page);
check('при запуске: ready, expand, полный экран, блокировка поворота',
  ['ready', 'expand', 'requestFullscreen', 'lockOrientation'].every((c) => boot.includes(c)),
  boot.join(', '));

const me = await page.evaluate(() => {
  const m = window.__WORMS__.scene.getScene('Menu');
  m.showOnline();
  return JSON.parse(localStorage.getItem('worms.player.v1'));
});
check('имя и идентификатор — из аккаунта Telegram',
  me.id === 'tg42' && me.name === 'Тест Телеграмов', `${me.id} / ${me.name}`);
check('рейтинг — из облака, а не из локальной копии',
  me.rating === 1234 && me.wins === 5, `рейтинг ${me.rating}, побед ${me.wins}`);

const area = await page.evaluate(() => {
  const r = document.getElementById('game').getBoundingClientRect();
  const c = document.querySelector('#game canvas').getBoundingClientRect();
  return {
    top: r.top, left: r.left, right: innerWidth - r.right, bottom: innerHeight - r.bottom,
    canvasInside: c.left >= r.left - 1 && c.top >= r.top - 1
      && c.right <= r.right + 1 && c.bottom <= r.bottom + 1,
    canvas: `${Math.round(c.width)}x${Math.round(c.height)}`,
    ratio: Math.abs((c.width / c.height) - (r.width / r.height)),
  };
});
check('игровое поле отступает от кнопок Telegram и от «чёлки»',
  area.top === 46 && area.left === 47 && area.right === 47 && area.bottom === 21,
  `сверху ${area.top}, слева ${area.left}, справа ${area.right}, снизу ${area.bottom}`);
check('канвас целиком внутри поля и заполняет его без полей',
  area.canvasInside && area.ratio < 0.02, `${area.canvas}, расхождение пропорций ${area.ratio.toFixed(3)}`);

// ------------------------------------------------------------ приглашение

const invite = await page.evaluate(() => {
  const m = window.__WORMS__.scene.getScene('Menu');
  m.showRoom('ABC123');
  const link = m.inviteLink('ABC123');
  const b = m.buttons.copy;
  return { link, button: b ? { x: b.x, y: b.y } : null };
});
check('ссылка-приглашение ведёт в t.me с кодом комнаты',
  invite.link === 'https://t.me/worms_test_bot?startapp=ABC123', invite.link);

await page.evaluate(() => window.__WORMS__.scene.getScene('Menu').buttons.copy);
await tapButton(page, invite.button);
const shared = (await calls(page)).find((c) => c.startsWith('openTelegramLink:'));
check('«позвать друга» открывает родной выбор чата со ссылкой',
  Boolean(shared) && shared.includes('t.me/share/url') && shared.includes(encodeURIComponent(invite.link)),
  shared ?? 'не вызывалось');

// -------------------------------------------------------- на экран Домой

await page.evaluate(() => window.__WORMS__.scene.getScene('Menu').showRoot());
const homeBtn = await page.evaluate(() => window.__WORMS__.scene.getScene('Menu').buttons.home ?? null);
check('в меню есть кнопка «На экран Домой», пока иконки нет', Boolean(homeBtn));

// Первая партия: играем хотсит и завершаем — предложение должно всплыть
await page.evaluate(() => {
  const m = window.__WORMS__.scene.getScene('Menu');
  m.showQuick();
});
await page.evaluate(() => {
  const m = window.__WORMS__.scene.getScene('Menu');
  const b = m.buttons.hotseat;
  m.start({ mode: 'quick', teams: [{ worms: 2, control: 'human' }, { worms: 2, control: 'human' }], rules: {} });
  return b;
});
await gameReady(page);
await page.evaluate(() => {
  const s = window.__WORMS__.scene.getScene('Game');
  s.worms.filter((w) => w.team === 1).forEach((w) => w.damage(999));
});
const offered = await page.waitForFunction(
  () => Telegram.WebApp.__calls.includes('addToHomeScreen'), null, { timeout: 15000 },
).then(() => true).catch(() => false);
check('после первой доигранной партии Telegram предлагает иконку', offered);
const offeredFlag = await page.evaluate(() => Telegram.WebApp.CloudStorage.__store.get('worms.home.offered'));
check('отметка «уже предлагали» лежит в облаке', offeredFlag === '1', String(offeredFlag));

// Иконка поставлена → кнопка в меню пропадает
await page.evaluate(() => window.__WORMS__.scene.getScene('Game').toMenu());
await menuReady(page);
const homeAfter = await page.evaluate(() => window.__WORMS__.scene.getScene('Menu').buttons.home ?? null);
check('когда иконка стоит, кнопки в меню нет', homeAfter === null);

// Вторая партия — предложения быть не должно
const offersBefore = (await calls(page)).filter((c) => c === 'addToHomeScreen').length;
await page.evaluate(() => {
  const m = window.__WORMS__.scene.getScene('Menu');
  m.start({ mode: 'quick', teams: [{ worms: 2, control: 'human' }, { worms: 2, control: 'human' }], rules: {} });
});
await gameReady(page);
await page.evaluate(() => {
  const s = window.__WORMS__.scene.getScene('Game');
  s.worms.filter((w) => w.team === 1).forEach((w) => w.damage(999));
});
await page.waitForFunction(() => window.__WORMS__.scene.getScene('Game').gameOverUi, null, { timeout: 15000 });
await page.waitForTimeout(2200);
const offersAfter = (await calls(page)).filter((c) => c === 'addToHomeScreen').length;
check('второй раз иконку не предлагают', offersAfter === offersBefore, `${offersBefore} → ${offersAfter}`);

// Результат боя ушёл в облако
const cloudAfter = await page.evaluate(() => JSON.parse(Telegram.WebApp.CloudStorage.__store.get('worms.player.v1')));
check('профиль пишется в облако', cloudAfter?.id === 'tg42', JSON.stringify(cloudAfter));

await page.close();

// ------------------------------------------- вход по ссылке-приглашению

const guest = await openPage({ startParam: 'ROOM42' });
const straight = await guest.waitForFunction(
  () => window.__WORMS__?.scene.isActive('Game') && window.__WORMS__.scene.getScene('Game').room === 'ROOM42',
  null, { timeout: 40000 },
).then(() => true).catch(() => false);
check('startapp=КОД ведёт прямо в комнату, минуя меню', straight);
const guestLink = await guest.evaluate(() => window.__WORMS__.scene.getScene('Game').inviteLink());
check('ссылка из партии — тоже t.me', guestLink === 'https://t.me/worms_test_bot?startapp=ROOM42', guestLink);
await guest.close();

// ------------------------------------------------------- старый клиент

const old = await openPage({ old: true });
await menuReady(old);
const oldHome = await old.evaluate(() => window.__WORMS__.scene.getScene('Menu').buttons.home ?? null);
check('старый клиент без иконки — кнопки нет и ничего не падает', oldHome === null);
await old.close();

await browser.close();

/** Тап по кнопке меню: координаты логические, переводим в экранные. */
async function tapButton(p, b) {
  if (!b) throw new Error('кнопки нет');
  const pt = await p.evaluate(([x, y]) => {
    const c = document.querySelector('#game canvas').getBoundingClientRect();
    const g = window.__WORMS__;
    return [c.left + (x / g.scale.width) * c.width, c.top + (y / g.scale.height) * c.height];
  }, [b.x, b.y]);
  await p.mouse.click(pt[0], pt[1]);
}

if (errors.length) {
  console.log('\nошибки страницы:');
  for (const e of errors) console.log('  ', e);
}
console.log(failures.length || errors.length
  ? `\nПРОВАЛ: ${[...failures, ...errors].length}` : '\nпроверки Telegram пройдены');
process.exit(failures.length || errors.length ? 1 : 0);
