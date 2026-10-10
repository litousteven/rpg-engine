// M01 contract — Intent schema（模块设计稿 M01-contract.md §3，设计稿 §4.1）
//
// 不变量：
//   I1 verb ∈ 本回合已呈现菜单的闭集（校验锚点是 menu.presented 事件，M12 落地）
//   I3 clientKey 引擎侧去重：重发同 key 不重复结算
//   I4 params 不含自由文本（玩家命名/风味走 naming 载荷）
import { z } from 'zod';
import { ActorIdSchema, EntityRefSchema, IntentIdSchema, SlugSchema } from './ids.js';
import { ProvenanceSchema } from './enums.js';

/** 客户端提交形态（M15 协议 turn.submitIntent.params.intent） */
export const IntentInputSchema = z.strictObject({
  /** 客户端幂等键（决策 O2：M0 起必填；引擎只去重不解读） */
  clientKey: z.string().min(1).max(64),
  actor: ActorIdSchema,
  /** 闭集：来自菜单条目的 verb（P3——菜单外 verb 结构上无法提交） */
  verb: SlugSchema,
  /** 0..n，类型由 verb 注册表定义 */
  targets: z.array(EntityRefSchema).max(8),
  /** 形状由 verb 注册表逐 verb 校验（M12）；契约层只保证是 JSON 对象 */
  params: z.record(z.string(), z.unknown()),
  /** 来源菜单条目（审计 + I1 校验锚点） */
  menuItemId: z.string().min(1).max(128).optional(),
  /** 决策所依据的 revision；即时制 stale 门控（§12.2） */
  basedOnRevision: z.number().int().min(0).optional(),
});

/** 引擎受理后的完整形态（intentId 引擎分配、provenance 由提交通道标注） */
export const IntentSchema = z.strictObject({
  ...IntentInputSchema.shape,
  intentId: IntentIdSchema,
  provenance: ProvenanceSchema,
  turn: z.number().int().min(0),
});

export type IntentInput = z.infer<typeof IntentInputSchema>;
export type Intent = z.infer<typeof IntentSchema>;
