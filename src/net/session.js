import { captureState, applyState, applyCommand, stateHash } from './protocol.js';
import { randomId } from './transport.js';

/**
 * Сетевая партия на двоих.
 *
 * Кто есть кто, решается без сервера: оба шлют приветствие со своим
 * случайным идентификатором и своим зерном, и меньший идентификатор
 * становится первой командой — его зерно и берётся. Схема симметричная,
 * арбитр не нужен, и она одинаково работает и между вкладками, и через
 * Supabase.
 *
 * Дальше ход принадлежит тому, чья команда сейчас ходит:
 *   • он играет как обычно, его приказ и итоговый снимок уходят второму;
 *   • второй в это время не может вводить ничего, показывает чужой выстрел
 *     по приказу и в конце приводит состояние к снимку.
 */
export class NetSession {
  constructor(scene, transport, room) {
    this.scene = scene;
    this.transport = transport;
    this.room = room;

    this.id = transport.id ?? randomId();
    this.peerId = null;
    this.myTeam = null;        // null = ещё не спарились
    this.seed = scene.seed;
    this.paired = false;
    this.lastTurn = 0;         // отсекает опоздавшие приказы
    this.lastPeerSeen = 0;
    this.onStatus = null;      // сцена подписывается, чтобы показать статус
  }

  get connected() { return this.paired; }
  get myTurn() { return this.myTeam !== null && this.scene.turn.currentTeam === this.myTeam; }

  async start() {
    await this.transport.connect(this.room, (msg) => this._onMessage(msg));
    this._hello();
    // Второй игрок мог подключиться раньше и уже отправить своё приветствие
    this.helloTimer = setInterval(() => { if (!this.paired) this._hello(); }, 1200);
    this._status('ждём второго игрока…');
  }

  _hello() {
    this.transport.send({ type: 'hello', id: this.id, seed: this.seed });
  }

  _status(text) {
    this.onStatus?.(text, this.paired);
  }

  _onMessage(msg) {
    this.lastPeerSeen = Date.now();
    switch (msg.type) {
      case 'hello': return this._onHello(msg);
      case 'shot': return this._onShot(msg);
      case 'state': return this._onState(msg);
      default: return undefined;
    }
  }

  _onHello(msg) {
    if (this.paired && msg.id === this.peerId) return;
    this.peerId = msg.id;

    // Меньший идентификатор — первая команда, и его зерно общее.
    const iAmFirst = this.id < msg.id;
    this.myTeam = iAmFirst ? 0 : 1;
    const seed = iAmFirst ? this.seed : msg.seed;

    // Отвечаем, чтобы тот, кто пришёл первым, тоже узнал о нас
    this._hello();

    if (!this.paired) {
      this.paired = true;
      clearInterval(this.helloTimer);
      this._status(`вы играете за ${this.myTeam === 0 ? 'красных' : 'синих'}`);
      this.scene.startNetMatch(seed, this.myTeam);
    }
  }

  /**
   * Своё эхо отсекает транспорт, так что сюда приходит только чужое —
   * фильтровать по «чей сейчас ход» нельзя: к моменту доставки очередь
   * могла уже смениться, и мы выбросили бы нужное сообщение.
   */
  _onShot(msg) {
    if (msg.cmd.turn < this.lastTurn) return;    // опоздавший приказ
    this.lastTurn = msg.cmd.turn;
    applyCommand(this.scene, msg.cmd);
  }

  _onState(msg) {
    applyState(this.scene, msg.state);
    this.lastTurn = msg.state.turn;
    const mine = stateHash(captureState(this.scene));
    if (mine !== msg.hash) {
      // Снимок уже применён, партия не сломается, но знать полезно:
      // расхождение здесь означает ошибку в самом протоколе.
      console.warn('[net] состояние разошлось', mine, '!=', msg.hash);
      this.onDiverge?.(mine, msg.hash);
    }
  }

  /** Вызывается сценой при выстреле локального игрока. */
  sendShot(cmd) {
    if (!this.paired) return;
    this.transport.send({ type: 'shot', cmd });
  }

  /**
   * Вызывается сценой, когда ход отыгран и очередь уже передана.
   * Шлёт только тот, чей ход это был: второй в это время ждал.
   */
  sendState(actedTeam) {
    if (!this.paired || actedTeam !== this.myTeam) return;
    const state = captureState(this.scene);
    this.lastTurn = state.turn;
    this.transport.send({ type: 'state', state, hash: stateHash(state) });
  }

  destroy() {
    clearInterval(this.helloTimer);
    this.transport.close();
  }
}
