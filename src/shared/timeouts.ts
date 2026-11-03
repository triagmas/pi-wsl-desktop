/**
 * UI21 F1-B R02 — единый источник тайм-аутов отправки.
 *
 * P1-дефект: внешний тайм-аут main-процесса (BridgeClient, дефолт 10 000 мс)
 * был МЕНЬШЕ внутреннего бюджета Pi на ACK команды `prompt`. Первая отправка в
 * холодной сессии (инициализация провайдера/расширений) не успевала подтвердить
 * приём за 10 с, и здоровый медленный ACK выглядел как `BRIDGE_TIMEOUT`.
 *
 * Правило, которое нельзя нарушать: **внешний тайм-аут каждого метода записи
 * строго больше внутреннего бюджета соответствующей операции Pi.** Обратное
 * соотношение всегда превращает медленный, но успешный вызов в ложный отказ.
 *
 * Обычные читающие запросы остаются на прежних 10 000 мс — увеличивать их
 * незачем, а «широкий» тайм-аут скрыл бы настоящие зависания.
 */

/** Общий бюджет обычной команды Pi (get_state, abort-подготовка, …). */
export const PI_COMMAND_TIMEOUT_MS = 15_000;

/**
 * Бюджет ACK команды `prompt`: Pi подтверждает ПРИЁМ промпта (disposition),
 * а не окончание ответа. Холодная сессия реально отвечает дольше 10 с.
 */
export const PI_PROMPT_ACK_TIMEOUT_MS = 60_000;

/**
 * R02 (#6566550672): потолок ОДНОЙ команды только что запущенного
 * `pi --mode rpc`. На реальном WSL-профиле холодный старт (загрузка
 * расширений, проверка пакетов) занимает 22 848–33 451 мс, поэтому общий
 * 15 000 мс рубил здоровый `new_session`/`get_state`.
 *
 * В R03 это уже не «первая команда», а потолок любого шага запуска; сумму
 * шагов ограничивает единый PI_START_BUDGET_MS, а не произведение окон.
 */
export const PI_COLD_START_TIMEOUT_MS = 40_000;

/**
 * R03 (#6572954720, P2): ЕДИНЫЙ end-to-end бюджет запуска сессии Pi —
 * от `spawn` до последней команды старта (`new_session`/`get_state` или
 * `get_state`/`switch_session`/`get_state`).
 *
 * Почему единый: в R02 каждая команда имела своё окно 40 000 мс, а внешний
 * бюджет операции — своё число (70 000/85 000). Две последовательные допустимо
 * медленные команды (по 40 000 мс) в такой схеме не помещались: вторая
 * обрывалась внешним тайм-аутом main, исход операции становился неопределённым.
 *
 * Схема (сверху вниз, каждый слой ждёт дольше внутреннего):
 *   IPC main        methodTimeoutMs('newSession'|'openSession') = 88 000
 *   bridge handler  bridgeHandlerTimeoutMs(...)                = 83 000
 *   запуск Pi       PI_START_BUDGET_MS                         = 80 000
 *   одна команда    min(PI_COLD_START_TIMEOUT_MS, остаток)      = 40 000
 *   обычная команда PI_COMMAND_TIMEOUT_MS                       = 15 000
 *   потолок bridge  BRIDGE_MAX_REQUEST_TIMEOUT_MS               = 90 000
 *
 * 80 000 = ровно два потолка команды, поэтому две медленные команды подряд
 * завершаются штатно, а третья получает только реальный остаток и при
 * исчерпании даёт явную ошибку «бюджет запуска исчерпан», не дожидаясь чужого
 * тайм-аута.
 */
export const PI_START_BUDGET_MS = 80_000;

/**
 * Запас между внутренним бюджетом запуска и внешним тайм-аутом main:
 * покрывает сериализацию IPC, kill процесса и запись диагностики, чтобы
 * ошибку формировал bridge, а не main с неопределённым исходом.
 */
export const PI_START_MARGIN_MS = 8_000;

/** Pi отвечает на `abort` только когда сессия стала idle. */
export const PI_INTERRUPT_TIMEOUT_MS = 30_000;

/** Бюджет ожидания `agent_settled` (сам ответ модели, не влияет на ACK). */
export const PI_SETTLE_TIMEOUT_MS = 180_000;

/** Внешний тайм-аут main-процесса для обычных (читающих) запросов. */
export const BRIDGE_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Потолок, который применяет сам bridge к `timeoutMs` из кадра запроса.
 * Он обязан быть БОЛЬШЕ самого длинного внешнего тайм-аута, иначе bridge
 * оборвёт запрос раньше main и снова превратит медленный успех в отказ.
 */
export const BRIDGE_MAX_REQUEST_TIMEOUT_MS = 90_000;

/**
 * UI21 F1-B R01 — бюджеты пробы Pi на готовом гейте (единственный источник истины).
 *
 * Проба последовательна: `--version`, затем дешёвая проверка режима и, если она
 * ничего не доказала, резервный `--help` (холодный DrvFs-старт доходит до ~18 с).
 * Внешний бюджет гейта обязан покрыть СУММУ этих шагов плюс запас обработчика,
 * иначе совместимый медленный Pi получит ложный BRIDGE_TIMEOUT.
 */
export const PI_VERSION_PROBE_TIMEOUT_MS = 8_000;
export const PI_MODE_PROBE_TIMEOUT_MS = 5_000;
export const PI_HELP_FALLBACK_TIMEOUT_MS = 20_000;
/** Худший случай одной пробы: version + режим + резервный help. */
export const PI_RPC_PROBE_BUDGET_MS =
  PI_VERSION_PROBE_TIMEOUT_MS + PI_MODE_PROBE_TIMEOUT_MS + PI_HELP_FALLBACK_TIMEOUT_MS;

const MUTATION_MARGIN_MS = 15_000;

/**
 * Запас, на который внешний тайм-аут main больше бюджета обработчика в bridge.
 * Нужен, чтобы именно bridge успел ответить своей ошибкой (а не main оборвал
 * запрос, оставив исход неизвестным).
 */
export const BRIDGE_HANDLER_MARGIN_MS = 5_000;

/**
 * Внешние тайм-ауты методов записи: внутренний бюджет + запас на транспорт и
 * сериализацию. Значения — единственный источник истины для `registerIpc`.
 */
/**
 * Внешний бюджет готового гейта и тех же двух методов из UI: оба могут запустить
 * пробу Pi (если она ещё не доказана), поэтому им нужен полный бюджет пробы,
 * иначе медленный, но совместимый Pi снова получит ложный BRIDGE_TIMEOUT.
 */
export const GATE_REQUEST_MS = PI_RPC_PROBE_BUDGET_MS + BRIDGE_HANDLER_MARGIN_MS + 2_000;

export const BRIDGE_METHOD_TIMEOUTS: Readonly<Record<string, number>> = {
  getRuntimeInfo: GATE_REQUEST_MS,
  getCapabilities: GATE_REQUEST_MS,
  /**
   * R03: запуск сессии — единый бюджет (spawn + get_state [+ switch_session +
   * get_state]) плюс запас на IPC/отмену. Ниже потолка bridge (90 000 мс).
   */
  openSession: PI_START_BUDGET_MS + PI_START_MARGIN_MS,
  /** Только ACK промпта; стриминг идёт событиями и этим тайм-аутом не ограничен. */
  sendPrompt: PI_PROMPT_ACK_TIMEOUT_MS + MUTATION_MARGIN_MS,
  interrupt: PI_INTERRUPT_TIMEOUT_MS + MUTATION_MARGIN_MS,
  // Ниже — операции из трёх последовательных команд Pi (pre-state → мутация →
  // post-state), каждая со своим бюджетом 15 000 мс, плюс запас на подтверждение
  // записи файла и транспорт. Сравнивать их с ОДНОЙ командой нельзя.
  /**
   * R02/R03: `newSession` поднимает `pi --mode rpc` в каталоге проекта и ждёт
   * `new_session` + `get_state`. Замер на реальном Pi без inference:
   * 22 848–33 451 мс на холодном и уже прогретом профиле. В R03 сумма шагов
   * ограничена единым PI_START_BUDGET_MS, внешний тайм-аут — он же плюс запас.
   */
  newSession: PI_START_BUDGET_MS + PI_START_MARGIN_MS,
  closeSession: PI_COMMAND_TIMEOUT_MS * 3 + MUTATION_MARGIN_MS,
  setModel: PI_COMMAND_TIMEOUT_MS * 3 + MUTATION_MARGIN_MS,
  setThinkingLevel: PI_COMMAND_TIMEOUT_MS * 3 + MUTATION_MARGIN_MS,
};

/** Тайм-аут для метода: увеличенный только там, где операция действительно долгая. */
export function methodTimeoutMs(method: string): number {
  return BRIDGE_METHOD_TIMEOUTS[method] ?? BRIDGE_REQUEST_TIMEOUT_MS;
}

/**
 * Бюджет, который main передаёт bridge в кадре запроса. Он строго меньше
 * внешнего тайм-аута main и строго больше внутреннего бюджета операции Pi —
 * так ошибку формирует bridge, а main успевает её получить.
 */
export function bridgeHandlerTimeoutMs(method: string): number {
  // Пол в точности как в BridgeClient: бюджет bridge никогда не уменьшается
  // ниже прежних 10 000 мс, иначе читающие запросы стали бы строже.
  return Math.max(BRIDGE_REQUEST_TIMEOUT_MS, methodTimeoutMs(method) - BRIDGE_HANDLER_MARGIN_MS);
}
