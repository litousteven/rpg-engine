// M01 contract — 权威状态分片（模块设计稿 M01-contract.md §5，设计稿 §11）
//
// 不变量：
//   S1 分片只经 timeline 事务变更（P2）
//   S2 inventory 堆叠条目无 uid、实例必带 uid 且不堆叠（G1）
//   S3 rep/affinity ∈ [-100,100]（G13）
//   S4 delayed 队列按 dueTurn 有序、重放时同序执行（G19）
//   S5 uidCounter/intentCounter 单调递增——ID 确定性的落点
//   S6 market.pending 随微事务累积提交，只在 flush 点（阈值或回合边界）清零并改 index（M15 §7）
//
// 数字表示：权威状态禁浮点，价格/指数一律定点整数（缩放 10⁴，决策 O1）。
import { z } from 'zod';
import {
  AbilitySlotKindSchema,
  DirectiveStrengthSchema,
  RaritySchema,
} from './enums.js';
import {
  ActorIdSchema,
  EntityRefSchema,
  InstanceUidSchema,
  SlugSchema,
  TemplateIdSchema,
} from './ids.js';

/** 定点缩放系数（决策 O1：10⁴；存储统一 i64 + scale 元数据） */
export const FIXED_SCALE = 10_000;

// ── 实体（§5.1/§5.3） ──────────────────────────────────────────────

/** 能力槽：引用原语目录的效果原语 + 等级（P4：运行时不新增原语） */
export const AbilitySchema = z.strictObject({
  slot: AbilitySlotKindSchema,
  primitive: SlugSchema,
  rank: z.number().int().min(1).max(5),
  cooldown: z.number().int().min(0).optional(),
});
export type Ability = z.infer<typeof AbilitySchema>;

/** 出处记录（C1/C2：source、回合、掷骰引用；lineage 为完整血统链，G3） */
export const ProvenanceRecordSchema = z.strictObject({
  source: z.string().min(1),
  turn: z.number().int().min(0),
  roll: z.string().min(1).optional(),
  lineage: z.array(z.string().min(1)).optional(),
});
export type ProvenanceRecord = z.infer<typeof ProvenanceRecordSchema>;

/** 堆叠条目（C4：200 件杂物 = 4 条，无 uid） */
export const StackEntrySchema = z.strictObject({
  template: TemplateIdSchema,
  qty: z.number().int().min(1),
  rarity: RaritySchema,
});

/** 唯一实例（C1 具名骨头 / C2 护符：uid 不堆叠，qty 恒为 1） */
export const InstanceEntrySchema = z.strictObject({
  uid: InstanceUidSchema,
  template: TemplateIdSchema,
  qty: z.literal(1),
  rarity: RaritySchema,
  basePrice: z.number().int().min(0).optional(),
  essence: z.array(SlugSchema),
  /** 世界观引用（C2：实体字段存模板 ID 本身；谓词形态 loreRef:… 由 M03 表达式层使用） */
  loreRef: TemplateIdSchema.optional(),
  abilities: z.array(AbilitySchema),
  provenance: ProvenanceRecordSchema,
});

export const InventoryEntrySchema = z.union([InstanceEntrySchema, StackEntrySchema]);
export type StackEntry = z.infer<typeof StackEntrySchema>;
export type InstanceEntry = z.infer<typeof InstanceEntrySchema>;
export type InventoryEntry = z.infer<typeof InventoryEntrySchema>;

// ── 世界分片 ──────────────────────────────────────────────────────

/** 区域控制（G15：region → 控制势力 + 争夺态） */
export const RegionStateSchema = z.strictObject({
  controller: TemplateIdSchema,
  contested: z.boolean(),
});

/** 市场条目（C4/G11：定点指数 + pending 累积器，M15 §7 惰性刷新；键 = `${category}::${region}`） */
export const MarketEntrySchema = z.strictObject({
  index: z.number().int().min(0),
  pendingSupply: z.number().int(),
  pendingDemand: z.number().int(),
});

/** 延迟结算队列条目（G19：dueTurn 到期由管线步骤 0 执行；重放同序） */
export const DelayedEffectSchema = z.strictObject({
  dueTurn: z.number().int().min(0),
  effect: SlugSchema,
  args: z.record(z.string(), z.unknown()).optional(),
  source: z.string().min(1),
});

/** 弧实例（G17：池内资产实例化后的运行时状态） */
export const ArcInstanceSchema = z.strictObject({
  arcId: TemplateIdSchema,
  stage: SlugSchema,
  slots: z.record(z.string(), EntityRefSchema),
  branchHistory: z.array(SlugSchema),
});

/** 场景（§4.3：tags 解锁环境动作——可供性的数据落点） */
export const SceneStateSchema = z.strictObject({
  sceneId: SlugSchema,
  tags: z.array(SlugSchema),
  actorsPresent: z.array(ActorIdSchema),
});

// ── Actor / 账本分片 ──────────────────────────────────────────────

export const ActorStateSchema = z.strictObject({
  hp: z.number().int(),
  level: z.number().int().min(0).optional(),
  gold: z.number().int().min(0).optional(),
  /** 商人钱包（拟态模型，§8.2：有上限、按周期恢复） */
  purse: z.number().int().min(0).optional(),
  membership: TemplateIdSchema.optional(),
  /** L2 标记（G21：为 true 时内容校验器要求完整 L0 profile 在位） */
  l2: z.boolean().optional(),
  profileRef: TemplateIdSchema.optional(),
  drives: z.array(SlugSchema).optional(),
});

/** 好感两级模型（G13/G16：base = f(势力声望)，personal = 个体修正，membership 变更重算 base、保留 personal） */
export const AffinitySchema = z.strictObject({
  base: z.number().int().min(-100).max(100),
  personal: z.number().int().min(-100).max(100),
});

/** 生效中的舞台指令（§3 L1：指令记账，可审计） */
export const ActiveDirectiveSchema = z.strictObject({
  directiveId: z.string().min(1),
  verb: SlugSchema,
  /** ActorId 或角色查询（query: 前缀，如 query:nearest_guards_3） */
  target: z.string().min(1),
  ttlTurns: z.number().int().min(1),
  strength: DirectiveStrengthSchema,
});

// ── 元信息与总装 ──────────────────────────────────────────────────

export const GameStateMetaSchema = z.strictObject({
  turn: z.number().int().min(0),
  revision: z.number().int().min(0),
  /** PCG32 种子（u32；分流 world/combat/loot 由 M02 派生） */
  seed: z.number().int().min(0).max(0xffffffff),
  ruleVersions: z.record(z.string(), z.string()),
  protoVer: z.number().int().min(0),
  uidCounter: z.number().int().min(0),
  intentCounter: z.number().int().min(0),
});

export const GameStateSchema = z.strictObject({
  meta: GameStateMetaSchema,
  world: z.strictObject({
    regions: z.record(z.string(), RegionStateSchema),
    market: z.record(z.string(), MarketEntrySchema),
    delayed: z.array(DelayedEffectSchema),
    arcs: z.array(ArcInstanceSchema),
  }),
  scene: SceneStateSchema,
  /** 键 = ActorId */
  actors: z.record(z.string(), ActorStateSchema),
  ledgers: z.strictObject({
    inventory: z.array(InventoryEntrySchema),
    /** 键 = faction 模板 ID；值 ∈ [-100,100]（S3） */
    factionRep: z.record(z.string(), z.number().int().min(-100).max(100)),
    /** 键 = npc ActorId */
    npcAffinity: z.record(z.string(), AffinitySchema),
    activeDirectives: z.array(ActiveDirectiveSchema),
  }),
});

export type GameState = z.infer<typeof GameStateSchema>;
export type ActorState = z.infer<typeof ActorStateSchema>;
export type MarketEntry = z.infer<typeof MarketEntrySchema>;
