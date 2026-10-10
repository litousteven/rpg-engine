// M01 contract — 玩家文本载荷（模块设计稿 M01-contract.md §7，设计稿 §6 注入防御）
//
// 规则：
//   N1 永远是数据不是指令
//   N2 过消毒管道（llm 层）后才进 LLM 上下文
//   N3 引擎侧唯一消费方是描述投影与叙事归档——判定与数值与它正交
import { z } from 'zod';
import { EntityRefSchema } from './ids.js';

export const NamingKindSchema = z.enum(['char_name', 'item_name', 'flavor', 'note']);
export type NamingKind = z.infer<typeof NamingKindSchema>;

export const NamingPayloadSchema = z.strictObject({
  kind: NamingKindSchema,
  /** 长度/字符集受限：字母（含中文）、数字、空格与少量标点 */
  text: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[\p{L}\p{N} _'·-]+$/u, '命名/风味字符集受限（§6 消毒管道第一道）'),
  targetRef: EntityRefSchema.optional(),
});

export type NamingPayload = z.infer<typeof NamingPayloadSchema>;
