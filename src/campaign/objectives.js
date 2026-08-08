/**
 * Цели миссий.
 *
 * «Выбить всех» — единственный сценарий, который умеет сама сцена, и его
 * мало: кампания из восьми одинаковых зачисток скучна уже на третьей карте.
 * Здесь описано, чем ещё может кончиться миссия, и это описание намеренно
 * оторвано от игры: сюда не приходит ни сцена, ни Phaser, ни бойцы —
 * только снимок состояния в виде чисел. Такую проверку можно вызвать из
 * любого места, прогнать в тесте и прочитать глазами, не запуская браузер.
 *
 * СНИМОК ПАРТИИ (то, что нужно собрать в GameScene):
 *
 *   {
 *     turn:       number,    // TurnManager.turnNumber — сквозной счётчик ходов
 *                            // ОБЕИХ сторон: «продержаться 10 ходов» это 10
 *                            // ходов на столе, примерно по 5 на команду
 *     playerTeam: number,    // GameScene.myTeamIndex
 *     alive:      number[],  // сколько бойцов живо, по индексу команды
 *     size:       number[],  // сколько бойцов было в начале, по индексу команды
 *   }
 *
 * Собрать его помогает snapshot() ниже — ей хватает массива бойцов с полями
 * team/alive и состава команд из описания партии.
 *
 * ПОДКЛЮЧЕНИЕ (одна строчка в GameScene, там где сейчас checkVictory):
 *
 *   import { checkObjective, snapshot } from '../campaign/objectives.js';
 *   import { missionObjective } from '../campaign/missions.js';
 *   ...
 *   // рядом с checkVictory(): в кампании судит цель, в остальных режимах —
 *   // как было. Проверять надо там же, где сейчас: после смерти бойца и
 *   // в конце хода, — а ещё в начале хода, иначе «продержаться N ходов»
 *   // и «уложиться в N ходов» сработают на ход позже.
 *   checkObjectiveNow() {
 *     const obj = this.match.mode === 'campaign'
 *       ? missionObjective(this.match.missionId) : null;
 *     if (!obj) return null;
 *     return checkObjective(obj, snapshot({
 *       turn: this.turn.turnNumber,
 *       playerTeam: this.myTeamIndex,
 *       worms: this.worms,
 *       teams: this.match.teams,
 *     }));
 *   }
 *
 * Вердикт 'win' — миссия зачтена (markDone + экран победы), 'lose' —
 * провал, null — играем дальше.
 */

/** Цель по умолчанию: если у миссии её нет, миссия обычная — на выбивание. */
export const DEFAULT_OBJECTIVE = { kind: 'eliminate' };

/**
 * Проверки целей.
 *
 * Каждая — чистая функция (objective, snapshot) -> 'win' | 'lose' | null.
 * Возврат null означает «мне добавить нечего», и тогда решает базовое
 * правило: своих не осталось — поражение, чужих не осталось — победа.
 * Базовое правило действует всегда: миссию нельзя проиграть «наполовину».
 */
const RULES = {
  /** Выбить всех. Всё решает базовое правило, добавлять нечего. */
  eliminate: () => null,

  /**
   * Продержаться N ходов. Считаем по сквозному номеру хода: как только
   * начался ход номер N+1, значит N ходов уже отыграно и мы живы.
   */
  survive: (o, s) => (s.turn > (o.turns ?? 10) ? 'win' : null),

  /**
   * Победить без потерь. Проверяется до победы, а не после: размен
   * «последний враг за последнего своего» здесь считается провалом,
   * иначе цель ничего не требует.
   */
  noLosses: (o, s) => (losses(s) > (o.allow ?? 0) ? 'lose' : null),

  /**
   * Уложиться в N ходов. Перебор по времени — поражение; победа на
   * последнем разрешённом ходу засчитывается (turn ещё не больше N).
   */
  underPar: (o, s) => (s.turn > (o.turns ?? 12) ? 'lose' : null),
};

export const OBJECTIVE_KINDS = Object.keys(RULES);

/**
 * Итог миссии на текущий момент.
 * @param {{kind?:string}} objective — поле objective миссии
 * @param {{turn:number,playerTeam:number,alive:number[],size:number[]}} snap
 * @returns {'win'|'lose'|null}
 */
export function checkObjective(objective, snap) {
  const o = objective ?? DEFAULT_OBJECTIVE;
  const rule = RULES[o.kind] ?? RULES.eliminate;

  // Свои кончились — поражение при любой цели, спорить не о чем.
  // (Взаимное истребление тоже поражение: задание не выполнено.)
  if (alive(snap, snap.playerTeam) <= 0) return 'lose';

  // Особое условие сильнее обычной победы: «без потерь» должно уметь
  // отобрать уже случившуюся зачистку, а «за N ходов» — просрочку.
  const special = rule(o, snap);
  if (special) return special;

  return enemiesAlive(snap) <= 0 ? 'win' : null;
}

/**
 * Снимок из «сырых» данных партии. Phaser тут не нужен: worms — любой
 * массив объектов с полями team и alive, teams — состав из описания партии.
 */
export function snapshot({ turn = 0, playerTeam = 0, worms = [], teams = [] }) {
  const n = Math.max(teams.length, ...worms.map((w) => w.team + 1), 1);
  const aliveBy = new Array(n).fill(0);
  const sizeBy = new Array(n).fill(0);

  for (let t = 0; t < n; t++) sizeBy[t] = teams[t]?.worms ?? 0;
  for (const w of worms) {
    if (w.team < 0 || w.team >= n) continue;
    if (w.alive) aliveBy[w.team]++;
    // Состав может быть не задан (быстрая игра) — тогда считаем по бойцам
    if (!teams.length) sizeBy[w.team]++;
  }
  return { turn, playerTeam, alive: aliveBy, size: sizeBy };
}

/** Короткая формулировка задачи — в брифинг и в HUD. */
export function objectiveText(objective) {
  const o = objective ?? DEFAULT_OBJECTIVE;
  if (o.text) return o.text;              // у миссии может быть своя фраза
  switch (o.kind) {
    case 'survive': return `Продержаться ${o.turns ?? 10} ходов`;
    case 'noLosses': return 'Победить, не потеряв ни одного бойца';
    case 'underPar': return `Победить за ${o.turns ?? 12} ходов`;
    default: return 'Выбить всех противников';
  }
}

/**
 * Строка прогресса — то, что имеет смысл держать перед глазами по ходу
 * миссии. Без неё цель «продержаться 10 ходов» превращается в угадайку.
 * Возвращает null, если показывать нечего.
 */
export function objectiveProgress(objective, snap) {
  const o = objective ?? DEFAULT_OBJECTIVE;
  switch (o.kind) {
    case 'survive': {
      const n = o.turns ?? 10;
      return `ход ${Math.min(snap.turn, n)} из ${n}`;
    }
    case 'underPar': {
      const n = o.turns ?? 12;
      return `ход ${snap.turn} из ${n}`;
    }
    case 'noLosses': {
      const l = losses(snap);
      return l ? `потери: ${l}` : 'потерь нет';
    }
    default: {
      const left = enemiesAlive(snap);
      return left ? `противников: ${left}` : null;
    }
  }
}

/** Сколько ходов осталось до срока. null — срока нет. */
export function turnsLeft(objective, snap) {
  const o = objective ?? DEFAULT_OBJECTIVE;
  if (o.kind !== 'survive' && o.kind !== 'underPar') return null;
  return Math.max(0, (o.turns ?? 0) - snap.turn);
}

// ---------------------------------------------------------------- мелочи

function alive(snap, team) { return snap.alive?.[team] ?? 0; }

function enemiesAlive(snap) {
  return (snap.alive ?? []).reduce(
    (sum, n, t) => (t === snap.playerTeam ? sum : sum + n), 0,
  );
}

function losses(snap) {
  const team = snap.playerTeam;
  return Math.max(0, (snap.size?.[team] ?? 0) - alive(snap, team));
}
