// M01 §5 验收：权威状态分片（S1–S6 可测部分）+ JSON 往返稳定。
import { describe, expect, it } from 'vitest';
import { GameStateSchema } from '../state.js';
import type { GameState, InstanceEntry } from '../state.js';

/** 完整状态样本（C1–C6 事实汇聚：掉落入包、易主、市场 pending、弧实例化） */
const state: GameState = {
  meta: {
    turn: 42,
    revision: 88,
    seed: 123456789,
    ruleVersions: { primitives: '1.0.0', pricing: '1.0.0', arcs: '1.0.0' },
    protoVer: 0,
    uidCounter: 318,
    intentCounter: 45,
  },
  world: {
    regions: {
      'region.mountain': { controller: 'faction.royal_house', contested: false },
      'region.capital': { controller: 'faction.prince_camp', contested: false },
    },
    market: {
      // 键 = `${category}::${region}`；index 定点 11875 = 1.1875（C4）
      'metal::region.mountain': { index: 11875, pendingSupply: 0, pendingDemand: 3 },
    },
    delayed: [
      { dueTurn: 62, effect: 'restock_table', args: { region: 'region.capital' }, source: 'region.control.changed' },
    ],
    arcs: [
      {
        arcId: 'arc.rebellion',
        stage: 'uprising',
        slots: { rebel_leader: 'npc.captain_marek', capital: 'region.capital' },
        branchHistory: ['spark'],
      },
    ],
  },
  scene: {
    sceneId: 'smithy_mountain_city',
    tags: ['forge', 'shelf', 'alchemy_table'],
    actorsPresent: ['player', 'npc.smith'],
  },
  actors: {
    player: { hp: 42, level: 7, gold: 4800 },
    'npc.smith': { hp: 30, purse: 6800, membership: 'faction.royal_house', profileRef: 'npc.smith' },
    'npc.captain_marek': { hp: 52, membership: 'faction.prince_camp', l2: true, drives: ['loyalty', 'greed'] },
  },
  ledgers: {
    inventory: [
      // C4：堆叠（无 uid，200 件杂物 = 少数条目）
      { template: 'item.sword.broken', qty: 80, rarity: 'common' },
      // C1：唯一实例（uid 不堆叠，essence/provenance/血统链）
      {
        uid: 'item.inst.000317',
        template: 'item.bone.large',
        qty: 1,
        rarity: 'rare',
        basePrice: 120,
        essence: ['poison_affinity', 'colossal'],
        loreRef: 'lore.bone_maw',
        abilities: [],
        provenance: { source: 'boss.bone_maw', turn: 42, roll: 'seed:a91f' },
      },
    ],
    factionRep: { 'faction.grey_wolves': 33 },
    npcAffinity: { 'npc.captain_rowan': { base: 20, personal: 18 } },
    activeDirectives: [
      { directiveId: 'dir.000001', verb: 'act_respect', target: 'npc.captain_rowan', ttlTurns: 1, strength: 'bias' },
    ],
  },
};

describe('权威状态分片（M01 §5）', () => {
  it('完整样本通过校验', () => {
    expect(GameStateSchema.parse(state)).toEqual(state);
  });

  it('JSON 往返逐字节稳定（P7 序列化确定性）', () => {
    const round = JSON.parse(JSON.stringify(state));
    expect(GameStateSchema.parse(round)).toEqual(state);
    expect(JSON.stringify(round)).toBe(JSON.stringify(state));
  });

  it('S2：堆叠条目带 uid 被拒（实例与堆叠是两种身份）', () => {
    const bad = structuredClone(state);
    (bad.ledgers.inventory[0] as InstanceEntry).uid = 'item.inst.000319';
    // 堆叠字段 + uid → instance 校验缺 essence/provenance 失败；stack 校验多 uid 失败
    expect(GameStateSchema.safeParse(bad).success).toBe(false);
  });

  it('S2：实例 qty ≠ 1 被拒（实例不堆叠）', () => {
    const bad = structuredClone(state);
    (bad.ledgers.inventory[1] as { qty: number }).qty = 2;
    expect(GameStateSchema.safeParse(bad).success).toBe(false);
  });

  it('S3：factionRep 超 [-100,100] 被拒（G13）', () => {
    const bad = structuredClone(state);
    bad.ledgers.factionRep['faction.grey_wolves'] = 101;
    expect(GameStateSchema.safeParse(bad).success).toBe(false);
  });

  it('S6：市场指数浮点被拒（定点 ×10⁴）', () => {
    const bad = structuredClone(state);
    bad.world.market['metal::region.mountain']!.index = 1.1875;
    expect(GameStateSchema.safeParse(bad).success).toBe(false);
  });

  it('S5：meta 计数器非负（ID 确定性生成）', () => {
    const bad = structuredClone(state);
    bad.meta.uidCounter = -1;
    expect(GameStateSchema.safeParse(bad).success).toBe(false);
  });

  it('seed ≤ u32（PCG32 种子域）', () => {
    const bad = structuredClone(state);
    bad.meta.seed = 0x1_0000_0000; // 2^32
    expect(GameStateSchema.safeParse(bad).success).toBe(false);
  });

  it('actor 金钱非负（§4.5 原子转移的前提）', () => {
    const bad = structuredClone(state);
    bad.actors.player!.gold = -1;
    expect(GameStateSchema.safeParse(bad).success).toBe(false);
  });

  it('C2：能力槽实例（passive/active/cost）合法', () => {
    const relic: InstanceEntry = {
      uid: 'item.inst.000318',
      template: 'relic.sun_amulet',
      qty: 1,
      rarity: 'epic',
      basePrice: 900,
      essence: ['light'],
      loreRef: 'lore.sun_cult',
      abilities: [
        { slot: 'passive', primitive: 'light_resist', rank: 2 },
        { slot: 'active', primitive: 'holy_burst', rank: 1, cooldown: 3 },
        { slot: 'cost', primitive: 'dark_penalty', rank: 1 },
      ],
      provenance: { source: 'location.sunken_temple', turn: 47, roll: 'seed:c7d2' },
    };
    const withRelic = structuredClone(state);
    withRelic.ledgers.inventory.push(relic);
    expect(GameStateSchema.safeParse(withRelic).success).toBe(true);
  });
});
