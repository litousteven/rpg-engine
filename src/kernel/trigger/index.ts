// M08 trigger — 公共出口
export { eventLogView } from './log-view.js';
export type { EventLogView } from './log-view.js';
export { predicateContext, TRIGGER_PREDICATES } from './predicates.js';
export type { PredicateContext } from './predicates.js';
export {
  processTriggers,
  executeDeferreds,
  dueDeferreds,
  buildDeferredScheduled,
  buildDeferredExecuted,
  DEFAULT_MAX_DEPTH,
  DEFAULT_TURN_BUDGET,
  DEFAULT_CHAIN_BUDGET,
} from './engine.js';
export type { TriggerResult, ProcessOptions } from './engine.js';
