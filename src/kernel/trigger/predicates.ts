// M08 trigger — 谓词上下文（模块设计稿 M08-trigger.md §2，裁决 O2）
//
// 闭包持有 GameState + EventLogView + Ruleset（§7 硬规则 3：
// 查物品走账本索引、查事件走事件日志、不扫描叙事归档）。
// 谓词集（§7 清单）：player_level / faction_rep / npc_affinity / player_owns /
// lineage_of / item_delivered / market_index / region_controlled_by /
// region_contested / quest_stage / arc_stage / scene_tag。
import type { GameState } from '../../contract/index.js';
import type { PredValue, ArgValue } from '../expr/index.js';
import { ownedQty, findEntries } from '../ledger/query.js';
import type { EventLogView } from './log-view.js';

/** 谓词签名注册表（checkTypes 静态查用；§7 谓词清单的返回类型） */
export const TRIGGER_PREDICATES: Record<string, { returns: 'bool' | 'num' | 'str' }> = {
  player_level: { returns: 'num' },
  faction_rep: { returns: 'num' },
  npc_affinity: { returns: 'num' },
  player_owns: { returns: 'bool' },
  lineage_of: { returns: 'str' },
  item_delivered: { returns: 'bool' },
  market_index: { returns: 'num' },
  region_controlled_by: { returns: 'str' },
  region_contested: { returns: 'bool' },
  quest_stage: { returns: 'str' },
  arc_stage: { returns: 'str' },
  scene_tag: { returns: 'bool' },
};

export type PredicateContext = (name: string, args: ArgValue[]) => PredValue;

/** M03 表达式的求值上下文（evaluate 的 ctx 参数） */
export function predicateContext(
  state: GameState,
  logView: EventLogView,
): PredicateContext {
  return (name, args) => {
    switch (name) {
      case 'player_level':
        return state.actors['player']?.level ?? 0;

      case 'faction_rep':
        return state.ledgers.factionRep[str(args, 0)] ?? 0;

      case 'npc_affinity': {
        // NPC ActorId 参数（B0 短名 elder_yun → npc.elder_yun 归一）
        const raw = str(args, 0);
        const npcId = raw.startsWith('npc.') ? raw : `npc.${raw}`;
        const a = state.ledgers.npcAffinity[npcId];
        return a ? a.base + a.personal : 0;
      }

      case 'player_owns': {
        // 引用四形态：tag:xxx / loreRef:xxx / uid / 模板
        const ref = str(args, 0);
        return ownedQty(state, ref) > 0;
      }

      case 'lineage_of': {
        const uid = str(args, 0);
        const entry = findEntries(state, uid).find((e) => 'uid' in e && e.uid === uid);
        if (!entry || !('uid' in entry)) return '';
        // lineage 链串接（includes 谓词的后缀查询面：'boss.bone_maw' in chain）
        return (entry.provenance.lineage ?? []).join(' ');
      }

      case 'item_delivered': {
        // §7：item.transferred + kind=quest-delivery + to=npc（+ 可选 tag：被交物品
        // 携带该 tag——B1 语义：玩家曾拥有该 tag 实例且已移出玩家账）
        const npcArg = namedArg(args, 'npc');
        const tagArg = namedArg(args, 'tag');
        return logView
          .byKind('quest-delivery')
          .some((e) => {
            if (e.t !== 'item.transferred') return false;
            if (npcArg !== undefined && e.to !== npcArg && e.to !== `npc.${npcArg}`) return false;
            if (tagArg !== undefined) {
              // 交付前玩家必然拥有过该 tag 实例（spawn 已提交）；
              // 交付后实例移出玩家账 → ownedQty == 0 即「已交出」
              const stillOwns = ownedQty(state, `tag:${tagArg}`) > 0;
              return !stillOwns;
            }
            return true;
          });
      }

      case 'market_index': {
        const category = namedArg(args, 'category') ?? str(args, 0);
        const region = namedArg(args, 'region') ?? str(args, 1);
        const entry = state.world.market[`${category}::${region}`];
        return entry?.index ?? 10_000; // 定点 1.0 = 10_000
      }

      case 'region_controlled_by': {
        const region = str(args, 0);
        return state.world.regions[region]?.controller ?? '';
      }

      case 'region_contested': {
        const region = str(args, 0);
        return state.world.regions[region]?.contested ?? false;
      }

      case 'quest_stage':
        // B1：任务阶段机未落（M14 B2）——查已提交 quest.stage.committed 事件
        return latestCommitted(logView, str(args, 0));

      case 'arc_stage': {
        const arcId = str(args, 0);
        const arc = state.world.arcs.find((a) => a.arcId === arcId);
        return arc?.stage ?? '';
      }

      case 'scene_tag': {
        const tag = str(args, 0);
        return state.scene.tags.includes(tag);
      }

      default:
        throw new Error(`未知谓词：${name}（不在 §7 清单）`);
    }
  };
}

// ── 参数取值助手 ─────────────────────────────────────────────────

const str = (args: ArgValue[], i: number): string => {
  const a = args[i];
  if (!a || typeof a.value !== 'string') throw new Error(`谓词参数 [${i}] 必须为字符串`);
  return a.value;
};

const namedArg = (args: ArgValue[], key: string): string | undefined => {
  const a = args.find((x) => x.key === key);
  return a && typeof a.value === 'string' ? a.value : undefined;
};

/** quest.stage.committed 的最新阶段（按事件序取最后） */
function latestCommitted(logView: EventLogView, questId: string): string {
  let stage = '';
  for (const e of logView.all()) {
    if (e.t === 'quest.stage.committed' && e.questId === questId) stage = e.stage;
  }
  return stage;
}
