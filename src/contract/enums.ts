// M01 contract — 闭集枚举（模块设计稿 M01-contract.md §3/§4.5/§6）
//
// 枚举只增不改（契约版本演进规则）；「不提供无限自由度」——全部取值在编译期封闭。
import { z } from 'zod';

/**
 * intent 来源（P2/I2：来源由提交通道标注，玩家不能伪造）。
 * system：延迟结算、回合 tick、触发器/弧 hook 生成的引擎侧 intent（决策状态 O5）。
 */
export const ProvenanceSchema = z.enum([
  'player',
  'actor-l2',
  'director',
  'stage-direction',
  'menu-enrichment',
  'system',
]);
export type Provenance = z.infer<typeof ProvenanceSchema>;

/**
 * 事件 source 归因（决策 O3 方案 B：类型按 fold 语义划分，交互动词进闭集枚举）。
 * 类型 = 分录科目（怎么变），source = 原始凭证（为什么变）。
 */
export const SourceKindSchema = z.enum([
  'buy',
  'sell',
  'barter',
  'auction',
  'gift',
  'loot',
  'quest-delivery',
  'craft-consume',
  'initial',
]);
export type SourceKind = z.infer<typeof SourceKindSchema>;

/** 稀有度（C1/C2：common/rare/epic；C4 分档定价 白 1×、绿 2×、蓝 4×…） */
export const RaritySchema = z.enum(['common', 'uncommon', 'rare', 'epic', 'legendary']);
export type Rarity = z.infer<typeof RaritySchema>;

/** 菜单条目三态（§4.4：visible 可执行 / locked 显示+达成条件提示 / hidden 玩家侧不存在） */
export const MenuStateSchema = z.enum(['visible', 'locked', 'hidden']);
export type MenuState = z.infer<typeof MenuStateSchema>;

/** 菜单条目来源：基础层（引擎） / 增富层（M1，G22 话题树变体同字段） */
export const MenuOriginSchema = z.enum(['base', 'enriched']);
export type MenuOrigin = z.infer<typeof MenuOriginSchema>;

/** 交互模式（§4.2/§4.5：战斗/对话/探索/商业态各自的动作表） */
export const ModeSchema = z.enum(['combat', 'dialogue', 'exploration', 'commercial']);
export type Mode = z.infer<typeof ModeSchema>;

/** RNG 分流（§14-1：world/combat/loot 独立流，掷骰入日志） */
export const RngStreamSchema = z.enum(['world', 'combat', 'loot']);
export type RngStream = z.infer<typeof RngStreamSchema>;

/** 能力槽（§5.1：passive 装备即生效 / active 主动+冷却 / cost 代价原语） */
export const AbilitySlotKindSchema = z.enum(['passive', 'active', 'cost']);
export type AbilitySlotKind = z.infer<typeof AbilitySlotKindSchema>;

/** 舞台指令强度（§3 L1：硬目标覆盖 / 效用偏置） */
export const DirectiveStrengthSchema = z.enum(['hard', 'bias']);
export type DirectiveStrength = z.infer<typeof DirectiveStrengthSchema>;

/** 提交深度（M15 §7 双层提交：回合事务 / 模式内微事务） */
export const InteractionDepthSchema = z.enum(['micro', 'turn']);
export type InteractionDepth = z.infer<typeof InteractionDepthSchema>;
