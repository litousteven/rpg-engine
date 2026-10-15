// M06 验收（模块设计稿 M06-entity.md §5）：
//   1. C1 T0 主路径：named 骨头 spawn → 实例入袋（uid/essence/lineage 全落账）
//   2. C2：护符 spawn（loreRef + passive/active/cost 三型能力槽）
//   3. 合成链（C1 T3）：骨头 → 骨刃 lineage 三段链；材料不足 → 回执
//   4. uid 严格序：伪造乱序 uid 事件 → applier 拒（E-1）
//   5. 堆叠 vs 实例：普通掉落 ×20 → 一条堆叠；named 再掉 → 新实例
// 夹具锚定：C1 boss.bone_maw → item.inst.000317（uid 继承）→ craft.weapon.bone_blade →
// item.inst.000412（lineage: boss.bone_maw, item.inst.000317, item.inst.000412）。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ApplierRegistry } from '../../timeline/registry.js';
import { Timeline } from '../../timeline/timeline.js';
import { EVENT_TYPES } from '../../../contract/index.js';
import type { GameState } from '../../../contract/index.js';
import { parseContent, assembleRuleset } from '../../rules/index.js';
import type { Ruleset } from '../../rules/index.js';
import { buildItemSpawned, buildEntityComposed, entityAppliers, describeProjection, nextUid } from '../index.js';
import { ledgerAppliers, seal } from '../../ledger/index.js';
import type { BuildEventDraft } from '../../ledger/index.js';

// ── 测试地基 ──────────────────────────────────────────────────────

function makeInitial(): GameState {
  return {
    meta: {
      turn: 42,
      revision: 0,
      seed: 42,
      ruleVersions: {},
      protoVer: 0,
      uidCounter: 316, // C1 锚点：000317 是下一枚 uid
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
  if (!pack.ok) throw new Error(`内容包解析失败：${JSON.stringify(pack.errors)}`);
  const rs = assembleRuleset(pack.value);
  if (!rs.ok) throw new Error(`规则库组装失败：${JSON.stringify(rs.errors)}`);
  return rs.value;
}

// ── 验收 1：C1 T0 主路径 ─────────────────────────────────────────

describe('M06 entity — C1 T0 掉落入袋', () => {
  it('named 骨头：uid 预测 000317、实例入袋、essence/provenance 焊死', () => {
    const tl = new Timeline(makeInitial(), makeRegistry());
    const r = buildItemSpawned(tl.state, {
      to: 'player',
      template: 'item.bone.large',
      qty: 1,
      rarity: 'rare',
      essence: ['poison_affinity', 'colossal'],
      named: true,
      provenance: { source: 'boss.bone_maw', roll: 'seed:a91f' },
      source: { kind: 'loot' },
      basePrice: 120,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ev = r.events[0] as { uid?: string };
    expect(ev.uid).toBe('item.inst.000317'); // E-1 预测：counter 316 + 1
    apply(tl, r.events);

    const entry = tl.state.ledgers.inventory[0];
    expect(entry).toBeDefined();
    if (entry && 'uid' in entry) {
      expect(entry.uid).toBe('item.inst.000317');
      expect(entry.template).toBe('item.bone.large');
      expect(entry.qty).toBe(1);
      expect(entry.rarity).toBe('rare');
      expect(entry.essence).toEqual(['poison_affinity', 'colossal']);
      expect(entry.provenance.source).toBe('boss.bone_maw');
      expect(entry.provenance.roll).toBe('seed:a91f');
      if (entry.basePrice !== undefined) expect(entry.basePrice).toBe(120);
    } else {
      expect.unreachable('named 掉落必须是实例条目');
    }
    // uidCounter 推进（E-1 applier 侧）
    expect(tl.state.meta.uidCounter).toBe(317);
    expect(() => tl.verifyFold()).not.toThrow();
  });

  it('描述投影（C1 T1）：基础文案 + 来源事实行', () => {
    const tl = new Timeline(makeInitial(), makeRegistry());
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
    expect(r.ok).toBe(true);
    if (r.ok) apply(tl, r.events);
    const entry = tl.state.ledgers.inventory[0];
    if (!entry || !('uid' in entry)) throw new Error('实例缺失');
    const desc = describeProjection(entry);
    expect(desc.base).toContain('兽骨'); // C1 T1 模板文案
    expect(desc.origin).toContain('boss.bone_maw'); // 来源行（事实渲染）
    expect(desc.origin).toContain('42'); // 第 42 回合
  });
});

// ── 验收 2：C2 护符 ─────────────────────────────────────────────

describe('M06 entity — C2 护符（loreRef + 三型能力槽）', () => {
  it('护符 spawn：loreRef/abilities 焊入实例', () => {
    const tl = new Timeline(makeInitial(), makeRegistry());
    const r = buildItemSpawned(tl.state, {
      to: 'player',
      template: 'relic.sun_amulet',
      qty: 1,
      rarity: 'epic',
      essence: ['light', 'ancient'],
      named: true,
      provenance: { source: 'location.sunken_temple', roll: 'seed:c7d2' },
      source: { kind: 'loot' },
      loreRef: 'lore.sun_cult',
      abilities: [
        { slot: 'passive', primitive: 'light_resist', rank: 2 },
        { slot: 'active', primitive: 'holy_burst', rank: 1, cooldown: 3 },
        { slot: 'cost', primitive: 'dark_penalty', rank: 1 },
      ],
      basePrice: 900,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    apply(tl, r.events);
    const entry = tl.state.ledgers.inventory[0];
    if (!entry || !('uid' in entry)) throw new Error('实例缺失');
    expect(entry.loreRef).toBe('lore.sun_cult');
    expect(entry.abilities).toHaveLength(3);
    expect(entry.abilities?.[0]?.slot).toBe('passive');
    expect(entry.abilities?.[1]?.slot).toBe('active');
    expect(entry.abilities?.[2]?.slot).toBe('cost');
    expect(() => tl.verifyFold()).not.toThrow();
  });
});

// ── 验收 3：合成链（C1 T3） ──────────────────────────────────────

describe('M06 entity — 合成（C1 T3 骨刃）', () => {
  it('骨头 → 骨刃：entity.composed + item.destroyed 同事务、lineage 三段链', () => {
    const ruleset = loadRuleset();
    const tl = new Timeline(makeInitial(), makeRegistry());
    // 先掉落 named 骨头（uid 000317）
    const drop = buildItemSpawned(tl.state, {
      to: 'player',
      template: 'item.bone.large',
      qty: 1,
      rarity: 'rare',
      essence: ['poison_affinity', 'colossal'],
      named: true,
      provenance: { source: 'boss.bone_maw', roll: 'seed:a91f', lineage: ['boss.bone_maw'] },
      source: { kind: 'loot' },
    });
    expect(drop.ok).toBe(true);
    if (drop.ok) apply(tl, drop.events);

    // 合成骨刃：材料 = uid 引用（骨头实例）
    const compose = buildEntityComposed(tl.state, ruleset, {
      recipe: 'craft.weapon.bone_blade',
      materials: [{ ref: 'item.inst.000317', qty: 1 }],
      source: { kind: 'craft-consume' },
    });
    expect(compose.ok).toBe(true);
    if (!compose.ok) return;
    // 同事务：destroyed（材料）+ composed（新实体）+ spawned（入袋）
    const kinds = compose.events.map((e) => e.t);
    expect(kinds).toContain('item.destroyed');
    expect(kinds).toContain('entity.composed');
    expect(kinds).toContain('item.spawned');
    apply(tl, compose.events);

    // 材料已耗、成品在袋
    const inv = tl.state.ledgers.inventory;
    expect(inv.find((e) => 'uid' in e && e.uid === 'item.inst.000317')).toBeUndefined();
    const blade = inv.find((e) => 'uid' in e && e.template === 'craft.weapon.bone_blade');
    expect(blade).toBeDefined();
    if (blade && 'uid' in blade) {
      // C1 T3 锚点：lineage 三段链 boss → 骨头 → 成品
      expect(blade.uid).toBe('item.inst.000318'); // counter 317 + 1
      expect(blade.provenance.lineage).toEqual(['boss.bone_maw', 'item.inst.000317', 'item.inst.000318']);
      // E-3 essence 继承
      expect(blade.essence).toEqual(['poison_affinity', 'colossal']);
    }
    expect(() => tl.verifyFold()).not.toThrow();
  });

  it('材料不足 → 回执（不产出事件）', () => {
    const ruleset = loadRuleset();
    const tl = new Timeline(makeInitial(), makeRegistry());
    const r = buildEntityComposed(tl.state, ruleset, {
      recipe: 'craft.weapon.bone_blade',
      materials: [{ ref: 'item.bone.large', qty: 1 }],
      source: { kind: 'craft-consume' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.receipt.reasons[0]?.rule).toBe('ledger.stock_sufficient');
  });

  it('配方不在规则库 → 回执', () => {
    const ruleset = loadRuleset();
    const tl = new Timeline(makeInitial(), makeRegistry());
    const r = buildEntityComposed(tl.state, ruleset, {
      recipe: 'craft.nonexistent.thing',
      materials: [{ ref: 'item.bone.large', qty: 1 }],
      source: { kind: 'craft-consume' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.receipt.reasons[0]?.rule).toBe('entity.recipe_exists');
  });
});

// ── 验收 4：uid 严格序（E-1） ─────────────────────────────────────

describe('M06 entity — uid 严格序（E-1）', () => {
  it('伪造乱序 uid 事件 → applier 拒、整笔回滚', () => {
    const tl = new Timeline(makeInitial(), makeRegistry());
    // counter=316，下一 uid 应为 000317——伪造 000999
    const forged: BuildEventDraft = {
      t: 'item.spawned',
      to: 'player',
      template: 'item.bone.large',
      qty: 1,
      rarity: 'rare',
      essence: [],
      uid: 'item.inst.000999',
      provenance: { source: 'test', turn: 42 },
      source: { kind: 'loot' },
    };
    expect(() => apply(tl, [forged])).toThrow(/uid 严格序违背/);
    expect(tl.state.meta.uidCounter).toBe(316);
    expect(tl.state.ledgers.inventory).toHaveLength(0);
    expect(tl.revision).toBe(0);
  });

  it('entity.composed 乱序 uid 同样被拒', () => {
    const tl = new Timeline(makeInitial(), makeRegistry());
    const forged: BuildEventDraft = {
      t: 'entity.composed',
      uid: 'item.inst.000998',
      recipe: 'craft.weapon.bone_blade',
      lineage: [],
      source: { kind: 'craft-consume' },
    };
    expect(() => apply(tl, [forged])).toThrow(/严格序违背/);
  });
});

// ── 验收 5：堆叠 vs 实例 ────────────────────────────────────────

describe('M06 entity — 堆叠 vs 实例（E-2）', () => {
  it('普通掉落 ×20 → 一条堆叠（L3 合并 template+rarity）', () => {
    const tl = new Timeline(makeInitial(), makeRegistry());
    const r = buildItemSpawned(tl.state, {
      to: 'player',
      template: 'item.bone.large',
      qty: 20,
      rarity: 'common',
      essence: [],
      named: false,
      provenance: { source: 'boss.bone_maw' },
      source: { kind: 'loot' },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ev = r.events[0] as { uid?: string };
    expect(ev.uid).toBeUndefined(); // 普通掉落无 uid
    apply(tl, r.events);
    expect(tl.state.ledgers.inventory).toHaveLength(1);
    expect(tl.state.ledgers.inventory[0]).toMatchObject({ template: 'item.bone.large', qty: 20, rarity: 'common' });
    // uidCounter 不动（堆叠不占实例号）
    expect(tl.state.meta.uidCounter).toBe(316);

    // 再掉 5 个同模板 → 合并到 25
    const more = buildItemSpawned(tl.state, {
      to: 'player',
      template: 'item.bone.large',
      qty: 5,
      rarity: 'common',
      essence: [],
      named: false,
      provenance: { source: 'boss.bone_maw' },
      source: { kind: 'loot' },
    });
    expect(more.ok).toBe(true);
    if (more.ok) apply(tl, more.events);
    expect(tl.state.ledgers.inventory).toHaveLength(1);
    expect(tl.state.ledgers.inventory[0]).toMatchObject({ qty: 25 });
  });

  it('named 再掉 → 新实例（不与堆叠合并）', () => {
    const tl = new Timeline(makeInitial(), makeRegistry());
    // 普通骨头 ×20
    const stack = buildItemSpawned(tl.state, {
      to: 'player', template: 'item.bone.large', qty: 20, rarity: 'common',
      essence: [], named: false, provenance: { source: 'boss.bone_maw' }, source: { kind: 'loot' },
    });
    expect(stack.ok).toBe(true);
    if (stack.ok) apply(tl, stack.events);
    // named 骨头（rare——堆叠键含 rarity 也不合并：实例条目与堆叠是两种形态）
    const named = buildItemSpawned(tl.state, {
      to: 'player', template: 'item.bone.large', qty: 1, rarity: 'rare',
      essence: ['poison_affinity', 'colossal'], named: true,
      provenance: { source: 'boss.bone_maw', roll: 'seed:a91f' }, source: { kind: 'loot' },
    });
    expect(named.ok).toBe(true);
    if (!named.ok) return;
    apply(tl, named.events);
    const inv = tl.state.ledgers.inventory;
    expect(inv).toHaveLength(2);
    expect(inv.filter((e) => 'uid' in e)).toHaveLength(1);
    expect(inv.filter((e) => !('uid' in e))).toHaveLength(1);
    expect(nextUid(tl.state)).toBe('item.inst.000318'); // counter 316→317 已推进
  });
});
