// M01 contract — 失败回执（模块设计稿 M01-contract.md §8，设计稿 §4.1 / §13 MVU 模式）
//
// 规则：
//   R1 reasons 至少一条且必含「提交值 vs 规则要求」（C3 超区间报价、等级不足都由此表达）
//   R2 retryable 区分「可修正重试」（参数错）与「不可重试」（回合已过、菜单已失效）
//   R3 回执本身入事件日志（intent.rejected）——重试闭环可审计
import { z } from 'zod';
import { IntentIdSchema } from './ids.js';

export const RejectionReasonSchema = z.strictObject({
  /** 出错字段路径（如 params.price / actor.level） */
  field: z.string().min(1),
  /** 提交值（原始 JSON） */
  submitted: z.unknown(),
  /** 规则要求的人类可读描述（如 "≥ 8" / "≤ 14400"） */
  expected: z.string().min(1),
  /** 规则出处（如 economy.negotiation_band / menu.gate） */
  rule: z.string().min(1),
});

export const ReceiptSchema = z.strictObject({
  intentId: IntentIdSchema.optional(),
  clientKey: z.string().min(1).max(64),
  retryable: z.boolean(),
  reasons: z.array(RejectionReasonSchema).min(1),
});

export type RejectionReason = z.infer<typeof RejectionReasonSchema>;
export type Receipt = z.infer<typeof ReceiptSchema>;
