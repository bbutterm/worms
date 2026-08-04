import { CFG, DEPTH, TEAM_COLORS, TEAM_NAMES } from '../config.js';
import { makeRng } from '../core/rng.js';
import { BIOMES, pickBiome } from '../core/biomes.js';
import { Terrain } from '../core/Terrain.js';
import { TurnManager, STATE } from '../core/TurnManager.js';
import { has } from '../core/assets.js';
import { Worm } from '../entities/Worm.js';
import { Hud } from '../ui/Hud.js';
import { Fx } from '../ui/Fx.js';
import { AimController } from '../ui/AimController.js';

export default class GameScene extends Phaser.Scene {
  constructor() { super('Game'); }

  create() {
    this.rng = makeRng((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
    this.wind = 0;
    this.worms = [];
    this.projectiles = [];
    this.followTarget = null;
    this.cameraManual = false;
    this.moveInput = { left: false, right: false, jumpQueued: false };
    this.gameOverUi = null;

    const biome = this._chooseBiome();

    this._buildSky(biome);
    this._buildTerrain(biome);
    this._buildWater(biome);

    this.fx = new Fx(this);
    this.hud = new Hud(this);
    this.turn = new TurnManager(this);
    this.aim = new AimController(this);

    this._spawnWorms();
    this._setupKeyboard();

    const cam = this.cameras.main;
    cam.setBounds(0, 0, CFG.WORLD_W, CFG.WORLD_H);
    cam.setBackgroundColor(biome.sky[1]);

    this.turn.begin(this.rng.int(0, CFG.TEAMS - 1));
    if (this.turn.activeWorm) {
      cam.scrollX = Phaser.Math.Clamp(
        this.turn.activeWorm.x - CFG.VIEW_W / 2, 0, CFG.WORLD_W - CFG.VIEW_W,
      );
    }

    this.events.once('shutdown', this._shutdown, this);
  }

  // ------------------------------------------------------------- построение

  /** Биом случайный; можно зафиксировать через ?biome=tundra — удобно для отладки. */
  _chooseBiome() {
    const forced = this.registry.get('forceBiome')
      ?? new URLSearchParams(location.search).get('biome');
    return BIOMES.find((b) => b.id === forced) ?? pickBiome(this.rng);
  }

  _buildSky(biome) {
    const key = 'sky-tex';
    if (this.textures.exists(key)) this.textures.remove(key);
    const tex = this.textures.createCanvas(key, CFG.VIEW_W, CFG.VIEW_H);
    const ctx = tex.getContext();
    const g = ctx.createLinearGradient(0, 0, 0, CFG.VIEW_H);
    g.addColorStop(0, biome.sky[0]);
    g.addColorStop(1, biome.sky[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CFG.VIEW_W, CFG.VIEW_H);

    if (biome.sun !== null && biome.sun !== undefined) {
      ctx.fillStyle = `#${biome.sun.toString(16).padStart(6, '0')}`;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(CFG.VIEW_W * 0.78, 110, 46, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    tex.refresh();

    if (has(this, 'bg_sky')) {
      this.add.tileSprite(0, 0, CFG.VIEW_W, CFG.VIEW_H, 'bg_sky')
        .setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH.SKY);
    } else {
      this.add.image(0, 0, key).setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH.SKY);
    }

    this._buildParallax(biome);
  }

  _buildParallax(biome) {
    if (has(this, 'bg_hills')) {
      this.add.tileSprite(0, CFG.GROUND_BASE - 300, CFG.WORLD_W, 340, 'bg_hills')
        .setOrigin(0, 0).setScrollFactor(0.4, 1).setDepth(DEPTH.PARALLAX);
      return;
    }

    const key = 'hills-tex';
    if (this.textures.exists(key)) this.textures.remove(key);
    const h = 340;
    const tex = this.textures.createCanvas(key, CFG.WORLD_W, h);
    const ctx = tex.getContext();
    const color = `#${biome.hills.toString(16).padStart(6, '0')}`;

    for (let layer = 0; layer < 2; layer++) {
      ctx.globalAlpha = layer === 0 ? 0.45 : 0.7;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, h);
      const amp = 60 - layer * 18;
      const freq = 0.0018 + layer * 0.0013;
      const off = 150 + layer * 70;
      const phase = this.rng() * 10;
      for (let x = 0; x <= CFG.WORLD_W; x += 4) {
        const y = off - Math.sin(x * freq + phase) * amp - Math.sin(x * freq * 2.7 + phase) * amp * 0.35;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(CFG.WORLD_W, h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    tex.refresh();

    this.add.image(0, CFG.GROUND_BASE - 300, key)
      .setOrigin(0, 0).setScrollFactor(0.4, 1).setDepth(DEPTH.PARALLAX);
  }

  _buildTerrain(biome) {
    this.terrain = new Terrain(CFG.WORLD_W, CFG.WORLD_H, biome, this.rng);
    this.terrain.generate();

    if (biome.texKey && has(this, biome.texKey)) {
      this.terrain.setTileImage(this.textures.get(biome.texKey).getSourceImage());
    }

    // По одной Phaser-текстуре на чанк: после взрыва в GPU уходит
    // только задетый кусок, а не вся карта целиком.
    this.terrainTextures = this.terrain.chunks.map((chunk, i) => {
      const key = `terrain-tex-${i}`;
      if (this.textures.exists(key)) this.textures.remove(key);
      const tex = this.textures.addCanvas(key, chunk.canvas);
      this.add.image(chunk.x0, 0, key).setOrigin(0, 0).setDepth(DEPTH.TERRAIN);
      return tex;
    });
    this.terrain.dirtyChunks.clear();
  }

  _buildWater(biome) {
    this.add.rectangle(0, CFG.WATER_Y, CFG.WORLD_W, CFG.WORLD_H - CFG.WATER_Y, biome.water, biome.waterAlpha)
      .setOrigin(0, 0).setDepth(DEPTH.WATER);
    this.add.rectangle(0, CFG.WATER_Y, CFG.WORLD_W, 3, 0xffffff, 0.25)
      .setOrigin(0, 0).setDepth(DEPTH.WATER);
  }

  _spawnWorms() {
    const total = CFG.TEAMS * CFG.WORMS_PER_TEAM;
    const spots = this._findSpawnSpots(total);

    for (let i = 0; i < total; i++) {
      const team = i % CFG.TEAMS;
      const idx = Math.floor(i / CFG.TEAMS);
      const x = spots[i] ?? this.rng.range(300, CFG.WORLD_W - 300);
      const top = this.terrain.surfaceYAt(x, 0) ?? CFG.GROUND_BASE - 100;
      this.worms.push(new Worm(this, x, top - 1, team, idx));
    }
  }

  /**
   * Точки старта: разнесены друг от друга, но все внутри окна шириной
   * CFG.SPAWN_SPAN — иначе противник может оказаться дальше максимальной
   * дальности выстрела, и ход будет нечем занять.
   */
  _findSpawnSpots(count) {
    const all = [];
    for (let x = 180; x < CFG.WORLD_W - 180; x += 6) {
      if (this.terrain.isSpawnable(x)) all.push(x);
    }
    if (!all.length) return [];

    // Случайное окно расселения внутри пригодной части острова
    const lo = all[0], hi = all[all.length - 1];
    const span = Math.min(CFG.SPAWN_SPAN, hi - lo);
    const start = lo + this.rng() * Math.max(0, (hi - lo) - span);
    let pool = all.filter((x) => x >= start && x <= start + span);
    if (pool.length < count) pool = all;

    // Перемешиваем и жадно набираем разнесённые точки
    const shuffled = pool.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = this.rng.int(0, i);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    for (let minDist = CFG.SPAWN_MIN_DIST; minDist >= 40; minDist -= 40) {
      const picked = [];
      for (const x of shuffled) {
        if (picked.every((p) => Math.abs(p - x) >= minDist)) picked.push(x);
        if (picked.length === count) break;
      }
      if (picked.length === count) {
        picked.sort((a, b) => a - b); // команды чередуются слева направо
        return picked;
      }
    }
    return shuffled.slice(0, count).sort((a, b) => a - b);
  }

  _setupKeyboard() {
    const kb = this.input.keyboard;
    this.keys = kb.addKeys({
      left: Phaser.Input.Keyboard.KeyCodes.LEFT,
      right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      a: Phaser.Input.Keyboard.KeyCodes.A,
      d: Phaser.Input.Keyboard.KeyCodes.D,
      jump: Phaser.Input.Keyboard.KeyCodes.SPACE,
      up: Phaser.Input.Keyboard.KeyCodes.UP,
      restart: Phaser.Input.Keyboard.KeyCodes.R,
    });
    kb.on('keydown', (e) => {
      const n = parseInt(e.key, 10);
      if (!Number.isNaN(n) && n >= 1) this.turn.setWeaponIndex(n - 1);
      if (e.key === 'r' || e.key === 'R') {
        if (this.turn.state === STATE.OVER) this.scene.restart();
      }
    });
  }

  // ------------------------------------------------------------------ цикл

  update(time, delta) {
    const dt = Math.min(delta / 1000, CFG.MAX_DT);

    this._handleMovement(dt);

    for (const w of this.worms) w.update(dt);

    for (const p of this.projectiles) p.update(dt);
    if (this.projectiles.some((p) => !p.alive)) {
      this.projectiles = this.projectiles.filter((p) => p.alive);
    }

    if (this.terrain.dirtyChunks.size) {
      for (const i of this.terrain.dirtyChunks) this.terrainTextures[i].refresh();
      this.terrain.dirtyChunks.clear();
    }

    this._updateCamera(dt);
    this.aim.update();
    this.turn.update(dt);
    this.hud.update();
  }

  _handleMovement(dt) {
    const w = this.turn.activeWorm;
    if (!this.canPlayerAct() || !w || !w.alive) {
      this.moveInput.jumpQueued = false;
      return;
    }
    const k = this.keys;
    const left = this.moveInput.left || k.left.isDown || k.a.isDown;
    const right = this.moveInput.right || k.right.isDown || k.d.isDown;

    if (left !== right) {
      w.walk(left ? -1 : 1, dt);
      this.cameraManual = false; // пошли — камера снова ведёт бойца
    }

    const jump = this.moveInput.jumpQueued
      || Phaser.Input.Keyboard.JustDown(k.jump)
      || Phaser.Input.Keyboard.JustDown(k.up);
    if (jump) w.jump();
    this.moveInput.jumpQueued = false;
  }

  _updateCamera(dt) {
    const cam = this.cameras.main;
    if (this.cameraManual) return;

    let target = this.followTarget;
    if (this.turn.state === STATE.FLYING && this.projectiles.length) {
      target = this.projectiles[0];
    } else if (this.turn.activeWorm && this.turn.state === STATE.AIM) {
      target = this.turn.activeWorm;
    }
    if (!target) return;

    const desired = Phaser.Math.Clamp(
      target.x - CFG.VIEW_W / 2, 0, CFG.WORLD_W - CFG.VIEW_W,
    );
    const lerp = this.turn.state === STATE.FLYING ? CFG.CAM_LERP_FAST : CFG.CAM_LERP;
    cam.scrollX += (desired - cam.scrollX) * Math.min(1, lerp * dt * 60);
  }

  // -------------------------------------------------------------- геймплей

  canPlayerAct() {
    return this.turn.state === STATE.AIM;
  }

  setWind(v) { this.wind = v; }

  setCameraManual(on) { this.cameraManual = on; }

  /** Выстрел активного бойца. Ход сразу переходит дальше. */
  fireActiveWorm(vx, vy) {
    const w = this.turn.activeWorm;
    if (!this.canPlayerAct() || !w || !w.alive) return;

    const len = Math.hypot(vx, vy) || 1;
    const nx = vx / len, ny = vy / len;

    // Точка вылета не должна оказаться внутри земли (например, при выстреле
    // вниз себе под ноги) — иначе снаряд «просочится» сквозь ландшафт.
    const ray = this.terrain.raycast(
      w.x, w.centerY,
      w.x + nx * CFG.MUZZLE_OFFSET, w.centerY + ny * CFG.MUZZLE_OFFSET,
    );
    const sx = ray.hit ? ray.freeX : ray.x;
    const sy = ray.hit ? ray.freeY : ray.y;

    w.facing = nx >= 0 ? 1 : -1;
    const shots = this.turn.weapon.fire(this, sx, sy, vx, vy, w);
    this.projectiles.push(...shots);
    this.turn.onFired();
    this.setCameraManual(false);
    this.followTarget = shots[0] ?? w;
  }

  /**
   * Взрыв: стираем круг из маски, раздаём урон по расстоянию от центра
   * и отбрасываем бойцов вектором от эпицентра.
   */
  explode(x, y, cfg, owner = null) {
    this.terrain.destroyCircle(x, y, cfg.radius);
    this.fx.explosion(x, y, cfg.radius);
    this.cameras.main.shake(220, cfg.shake ?? 0.006);

    for (const w of this.worms) {
      if (!w.alive) continue;
      const wx = w.x, wy = w.centerY;
      const d = Math.hypot(wx - x, wy - y);
      if (d > cfg.damageRadius) continue;

      const f = 1 - d / cfg.damageRadius;      // линейный спад от центра
      const dmg = Math.round(cfg.damage * f);

      let nx, ny;
      if (d < 1) { nx = 0; ny = -1; } else { nx = (wx - x) / d; ny = (wy - y) / d; }
      w.applyImpulse(nx * cfg.knockback * f, ny * cfg.knockback * f - 70 * f);

      w.damage(dmg, 'взрыв');
    }
  }

  onWormDied(worm) {
    this.fx.explosion(worm.x, worm.centerY, 26);
    this.terrain.destroyCircle(worm.x, worm.centerY, 22);
    this.cameras.main.shake(160, 0.004);
    // Ход обрывается, если погиб тот, кто ходит, либо если команда выбита
    // целиком — иначе победа ждала бы истечения 30-секундного таймера.
    if (this.turn.state === STATE.AIM
      && (this.turn.activeWorm === worm || this.checkVictory() !== null)) {
      this.turn.endTurn();
    }
  }

  teamAlive(team) {
    return this.worms.some((w) => w.team === team && w.alive);
  }

  /** null — играем дальше; иначе индекс победившей команды или -1 (ничья). */
  checkVictory() {
    const alive = [];
    for (let t = 0; t < CFG.TEAMS; t++) if (this.teamAlive(t)) alive.push(t);
    if (alive.length === 1) return alive[0];
    if (alive.length === 0) return -1;
    return null;
  }

  onGameOver(winner) {
    if (this.gameOverUi) return;

    const text = winner >= 0 ? `Победа: ${TEAM_NAMES[winner]}!` : 'Ничья';
    const color = winner >= 0 ? TEAM_COLORS[winner] : 0xffffff;

    const shade = this.add.rectangle(0, 0, CFG.VIEW_W, CFG.VIEW_H, 0x070b14, 0.55)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH.HUD + 10);
    const title = this.add.text(CFG.VIEW_W / 2, CFG.VIEW_H / 2 - 26, text, {
      fontFamily: 'monospace', fontSize: '44px',
      color: `#${color.toString(16).padStart(6, '0')}`,
      stroke: '#0d1018', strokeThickness: 8,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.HUD + 11);
    const sub = this.add.text(CFG.VIEW_W / 2, CFG.VIEW_H / 2 + 30,
      'тап или R — новая карта', {
        fontFamily: 'monospace', fontSize: '18px', color: '#c3cee0',
        stroke: '#0d1018', strokeThickness: 5,
      }).setOrigin(0.5).setScrollFactor(0).setDepth(DEPTH.HUD + 11);

    this.gameOverUi = [shade, title, sub];

    this.time.delayedCall(600, () => {
      this.input.once('pointerdown', () => this.scene.restart());
    });
  }

  _shutdown() {
    this.aim?.destroy();
    this.projectiles = [];
    this.worms = [];
  }
}
