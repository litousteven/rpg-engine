// M07 rules — 效果原语注册表（模块设计稿 M07-rules.md §2，R-5 原语封闭）
//
// EffectPrimitive 是代码常量（技术选型稿 §4 硬规则 6）：纯函数
//   (state, args, rng) → events[]；原语内无 IO。
// B1 落测试原语骨架——真实效果原语集随 M12/B2 结算器落地，现在只有
// 内容三件套与触发器联测需要的最小集（命名锚定 case 文档）。
import type { GameState, GameEvent } from '../../contract/index.js';
import type { Rng } from '../rng/index.js';

export type EffectPrimitive = (state: GameState, args: unknown, rng: Rng) => GameEvent[];

/** 注册表键 = 原语 id（与 content primitives.json 的 id 对齐，R-5 校验依据） */
export type EffectRegistry = ReadonlyMap<string, EffectPrimitive>;

const registry = new Map<string, EffectPrimitive>();

/**
 * B1 测试原语：产出 ability.applied（无信封——seq/turn/revision 由 M08 在
 * 入事务前统一分配；见 trigger.ts renumber）。锚点：
 *   C1 T3 骨刃配方 essence 映射（poison_on_hit / heavy）
 *   C2 护符能力槽三型（light_resist / holy_burst / dark_penalty）
 *   B1 收口：任务效果原语（quest_effect——quest.stage.prepared 产出）
 */
const ABILITY_PRIMITIVES: Record<string, { slot: 'passive' | 'active' | 'cost'; rank: number }> = {
  poison_on_hit: { slot: 'passive', rank: 1 }, // C1 T3
  heavy: { slot: 'passive', rank: 1 }, // C1 T3
  light_resist: { slot: 'passive', rank: 2 }, // C2
  holy_burst: { slot: 'active', rank: 1 }, // C2
  dark_penalty: { slot: 'cost', rank: 1 }, // C2
};

const buildApplied = (
  t: { slot: 'passive' | 'active' | 'cost'; rank: number },
  primitive: string,
  target: string,
): GameEvent => ({
  seq: 0,
  turn: 0,
  revision: 0,
  t: 'ability.applied',
  target,
  slot: t.slot,
  primitive,
  rank: t.rank,
});

for (const [id, spec] of Object.entries(ABILITY_PRIMITIVES)) {
  const impl: EffectPrimitive = (state, args) => {
    const target =
      args && typeof args === 'object' && 'target' in args && typeof args.target === 'string'
        ? args.target
        : 'player';
    return [buildApplied(spec, id, target)] as GameEvent[];
  };
  registry.set(id, impl);
}

// C1 T4 联测原语：任务阶段推进（quest.stage.prepared；两阶段提交的提议侧）
registry.set('quest_effect', (_state, args) => {
  const questId =
    args && typeof args === 'object' && 'questId' in args && typeof args.questId === 'string'
      ? args.questId
      : 'quest.default';
  const stage =
    args && typeof args === 'object' && 'stage' in args && typeof args.stage === 'string'
      ? args.stage
      : 'default';
  const event: GameEvent = {
    seq: 0,
    turn: 0,
    revision: 0,
    t: 'quest.stage.prepared',
    questId,
    stage,
  };
  return [event];
});

/** 只读注册表（R-5；数据侧原语目录 id ⊆ 此键集，assembleRuleset 校验） */
export const effectRegistry: EffectRegistry = registry;
