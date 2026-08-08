import { CFG, DEPTH } from '../config.js';
import { has } from '../core/assets.js';

/**
 * Мина.
 *
 * Единственный предмет, который переживает ход того, кто его поставил:
 * лежит, пока рядом кто-нибудь не пройдёт. Поэтому она живёт не в списке
 * снарядов (он чистится в конце хода), а рядом с ящиками.
 *
 * Взводится не сразу — иначе поставивший подрывался бы на ней сам, не
 * успев отойти. После срабатывания ещё секунда на «пикание»: у жертвы
 * должен быть шанс отскочить, и это единственное, что делает мину
 * оружием позиционным, а не просто отложенным взрывом.
 */
export class Mine {
  constructor(scene, x, y, weapon, owner) {
    this.scene = scene;
    this.terrain = scene.terrain;
    this.weapon = weapon;
    this.owner = owner;

    this.x = x;
    this.y = y;
    this.alive = true;
    this.armed = false;
    this.armTimer = CFG.MINE_ARM;
    this.fuse = 0;                  // >0 — уже пикает, скоро рванёт
    this.vy = 0;

    const key = has(scene, 'proj_mine') ? 'proj_mine' : null;
    if (key) {
      this.view = scene.add.sprite(x, y, key);
    } else {
      this.view = scene.add.circle(x, y, 6, 0xb04040);
      this.view.setStrokeStyle(2, 0x1a1a24, 0.8);
    }
    scene.rig.world(this.view.setDepth(DEPTH.WORM - 1));
  }

  /** Опустить на землю: мину ставят стоя, а под ногами может быть склон. */
  _fall(dt) {
    this.vy = Math.min(this.vy + CFG.GRAVITY * dt, 700);
    const step = this.vy * dt;
    const ray = this.terrain.raycast(this.x, this.y, this.x, this.y + step);
    if (ray.hit) {
      this.y = ray.freeY;
      this.vy = 0;
      return true;
    }
    this.y += step;
    if (this.y > CFG.DROWN_Y) { this.destroy(); return false; }
    return false;
  }

  update(dt) {
    if (!this.alive) return;

    const onGround = this.terrain.solidInRow(this.x - 4, this.x + 4, this.y + 1);
    if (!onGround) { this._fall(dt); }
    if (!this.alive) return;

    if (!this.armed) {
      this.armTimer -= dt;
      // Взводится не просто по таймеру, а когда рядом никого не осталось.
      // Иначе мина всегда убивала своего же: ход кончается сразу после
      // установки, поставивший стоит вплотную, и первым, кого замечает
      // взведённая мина, оказывается он сам.
      if (this.armTimer <= 0 && !this._someoneClose()) {
        this.armed = true;
        if (this.view.setTexture && has(this.scene, 'proj_mine_on')) {
          this.view.setTexture('proj_mine_on');
          if (this.scene.anims.exists('proj_mine_on')) this.view.play('proj_mine_on');
        }
      }
    } else if (this.fuse > 0) {
      this.fuse -= dt;
      // Мигаем всё быстрее — это единственное предупреждение, которое есть
      const blink = this.fuse < 0.35 ? 12 : 6;
      this.view.setAlpha(Math.sin(this.fuse * blink * Math.PI) > 0 ? 1 : 0.35);
      if (this.fuse <= 0) { this.explode(); return; }
    } else if (this._someoneClose()) {
      this.fuse = CFG.MINE_FUSE;
      this.scene.fx.pickup(this.x, this.y - 14, 'мина!', '#ff8a8a');
    }

    this.view.setPosition(Math.round(this.x), Math.round(this.y));
  }

  _someoneClose() {
    for (const w of this.scene.worms) {
      if (!w.alive) continue;
      if (Math.hypot(w.x - this.x, w.centerY - this.y) <= CFG.MINE_TRIGGER) return true;
    }
    return false;
  }

  explode() {
    if (!this.alive) return;
    const { x, y } = this;
    this.destroy();
    this.scene.explode(x, y, this.weapon.explosion, this.owner);
  }

  destroy() {
    if (!this.alive) return;
    this.alive = false;
    this.view.destroy();
  }
}
