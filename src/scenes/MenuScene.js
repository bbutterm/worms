import { UI, font, ensureButton } from '../ui/theme.js';
import { CFG } from '../config.js';
import { MISSIONS, loadProgress, isUnlocked } from '../campaign/missions.js';
import { objectiveText } from '../campaign/objectives.js';
import { quickMatch, campaignMatch, onlineMatch } from '../core/match.js';
import { randomRoom, copyText } from '../net/transport.js';
import { Lobby } from '../net/lobby.js';
import { makeTransport } from '../net/connect.js';
import { player, setName } from '../platform/player.js';
import {
  inviteLink as tgInviteLink, shareRoom, canOfferHomeScreen, addToHomeScreen, onHomeScreenChange,
} from '../platform/telegram.js';
import { leagueOf, nextLeague, leagueProgress, toNextLeague, leagueLabel } from '../platform/league.js';
import { BOT_LEVELS } from '../ai/Bot.js';

/**
 * Меню.
 *
 * Один экран на всё: разделы переключаются перерисовкой, отдельных сцен под
 * каждый нет — так проще держать общий фон и не гонять загрузку по кругу.
 *
 * Разделы:
 *   быстрая игра — случайная карта, соперник рядом или бот;
 *   кампания     — миссии с фиксированной картой и условиями;
 *   онлайн       — лобби: создать комнату или войти по коду.
 *
 * Кнопки складываются в this.buttons — по ним ходит тест, чтобы не считать
 * раскладку у себя заново.
 */
export default class MenuScene extends Phaser.Scene {
  constructor() { super('Menu'); }

  create() {
    // Раскладка — в логическом экране, фон — на весь канвас: фон рисует
    // главная камера, а всё остальное — uiCam, чей вьюпорт сдвинут внутрь
    // на рамку безопасной области (под кнопки Telegram и «чёлку»).
    this.items = [];
    this.buttons = {};

    this.cameras.main.setBackgroundColor('#0d1220');
    const f = CFG.FRAME;
    this.uiCam = this.cameras.add(f.left, f.top, CFG.VIEW_W, CFG.VIEW_H);
    this._measure();
    // Всё, что появляется в сцене, — интерфейс, кроме фона: он помечается
    // отдельно в _backdrop, а остальное разводится по камерам здесь.
    const assignCamera = (go) => {
      // Лобби живёт и когда меню уснуло, и может дорисовать список уже
      // без камер — тогда просто нечего разводить
      const bg = this.cameras?.main;
      if (!bg || !this.uiCam) return;
      if (this._addingBackdrop) this.uiCam.ignore(go);
      else bg.ignore(go);
    };
    this.events.on('addedtoscene', assignCamera);
    this.events.once('shutdown', () => this.events.off('addedtoscene', assignCamera));
    this._backdrop();
    this.showRoot();

    this.input.keyboard?.on('keydown-ESC', () => this.showRoot());

    // Повернули телефон или уехала панель браузера — раскладка считается
    // от ширины экрана, поэтому раздел перерисовывается целиком.
    this.game.events.on('worms-resize', this._relayout, this);
    // Telegram узнал, стоит ли иконка на экране Домой: кнопка появляется
    // или пропадает
    const offHome = onHomeScreenChange(() => {
      if (this.section === this.showRoot) this.showRoot();
    });
    this.events.once('shutdown', () => {
      this.game.events.off('worms-resize', this._relayout, this);
      offHome();
    });
  }

  _relayout() {
    const f = CFG.FRAME;
    this.uiCam.setViewport(f.left, f.top, CFG.VIEW_W, CFG.VIEW_H);
    this._measure();
    this.backdropImage?.destroy();
    this.textures.remove('menu-bg');
    this._backdrop();
    (this.section ?? this.showRoot).call(this);
  }

  /**
   * Размеры раскладки. Разделы размечены под высоту 720; в портрете экран
   * выше, и содержимое центрируется по вертикали: камера интерфейса
   * прокручена на oy, так что y=0 раздела оказывается на oy экрана. Что
   * прижато к низу экрана (назад, «на экран Домой»), считается от bottomY.
   */
  _measure() {
    this.W = CFG.VIEW_W;
    this.H = CFG.VIEW_H;
    this.portrait = this.H > this.W;
    this.oy = Math.max(0, Math.round((this.H - CFG.VIEW_BASE) / 2));
    this.uiCam.scrollY = -this.oy;
  }

  /** y в координатах раздела для точки на расстоянии d от низа экрана. */
  bottomY(d) { return this.H - this.oy - d; }

  /** Небо и силуэт холмов: пустой тёмный экран смотрелся заготовкой. */
  _backdrop() {
    const W = this.scale.width, H = this.scale.height;   // весь канвас
    const key = 'menu-bg';
    if (!this.textures.exists(key)) {
      const tex = this.textures.createCanvas(key, W, H);
      const ctx = tex.getContext();
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#1b2a4a');
      sky.addColorStop(0.55, '#2c3f5e');
      sky.addColorStop(1, '#55407a');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      // Три гряды холмов той же формы, что и в игре: сумма синусоид
      const bands = [
        { y: H * 0.62, amp: 26, freq: 0.004, color: 'rgba(20,28,44,0.55)' },
        { y: H * 0.74, amp: 34, freq: 0.0026, color: 'rgba(14,20,32,0.75)' },
        { y: H * 0.88, amp: 22, freq: 0.0061, color: '#0b1018' },
      ];
      for (const b of bands) {
        ctx.beginPath();
        ctx.moveTo(0, H);
        for (let x = 0; x <= W; x += 4) {
          const y = b.y + Math.sin(x * b.freq) * b.amp + Math.sin(x * b.freq * 2.7) * b.amp * 0.4;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(W, H);
        ctx.closePath();
        ctx.fillStyle = b.color;
        ctx.fill();
      }
      tex.refresh();
    }
    this._addingBackdrop = true;
    this.backdropImage = this.add.image(0, 0, key).setOrigin(0, 0).setDepth(-10);
    this._addingBackdrop = false;
  }

  // ------------------------------------------------------------- разделы

  _clear() {
    for (const o of this.items) o.destroy();
    this.items = [];
    this.buttons = {};
    this.copiedLabel = null;
  }

  _title(text, sub = '') {
    const t = this.add.text(this.W / 2, 54, text, font(44, 800, UI.accent)).setOrigin(0.5, 0);
    this.items.push(t);
    if (sub) {
      this.items.push(this.add.text(this.W / 2, 106, sub, font(15, 700, UI.textDim))
        .setOrigin(0.5, 0));
    }
    return t;
  }

  /**
   * Кнопка меню. Ширина фиксированная, чтобы столбец читался как список,
   * а не как набор разных плашек.
   */
  _button(key, x, y, label, hint, onTap, { w = 420, h = 66, variant = 'normal', enabled = true } = {}) {
    const texKey = `menu-btn-${w}x${h}-${variant}`;
    ensureButton(this, texKey, w, h, variant);
    const img = this.add.image(x, y, texKey).setOrigin(0.5);
    const alpha = enabled ? 1 : 0.45;
    img.setAlpha(alpha);

    const title = this.add.text(x, hint ? y - 10 : y, label,
      font(hint ? 20 : 22, 800, enabled ? UI.text : UI.textDim)).setOrigin(0.5).setAlpha(alpha);
    this.items.push(img, title);
    if (hint) {
      const sub = this.add.text(x, y + 15, hint, font(12, 700, UI.textDim))
        .setOrigin(0.5).setAlpha(alpha);
      this.items.push(sub);
    }

    if (enabled) {
      img.setInteractive({ useHandCursor: true });
      img.on('pointerdown', () => { img.setScale(0.97).setTint(0xcccccc); });
      const release = () => img.setScale(1).clearTint();
      img.on('pointerout', release);
      img.on('pointerup', () => { release(); onTap(); });
    }
    // Координаты для тестов — экранные (раздел прокручен на oy)
    this.buttons[key] = { x, y: y + this.oy, w, h, enabled };
    return img;
  }

  /**
   * Полоса лиги: где игрок внутри своей ступени и сколько до следующей.
   *
   * Голое число рейтинга не говорит ни много это, ни мало. Полоса отвечает
   * на оба вопроса сразу — видно и положение внутри лиги, и цель.
   */
  _leagueBar(cx, y, rating) {
    const w = 420, h = 10;
    const cur = leagueOf(rating);
    const next = nextLeague(rating);
    const left = cx - w / 2;

    this.items.push(this.add.rectangle(left, y, w, h, 0x0b1220, 0.85).setOrigin(0, 0.5));
    const fill = Math.max(3, Math.round(w * leagueProgress(rating)));
    this.items.push(this.add.rectangle(left, y, fill, h, cur.color).setOrigin(0, 0.5));

    this.items.push(this.add.text(left, y + 12, cur.name, font(12, 800, cur.text))
      .setOrigin(0, 0));
    this.items.push(this.add.text(left + w, y + 12,
      next ? `до «${next.name}» ещё ${toNextLeague(rating)}` : 'выше некуда',
      font(12, 700, UI.textDim)).setOrigin(1, 0));
  }

  _back(onTap = () => this.showRoot()) {
    this._button('back', 92, this.bottomY(46), '← назад', '', onTap, { w: 148, h: 50 });
  }

  showRoot() {
    this.section = this.showRoot;
    this._clear();
    this._title('WORMS', 'прототип пошаговой артиллерии');
    const cx = this.W / 2;
    const y0 = 214, step = 86;

    this._button('quick', cx, y0, 'Быстрая игра', 'случайная карта',
      () => this.showQuick(), { variant: 'primary' });
    this._button('campaign', cx, y0 + step, 'Кампания', 'миссии с условиями',
      () => this.showCampaign());
    this._button('online', cx, y0 + step * 2, 'Онлайн', 'игра вдвоём по ссылке',
      () => this.showOnline());

    // Иконка на экран Домой: открывает игру внутри Telegram сразу в полный
    // экран. Кнопка есть, только пока Telegram говорит, что иконки нет
    if (canOfferHomeScreen()) {
      this._button('home', 132, this.bottomY(46), '⌂ На экран Домой', '',
        () => addToHomeScreen(), { w: 228, h: 50 });
    }

    this.items.push(this.add.text(this.W - 16, this.bottomY(14),
      'бой — в ландшафте · звука нет', font(11, 700, UI.textDim)).setOrigin(1, 1));
  }

  // ------------------------------------------------------- быстрая игра

  showQuick() {
    this.section = this.showQuick;
    this._clear();
    this._title('Быстрая игра', 'случайная карта, 2 на 2');
    const cx = this.W / 2;
    const y0 = 186, step = 74;

    this._button('hotseat', cx, y0, 'Вдвоём на одном устройстве', 'ходы по очереди',
      () => this.start(quickMatch(null)), { variant: 'primary' });

    const levels = ['rookie', 'fighter', 'sniper'];
    const hints = {
      rookie: 'только базука, целится грубо',
      fighter: 'считает траекторию, бьёт уверенно',
      sniper: 'всё оружие, промахивается редко',
    };
    levels.forEach((id, i) => {
      this._button(id, cx, y0 + step * (i + 1), `Против бота: ${BOT_LEVELS[id].name}`,
        hints[id], () => this.start(quickMatch(id)));
    });
    this._back();
  }

  // ------------------------------------------------------------ кампания

  showCampaign() {
    this.section = this.showCampaign;
    this._clear();
    const done = loadProgress();
    this._title('Кампания', `пройдено ${done.size} из ${MISSIONS.length}`);

    // Восемь миссий в столбик не влезают по высоте — раскладываем в две
    // колонки. Ширина плашки при этом меньше обычной кнопки меню.
    const w = Math.min(400, (this.W - 120) / 2);
    const rows = Math.ceil(MISSIONS.length / 2);
    const step = 70;
    const y0 = 168;
    const colX = [this.W / 2 - w / 2 - 14, this.W / 2 + w / 2 + 14];

    MISSIONS.forEach((m, i) => {
      const open = isUnlocked(i, done);
      const mark = done.has(m.id) ? ' ✓' : '';
      // Красная плашка — только у той миссии, которую играть дальше:
      // тусклая красная у запертой читалась как «сломано», а не «закрыто».
      const next = open && !done.has(m.id);
      this._button(m.id, colX[Math.floor(i / rows)], y0 + step * (i % rows),
        `${i + 1}. ${m.title}${mark}`,
        open ? m.subtitle : 'откроется после предыдущей',
        () => this.showBrief(m),
        { enabled: open, variant: next ? 'primary' : 'normal', w, h: 60 });
    });
    this._back();
  }

  /** Вводная перед миссией: без неё условия видно только по факту. */
  showBrief(mission) {
    this.section = () => this.showBrief(mission);
    this._clear();
    this._title(mission.title, mission.subtitle);
    const cx = this.W / 2;

    const w = Math.min(620, this.W - 80);
    const h = mission.brief.length * 30 + 44;
    const y = 168;
    ensureButton(this, `menu-panel-${w}x${h}`, w, h, 'normal');
    this.items.push(this.add.image(cx, y + h / 2, `menu-panel-${w}x${h}`).setOrigin(0.5));
    mission.brief.forEach((line, i) => {
      this.items.push(this.add.text(cx, y + 26 + i * 30, line, font(15, 700))
        .setOrigin(0.5, 0));
    });
    this.items.push(this.add.text(cx, y + h + 12,
      `Задача: ${objectiveText(mission.objective)}`, font(14, 800, UI.accent))
      .setOrigin(0.5, 0));

    this._button('start', cx, y + h + 74, 'В бой', '',
      () => this.start(campaignMatch(mission.id)), { variant: 'primary', w: 300, h: 62 });
    this._back(() => this.showCampaign());
  }

  // -------------------------------------------------------------- онлайн

  showOnline() {
    this.section = this.showOnline;
    this._clear();
    const me = player();
    this._title('Онлайн', leagueLabel(me.rating));
    const cx = this.W / 2;

    this._leagueBar(cx, 132, me.rating);

    // Профиль: имя можно поменять, если игра открыта не в Telegram —
    // там имя и так своё, и подменять его незачем.
    if (!me.telegram) {
      this._button('rename', cx, 176, 'Сменить имя', '', () => {
        const v = globalThis.prompt?.('Имя в бою:', me.name);
        if (v) { setName(v); this.showOnline(); }
      }, { w: 260, h: 46 });
    }
    this.items.push(this.add.text(cx, 212,
      `побед ${me.wins} · поражений ${me.losses}`, font(12, 700, UI.textDim))
      .setOrigin(0.5, 0));

    // 262, а не 250: строка побед/поражений над кнопками заезжала под
    // верхний край «Быстрого боя»
    const y0 = 262, step = 74;
    this._button('quickmatch', cx, y0, 'Быстрый бой', 'подобрать соперника по рейтингу',
      () => this.startSearch(), { variant: 'primary' });
    this._button('friend', cx, y0 + step, 'Играть с другом', 'по коду комнаты',
      () => this.showFriend());
    this.items.push(this.add.text(cx, y0 + step * 2 - 8, this.lobbyNote ?? '',
      font(12, 700, UI.textDim)).setOrigin(0.5, 0));

    this._back();
    this._ensureLobby();
  }

  /** Раздел «с другом» — то, что раньше было всем разделом «онлайн». */
  showFriend() {
    this.section = this.showFriend;
    this._clear();
    this._title('Игра с другом', 'по коду комнаты');
    const cx = this.W / 2;
    const y0 = 200, step = 80;

    this._button('create', cx, y0, 'Создать комнату', 'код и ссылка для друга',
      () => this.showRoom(randomRoom()), { variant: 'primary' });
    this._button('join', cx, y0 + step, 'Войти по коду', 'если код прислали тебе',
      () => this.askCode());
    this._back(() => this.showOnline());
  }

  /**
   * Лобби живёт, пока открыто меню: подключаемся один раз и держим —
   * иначе список игроков собирался бы заново на каждом переходе.
   */
  async _ensureLobby() {
    if (this.lobby || this.lobbyStarting) return;
    this.lobbyStarting = true;
    try {
      this.lobby = new Lobby(await makeTransport());
      this.lobby.onChange = (list) => this._showPlayers(list);
      this.lobby.onMatch = (room, opponent) => {
        this.lobbyNote = opponent ? `соперник: ${opponent.name}` : '';
        this.startOnline(room);
      };
      await this.lobby.start();
    } catch (e) {
      console.warn('[лобби] не поднялось', e);
      this.lobbyNote = 'сеть недоступна — играть можно по коду комнаты';
      if (this.section === this.showOnline) this.showOnline();
    } finally {
      this.lobbyStarting = false;
    }
  }

  /** Список тех, кто сейчас в лобби. Тап по строке — позвать в бой. */
  _showPlayers(list) {
    if (this.section !== this.showOnline && this.section !== this.startSearch) return;
    for (const o of this.playerRows ?? []) o.destroy();
    this.playerRows = [];

    // В ландшафте список стоит справа от кнопок; в портрете справа места
    // нет — он уходит под кнопки, там высоты хватает
    const searching = this.section === this.startSearch;
    const x = this.portrait ? this.W / 2 - 210 : this.W - 250;
    const top = this.portrait ? (searching ? 380 : 470) : 120;
    const head = this.add.text(x, top, `в сети: ${list.length + 1}`,
      font(13, 800, UI.accent)).setOrigin(0, 0);
    this.playerRows.push(head);

    list.slice(0, 7).forEach((p, i) => {
      const y = top + 28 + i * 34;
      const seeks = p.state === 'searching';
      const row = this.add.text(x, y, p.name,
        font(13, 800, seeks ? UI.text : UI.textDim)).setOrigin(0, 0);
      row.setInteractive({ useHandCursor: true });
      row.on('pointerdown', () => this.lobby?.invite(p.id));
      // Лига под именем: с кем сводит подбор, видно до боя, а не после
      const sub = this.add.text(x, y + 15,
        `${leagueLabel(p.rating)}${seeks ? ' · ищет бой' : ''}`,
        font(11, 700, leagueOf(p.rating).text)).setOrigin(0, 0).setAlpha(seeks ? 1 : 0.6);
      this.playerRows.push(row, sub);
    });
    // Строки живут отдельно от items: список обновляется чаще, чем раздел
    for (const o of this.playerRows) this.items.push(o);
  }

  /** Поиск боя: ждём, пока лобби сведёт нас с кем-нибудь. */
  startSearch() {
    this.section = this.startSearch;
    this._clear();
    const me = player();
    this._title('Ищем соперника…', leagueLabel(me.rating));
    const cx = this.W / 2;

    // Подбор начинает с равных по рейтингу и постепенно расширяет круг.
    // Без этой строки экран выглядит зависшим: непонятно, ищет он ещё
    // впритык или уже согласен на любого.
    this.searchStatus = this.add.text(cx, 190, 'Ищем соперника…',
      font(16, 800, UI.accent)).setOrigin(0.5, 0);
    this.items.push(this.searchStatus);
    this.items.push(this.add.text(cx, 224,
      'Круг поиска расширяется каждые пять секунд ожидания.',
      font(13, 700, UI.textDim)).setOrigin(0.5, 0));

    this._button('cancel', cx, 300, 'Отменить поиск', '', () => {
      this.lobby?.search(false);
      this._stopSearchTicker();
      this.showOnline();
    }, { w: 300, h: 56 });

    this._ensureLobby();
    this.lobby?.search(true);
    if (this.lobby) this._showPlayers(this.lobby.list());
    this._startSearchTicker();
  }

  /** Строка статуса живёт своим таймером: лобби бьётся реже, чем хочется глазу. */
  _startSearchTicker() {
    this._stopSearchTicker();
    this.searchTicker = this.time.addEvent({
      delay: 500, loop: true,
      callback: () => {
        if (this.section !== this.startSearch || !this.searchStatus?.active) {
          this._stopSearchTicker();
          return;
        }
        const text = this.lobby?.statusText();
        if (text) this.searchStatus.setText(text);
      },
    });
    this.events.once('shutdown', () => this._stopSearchTicker());
  }

  _stopSearchTicker() {
    this.searchTicker?.remove();
    this.searchTicker = null;
  }

  askCode() {
    const raw = globalThis.prompt?.('Код комнаты:', '') ?? '';
    const code = raw.trim().toUpperCase();
    if (code) this.startOnline(code);
  }

  /** Комната создана: показываем код крупно, ссылку кладём в буфер. */
  showRoom(room) {
    this.section = () => this.showRoom(room);
    this._clear();
    this._title('Комната создана', 'дай другу код или ссылку');
    const cx = this.W / 2;

    const code = this.add.text(cx, 190, room, font(72, 800, UI.accent)).setOrigin(0.5, 0);
    this.items.push(code);

    const link = this.inviteLink(room);
    // В Telegram зовём родным выбором чата, снаружи — буфером обмена
    this._button('copy', cx, 320, 'Позвать друга', '',
      () => {
        if (shareRoom(room, link)) return;
        copyText(link);
        // Подтверждение одно на все нажатия: иначе оно множится стопкой
        if (this.copiedLabel) return;
        this.copiedLabel = this.add.text(cx, 366, 'скопировано', font(13, 700, '#8ef0a0'))
          .setOrigin(0.5, 0);
        this.items.push(this.copiedLabel);
      }, { w: 340, h: 58 });
    this._button('enter', cx, 404, 'Войти в комнату', 'ждать соперника',
      () => this.startOnline(room), { variant: 'primary', w: 340, h: 62 });
    this._back(() => this.showOnline());
  }

  inviteLink(room) {
    return tgInviteLink(room);
  }

  // ---------------------------------------------------------------- старт

  /**
   * Онлайн отличается тем, что комната живёт в адресе: так работает ссылка
   * -приглашение и так же партия переживает перезагрузку страницы.
   */
  startOnline(room) {
    const url = new URL(location.href);
    url.searchParams.set('room', room);
    history.replaceState(null, '', url);
    this.start(onlineMatch());
  }

  start(match) {
    this.registry.set('match', match);
    this.registry.set('seed', match.seed ?? null);
    this.registry.set('forceBiome', match.biome ?? null);
    this.scene.start('Game');
  }
}
