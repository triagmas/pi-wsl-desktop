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
   * Холодный старт `pi --mode rpc` + до трёх команд `get_state`/`switch_session`
   * (по 15 000 мс каждая) на реальном профиле.
   */
  openSession: PI_COMMAND_TIMEOUT_MS * 3 + MUTATION_MARGIN_MS,
  /** Только ACK промпта; стриминг идёт событиями и этим тайм-аутом не ограничен. */
  sendPrompt: PI_PROMPT_ACK_TIMEOUT_MS + MUTATION_MARGIN_MS,
  interrupt: PI_INTERRUPT_TIMEOUT_MS + MUTATION_MARGIN_MS,
  // Ниже — операции из трёх последовательных команд Pi (pre-state → мутация →
  // post-state), каждая со своим бюджетом 15 000 мс, плюс запас на подтверждение
  // записи файла и транспорт. Сравнивать их с ОДНОЙ командой нельзя.
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
