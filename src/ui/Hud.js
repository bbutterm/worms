import { CFG, DEPTH, TEAM_COLORS, TEAM_NAMES } from '../config.js';
import { WEAPONS } from '../weapons/index.js';
import { has as hasAsset } from '../core/assets.js';
import { UI, font, ensureButton, ensureRoundButton, ensureIcon } from './theme.js';

const TOP_H = 62;

/**
 * Интерфейс: ход, таймер, здоровье команд, ветер, выбор оружия и тач-кнопки.
 *
 * Всё живёт в интерфейсной камере (rig.ui): не масштабируется зумом и не
 * трясётся при взрывах. Container не используем — хит-тест интерактивных
 * объектов внутри контейнера ведёт себя непредсказуемо.
 *
 * Кнопки — картинки из theme.js: скруглённые плашки с фаской и тенью.
 * Раньше это были плоские прямоугольники с юникодными значками, и всё
 * вместе выглядело как отладочный оверлей поверх нарисованной игры.
 */
export class Hud {
  constructor(scene) {
    this.scene = scene;
    this.uiRects = [];
    this.weaponButtons = [];
    this.holdButtons = [];

    const W = CFG.VIEW_W;
    const H = CFG.VIEW_H;
    // Через fix проходит каждый объект интерфейса, поэтому здесь же он и
    // запоминается: иначе пересобрать HUD после поворота экрана нечем.
    this.items = [];
    this.fix = (o, d = DEPTH.HUD) => {
      this.items.push(o);
      return scene.rig.ui(o.setScrollFactor(0).setDepth(d));
    };

    this._buildTopBar(W);
    this._buildWeapons(W, H);
    this._buildControls(W, H);
    this._buildHelp(W, H);

    scene.input.on('pointerup', this._releaseAll, this);
    scene.input.on('pointerupoutside', this._releaseAll, this);
  }

  // ------------------------------------------------------- верхняя панель

  _buildTopBar(W) {
    const s = this.scene;
    const key = 'ui-topbar';
    if (!s.textures.exists(key)) {
      const tex = s.textures.createCanvas(key, 8, TOP_H);
      const ctx = tex.getContext();
      const g = ctx.createLinearGradient(0, 0, 0, TOP_H);
      g.addColorStop(0, 'rgba(16,19,26,0.94)');
      g.addColorStop(1, 'rgba(16,19,26,0.72)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 8, TOP_H);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(0, TOP_H - 2, 8, 2);
      tex.refresh();
    }
    this.fix(s.add.image(0, 0, key).setOrigin(0, 0).setDisplaySize(W, TOP_H));

    // Кто ходит: цветная метка команды + имя бойца
    this.teamChip = this.fix(s.add.rectangle(16, 14, 6, 32, 0xffffff).setOrigin(0, 0));
    this.turnText = this.fix(s.add.text(32, 10, '', font(19, 800)));
    this.subText = this.fix(s.add.text(32, 35, '', font(12, 700, UI.textDim)));

    // Таймер по центру — кольцо вокруг цифры
    this.timerGfx = this.fix(s.add.graphics());
    this.timerCx = Math.round(W / 2);
    this.timerCy = Math.round(TOP_H / 2) - 1;
    this.timerText = this.fix(s.add.text(this.timerCx, this.timerCy, '30',
      font(21, 800)).setOrigin(0.5));

    // Здоровье команд сходится к таймеру: слева красные, справа синие
    this.teamBars = [];
    const barW = 190, gap = 52;
    for (let t = 0; t < CFG.TEAMS; t++) {
      const right = t % 2 === 1;
      const x = right ? this.timerCx + gap : this.timerCx - gap - barW;
      this.fix(s.add.text(right ? x : x + barW, 8, TEAM_NAMES[t],
        font(13, 800, hex(TEAM_COLORS[t]))).setOrigin(right ? 0 : 1, 0));
      const cnt = this.fix(s.add.text(right ? x + barW : x, 8, '',
        font(12, 700, UI.textDim)).setOrigin(right ? 1 : 0, 0));
      this.fix(this._barImage(x, 36, barW, 12));
      const bar = this.fix(s.add.rectangle(right ? x + 2 : x + barW - 2, 36,
        barW - 4, 8, TEAM_COLORS[t]).setOrigin(right ? 0 : 1, 0.5), DEPTH.HUD + 1);
      this.teamBars.push({ bar, cnt, width: barW - 4 });
    }

    this.fix(s.add.text(W - 16, 8, 'ВЕТЕР', font(11, 700, UI.textDim)).setOrigin(1, 0));
    this.windText = this.fix(s.add.text(W - 16, 22, '0', font(17, 800)).setOrigin(1, 0));
    this.windGfx = this.fix(s.add.graphics());
    this.windCx = W - 150;
    this.windCy = 38;
  }

  _barImage(x, y, w, h) {
    const s = this.scene;
    const key = `ui-bar-${w}x${h}`;
    if (!s.textures.exists(key)) {
      const tex = s.textures.createCanvas(key, w, h);
      const ctx = tex.getContext();
      ctx.fillStyle = UI.bar;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
      tex.refresh();
    }
    return s.add.image(x, y, key).setOrigin(0, 0.5);
  }

  // --------------------------------------------------------------- оружие

  _buildWeapons(W, H) {
    const s = this.scene;
    const bw = 88, bh = 54, gap = 10;
    const total = WEAPONS.length * bw + (WEAPONS.length - 1) * gap;
    let bx = Math.round((W - total) / 2);
    const by = H - bh - 12;

    ensureButton(s, 'ui-weapon', bw, bh, 'normal');
    ensureButton(s, 'ui-weapon-on', bw, bh, 'active');

    for (let i = 0; i < WEAPONS.length; i++) {
      const weapon = WEAPONS[i];
      const plate = this.fix(s.add.image(bx + bw / 2, by + bh / 2, 'ui-weapon'));
      plate.setInteractive({ useHandCursor: true });
      plate.on('pointerdown', () => { this._press(plate); s.turn.setWeaponIndex(i); });
      plate.on('pointerup', () => this._unpress(plate));
      plate.on('pointerout', () => this._unpress(plate));

      const icon = hasAsset(s, weapon.iconKey)
        ? this.fix(s.add.image(bx + bw / 2, by + 19, weapon.iconKey).setOrigin(0.5), DEPTH.HUD + 1)
        : this.fix(s.add.text(bx + bw / 2, by + 8, weapon.icon, font(18, 800))
          .setOrigin(0.5, 0), DEPTH.HUD + 1);
      const name = this.fix(s.add.text(bx + bw / 2, by + 36, weapon.name,
        font(11, 700, UI.textDim)).setOrigin(0.5, 0), DEPTH.HUD + 1);
      this.fix(s.add.text(bx + 7, by + 3, `${i + 1}`,
        font(10, 700, UI.textDim)).setOrigin(0, 0), DEPTH.HUD + 1);
      const ammo = this.fix(s.add.text(bx + bw - 7, by + 3, '',
        font(11, 800, UI.accent)).setOrigin(1, 0), DEPTH.HUD + 1);

      this.weaponButtons.push({ plate, icon, name, ammo });
      this.uiRects.push({ x: bx, y: by, w: bw, h: bh });
      bx += bw + gap;
    }
  }

  // --------------------------------------------------------------- кнопки

  _buildControls(W, H) {
    const s = this.scene;
    const B = 62;         // сторона квадратной кнопки
    const FR = 54;        // радиус «Огня»
    const gap = 10;

    // Руки разведены по смыслу: слева — перемещение и камера, справа —
    // всё, что относится к выстрелу: угол, прыжок и сам «Огонь».
    const lx = 24, lx2 = lx + B + gap;
    const rowLow = H - B - 14;
    const rowHigh = rowLow - B - gap;

    this._hold(lx, rowLow, B, 'left', 'left');
    this._hold(lx2, rowLow, B, 'right', 'right');
    this._tap(lx, rowHigh, B, 'overview', () => s.rig.toggleOverview());
    this._tap(lx2, rowHigh, B, 'focus', () => s.focusCamera());

    // Справа: «Огонь» в углу, слева от него угол прицела, над ним прыжок.
    // Раскладка считается от круга, иначе квадраты наезжают на него.
    const fireCx = W - 30 - FR, fireCy = H - 30 - FR;
    const ax = fireCx - FR - gap - B;
    const aimLow = fireCy + FR - B;
    const aimHigh = aimLow - B - gap;
    const camRow = aimHigh - B - gap;

    this._hold(ax, aimHigh, B, 'up', 'aimUp');
    this._hold(ax, aimLow, B, 'down', 'aimDown');
    this._hold(fireCx - B / 2, camRow, B, 'jump', 'jumpQueued');

    // Полного экрана нет в Safari на iPhone — там кнопку не показываем
    if (s.scale.fullscreen.available) {
      this._tap(ax, camRow, B, 'fullscreen', () => {
        if (s.scale.isFullscreen) s.scale.stopFullscreen();
        else s.scale.startFullscreen();
      });
    }

    this._fireButton(fireCx, fireCy, FR);

    // Центры кнопок наружу: раскладка зависит от пропорций экрана, и
    // тестам незачем повторять её вычисления у себя.
    this.buttons = {
      fire: { x: fireCx, y: fireCy },
      aimUp: { x: ax + B / 2, y: aimHigh + B / 2 },
      aimDown: { x: ax + B / 2, y: aimLow + B / 2 },
      jump: { x: fireCx, y: camRow + B / 2 },
      overview: { x: lx + B / 2, y: rowHigh + B / 2 },
      focus: { x: lx2 + B / 2, y: rowHigh + B / 2 },
      left: { x: lx + B / 2, y: rowLow + B / 2 },
      right: { x: lx2 + B / 2, y: rowLow + B / 2 },
    };
  }

  _plate(x, y, size, iconName) {
    const s = this.scene;
    const key = `ui-sq-${size}`;
    ensureButton(s, key, size, size, 'normal');
    const img = this.fix(s.add.image(x + size / 2, y + size / 2, key));
    img.setInteractive({ useHandCursor: true });
    const iconKey = ensureIcon(s, iconName, Math.round(size * 0.62));
    if (iconKey) this.fix(s.add.image(x + size / 2, y + size / 2, iconKey), DEPTH.HUD + 1);
    this.uiRects.push({ x, y, w: size, h: size });
    return img;
  }

  /**
   * Регистрирует кнопку, которую можно держать.
   *
   * Кнопка запоминает палец, который её нажал, и отпускается только им.
   * Иначе получалось так: держишь «Огонь» одним пальцем, поправляешь угол
   * другим — и на отпускании второго пальца выстрел уходил сам.
   */
  _register(img, onDown, onUp) {
    const entry = { pointerId: null, release: null };
    entry.release = (pointer) => {
      if (pointer && entry.pointerId !== null && pointer.id !== entry.pointerId) return;
      entry.pointerId = null;
      this._unpress(img);
      onUp?.();
    };
    img.on('pointerdown', (pointer) => {
      entry.pointerId = pointer?.id ?? null;
      this._press(img);
      onDown?.();
    });
    img.on('pointerup', (pointer) => entry.release(pointer));
    img.on('pointerout', (pointer) => entry.release(pointer));
    this.holdButtons.push(entry);
    return entry;
  }

  _hold(x, y, size, iconName, action) {
    const s = this.scene;
    const img = this._plate(x, y, size, iconName);
    this._register(img,
      () => { s.moveInput[action] = true; },
      // jumpQueued — одноразовый флаг, его сцена сама сбрасывает за кадр
      () => { if (action !== 'jumpQueued') s.moveInput[action] = false; });
  }

  _tap(x, y, size, iconName, onTap) {
    const img = this._plate(x, y, size, iconName);
    this._register(img, onTap, null);
  }

  /**
   * Кнопка выстрела: удержание набирает силу, отпускание стреляет.
   * Отпускание ловится и глобально (_releaseAll), иначе увод пальца
   * за пределы кнопки оставил бы заряд висеть навсегда.
   */
  _fireButton(cx, cy, r) {
    const s = this.scene;
    ensureRoundButton(s, 'ui-fire', r, 'primary');
    const img = this.fix(s.add.image(cx, cy, 'ui-fire'));
    img.setInteractive(new Phaser.Geom.Circle(img.width / 2, img.height / 2, r),
      Phaser.Geom.Circle.Contains);
    this.fix(s.add.text(cx, cy, 'ОГОНЬ', font(16, 800)).setOrigin(0.5), DEPTH.HUD + 1);

    this._register(img,
      () => { s.moveInput.fire = true; },
      () => { s.moveInput.fire = false; });
    this.uiRects.push({ x: cx - r, y: cy - r, w: r * 2, h: r * 2 });

    // Шкала заряда — дугой вокруг самой кнопки: видно, не отводя глаз
    this.chargeGfx = this.fix(s.add.graphics(), DEPTH.HUD + 2);
    this.chargeR = r + 11;
    this.chargeCx = cx;
    this.chargeCy = cy;
  }

  _press(img) { img.setScale(0.94).setTint(0xc9c9c9); }
  _unpress(img) { img.setScale(1).clearTint(); }
  /**
   * Глобальное отпускание: палец мог уйти с кнопки до того, как его подняли,
   * и тогда своего события кнопка не получит. Отпускаем только то, что
   * держал именно этот палец, — остальные кнопки других пальцев не трогаем.
   */
  _releaseAll(pointer) { for (const b of this.holdButtons) b.release(pointer); }

  // ------------------------------------------------------------ подсказка

  _buildHelp(W, H) {
    const s = this.scene;
    // Снизу слева от панели оружия: справа сверху она перекрывала
    // указатели на бойцов вне экрана.
    this._tap(206, H - 62, 48, 'help', () => this.toggleHelp());
    this._tap(206 + 56, H - 62, 48, 'home', () => s.toMenu());
    // Приглашение по ссылке нужно только в сетевой партии: в кампании эта
    // кнопка молча бросала бы миссию
    if (s.match?.mode === 'online') {
      this._tap(206 + 112, H - 62, 48, 'link', () => s.shareInvite());
    }

    // Строка сетевого статуса живёт над этими кнопками и в локальной
    // партии пуста — обычной игре она не мешает
    this.netText = this.fix(s.add.text(206, H - 70, '', font(12, 800, UI.accent))
      .setOrigin(0, 1), DEPTH.HUD + 1);

    const lines = [
      'ОГОНЬ — держи, набирается сила; отпустил — выстрел',
      'вверх/вниз справа — угол прицела, его можно править прямо на заряде',
      'прыжок — над «ОГНЁМ», ходьба — слева внизу',
      'тянуть фон — камера, два пальца — приблизить',
      'кнопки слева сверху — обзор карты и возврат к бойцу',
      'свайп прямо по бойцу — быстрый выстрел',
      'домик внизу слева — выход в меню',
      ...(s.match?.mode === 'online' ? ['звенья цепи — позвать второго по ссылке'] : []),
    ];
    const w = 560, h = lines.length * 27 + 96;
    const x = Math.round((W - w) / 2), y = Math.round((H - h) / 2);

    ensureButton(s, 'ui-help', w, h, 'normal');
    this.helpPanel = [
      this.fix(s.add.image(x + w / 2, y + h / 2, 'ui-help'), DEPTH.HUD + 20),
      this.fix(s.add.text(x + w / 2, y + 18, 'УПРАВЛЕНИЕ', font(19, 800, UI.accent))
        .setOrigin(0.5, 0), DEPTH.HUD + 21),
      this.fix(s.add.text(x + w / 2, y + h - 24, 'нажми «?» справа сверху, чтобы закрыть',
        font(12, 700, UI.textDim)).setOrigin(0.5, 0.5), DEPTH.HUD + 21),
    ];
    lines.forEach((line, i) => {
      this.helpPanel.push(this.fix(
        s.add.text(x + 30, y + 56 + i * 27, `·  ${line}`, font(14, 700)), DEPTH.HUD + 21,
      ));
    });
    this.setHelp(true);

    // Подсказка закрывается любым касанием — искать кнопку не нужно.
    // Обработчик именованный: при пересборке HUD его надо снять, иначе
    // старый останется висеть и будет закрывать уже новую подсказку.
    this._closeHelp = () => { if (this.helpVisible) this.setHelp(false); };
    this.scene.input.on('pointerdown', this._closeHelp);
  }

  setHelp(on) {
    this.helpVisible = on;
    for (const o of this.helpPanel) o.setVisible(on);
  }

  toggleHelp() { this.setHelp(!this.helpVisible); }

  setNetStatus(text, color = UI.accent) {
    this.netText?.setText(text).setColor(color);
  }

  /** Снести интерфейс целиком — перед пересборкой под новый размер экрана. */
  destroy() {
    this.scene.input.off('pointerup', this._releaseAll, this);
    this.scene.input.off('pointerupoutside', this._releaseAll, this);
    if (this._closeHelp) this.scene.input.off('pointerdown', this._closeHelp);
    for (const o of this.items) o.destroy();
    this.items = [];
    this.holdButtons = [];
    this.weaponButtons = [];
    this.uiRects = [];
    this.helpPanel = [];
  }

  // --------------------------------------------------------------- прочее

  /** Попал ли указатель в интерфейс — тогда это не прицеливание и не камера. */
  isOverUI(pointer) {
    const px = pointer.x, py = pointer.y;
    if (py < TOP_H) return true;
    if (this.helpVisible) return true;   // подсказка перекрывает всё поле
    for (const r of this.uiRects) {
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return true;
    }
    return false;
  }

  setWeaponIndex(i) {
    for (let k = 0; k < this.weaponButtons.length; k++) {
      const b = this.weaponButtons[k];
      const on = k === i;
      b.plate.setTexture(on ? 'ui-weapon-on' : 'ui-weapon');
      b.name.setColor(on ? '#2a1c06' : UI.textDim);
      if (b.icon.setColor) b.icon.setColor(on ? '#2a1c06' : UI.text);
      else b.icon.setAlpha(on ? 1 : 0.6);
    }
  }

  update() {
    const scene = this.scene;
    const turn = scene.turn;
    const team = turn.currentTeam;
    const worm = turn.activeWorm;

    this.teamChip.fillColor = TEAM_COLORS[team];
    this.turnText.setText(worm ? `Боец ${worm.name}` : TEAM_NAMES[team]);
    this.turnText.setColor(hex(TEAM_COLORS[team]));
    this.subText.setText(`${TEAM_NAMES[team]} · ${scene.terrain.biome.name} · ${turn.weapon.name}`);

    this._updateTimer(turn);
    this._updateWind(scene.wind);
    this._updateTeams(scene);
    this._updateCharge(scene);
    this._updateAmmo(turn);
  }

  _updateTimer(turn) {
    const left = Math.max(0, turn.timeLeft);
    const frac = Phaser.Math.Clamp(left / (this.scene.turnTime ?? CFG.TURN_TIME), 0, 1);
    const urgent = left <= 5;
    const color = urgent ? 0xff6b6b : left <= 12 ? 0xffd166 : 0x6ee36e;

    this.timerText.setText(Math.ceil(left).toString());
    this.timerText.setColor(urgent ? '#ff9a9a' : UI.text);
    // Под конец хода цифра пульсирует: одного цвета мало, его не замечают
    this.timerText.setScale(urgent ? 1 + Math.sin(this.scene.time.now / 90) * 0.09 : 1);

    const g = this.timerGfx;
    const r = 23;
    g.clear();
    g.lineStyle(5, 0x11151d, 0.9);
    g.strokeCircle(this.timerCx, this.timerCy, r);
    if (frac > 0) {
      g.lineStyle(5, color, 1);
      g.beginPath();
      g.arc(this.timerCx, this.timerCy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      g.strokePath();
    }
  }

  _updateWind(wind) {
    const g = this.windGfx;
    const half = 52, cy = this.windCy, cx = this.windCx;
    this.windText.setText(`${Math.abs(Math.round(wind))}`);
    g.clear();
    g.fillStyle(0x11151d, 0.9).fillRect(cx - half, cy - 6, half * 2, 12);
    const k = Phaser.Math.Clamp(wind / CFG.WIND_MAX, -1, 1);
    g.fillStyle(k >= 0 ? 0x6ecbff : 0xffa46e, 1);
    if (k >= 0) g.fillRect(cx, cy - 5, half * k, 10);
    else g.fillRect(cx + half * k, cy - 5, -half * k, 10);
    g.fillStyle(0xffffff, 0.85).fillRect(cx - 1, cy - 9, 2, 18);
  }

  _updateTeams(scene) {
    for (let t = 0; t < CFG.TEAMS; t++) {
      const living = scene.worms.filter((w) => w.team === t && w.alive);
      const total = living.reduce((a, w) => a + w.health, 0);
      const b = this.teamBars[t];
      b.bar.width = b.width * Phaser.Math.Clamp(
        total / (CFG.MAX_HEALTH * CFG.WORMS_PER_TEAM), 0, 1,
      );
      b.cnt.setText(`${living.length}/${CFG.WORMS_PER_TEAM}`);
    }
  }

  _updateCharge(scene) {
    const g = this.chargeGfx;
    g.clear();
    const c = Phaser.Math.Clamp(scene.charge, 0, 1);
    if (c <= 0) return;
    g.lineStyle(7, c > 0.85 ? 0xff6b6b : c > 0.55 ? 0xffa34d : 0xffd166, 1);
    g.beginPath();
    g.arc(this.chargeCx, this.chargeCy, this.chargeR,
      -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * c);
    g.strokePath();
  }

  _updateAmmo(turn) {
    for (let i = 0; i < WEAPONS.length; i++) {
      const n = turn.ammoOf ? turn.ammoOf(i) : Infinity;
      const b = this.weaponButtons[i];
      b.ammo.setText(Number.isFinite(n) ? `${n}` : '∞');
      // На выбранной плашке фон янтарный — акцентный цвет на нём не читается
      const on = this.scene.turn.weaponIndex === i;
      b.ammo.setColor(n === 0 ? '#ff7b7b' : on ? '#2a1c06' : UI.accent);
      b.plate.setAlpha(n === 0 ? 0.5 : 1);
    }
  }
}

function hex(n) {
  return `#${n.toString(16).padStart(6, '0')}`;
}
