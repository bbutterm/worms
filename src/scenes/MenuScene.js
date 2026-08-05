import { UI, font, ensureButton } from '../ui/theme.js';
import { MISSIONS, loadProgress, isUnlocked } from '../campaign/missions.js';
import { quickMatch, campaignMatch, onlineMatch } from '../core/match.js';
import { randomRoom, copyText } from '../net/transport.js';
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
    const W = this.scale.width, H = this.scale.height;
    this.W = W; this.H = H;
    this.items = [];
    this.buttons = {};

    this.cameras.main.setBackgroundColor('#0d1220');
    this._backdrop();
    this.showRoot();

    this.input.keyboard?.on('keydown-ESC', () => this.showRoot());
  }

  /** Небо и силуэт холмов: пустой тёмный экран смотрелся заготовкой. */
  _backdrop() {
    const { W, H } = this;
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
    this.add.image(0, 0, key).setOrigin(0, 0).setDepth(-10);
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
    this.buttons[key] = { x, y, w, h, enabled };
    return img;
  }

  _back(onTap = () => this.showRoot()) {
    this._button('back', 92, this.H - 46, '← назад', '', onTap, { w: 148, h: 50 });
  }

  showRoot() {
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

    this.items.push(this.add.text(this.W - 16, this.H - 14,
      'ландшафтная ориентация · звука нет', font(11, 700, UI.textDim)).setOrigin(1, 1));
  }

  // ------------------------------------------------------- быстрая игра

  showQuick() {
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
    this._clear();
    const done = loadProgress();
    this._title('Кампания', `пройдено ${done.size} из ${MISSIONS.length}`);
    const cx = this.W / 2;
    const y0 = 178, step = 78;

    MISSIONS.forEach((m, i) => {
      const open = isUnlocked(i, done);
      const mark = done.has(m.id) ? ' ✓' : '';
      // Красная плашка — только у той миссии, которую играть дальше:
      // тусклая красная у запертой читалась как «сломано», а не «закрыто».
      const next = open && !done.has(m.id);
      this._button(m.id, cx, y0 + step * i, `${i + 1}. ${m.title}${mark}`,
        open ? m.subtitle : 'откроется после предыдущей',
        () => this.showBrief(m), { enabled: open, variant: next ? 'primary' : 'normal' });
    });
    this._back();
  }

  /** Вводная перед миссией: без неё условия видно только по факту. */
  showBrief(mission) {
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

    this._button('start', cx, y + h + 60, 'В бой', '',
      () => this.start(campaignMatch(mission.id)), { variant: 'primary', w: 300, h: 62 });
    this._back(() => this.showCampaign());
  }

  // -------------------------------------------------------------- онлайн

  showOnline() {
    this._clear();
    this._title('Онлайн', 'вдвоём через интернет, по коду комнаты');
    const cx = this.W / 2;
    const y0 = 196, step = 80;

    this._button('create', cx, y0, 'Создать комнату', 'код и ссылка для друга',
      () => this.showRoom(randomRoom()), { variant: 'primary' });
    this._button('join', cx, y0 + step, 'Войти по коду', 'если код прислали тебе',
      () => this.askCode());
    this.items.push(this.add.text(cx, y0 + step * 2 + 6,
      'первым ходит тот, кто создал комнату', font(12, 700, UI.textDim)).setOrigin(0.5, 0));
    this._back();
  }

  askCode() {
    const raw = globalThis.prompt?.('Код комнаты:', '') ?? '';
    const code = raw.trim().toUpperCase();
    if (code) this.startOnline(code);
  }

  /** Комната создана: показываем код крупно, ссылку кладём в буфер. */
  showRoom(room) {
    this._clear();
    this._title('Комната создана', 'дай другу код или ссылку');
    const cx = this.W / 2;

    const code = this.add.text(cx, 190, room, font(72, 800, UI.accent)).setOrigin(0.5, 0);
    this.items.push(code);

    const link = this.inviteLink(room);
    this._button('copy', cx, 320, 'Скопировать ссылку', '',
      () => {
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
    const url = new URL(location.href);
    url.searchParams.set('room', room);
    return url.toString();
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
