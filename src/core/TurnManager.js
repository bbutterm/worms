import { CFG, TEAM_COLORS, TEAM_NAMES } from '../config.js';
import { WEAPONS } from '../weapons/index.js';

export const STATE = {
  AIM: 'aim',         // игрок ходит и целится
  FLYING: 'flying',   // снаряд в воздухе
  RESOLVE: 'resolve', // ждём, пока всё успокоится
  OVER: 'over',       // игра окончена
};

/** Очередь ходов: 2 команды по 2 бойца, таймер 30 сек, ветер на каждый ход. */
export class TurnManager {
  constructor(scene) {
    this.scene = scene;
    this.state = STATE.RESOLVE;
    this.currentTeam = 0;
    this.activeWorm = null;
    this.timeLeft = CFG.TURN_TIME;
    this.resolveTimer = 0;
    this.flyTimer = 0;
    this.weaponIndex = 0;
    this.teamCursor = new Array(CFG.TEAMS).fill(0);
    this.turnNumber = 0;
    // Патроны общие на команду, как в оригинале
    this.ammo = Array.from({ length: CFG.TEAMS }, () =>
      WEAPONS.map((w) => w.startAmmo));
  }

  /** Сколько осталось у текущей команды. Infinity — безлимитное оружие. */
  ammoOf(index, team = this.currentTeam) {
    const n = this.ammo[team][index];
    return n === null ? Infinity : n;
  }

  addAmmo(index, count, team = this.currentTeam) {
    if (this.ammo[team][index] === null) return;
    this.ammo[team][index] += count;
  }

  /** Индекс случайного оружия с конечным запасом — для ящика. */
  randomCrateWeapon(rng) {
    const limited = WEAPONS.map((w, i) => (w.startAmmo === null ? -1 : i))
      .filter((i) => i >= 0);
    return limited[rng.int(0, limited.length - 1)];
  }

  get weapon() { return WEAPONS[this.weaponIndex]; }

  setWeaponIndex(i) {
    if (i < 0 || i >= WEAPONS.length) return;
    if (this.ammoOf(i) <= 0) return;      // пустое оружие не выбирается
    this.weaponIndex = i;
    this.scene.hud.setWeaponIndex(i);
  }

  /** Списать выстрел и, если запас кончился, вернуться к базуке. */
  spendAmmo() {
    const i = this.weaponIndex;
    if (this.ammo[this.currentTeam][i] === null) return;
    this.ammo[this.currentTeam][i] = Math.max(0, this.ammo[this.currentTeam][i] - 1);
  }

  /** Первый ход. */
  begin(startTeam = 0) {
    this.currentTeam = startTeam;
    this.setWeaponIndex(0);
    this._activate(startTeam, /* advanceTeam */ false);
  }

  /** Передать ход следующей команде. */
  next() {
    const winner = this.scene.checkVictory();
    if (winner !== null) { this._gameOver(winner); return; }
    this._activate(this.currentTeam, /* advanceTeam */ true);
  }

  _activate(fromTeam, advanceTeam) {
    let team = fromTeam;
    if (advanceTeam) {
      for (let i = 1; i <= CFG.TEAMS; i++) {
        const t = (fromTeam + i) % CFG.TEAMS;
        if (this.scene.teamAlive(t)) { team = t; break; }
      }
    }
    const worm = this._pickWorm(team);
    if (!worm) {
      const winner = this.scene.checkVictory();
      this._gameOver(winner);
      return;
    }

    this.currentTeam = team;
    this.activeWorm = worm;
    this.turnNumber++;
    this.timeLeft = CFG.TURN_TIME;
    this.state = STATE.AIM;

    // Оружие могло кончиться у этой команды — откатываемся на доступное
    if (this.ammoOf(this.weaponIndex) <= 0) {
      const ok = WEAPONS.findIndex((w, i) => this.ammoOf(i) > 0);
      this.weaponIndex = ok >= 0 ? ok : 0;
    }
    this.scene.hud.setWeaponIndex(this.weaponIndex);

    this.scene.maybeDropCrate();

    // Ветер случайный в начале каждого хода
    this.scene.setWind(this.scene.rng.range(CFG.WIND_MIN, CFG.WIND_MAX));
    this.scene.resetAim();

    for (const w of this.scene.worms) w.setActiveMarker(w === worm);
    this.scene.followTarget = worm;
    this.scene.frameTurn(worm);
    this.scene.fx.banner(
      `${TEAM_NAMES[team]} — ход ${this.turnNumber}`,
      hex(TEAM_COLORS[team]), 1200,
    );
  }

  /** Следующий живой боец команды по кругу. */
  _pickWorm(team) {
    const list = this.scene.worms.filter((w) => w.team === team);
    if (!list.length) return null;
    for (let i = 0; i < list.length; i++) {
      const idx = (this.teamCursor[team] + i) % list.length;
      if (list[idx].alive) {
        this.teamCursor[team] = (idx + 1) % list.length;
        return list[idx];
      }
    }
    return null;
  }

  /** Вызывается сценой сразу после выстрела: ход уже не вернуть. */
  onFired() {
    this.spendAmmo();
    this.state = STATE.FLYING;
    this.flyTimer = 0;
    this.activeWorm?.setActiveMarker(false);
    this.scene.cancelCharge();
  }

  /** Досрочно завершить ход (таймер, смерть активного бойца). */
  endTurn() {
    if (this.state === STATE.OVER) return;
    this.state = STATE.RESOLVE;
    this.resolveTimer = 0;
    this.activeWorm?.setActiveMarker(false);
    this.scene.aim.cancel();
  }

  _gameOver(winner) {
    this.state = STATE.OVER;
    this.activeWorm = null;
    for (const w of this.scene.worms) w.setActiveMarker(false);
    this.scene.onGameOver(winner);
  }

  update(dt) {
    const scene = this.scene;

    switch (this.state) {
      case STATE.AIM: {
        this.timeLeft -= dt;
        if (!this.activeWorm || !this.activeWorm.alive) { this.endTurn(); break; }
        if (this.timeLeft <= 0) {
          scene.fx.banner('Время вышло', '#ffd166', 1000);
          this.endTurn();
        }
        break;
      }

      case STATE.FLYING: {
        this.flyTimer += dt;
        // Снаряды сами себя ограничивают по времени жизни, но если что-то
        // всё же застряло — ход всё равно должен сдвинуться.
        if (this.flyTimer >= CFG.FLY_TIMEOUT) {
          for (const p of scene.projectiles) p.destroy();
          scene.projectiles.length = 0;
        }
        if (scene.projectiles.length === 0) {
          this.state = STATE.RESOLVE;
          this.resolveTimer = 0;
        }
        break;
      }

      case STATE.RESOLVE: {
        this.resolveTimer += dt;
        const quiet = scene.projectiles.length === 0 && scene.worms.every((w) => w.settled);
        if ((quiet && this.resolveTimer >= CFG.RESOLVE_SETTLE)
          || this.resolveTimer >= CFG.RESOLVE_TIMEOUT) {
          this.next();
        }
        break;
      }

      default:
        break;
    }
  }
}

function hex(n) {
  return `#${n.toString(16).padStart(6, '0')}`;
}
