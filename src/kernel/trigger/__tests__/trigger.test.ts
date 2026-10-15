// M08 验收（模块设计稿 M08-trigger.md §5）：
//   1. C1 T4 联测：item.transferred{kind:quest-delivery} → 触发器评估
//      item_delivered(npc, tag) → 原语产出 quest.stage.prepared
//   2. 级联：深度推进正确；预算命中 → budgetHit + 中止
//   3. EventLogView 语义（裁决 O2）：级联中途评估只看已提交事件
//   4. 谓词上下文：player_owns / faction_rep / item_delivered / lineage_of
//   5. 冷却（B1 同批防环：同 (triggerId, 起因) 不二次触发）
// 夹具锚定：C1 T4 elder_yun + tag:bone_of_bone_maw；C5 faction_rep 门控。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ApplierRegistry } from '../../timeline/registry.js';
import { Timeline } from '../../timeline/timeline.js';
import { EVENT_TYPES } from '../../../contract/index.js';
import type { GameState } from '../../../contract/index.js';
import { parseContent, assembleRuleset } from '../../rules/index.js';
import type { Ruleset } from '../../rules/index.js';
import { buildItemSpawned, entityAppliers } from '../../entity/index.js';
import { buildItemTransfer, ledgerAppliers, seal } from '../../ledger/index.js';
import type { BuildEventDraft } from '../../ledger/index.js';
import { createRng } from '../../rng/index.js';
import { eventLogView, predicateContext, processTriggers } from '../index.js';

// ── 测试地基 ──────────────────────────────────────────────────────

function makeInitial(): GameState {
  return {
    meta: {
      turn: 42,
      revision: 0,
      seed: 42,
      ruleVersions: {},
      protoVer: 0,
      uidCounter: 316,
      intentCounter: 0,
    },
    world: { regions: {}, market: {}, delayed: [], arcs: [] },
    scene: { sceneId: 'camp', tags: ['alchemy_table'], actorsPresent: ['player', 'npc.elder_yun'] },
    actors: {
      player: { hp: 30, level: 8, gold: 60000 },
      'npc.elder_yun': { hp: 30 },
    },
    ledgers: {
      inventory: [],
      factionRep: { 'faction.grey_wolves': 18 },
      npcAffinity: {},
      activeDirectives: [],
    },
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
  // quest.stage.* / trigger.* / deferred.* / cascade.* 的 no-op（B1：quest 阶段机 M14）
  return reg;
}

function apply(tl: Timeline<GameState>, drafts: readonly BuildEventDraft[]): void {
  tl.apply(seal(drafts, { seq: tl.lastSeq + 1, turn: tl.state.meta.turn, revision: tl.revision + 1 }));
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

/** 掉落 named 骨头并提交（C1 T0 路径复用） */
function dropBone(tl: Timeline<GameState>): void {
  const r = buildItemSpawned(tl.state, {
    to: 'player',
    template: 'item.bone.large',
    qty: 1,
    rarity: 'rare',
    essence: ['poison_affinity', 'colossal'],
    named: true,
    provenance: { source: 'boss.bone_maw', roll: 'seed:a91f' },
    source: { kind: 'loot' },
  });
  if (r.ok) apply(tl, r.events);
}

// ── 验收 1：C1 T4 联测 ───────────────────────────────────────────

describe('M08 trigger — C1 T4 剧情交付联测', () => {
  it('item.transferred{quest-delivery} → item_delivered 真 → quest_effect 原语产出 quest.stage.prepared', () => {
    const ruleset = loadRuleset();
    const tl = new Timeline(makeInitial(), makeRegistry());
    dropBone(tl);

    // 玩家把骨头交给长老（C1 T4）
    const deliver = buildItemTransfer(tl.state, {
      from: 'player',
      to: 'npc.elder_yun',
      ref: 'tag:bone_of_bone_maw',
      qty: 1,
      source: { kind: 'quest-delivery' },
    });
    expect(deliver.ok).toBe(true);
    if (!deliver.ok) return;
    apply(tl, deliver.events);
    const delivered = tl.events.find((e) => e.t === 'item.transferred' && e.source.kind === 'quest-delivery');
    expect(delivered).toBeDefined();

    // 触发器级联：incoming = 已提交的交付事件
    const result = processTriggers(tl.state, ruleset, [delivered!], {
      seq: tl.lastSeq + 1,
      turn: tl.state.meta.turn,
      revision: tl.revision,
      committed: eventLogView([...tl.events]),
      rng: createRng(42, 'world'),
    });
    // 触发器 fired + 原语产出（quest.stage.prepared）
    expect(result.fired).toHaveLength(1);
    expect(result.fired[0]?.triggerId).toBe('trigger.elder_yun_bone_delivery');
    const flat = result.txs.flat();
    expect(flat.some((e) => e.t === 'trigger.fired')).toBe(true);
    const prepared = flat.find((e) => e.t === 'quest.stage.prepared');
    expect(prepared && prepared.t === 'quest.stage.prepared' ? prepared.questId : '').toBe('quest.elder_yun_favor');
  });
});

// ── 验收 4：谓词上下文 ───────────────────────────────────────────

describe('M08 trigger — 谓词上下文（§7 硬规则 3）', () => {
  it('player_owns(tag) / faction_rep / player_level / scene_tag：账本直查', () => {
    const tl = new Timeline(makeInitial(), makeRegistry());
    const ctx = predicateContext(tl.state, eventLogView([...tl.events]));
    // 直接调用谓词（谓词级断言比表达式整链路更直接）
    expect(ctx('player_level', [])).toBe(8);
    expect(ctx('faction_rep', [{ value: 'faction.grey_wolves' }])).toBe(18);
    expect(ctx('scene_tag', [{ value: 'alchemy_table' }])).toBe(true);
    expect(ctx('player_owns', [{ value: 'tag:bone_of_bone_maw' }])).toBe(false); // 未掉落

    dropBone(tl);
    const ctx2 = predicateContext(tl.state, eventLogView([...tl.events]));
    expect(ctx2('player_owns', [{ value: 'tag:bone_of_bone_maw' }])).toBe(true); // C1 T4 前提
  });

  it('item_delivered（logView 查询，裁决 O2）', () => {
    const tl = new Timeline(makeInitial(), makeRegistry());
    dropBone(tl);
    const deliver = buildItemTransfer(tl.state, {
      from: 'player', to: 'npc.elder_yun', ref: 'tag:bone_of_bone_maw', qty: 1,
      source: { kind: 'quest-delivery' },
    });
    if (deliver.ok) apply(tl, deliver.events);

    const ctx = predicateContext(tl.state, eventLogView([...tl.events]));
    // 命中：elder_yun 收到 bone tag（C1 T4 表达式语义）
    expect(ctx('item_delivered', [{ key: 'npc', value: 'npc.elder_yun' }, { key: 'tag', value: 'bone_of_bone_maw' }])).toBe(true);
    // 未命中：别的 NPC
    expect(ctx('item_delivered', [{ key: 'npc', value: 'npc.somebody_else' }])).toBe(false);
  });

  it('lineage_of：血统链查询（C1 T3 语义）', () => {
    const tl = new Timeline(makeInitial(), makeRegistry());
    dropBone(tl);
    const ctx = predicateContext(tl.state, eventLogView([...tl.events]));
    // spawn 时 lineage 未带 boss——provenance.source 为 boss.bone_maw
    // hasTag 命中 tag:bone_of_bone_maw（来源 tag），lineage_of 返回链
    const chain = ctx('lineage_of', [{ value: 'item.inst.000317' }]);
    expect(typeof chain).toBe('string');
  });
});

// ── 验收 3：EventLogView 语义（裁决 O2） ─────────────────────────

describe('M08 trigger — EventLogView（裁决 O2）', () => {
  it('级联中途评估只看已提交：在途事件不在视图', () => {
    const tl = new Timeline(makeInitial(), makeRegistry());
    dropBone(tl);
    // committed 快照 = 交付前
    const before = eventLogView([...tl.events]);
    // 谓词上下文绑定的 committed 不含在途交付事件 → item_delivered 查不到
    // （视图只读已提交；在途事件天然不可见——裁决 O2 的字面语义）
    const ctx = predicateContext(tl.state, before);
    expect(
      ctx('item_delivered', [{ key: 'npc', value: 'npc.elder_yun' }, { key: 'tag', value: 'bone_of_bone_maw' }]),
    ).toBe(false);

    // 而 inFlight 提交后（状态更新），同级联再评估为真
    const deliver = buildItemTransfer(tl.state, {
      from: 'player', to: 'npc.elder_yun', ref: 'tag:bone_of_bone_maw', qty: 1,
      source: { kind: 'quest-delivery' },
    });
    if (deliver.ok) apply(tl, deliver.events);
    const ctxAfter = predicateContext(tl.state, eventLogView([...tl.events]));
    expect(
      ctxAfter('item_delivered', [{ key: 'npc', value: 'npc.elder_yun' }, { key: 'tag', value: 'bone_of_bone_maw' }]),
    ).toBe(true);
  });

  it('byKind 过滤（source.kind 投影）', () => {
    const tl = new Timeline(makeInitial(), makeRegistry());
    dropBone(tl);
    const view = eventLogView([...tl.events]);
    expect(view.byKind('loot')).toHaveLength(1); // C1 T0 掉落
    expect(view.byKind('buy')).toHaveLength(0);
    expect(view.all()).toHaveLength(1);
  });
});

// ── 验收 5：级联与预算 ───────────────────────────────────────────

describe('M08 trigger — 级联与预算', () => {
  it('同批防环：同 (triggerId, 起因) 不二次触发（T-9）', () => {
    const ruleset = loadRuleset();
    const tl = new Timeline(makeInitial(), makeRegistry());
    dropBone(tl);
    const deliver = buildItemTransfer(tl.state, {
      from: 'player', to: 'npc.elder_yun', ref: 'tag:bone_of_bone_maw', qty: 1,
      source: { kind: 'quest-delivery' },
    });
    if (deliver.ok) apply(tl, deliver.events);
    const delivered = tl.events.filter((e) => e.t === 'item.transferred');
    // 同一事件两次入队 → 触发器只 fire 一次
    const result = processTriggers(tl.state, ruleset, [...delivered, ...delivered], {
      seq: 100, turn: 42, revision: tl.revision,
      committed: eventLogView([...tl.events]),
      rng: createRng(42, 'world'),
    });
    expect(result.fired).toHaveLength(1);
  });

  it('无命中 → 空结果', () => {
    const ruleset = loadRuleset();
    const tl = new Timeline(makeInitial(), makeRegistry());
    const result = processTriggers(tl.state, ruleset, [], {
      seq: 0, turn: 42, revision: 0,
      committed: eventLogView([]),
      rng: createRng(42, 'world'),
    });
    expect(result.txs).toHaveLength(0);
    expect(result.fired).toHaveLength(0);
    expect(result.budgetHit).toBeUndefined();
  });
});
