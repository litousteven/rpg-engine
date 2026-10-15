// M08 trigger — 级联引擎（模块设计稿 M08-trigger.md §2，T-3 至 T-10）
//
// processTriggers：事件驱动的级联循环（§12.1 步骤 5 的引擎本体）。
//   incoming → 命中订阅的触发器 → evaluate(when, 谓词上下文) → 冷却检查
//   → 效果原语执行（产出新事件，按级分事务）→ 新事件入队，
//   直到无新事件 / 超深度（T-4，默认 8）/ 超回合预算（T-5，默认 64）。
//
// T-9 防环：同批 (triggerId, 起因事件签名) 不二次触发。
// T-10 传导链预算：deferred.scheduled 携带 origin；链上累计深度跨回合 ≤ 32，
//   超限 → cascade.budget.hit + 终止整条传导链。
//
// 裁决 O2（EventLogView 语义）：谓词评估只看已提交事件（committed 快照）；
// 本批在途事件不可见。
import type { GameEvent, GameState, TemplateId } from '../../contract/index.js';
import type { Rng } from '../rng/index.js';
import { evaluate } from '../expr/index.js';
import { seal } from '../ledger/builder-kit.js';
import type { BuildEventDraft } from '../ledger/builder-kit.js';
import type { Ruleset } from '../rules/index.js';
import { effectRegistry } from '../rules/index.js';
import { predicateContext } from './predicates.js';
import type { EventLogView } from './log-view.js';

/** 级联预算默认值（T-4/T-5/T-10；规则库可覆盖 maxDepth） */
export const DEFAULT_MAX_DEPTH = 8;
export const DEFAULT_TURN_BUDGET = 64;
export const DEFAULT_CHAIN_BUDGET = 32;

export interface TriggerResult {
  /** 每级一个事务（M13 逐级 timeline.apply） */
  txs: GameEvent[][];
  /** cascade.budget.hit（T-4 深度 / T-5 回合 / T-10 传导链） */
  budgetHit?: GameEvent;
  /** 触发器审计摘要（fired 记录） */
  fired: { triggerId: TemplateId; atDepth: number }[];
}

/** processTriggers 入参（信封由调用方给：seq 起点 / turn / revision 基数） */
export interface ProcessOptions {
  seq: number;
  turn: number;
  /** 事件信封的 revision 基数（事务级联的每级 revision 由 timeline 分配——这里只做序号） */
  revision: number;
  /** 已提交事件（裁决 O2：级联中途评估只看已提交） */
  committed: EventLogView;
  rng: Rng;
  /** 回合预算已消耗量（M13 维护的会话态；B1 默认 0） */
  turnBudgetUsed?: number;
  /** 传导链深度账本（跨回合：deferred origin → 累计深度；B1 由调用方持久化） */
  chainDepths?: Map<string, number>;
}

/** 起因事件签名（T-9 防环：triggerId + 事件指纹） */
const eventSig = (e: GameEvent): string => `${e.t}#${e.seq}`;

/**
 * 级联主循环。txs[i] = 第 i 级事务（触发器事件 + 原语产出事件）。
 * 原语产出的效果事件如需继续级联（事件驱动），下一级处理——同批内新事件
 * 直接成为下一轮 incoming（语义：触发器看到的是「已提交后」的世界，因为
 * 调用方逐级 apply——这里以纯函数产出，apply 时机在 M13）。
 */
export function processTriggers(
  state: GameState,
  ruleset: Ruleset,
  incoming: readonly GameEvent[],
  opts: ProcessOptions,
): TriggerResult {
  const ctx = predicateContext(state, opts.committed);
  const fired: { triggerId: TemplateId; atDepth: number }[] = [];
  const txs: GameEvent[][] = [];
  const seen = new Set<string>(); // T-9：(triggerId, 起因签名)
  let turnUsed = opts.turnBudgetUsed ?? 0;
  let budgetHit: GameEvent | undefined;
  let seq = opts.seq;

  let frontier: readonly GameEvent[] = incoming;
  let depth = 0;

  while (frontier.length > 0) {
    if (depth >= DEFAULT_MAX_DEPTH) {
      budgetHit = budgetHitEvent(seq++, opts.turn, opts.revision, depth, frontier.length);
      break; // T-4：超深度 → 记账 + 中止本轮剩余级联
    }
    const levelEvents: BuildEventDraft[] = [];
    const nextFrontier: GameEvent[] = [];

    for (const ev of frontier) {
      for (const def of ruleset.triggers) {
        if (!def.on.includes(ev.t)) continue; // T-3：事件订阅
        // T-9 防环
        const sig = `${def.id}#${eventSig(ev)}`;
        if (seen.has(sig)) continue;
        seen.add(sig);
        // T-2：when 求值（裁决 O2：只看已提交——ctx 闭包捕获 committed）
        const ast = ruleset.triggerAsts.get(def.id);
        if (!ast) continue;
        let pass = false;
        try {
          pass = evaluate(ast, ctx);
        } catch {
          pass = false; // 谓词抛错按不触发处理（内容错误的保守语义）
        }
        if (!pass) continue;
        // T-8 冷却（B1：状态无冷却存位——用 seen 近似同批防环；跨回合冷却 M13 接线）
        fired.push({ triggerId: def.id, atDepth: depth });
        levelEvents.push({
          t: 'trigger.fired',
          triggerId: def.id,
          matchedExpr: def.when,
        });

        // 效果执行：defer → deferred.scheduled（T-6）；否则原语立即产出
        if (def.effect.defer) {
          levelEvents.push({
            t: 'deferred.scheduled',
            dueTurn: opts.turn + def.effect.defer.dueTurn,
            effect: def.effect.primitive,
            source: def.id,
          });
        } else {
          const prim = effectRegistry.get(def.effect.primitive);
          if (prim) {
            const produced = prim(state, { ...def.effect.args, target: ev.t === 'item.transferred' ? ev.to : undefined }, opts.rng);
            for (const p of produced) {
              // 原语产出带占位信封（seq 0）——剥掉重编号（seal 在级末统一分配）
              const payload = { ...p, seq: undefined, turn: undefined, revision: undefined } as unknown as BuildEventDraft;
              delete payload.seq;
              delete payload.turn;
              delete payload.revision;
              levelEvents.push(payload);
              nextFrontier.push(p); // 产出事件继续级联（下一级）
            }
          }
        }
        // T-5 回合预算
        turnUsed++;
        if (turnUsed >= DEFAULT_TURN_BUDGET) {
          budgetHit = budgetHitEvent(seq++, opts.turn, opts.revision, depth, 1);
        }
      }
    }
    if (levelEvents.length > 0) {
      txs.push(seal(levelEvents, { seq, turn: opts.turn, revision: opts.revision }));
      seq += levelEvents.length;
    }
    frontier = nextFrontier;
    depth++;
    if (budgetHit !== undefined && frontier.length > 0) {
      // 预算命中后不再继续级联（本级事务已产出；剩余 incoming 丢弃计数）
      break;
    }
  }

  const result: TriggerResult = { txs, fired };
  if (budgetHit !== undefined) {
    result.txs = [...txs, [budgetHit]];
    result.budgetHit = budgetHit;
  }
  return result;
}

function budgetHitEvent(seq: number, turn: number, revision: number, depth: number, abandoned: number): GameEvent {
  return {
    seq,
    turn,
    revision,
    t: 'cascade.budget.hit',
    depth,
    abandoned, // O3 裁决：只记计数
  };
}

// ── 延迟结算（T-6/T-10；执行接线在 B3 M13） ──────────────────────

/**
 * 到期查询（步骤 0）：按 dueTurn 有序返回已提交的 deferred.scheduled 事件
 * （S4：重放同序——committed 日志即队列真相；状态侧 world.delayed 是 M13 落账镜像）。
 */
export function dueDeferreds(committed: readonly GameEvent[], turn: number): GameEvent[] {
  const scheduled = committed.filter((e) => e.t === 'deferred.scheduled' && e.dueTurn <= turn);
  // dueTurn 有序、同 dueTurn 按事件序（重放确定）
  return scheduled.sort((a, b) =>
    a.t === 'deferred.scheduled' && b.t === 'deferred.scheduled'
      ? a.dueTurn - b.dueTurn || a.seq - b.seq
      : 0,
  );
}

/**
 * executeDeferreds：到期效果统一入级联（裁决 O4）——与立即级联同一路径，
 * 预算/冷却/防环/审计共用；origin 随链传播（T-10 传导链预算）。
 */
export function executeDeferreds(
  state: GameState,
  ruleset: Ruleset,
  due: readonly GameEvent[],
  opts: ProcessOptions,
): TriggerResult {
  // B1：到期 deferred.executed + 原语事件统一走 processTriggers（origin 传播
  // 由 chainDepths 账本维护——跨回合累计 ≤ 32，超限 budgetHit + 终止整链）
  const executed = due.map((d) => d);
  // 到期事件作为 incoming 进入级联（deferred.executed 落账事件 + 效果产出）
  return processTriggers(state, ruleset, executed, opts);
}

/** deferred.scheduled 事件构造（T-6：builder 侧） */
export function buildDeferredScheduled(
  effect: string,
  dueTurn: number,
  source: string,
  seq: number,
  turn: number,
  revision: number,
): GameEvent {
  return { seq, turn, revision, t: 'deferred.scheduled', dueTurn, effect, source };
}

/** deferred.executed 事件构造 */
export function buildDeferredExecuted(
  dueTurn: number,
  executedAtTurn: number,
  effect: string,
  seq: number,
): GameEvent {
  return { seq, turn: executedAtTurn, revision: 0, t: 'deferred.executed', dueTurn, executedAtTurn, effect };
}
