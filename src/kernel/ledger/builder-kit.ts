// M05 ledger / M06 entity — 构建器共用件（builder Result 形态与事件草稿）
//
// builder 产出 Result（M05 裁决 O1）：{ ok: true, events } | { ok: false, receipt }——
// 回执即 R1 形态（提交值 vs 规则要求），M12/协议零转换。
//
// 事件草稿：payload 优先（信封 seq/turn/revision 由调用方在入 timeline 事务前统一
// 分配——builder 不持有日志游标，无法预知信封；与 M08 触发器 renumber 同一约定）。
import { ReceiptSchema } from '../../contract/index.js';
import type { GameEvent, Receipt } from '../../contract/index.js';

export type BuildResult = { ok: true; events: BuildEventDraft[] } | { ok: false; receipt: Receipt };

/**
 * 事件草稿：判别联合的宽化形态——t 是 GameEvent['t'] 之一，payload 字段不做
 * 精确判别（运行时校验由 timeline.apply 的 Zod schema 兜底，E4）。
 * 生成侧（builder/M06/M08）以它为产出类型；消费侧 seal 后过 schema。
 */
export type BuildEventDraft = { t: GameEvent['t'] } & Record<string, unknown>;

/** 轻量回执构造（builder 内部用；intentId 由 M12 在受理时补） */
export function reject(
  clientKey: string,
  reasons: { field: string; submitted: unknown; expected: string; rule: string }[],
  retryable = true,
): { ok: false; receipt: Receipt } {
  return {
    ok: false,
    receipt: ReceiptSchema.parse({ clientKey, retryable, reasons }),
  };
}

/** 给事件草稿盖信封（timeline.apply 前的最后一步；schema 校验兜底 E4） */
export function seal(
  drafts: readonly BuildEventDraft[],
  env: { seq: number; turn: number; revision: number },
): GameEvent[] {
  return drafts.map((d, i) => ({ ...d, seq: env.seq + i, turn: env.turn, revision: env.revision })) as GameEvent[];
}
