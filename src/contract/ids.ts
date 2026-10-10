// M01 contract — ID 与标识体系（模块设计稿 M01-contract.md §2）
//
// 全部 ID 为带命名空间前缀的字符串，schema 用正则约束（防内容期手写错）。
// 本文件只定义形状，不含任何行为。
import { z } from 'zod';

/** 单段 slug：小写字母开头，允许小写字母/数字/下划线（verb、场景标签、essence 标签等） */
export const SlugSchema = z.string().regex(/^[a-z][a-z0-9_]*$/, 'slug：小写字母开头，仅 [a-z0-9_]');

/** 模板 ID：命名空间.名称，至少两段（item.bone.large / npc.guard / faction.grey_wolves / quest.q42 / lore.sun_cult） */
export const TemplateIdSchema = z.string().regex(
  /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/,
  '模板 ID：至少两段，每段小写字母开头（如 item.bone.large）',
);

/** Actor ID：player 或 npc.<slug>[.<slug|编号>]——npc.guard.12 即模板 npc.guard 的 12 号实例（战斗实例化 NPC） */
export const ActorIdSchema = z.string().regex(
  /^(player|npc\.[a-z][a-z0-9_]*(\.[a-z0-9_]+)*)$/,
  'Actor ID：player 或 npc.<slug>[.<slug|编号>]（如 npc.guard.12）',
);

/** 唯一实例 UID：item.inst.NNNNNN（计数器确定性生成，禁随机，M01 不变量 S5） */
export const InstanceUidSchema = z.string().regex(
  /^item\.inst\.\d{6}$/,
  '实例 UID：item.inst.NNNNNN（6 位计数）',
);

/** Intent ID：int.NNNNNN（引擎按提交顺序分配） */
export const IntentIdSchema = z.string().regex(/^int\.\d{6}$/, 'Intent ID：int.NNNNNN（6 位计数）');

/** 物品谓词的 tag 引用形态（§7：tag:bone_of_bone_maw） */
export const TagRefSchema = z.string().regex(/^tag:[a-z][a-z0-9_]*$/, 'tag 引用：tag:<slug>');

/** 物品谓词的 loreRef 引用形态（§7：loreRef:lore.sun_cult） */
export const LoreRefSchema = z.string().regex(
  /^loreRef:[a-z][a-z0-9_.]+$/,
  'loreRef 引用：loreRef:<模板 ID>',
);

/** 实体引用：uid | 模板 | tag: | loreRef: 四形态（intent targets 与账本引用的统一形态） */
export const EntityRefSchema = z.union(
  [InstanceUidSchema, TemplateIdSchema, TagRefSchema, LoreRefSchema],
  { message: '实体引用：uid / 模板 ID / tag: / loreRef: 四形态之一' },
);

export type Slug = z.infer<typeof SlugSchema>;
export type TemplateId = z.infer<typeof TemplateIdSchema>;
export type ActorId = z.infer<typeof ActorIdSchema>;
export type InstanceUid = z.infer<typeof InstanceUidSchema>;
export type IntentId = z.infer<typeof IntentIdSchema>;
export type EntityRef = z.infer<typeof EntityRefSchema>;
