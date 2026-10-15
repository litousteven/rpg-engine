// M01 contract — GameEvent 判别联合（模块设计稿 M01-contract.md §4，设计稿 §11）
//
// 事件是模块间唯一的真实耦合面（模块模板硬规则「事件产出必填」）：
//   权威事件日志 = fold 输入 = 协议事件流的原材料。
//
// 不变量：
//   E1 fold(events) ≡ snapshot（M04 验收基准）
//   E2 事件 append-only、不可变
//   E3 同种子重放产生逐字节相同的事件流（P7）
//   E4 payload 字段集由 t 唯一决定（Zod discriminated union，strict 拒未知字段）
//
// 粒度裁决（O3 方案 B）：类型按 fold 语义划分（易主/消失/诞生…），交互动词进 source.kind。
// 数字表示：全定点整数（scale 10⁴，state.ts FIXED_SCALE）。
import { z } from 'zod';
import {
  DirectiveStrengthSchema,
  ModeSchema,
  ProvenanceSchema,
  RaritySchema,
  RngStreamSchema,
  SourceKindSchema,
} from './enums.js';
import {
  ActorIdSchema,
  EntityRefSchema,
  IntentIdSchema,
  InstanceUidSchema,
  SlugSchema,
  TemplateIdSchema,
} from './ids.js';
import { AbilitySchema } from './state.js';
import { MenuSchema } from './menu.js';
import { ReceiptSchema } from './receipt.js';

// ── 公共信封字段（M01 §4.1） ──────────────────────────────────────

const envelope = {
  /** 会话内全局递增——事件流游标（重连/重放/断点续传） */
  seq: z.number().int().min(0),
  /** 所属回合 */
  turn: z.number().int().min(0),
  /** 本事件落在哪个已提交事务上（timeline revision++） */
  revision: z.number().int().min(0),
} as const;

/** source 归因（O3 方案 B 的「原始凭证」：fold 只认类型语义，动词进 kind） */
export const SourceRefSchema = z.strictObject({
  kind: SourceKindSchema,
  /** 触发本账面变化的 intent 归因 */
  intentId: IntentIdSchema.optional(),
  questId: TemplateIdSchema.optional(),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

/** 事件构造器：信封 + 判别字面量 + payload，显式 strict（拒未知字段，E4） */
const ev = <T extends string, S extends z.ZodRawShape>(t: T, shape: S) =>
  z.strictObject({ ...envelope, t: z.literal(t), ...shape });

// ── 事件类型目录（M01 §4.3；分组注释对齐该表） ───────────────────

export const GameEventSchema = z.discriminatedUnion('t', [
  // 元
  ev('turn.began', { mode: ModeSchema }),
  ev('turn.settled', { intentCount: z.number().int().min(0), maxCascadeDepth: z.number().int().min(0) }),
  ev('intent.rejected', { intentId: IntentIdSchema, receipt: ReceiptSchema }),
  ev('menu.presented', { mode: ModeSchema, menu: MenuSchema }),

  // 随机（§14-1：掷骰入日志——重放确定性的数据落点；stateBefore 为 RNG 流状态的十六进制串）
  ev('rng.rolled', {
    stream: RngStreamSchema,
    stateBefore: z.string().regex(/^[0-9a-f]+$/, 'RNG 流状态：十六进制串'),
    rolls: z.array(z.number().int().min(0)).min(1),
  }),

  // 账本·物品（fold 语义三分：诞生 / 易主 / 消失）
  ev('item.spawned', {
    /** 诞生即入账的归属者（C1 掉落 → player；C2 搜查 → player） */
    to: ActorIdSchema,
    template: TemplateIdSchema,
    qty: z.number().int().min(1),
    rarity: RaritySchema,
    essence: z.array(SlugSchema),
    /** 唯一实例才有 uid（G1：named → 升级实例不堆叠） */
    uid: InstanceUidSchema.optional(),
    /** 实例携带的世界观引用（C2 护符）与能力槽（G8）——实例字段随事件焊死 */
    loreRef: TemplateIdSchema.optional(),
    abilities: z.array(AbilitySchema).optional(),
    basePrice: z.number().int().min(0).optional(),
    provenance: z.strictObject({
      source: z.string().min(1),
      turn: z.number().int().min(0),
      roll: z.string().min(1).optional(),
      lineage: z.array(z.string().min(1)).optional(),
    }),
    source: SourceRefSchema,
  }),
  ev('item.transferred', {
    from: ActorIdSchema,
    to: ActorIdSchema,
    ref: EntityRefSchema,
    qty: z.number().int().min(1),
    /** 成交价（定点整数；非交易类转移无此字段） */
    price: z.number().int().optional(),
    source: SourceRefSchema,
  }),
  ev('item.destroyed', {
    owner: ActorIdSchema,
    ref: EntityRefSchema,
    qty: z.number().int().min(1),
    source: SourceRefSchema,
  }),

  // 账本·金钱
  ev('gold.changed', {
    actor: ActorIdSchema,
    delta: z.number().int(),
    balance: z.number().int().min(0),
    source: SourceRefSchema,
  }),

  // 账本·声望/好感/归属/区域（S3 上下限由状态侧硬约束，事件记录落定值）
  ev('rep.changed', {
    faction: TemplateIdSchema,
    delta: z.number().int(),
    value: z.number().int().min(-100).max(100),
    source: SourceRefSchema,
  }),
  ev('affinity.changed', {
    npc: ActorIdSchema,
    delta: z.number().int(),
    value: z.number().int().min(-100).max(100),
    source: SourceRefSchema,
  }),
  ev('membership.changed', {
    npc: ActorIdSchema,
    from: TemplateIdSchema,
    to: TemplateIdSchema,
    source: SourceRefSchema,
  }),
  ev('region.control.changed', {
    region: TemplateIdSchema,
    controller: TemplateIdSchema,
    contested: z.boolean(),
    source: SourceRefSchema,
  }),

  // 账本·市场（C4：仅 flush 点发出——量阈值或回合边界，M15 §7 惰性刷新）
  ev('market.index.changed', {
    category: SlugSchema,
    region: TemplateIdSchema,
    index: z.number().int(),
    reason: z.string().min(1),
  }),
  ev('purse.changed', { npc: ActorIdSchema, balance: z.number().int().min(0), source: SourceRefSchema }),

  // 账本·批量（C4 G12：单 intent 批量 delta 的汇总审计）
  ev('ledger.batch', {
    actor: ActorIdSchema,
    rows: z
      .array(
        z.strictObject({
          kind: z.enum(['remove', 'add']),
          ref: EntityRefSchema,
          qty: z.number().int().min(1),
          amount: z.number().int(),
        }),
      )
      .min(1)
      .max(512),
    source: SourceRefSchema,
  }),

  // 战斗
  ev('hp.changed', { actor: ActorIdSchema, delta: z.number().int(), cause: z.string().min(1) }),
  ev('actor.defeated', { actor: ActorIdSchema, cause: z.string().min(1) }),
  ev('ability.used', {
    actor: ActorIdSchema,
    abilityId: SlugSchema,
    cooldownLeft: z.number().int().min(0),
  }),

  // 实体（§5.3：血统链完整入事件，lineage 谓词与叙事检索的事实源）
  ev('entity.composed', {
    uid: InstanceUidSchema,
    recipe: TemplateIdSchema,
    lineage: z.array(z.string().min(1)),
    source: SourceRefSchema,
  }),
  ev('ability.applied', {
    target: ActorIdSchema,
    slot: z.enum(['passive', 'active', 'cost']),
    primitive: SlugSchema,
    rank: z.number().int().min(1).max(5),
  }),

  // 触发（G19：级联预算与延迟结算）
  ev('trigger.fired', { triggerId: TemplateIdSchema, matchedExpr: z.string().min(1) }),
  ev('cascade.budget.hit', { depth: z.number().int().min(0), abandoned: z.number().int().min(0) }),
  ev('deferred.scheduled', {
    dueTurn: z.number().int().min(0),
    effect: SlugSchema,
    source: z.string().min(1),
  }),
  ev('deferred.executed', {
    dueTurn: z.number().int().min(0),
    executedAtTurn: z.number().int().min(0),
    effect: SlugSchema,
  }),

  // 任务（两阶段：prepared → committed 才前进，C5/C1 T4）
  ev('quest.stage.prepared', { questId: TemplateIdSchema, stage: SlugSchema }),
  ev('quest.stage.committed', { questId: TemplateIdSchema, stage: SlugSchema }),

  // 弧（C6 G17/G18）
  ev('arc.selected', { arcId: TemplateIdSchema, slots: z.record(z.string(), EntityRefSchema) }),
  ev('arc.stage.advanced', { arcId: TemplateIdSchema, stage: SlugSchema }),
  ev('arc.branch.taken', { arcId: TemplateIdSchema, from: SlugSchema, to: SlugSchema }),
  ev('arc.aborted', { arcId: TemplateIdSchema }),

  // 指令（§3 L1：记账——何时、为何、影响谁；target 为 ActorId 或角色查询串）
  ev('directive.issued', {
    directiveId: z.string().min(1),
    verb: SlugSchema,
    target: z.string().min(1),
    ttlTurns: z.number().int().min(1),
    strength: DirectiveStrengthSchema,
    reason: z.string().min(1),
    provenance: ProvenanceSchema,
  }),
  ev('directive.expired', { directiveId: z.string().min(1) }),

  // 命名（§6：消毒审计入日志）
  ev('naming.sanitized', {
    target: EntityRefSchema,
    maxLength: z.number().int().min(1),
    truncated: z.boolean(),
  }),
]);

export type GameEvent = z.infer<typeof GameEventSchema>;

/** 事件类型全集（运行时可枚举；完备性测试遍历它对齐 discriminatedUnion） */
export const EVENT_TYPES = [
  'turn.began',
  'turn.settled',
  'intent.rejected',
  'menu.presented',
  'rng.rolled',
  'item.spawned',
  'item.transferred',
  'item.destroyed',
  'gold.changed',
  'rep.changed',
  'affinity.changed',
  'membership.changed',
  'region.control.changed',
  'market.index.changed',
  'purse.changed',
  'ledger.batch',
  'hp.changed',
  'actor.defeated',
  'ability.used',
  'entity.composed',
  'ability.applied',
  'trigger.fired',
  'cascade.budget.hit',
  'deferred.scheduled',
  'deferred.executed',
  'quest.stage.prepared',
  'quest.stage.committed',
  'arc.selected',
  'arc.stage.advanced',
  'arc.branch.taken',
  'arc.aborted',
  'directive.issued',
  'directive.expired',
  'naming.sanitized',
] as const satisfies readonly string[];

export type EventType = (typeof EVENT_TYPES)[number];
