// B0 收口验收（dev-process.md §2）：全链路集成测试。
//   M02 掷骰 → rng.rolled 事件 → M04 timeline 原子提交 → verifyFold 重放
//   → M03 表达式在重放状态上求值 ≡ live 状态。
// 状态用 contract GameState（真实 schema），applier 为账本预览夹具（M05 落地后替换）。
import { describe, expect, it } from 'vitest';
import { ApplierRegistry } from '../timeline/registry.js';
import { Timeline } from '../timeline/timeline.js';
import { createRng } from '../rng/index.js';
import { parse } from '../expr/parser.js';
import { evaluate } from '../expr/eval.js';
import type { GameState, GameEvent } from '../../contract/index.js';
import { EVENT_TYPES } from '../../contract/index.js';

// ── GameState 夹具（锚定 Case 5：灰狼声望路径） ──

function makeInitial(seed: number): GameState {
  return {
    meta: {
      turn: 1,
      revision: 0,
      seed,
      ruleVersions: { test: '1.0.0' },
      protoVer: 0,
      uidCounter: 0,
      intentCounter: 0,
    },
    world: {
      regions: {},
      market: {},
      delayed: [],
      arcs: [],
    },
    scene: { sceneId: 'camp', tags: [], actorsPresent: ['player'] },
    actors: {
      player: { hp: 30, level: 8, gold: 60000 },
      'npc.smith': { hp: 30, purse: 800 },
    },
    ledgers: {
      inventory: [],
      // C5 锚点：灰狼声望 18 → 33（「信任」档）
      factionRep: { 'faction.grey_wolves': 18 },
      npcAffinity: {},
      activeDirectives: [],
    },
  };
}

function makeAppliers(): ApplierRegistry<GameState> {
  const reg = new ApplierRegistry<GameState>();
  for (const t of EVENT_TYPES) reg.register(t, (s) => s);
  reg.register('gold.changed', (s, e) => {
    if (e.t !== 'gold.changed') return s;
    const actor = s.actors[e.actor];
    if (!actor) throw new Error(`unknown actor ${e.actor}`);
    if ((actor.gold ?? 0) + e.delta !== e.balance) throw new Error('balance 不一致');
    return { ...s, actors: { ...s.actors, [e.actor]: { ...actor, gold: e.balance } } };
  });
  reg.register('rep.changed', (s, e) => {
    if (e.t !== 'rep.changed') return s;
    if ((s.ledgers.factionRep[e.faction] ?? 0) + e.delta !== e.value) throw new Error('rep 不一致');
    return { ...s, ledgers: { ...s.ledgers, factionRep: { ...s.ledgers.factionRep, [e.faction]: e.value } } };
  });
  return reg;
}

/** 谓词上下文：只读 GameState 快照（§7 硬规则 3——账本走索引） */
function ctxFromState(state: GameState) {
  return (name: string, args: { key?: string; value: boolean | number | string }[]) => {
    switch (name) {
      case 'player_level':
        return state.actors['player']!.level ?? 0;
      case 'faction_rep':
        return state.ledgers.factionRep[String(args[0]?.value)] ?? 0;
      case 'player_gold':
        return state.actors['player']!.gold ?? 0;
      default:
        throw new Error(`收口测试未实现谓词：${name}`);
    }
  };
}

const SEED = 42;

/** 场景脚本：两笔事务（掷骰+掉落 → 声望+金钱），全部事件信封正确 */
function runScenario(): { tl: Timeline<GameState>; lootRolls: number[] } {
  const tl = new Timeline(makeInitial(SEED), makeAppliers());

  // tx1（rev 1）：M02 掷骰 → rng.rolled 事件 + 掉落入账
  const rng = createRng(SEED, 'loot');
  const rolls = rng.rollN(6, 2); // 先取数（stateBefore 记入事件）
  const lootEvents: GameEvent[] = [
    {
      seq: 0,
      turn: 1,
      revision: 1,
      t: 'rng.rolled',
      stream: 'loot',
      stateBefore: '00000000deadbeef',
      rolls,
    },
    {
      seq: 1,
      turn: 1,
      revision: 1,
      t: 'item.spawned',
      to: 'player',
      template: 'item.sword.broken',
      qty: 3,
      rarity: 'common',
      essence: [],
      provenance: { source: 'test', turn: 1 },
      source: { kind: 'loot' },
    },
  ];
  tl.apply(lootEvents);

  // tx2（rev 2）：声望 +15 → 33（C5 锚点）+ 金钱变化
  tl.apply([
    {
      seq: 2,
      turn: 1,
      revision: 2,
      t: 'rep.changed',
      faction: 'faction.grey_wolves',
      delta: 15,
      value: 33,
      source: { kind: 'quest-delivery', questId: 'quest.q42' },
    },
    {
      seq: 3,
      turn: 1,
      revision: 2,
      t: 'gold.changed',
      actor: 'player',
      delta: -12000,
      balance: 48000,
      source: { kind: 'buy', intentId: 'int.000042' },
    },
  ]);
  return { tl, lootRolls: rolls };
}

describe('B0 收口验收（dev-process §2）', () => {
  it('验收③全链路：掷骰→事件→提交→verifyFold→重放→M03 求值一致', () => {
    const { tl } = runScenario();

    // M04 真相源自检：fold(日志) ≡ 状态
    expect(() => tl.verifyFold()).not.toThrow();

    // 重放：从日志重建
    const txs: GameEvent[][] = [
      [tl.events[0]!, tl.events[1]!],
      [tl.events[2]!, tl.events[3]!],
    ];
    const replayed = Timeline.fromTxs(makeInitial(SEED), makeAppliers(), txs);
    expect(JSON.stringify(replayed.state)).toBe(JSON.stringify(tl.state));

    // M03：重放状态上求值 ≡ live 状态求值（表达式用真实命名空间键）
    const exprs = [
      'faction_rep(faction.grey_wolves) >= 30', // C5：声望门控 → true
      'player_level >= 8 and faction_rep(faction.grey_wolves) >= 30',
      'player_gold > 40000', // 收口测试辅助谓词
      'not (faction_rep(faction.grey_wolves) < 30)',
    ];
    for (const src of exprs) {
      const ast = parse(src);
      expect(evaluate(ast, ctxFromState(replayed.state))).toBe(evaluate(ast, ctxFromState(tl.state)));
    }
    expect(evaluate(parse('faction_rep(faction.grey_wolves) >= 30'), ctxFromState(tl.state))).toBe(true);
  });

  it('验收①同种子双跑：事件流（含 rng.rolled）逐字节相等', () => {
    const a = runScenario();
    const b = runScenario();
    expect(JSON.stringify([...a.tl.events])).toBe(JSON.stringify([...b.tl.events]));
    expect(JSON.stringify(a.tl.state)).toBe(JSON.stringify(b.tl.state));
    expect(a.lootRolls).toEqual(b.lootRolls); // M02 确定性
    expect(a.tl.revision).toBe(2);
  });

  it('验收④Case 夹具回归：C5 声望路径 + C3 金钱路径', () => {
    const { tl } = runScenario();
    const s = tl.state;
    // C5：rep 33（灰狼声望），两级好感数值落账
    expect(s.ledgers.factionRep['faction.grey_wolves']).toBe(33);
    // C3：玩家余额 48000（买锤后）
    expect(s.actors['player']!.gold).toBe(48000);
    // M02：掷骰事件留痕（stateBefore + rolls 入日志）
    const rolled = tl.events.find((e) => e.t === 'rng.rolled');
    expect(rolled && rolled.t === 'rng.rolled' ? rolled.rolls.length : 0).toBe(2);
    expect(() => tl.verifyFold()).not.toThrow();
  });
});
