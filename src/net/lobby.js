import { player } from '../platform/player.js';

/**
 * Лобби: кто сейчас онлайн и с кем свести.
 *
 * Присутствие сделано на обычных широковещательных сообщениях, а не на
 * механизме presence конкретного сервиса. Причина простая: транспорт у нас
 * подменяемый (вкладки, Supabase, что угодно потом), и если завязаться на
 * фирменный presence, лобби перестанет работать везде, кроме одного
 * сервиса, и его нечем будет проверить в тестах.
 *
 * Каждый раз в HEARTBEAT шлёт «я здесь» со своим состоянием. Кого не
 * слышно дольше TIMEOUT — считается ушедшим.
 *
 * Подбор без сервера и без арбитра. Оба клиента видят один и тот же список
 * ищущих, сортируют его по идентификатору и разбивают на пары подряд:
 * первый со вторым, третий с четвёртым. Решение получается одинаковым у
 * обеих сторон, потому что считается из одних и тех же данных, — и код
 * комнаты тоже выводится из пары идентификаторов, а не разыгрывается.
 */

const HEARTBEAT = 1500;   // мс между «я здесь»
const TIMEOUT = 5000;     // мс молчания, после которых игрок считается ушедшим

export class Lobby {
  constructor(transport) {
    this.transport = transport;
    this.me = player();
    this.peers = new Map();      // id -> { id, name, rating, state, seen }
    this.state = 'idle';         // idle | searching
    this.onChange = null;        // сцена перерисовывает список
    this.onMatch = null;         // (room, opponent) — нашли пару
    this.matched = null;
  }

  async start() {
    await this.transport.connect('lobby', (msg) => this._onMessage(msg));
    this._beat();
    this.timer = setInterval(() => this._beat(), HEARTBEAT);
  }

  _beat() {
    this._forget();
    this.transport.send({
      type: 'here',
      id: this.me.id,
      name: this.me.name,
      rating: this.me.rating,
      state: this.state,
    });
    if (this.state === 'searching') this._tryMatch();
    this.onChange?.(this.list());
  }

  /** Убрать тех, кого давно не слышно. */
  _forget() {
    const now = Date.now();
    let changed = false;
    for (const [id, p] of this.peers) {
      if (now - p.seen > TIMEOUT) { this.peers.delete(id); changed = true; }
    }
    if (changed) this.onChange?.(this.list());
  }

  _onMessage(msg) {
    if (msg.type === 'here' && msg.id && msg.id !== this.me.id) {
      this.peers.set(msg.id, {
        id: msg.id, name: msg.name, rating: msg.rating,
        state: msg.state, seen: Date.now(),
      });
      if (this.state === 'searching') this._tryMatch();
      this.onChange?.(this.list());
      return;
    }
    // Приглашение лично мне: соперник выбрал меня в списке
    if (msg.type === 'invite' && msg.to === this.me.id) {
      this._enter(msg.room, this.peers.get(msg.from) ?? { name: msg.name, rating: msg.rating });
    }
  }

  list() {
    return [...this.peers.values()].sort((a, b) => b.rating - a.rating);
  }

  search(on = true) {
    this.state = on ? 'searching' : 'idle';
    this.matched = null;
    this._beat();
  }

  /**
   * Разбиение ищущих на пары. Считается у каждого своё, но из одинаковых
   * данных — поэтому совпадает. Кто в паре первый, тот и «хозяин» комнаты,
   * но код всё равно один и тот же у обоих.
   */
  _tryMatch() {
    if (this.matched) return;
    const ids = [this.me.id, ...this.list()
      .filter((p) => p.state === 'searching')
      .map((p) => p.id)].sort();
    const i = ids.indexOf(this.me.id);
    const partnerId = i % 2 === 0 ? ids[i + 1] : ids[i - 1];
    if (!partnerId) return;

    this._enter(roomFor(this.me.id, partnerId), this.peers.get(partnerId));
  }

  /** Позвать конкретного игрока из списка. */
  invite(peerId) {
    const room = roomFor(this.me.id, peerId);
    this.transport.send({
      type: 'invite', to: peerId, from: this.me.id,
      name: this.me.name, rating: this.me.rating, room,
    });
    this._enter(room, this.peers.get(peerId));
  }

  _enter(room, opponent) {
    if (this.matched) return;
    this.matched = room;
    this.state = 'idle';
    this.onMatch?.(room, opponent ?? null);
  }

  destroy() {
    clearInterval(this.timer);
    this.transport.close();
  }
}

/**
 * Код комнаты из пары идентификаторов. Порядок не важен — сортируем,
 * чтобы обе стороны получили одно и то же, не договариваясь.
 */
export function roomFor(a, b) {
  const key = [a, b].sort().join('|');
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = 'M';
  let n = h >>> 0;
  for (let i = 0; i < 5; i++) { out += abc[n % abc.length]; n = Math.floor(n / abc.length); }
  return out;
}
