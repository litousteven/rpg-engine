// B1 收口验收（dev-process.md §2 B1 行；M08-trigger.md §5 验收 8）：
//
//   M07 掉落表（骨头 named）→ M02 掷骰（chance 判定 + roll 事件）
//   → M06 buildItemSpawned（uid/essence/lineage/provenance 焊入）
//   → timeline.apply（M05/M06 真实 applier：实例入袋）
//   → M08 predicateContext(player_owns(tag)) 求值为真
//   → verifyFold + 重放后求值仍真
//
// 这是 B1 的主验收：四个模块在同一链路上协作，全程零 LLM、零 fs（内容加载除外）、
// 事件溯源真相源（fold ≡ snapshot）。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ApplierRegistry } from '../src/kernel/timeline/registry.js';
import { Timeline } from '../src/kernel/timeline/timeline.js';
import { EVENT_TYPES } from '../src/contract/index.js';
import type { GameState, GameEvent } from '../src/contract/index.js';
import { parseContent, assembleRuleset } from '../src/kernel/rules/index.js';
import type { Ruleset } from '../src/kernel/rules/index.js';
import { createRng } from '../src/kernel/rng/index.js';
import { buildItemSpawned, entityAppliers, describeProjection } from '../src/kernel/entity/index.js';
import { ledgerAppliers, seal } from '../src/kernel/ledger/index.js';
import type { BuildEventDraft } from '../src/kernel/ledger/index.js';
import { eventLogView, predicateContext } from '../src/kernel/trigger/index.js';

const SEED = 42;

function makeInitial(seed: number): GameState {
  return {
    meta: {
      turn: 42,
      revision: 0,
      seed,
      ruleVersions: { loot: '1.0.0', primitives: '1.0.0', recipes: '1.0.0', triggers: '1.0.0' },
      protoVer: 0,
      uidCounter: 316, // C1 锚点：000317
      intentCounter: 0,
    },
    world: { regions: {}, market: {}, delayed: [], arcs: [] },
    scene: { sceneId: 'camp', tags: [], actorsPresent: ['player'] },
    actors: { player: { hp: 30, level: 8, gold: 60000 } },
    ledgers: { inventory: [], factionRep: {}, npcAffinity: {}, activeDirectives: [] },
  };
}

function makeRegistry(): ApplierRegistry<GameState> {
  const reg = new ApplierRegistry<GameState>();
  for (const t of EVENT_TYPES) reg.register(t, (s) => s);
  const all: [string, (s: GameState, e: never) => GameState][] = [
    ...ledgerAppliers(),
    ...entityAppliers(),
  ];
  for (const [t, a] of all) reg.register(t as never, a as never);
  return reg;
}

function loadRuleset(): Ruleset {
  const files = {
    'VERSION.json': readFileSync('content/VERSION.json', 'utf8'),
    'primitives.json': readFileSync('content/primitives.json', 'utf8'),
    'loot.json': readFileSync('content/loot.json', 'utf8'),
    'recipes.json': readFileSync('content/recipes.json', 'utf8'),
    'triggers.json': readFileSync('content/triggers.json', 'utf8'),
  };
  const pack = parseContent(files);
  if (!pack.ok) throw new Error(JSON.stringify(pack.errors));
  const rs = assembleRuleset(pack.value);
  if (!rs.ok) throw new Error(JSON.stringify(rs.errors));
  return rs.value;
}

function apply(tl: Timeline<GameState>, drafts: readonly BuildEventDraft[]): void {
  tl.apply(seal(drafts, { seq: tl.lastSeq + 1, turn: tl.state.meta.turn, revision: tl.revision + 1 }));
}

/** C1 T0 全链路场景（同种子双跑逐字节一致的结构体） */
function runT0(): { tl: Timeline<GameState>; rolls: number[]; rngEvent: unknown } {
  const ruleset = loadRuleset();
  const tl = new Timeline(makeInitial(SEED), makeRegistry());

  // ① M07：掉落表数据源（boss.bone_maw → item.bone.large named chance {1,1}）
  const table = ruleset.lootTables.get('boss.bone_maw');
  if (!table) throw new Error('掉落表缺失：boss.bone_maw');
  const entry = table.loot[0]!;

  // ② M02：loot 流掷骰（chance 判定 + 掷前状态留痕）
  const rng = createRng(SEED, 'loot');
  const stateBefore = rng.stateHex();
  const hit = rng.chance(entry.chance.num, entry.chance.den);
  const rolls = [hit ? 1 : 0];
  apply(tl, [
    { t: 'rng.rolled', stream: 'loot', stateBefore, rolls },
  ]);
  const rngEvent = tl.events[0];

  // ③ M06：named 骨头 spawn（uid 预测 + essence/provenance 焊接）
  expect(hit).toBe(true); // chance {1,1} 必中（C1 T0 前提）
  const spawned = buildItemSpawned(tl.state, {
    to: 'player',
    template: entry.template,
    qty: entry.qty ?? 1,
    rarity: entry.rarity ?? 'rare',
    essence: entry.essence, // E-3：掉落表 essence 继承
    named: entry.named,
    provenance: { source: 'boss.bone_maw', roll: `loot:${stateBefore}` },
    source: { kind: 'loot' },
    basePrice: 120, // C1 账本示例
  });
  if (!spawned.ok) throw new Error(JSON.stringify(spawned.receipt));
  apply(tl, spawned.events);

  return { tl, rolls, rngEvent };
}

describe('B1 收口验收（dev-process §2：Case 1 T0 全链路）', () => {
  it('主链路：掉落表 → 掷骰 → spawn → 入袋 → player_owns(tag) 真 → verifyFold', () => {
    const { tl } = runT0();

    // ④ M05/M06 真实 applier：实例入袋（uid/essence/provenance 全落账）
    const inv = tl.state.ledgers.inventory;
    expect(inv).toHaveLength(1);
    const bone = inv[0];
    expect(bone && 'uid' in bone ? bone.uid : '').toBe('item.inst.000317');
    expect(bone && 'uid' in bone ? bone.essence : []).toEqual(['poison_affinity', 'colossal']);
    expect(bone && 'uid' in bone ? bone.provenance.source : '').toBe('boss.bone_maw');
    expect(tl.state.meta.uidCounter).toBe(317);

    // ⑤ M08：谓词上下文求值 player_owns(tag:bone_of_bone_maw) 为真
    const ctx = predicateContext(tl.state, eventLogView([...tl.events]));
    expect(ctx('player_owns', [{ value: 'tag:bone_of_bone_maw' }])).toBe(true);

    // ⑥ verifyFold：fold(全量日志) ≡ 当前状态（E1）
    expect(() => tl.verifyFold()).not.toThrow();

    // ⑦ 描述投影（C1 T1 的 B1 落点）：事实 → 文案
    const entry0 = inv[0];
    if (entry0 && 'uid' in entry0) {
      const desc = describeProjection(entry0);
      expect(desc.base).toContain('兽骨');
      expect(desc.origin).toContain('boss.bone_maw');
    }
  });

  it('重放：同种子双跑事件流逐字节相等；重放状态上求值仍真（P7）', () => {
    const a = runT0();
    const b = runT0();
    // 同种子双跑：事件流逐字节相等
    expect(JSON.stringify([...a.tl.events])).toBe(JSON.stringify([...b.tl.events]));
    expect(JSON.stringify(a.tl.state)).toBe(JSON.stringify(b.tl.state));

    // 重放：从日志重建（fold 路径）——两笔事务（掷骰 / spawn）
    const txs: GameEvent[][] = [
      [a.tl.events[0]!],
      [a.tl.events[1]!],
    ];
    const replayed = Timeline.fromTxs(makeInitial(SEED), makeRegistry(), txs);
    expect(JSON.stringify(replayed.state)).toBe(JSON.stringify(a.tl.state));

    // 重放状态上求值仍真（M03 evaluate + M08 谓词上下文）
    const ctx = predicateContext(replayed.state, eventLogView([...replayed.events]));
    expect(ctx('player_owns', [{ value: 'tag:bone_of_bone_maw' }])).toBe(true);
  });
});
