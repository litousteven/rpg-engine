// M05 验收（模块设计稿 M05-ledger.md §5）：
//   1. 双向原子（C3）：purse 不足侧 → 回执 economy.purse，无事件
//   2. 批量（C4）：N transfer + 1 gold 单事务；≥50 行附 ledger.batch
//   3. 两级好感（C5/C6）：rep 18→33 映射 base；membership → base 重算 personal 保留
//   4. 域校验：rep 150 拒 / gold 负余额拒 / qty 0 拒
//   5. L2 成对一致性：builder 产出的事件全部过 applier（正例）+ builder 拒的形态在
//      applier 侧同样被拒（反例）——两层校验不漂移
// 夹具锚定：C3 铁匠 purse 800、C4 200 件杂物、C5 rep 18→33、C6 队长倒戈。
import { describe, expect, it } from 'vitest';
import { ApplierRegistry } from '../../timeline/registry.js';
import { Timeline } from '../../timeline/timeline.js';
import { EVENT_TYPES } from '../../../contract/index.js';
import type { GameState } from '../../../contract/index.js';
import {
  buildGoldChange,
  buildPurseChange,
  buildRepChange,
  buildAffinityChange,
  buildMembershipChange,
  buildItemTransfer,
  buildItemDestroyed,
  buildBatchSell,
  defaultRepToBase,
  ledgerAppliers,
  seal,
} from '../index.js';
import type { BuildEventDraft } from '../index.js';
import { entityAppliers } from '../../entity/index.js';

// ── 测试地基 ──────────────────────────────────────────────────────

function makeInitial(): GameState {
  return {
    meta: {
      turn: 42,
      revision: 0,
      seed: 42,
      ruleVersions: { test: '1.0.0' },
      protoVer: 0,
      uidCounter: 0,
      intentCounter: 0,
    },
    world: { regions: {}, market: {}, delayed: [], arcs: [] },
    scene: { sceneId: 'camp', tags: [], actorsPresent: ['player'] },
    actors: {
      // C3 锚点：玩家 60000（B0 夹具延续）；铁匠 purse 800（C3 文档）
      player: { hp: 30, level: 8, gold: 60000 },
      'npc.smith': { hp: 30, purse: 800 },
      'npc.grocer': { hp: 30, purse: 2500 },
      // C6 锚点：队长倒戈
      'npc.captain_marek': { hp: 30, membership: 'faction.royal_house' },
    },
    ledgers: {
      inventory: [],
      // C5 锚点：灰狼 18 → 33
      factionRep: { 'faction.grey_wolves': 18, 'faction.prince_camp': 40 },
      npcAffinity: {},
      activeDirectives: [],
    },
  };
}

/** 全事件注册表（B1：M05 + M06 entity appliers；其余 no-op——assertComplete 需要） */
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
/** builder → seal → apply 的最短路径（各测试共用） */
function apply(tl: Timeline<GameState>, drafts: readonly BuildEventDraft[]): void {
  tl.apply(seal(drafts, { seq: tl.lastSeq + 1, turn: tl.state.meta.turn, revision: tl.revision + 1 }));
}

/** 先放一堆物品进账（走 spawn builder——builder 依赖真实数据面） */
function seedInventory(tl: Timeline<GameState>, items: BuildEventDraft[]): void {
  apply(tl, items);
}

const spawnDraft = (over: Partial<BuildEventDraft> = {}): BuildEventDraft => ({
  t: 'item.spawned',
  to: 'player',
  template: 'item.bone.large',
  qty: 1,
  rarity: 'rare',
  essence: [],
  provenance: { source: 'test', turn: 42 },
  source: { kind: 'initial' },
  ...over,
});

// ── 验收 4：域校验（L4/L3/L5 反例） ───────────────────────────────

describe('M05 ledger — 域校验（L2 builder 预检侧）', () => {
  it('rep 超 100 拒：18 + 90 = 108 越域', () => {
    const r = buildRepChange(makeInitial(), {
      faction: 'faction.grey_wolves',
      delta: 90,
      source: { kind: 'quest-delivery' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.receipt.reasons[0]?.rule).toBe('ledger.rep_domain');
      expect(r.receipt.retryable).toBe(true);
    }
  });

  it('gold 负余额拒：60000 - 70000', () => {
    const r = buildGoldChange(makeInitial(), {
      actor: 'player',
      delta: -70000,
      source: { kind: 'buy' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.receipt.reasons[0]?.rule).toBe('ledger.gold_nonnegative');
  });

  it('qty 0 拒（transfer/destroyed）', () => {
    const s = makeInitial();
    const t1 = buildItemTransfer(s, { from: 'player', to: 'npc.smith', ref: 'item.bone.large', qty: 0, source: { kind: 'sell' } });
    expect(t1.ok).toBe(false);
    const d1 = buildItemDestroyed(s, { owner: 'player', ref: 'item.bone.large', qty: 0, source: { kind: 'craft-consume' } });
    expect(d1.ok).toBe(false);
  });

  it('实例类引用 qty > 1 拒（G1 不堆叠）', () => {
    const s = makeInitial();
    seedInventoryRaw(s);
    const r = buildItemTransfer(s, {
      from: 'player',
      to: 'npc.elder_yun',
      ref: 'tag:bone_of_bone_maw',
      qty: 2,
      source: { kind: 'quest-delivery' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.receipt.reasons[0]?.rule).toBe('ledger.instance_no_split');
  });

  it('库存不足拒：qty > owned', () => {
    const s = makeInitial();
    const r = buildItemTransfer(s, { from: 'player', to: 'npc.smith', ref: 'item.bone.large', qty: 5, source: { kind: 'sell' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.receipt.reasons[0]?.rule).toBe('ledger.stock_sufficient');
  });
});

/** 直改状态塞库存（域校验测试用——不过 timeline，只构造数据面） */
function seedInventoryRaw(s: GameState): void {
  s.ledgers.inventory.push(
    // C1 具名骨头（uid 实例）
    {
      uid: 'item.inst.000317',
      template: 'item.bone.large',
      qty: 1,
      rarity: 'rare',
      basePrice: 120,
      essence: ['poison_affinity', 'colossal'],
      abilities: [],
      provenance: { source: 'boss.bone_maw', turn: 42, roll: 'seed:a91f', lineage: ['boss.bone_maw'] },
    },
    // C4 堆叠：破剑 ×80
    { template: 'item.sword.broken', qty: 80, rarity: 'common' },
    { template: 'item.hide.beast', qty: 60, rarity: 'common' },
    { template: 'item.ore.iron', qty: 40, rarity: 'common' },
    { template: 'item.junk.misc', qty: 20, rarity: 'common' },
  );
}

// ── 验收 1：双向原子（C3） ────────────────────────────────────────

describe('M05 ledger — 交易原子性（L5，C3 锚点）', () => {
  it('买锤成功路径：2 transfer + 2 gold + purse 落账（C3 数值 12000/48000/6800 → 定点）', () => {
    const tl = new Timeline(makeInitial(), makeRegistry());
    seedInventory(tl, [
      spawnDraft({ template: 'weapon.dwarf_hammer', qty: 1, rarity: 'rare' }),
    ]);
    const s = tl.state;
    // C3：玩家 60000 → 买 12000 → 48000（定点 120000000/480000000 的整数等比简化——B0 夹具延续用 48000）
    const buy = buildItemTransfer(s, { from: 'npc.smith', to: 'player', ref: 'weapon.dwarf_hammer', qty: 1, price: 12000, source: { kind: 'buy', intentId: 'int.000042' } });
    expect(buy.ok).toBe(true);
    const pay = buildGoldChange(s, { actor: 'player', delta: -12000, source: { kind: 'buy', intentId: 'int.000042' } });
    expect(pay.ok).toBe(true);
    const purse = buildPurseChange(s, { npc: 'npc.smith', balance: 800, source: { kind: 'buy', intentId: 'int.000042' } });
    expect(purse.ok).toBe(true);
    if (buy.ok && pay.ok && purse.ok) {
      apply(tl, [...buy.events, ...pay.events, ...purse.events]);
    }
    expect(tl.state.actors['player']?.gold).toBe(48000);
    expect(() => tl.verifyFold()).not.toThrow();
  });

  it('purse 不足侧：回执 economy.purse、整笔无事件（L5）', () => {
    const s = makeInitial();
    // C3 文档：铁匠 purse 800，收购骨杖 300 后 500；这里构造 purse 不足
    const r = buildPurseChange(s, { npc: 'npc.smith', balance: -1, source: { kind: 'buy' } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.receipt.reasons[0]?.rule).toBe('economy.purse');
      expect(r.receipt.reasons[0]?.expected).toBe('≥ 0');
    }
    // 预检失败 → 调用方不出事件（builder 层结构保证：Result 之外无产出）
    expect('events' in r).toBe(false);
  });
});

// ── 验收 2：批量（C4） ────────────────────────────────────────────

describe('M05 ledger — 批量形态（L6，C4 锚点）', () => {
  it('4 堆叠卖出：4 transfer + 1 gold 单事务', () => {
    const tl = new Timeline(makeInitial(), makeRegistry());
    const s = tl.state;
    seedInventoryRaw(s);
    // C4：200 件杂物（80/60/40/20）→ 4 行转移 + 1 行 gold
    const stacks = [
      { ref: 'item.sword.broken', qty: 80 },
      { ref: 'item.hide.beast', qty: 60 },
      { ref: 'item.ore.iron', qty: 40 },
      { ref: 'item.junk.misc', qty: 20 },
    ];
    const unitPrices = [3, 2, 5, 1];
    const r = buildBatchSell(s, {
      seller: 'player',
      merchant: 'npc.grocer',
      stacks,
      unitPrices,
      source: { kind: 'sell' },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.events.filter((e) => e.t === 'item.transferred')).toHaveLength(4);
    expect(r.events.filter((e) => e.t === 'gold.changed')).toHaveLength(1);
    // 总额 = 80*3 + 60*2 + 40*5 + 20*1 = 580
    const goldEv = r.events.find((e) => e.t === 'gold.changed');
    expect(goldEv && goldEv.t === 'gold.changed' ? goldEv.delta : 0).toBe(580);
    // < 50 行：不附 ledger.batch
    expect(r.events.some((e) => e.t === 'ledger.batch')).toBe(false);
    apply(tl, r.events);
    expect(() => tl.verifyFold()).not.toThrow();
  });

  it('≥ 50 行附 ledger.batch（applier no-op）——合法 50 行形状', () => {
    const s = makeInitial();
    seedInventoryRaw(s);
    // 构造 50 个合法行：同模板拆成 50 行（qty 合计 = 80 ≤ 库存）
    const many: { ref: string; qty: number }[] = Array.from({ length: 50 }, (_, i) => ({
      ref: 'item.sword.broken',
      qty: i === 0 ? 31 : 1, // 31 + 49 = 80
    }));
    const r = buildBatchSell(s, {
      seller: 'player',
      merchant: 'npc.grocer',
      stacks: many,
      unitPrices: many.map(() => 1),
      source: { kind: 'sell' },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // L6：行数 ≥ 50 → 附加 ledger.batch 审计摘要
    expect(r.events.some((e) => e.t === 'ledger.batch')).toBe(true);
    const batch = r.events.find((e) => e.t === 'ledger.batch') as { rows: unknown[] } | undefined;
    expect(batch?.rows.length).toBe(50);
    // 形状：50 transfer + 1 gold + 1 batch
    expect(r.events.filter((e) => e.t === 'item.transferred')).toHaveLength(50);
    expect(r.events.filter((e) => e.t === 'gold.changed')).toHaveLength(1);
  });
});

// ── 验收 3：两级好感（C5/C6） ─────────────────────────────────────

describe('M05 ledger — 两级好感（L7，C5/C6 锚点）', () => {
  it('C5：rep 18 + 15 = 33 落账（「信任」档）', () => {
    const tl = new Timeline(makeInitial(), makeRegistry());
    const r = buildRepChange(tl.state, {
      faction: 'faction.grey_wolves',
      delta: 15,
      source: { kind: 'quest-delivery', questId: 'quest.q42' },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ev = r.events[0] as { t: string; value?: number };
    expect(ev.value).toBe(33);
    apply(tl, r.events);
    expect(tl.state.ledgers.factionRep['faction.grey_wolves']).toBe(33);
    expect(() => tl.verifyFold()).not.toThrow();
  });

  it('C6：队长倒戈 → base 重算、personal 保留', () => {
    const tl = new Timeline(makeInitial(), makeRegistry());
    // 先建立好感：royal_house rep 0 → base 0；personal +5（赠礼）
    const gift = buildAffinityChange(tl.state, {
      npc: 'npc.captain_marek',
      delta: 5,
      value: 5,
      source: { kind: 'gift' },
    });
    expect(gift.ok).toBe(true);
    if (gift.ok) apply(tl, gift.events);
    expect(tl.state.ledgers.npcAffinity['npc.captain_marek']).toEqual({ base: 0, personal: 5 });

    // 倒戈：royal_house → prince_camp（rep 40 → base 20）
    const r = buildMembershipChange(tl.state, {
      npc: 'npc.captain_marek',
      to: 'faction.prince_camp',
      source: { kind: 'quest-delivery', questId: 'quest.rebellion' },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // O3 裁决：membership.changed + affinity.changed 同事务
    expect(r.events.map((e) => e.t)).toEqual(['membership.changed', 'affinity.changed']);
    apply(tl, r.events);
    // base = 20（rep 40 → 阶梯 30..59 → 20）；personal 5 保留
    expect(tl.state.ledgers.npcAffinity['npc.captain_marek']).toEqual({ base: 20, personal: 5 });
    expect(tl.state.actors['npc.captain_marek']?.membership).toBe('faction.prince_camp');
    expect(() => tl.verifyFold()).not.toThrow();
  });

  it('defaultRepToBase 阶梯表（P4 规则即数据的 B1 默认表）', () => {
    expect(defaultRepToBase(70)).toBe(40);
    expect(defaultRepToBase(30)).toBe(20);
    expect(defaultRepToBase(0)).toBe(0);
    expect(defaultRepToBase(-10)).toBe(-20);
    expect(defaultRepToBase(-80)).toBe(-40);
  });
});

// ── 验收 5：L2 成对一致性（builder 正反例参数化过 applier） ──────

describe('M05 ledger — L2 成对一致性', () => {
  it('builder 正例全部过 applier（gold/rep/affinity/membership/transfer）', () => {
    const tl = new Timeline(makeInitial(), makeRegistry());
    seedInventoryRaw(tl.state);
    const cases: (() => BuildEventDraft[])[] = [
      () => {
        const r = buildGoldChange(tl.state, { actor: 'player', delta: -100, source: { kind: 'buy' } });
        if (!r.ok) throw new Error('gold builder 拒');
        return r.events;
      },
      () => {
        const r = buildRepChange(tl.state, { faction: 'faction.grey_wolves', delta: 10, source: { kind: 'quest-delivery' } });
        if (!r.ok) throw new Error('rep builder 拒');
        return r.events;
      },
      () => {
        const r = buildAffinityChange(tl.state, { npc: 'npc.captain_marek', delta: 3, value: 3, source: { kind: 'gift' } });
        if (!r.ok) throw new Error('affinity builder 拒');
        return r.events;
      },
      () => {
        const r = buildMembershipChange(tl.state, { npc: 'npc.captain_marek', to: 'faction.prince_camp', source: { kind: 'quest-delivery' } });
        if (!r.ok) throw new Error('membership builder 拒');
        return r.events;
      },
      () => {
        const r = buildItemTransfer(tl.state, { from: 'player', to: 'npc.grocer', ref: 'item.sword.broken', qty: 10, source: { kind: 'sell' } });
        if (!r.ok) throw new Error('transfer builder 拒');
        return r.events;
      },
    ];
    for (const [i, getEvents] of cases.entries()) {
      const drafts = getEvents();
      expect(drafts.length).toBeGreaterThan(0);
      apply(tl, drafts);
      expect(() => tl.verifyFold(), `case ${i} 后 verifyFold`).not.toThrow();
    }
  });

  it('builder 反例（超域 delta）在 applier 侧同样被拒', () => {
    const tl = new Timeline(makeInitial(), makeRegistry());
    // builder 拒：rep +90 越域
    const pre = buildRepChange(tl.state, { faction: 'faction.grey_wolves', delta: 90, source: { kind: 'gift' } });
    expect(pre.ok).toBe(false);
    // 直接伪造同形态事件（绕过 builder）→ applier 校验 value 越域抛错回滚
    const forged: BuildEventDraft = {
      t: 'rep.changed',
      faction: 'faction.grey_wolves',
      delta: 90,
      value: 108, // 18 + 90
      source: { kind: 'gift' },
    };
    expect(() => apply(tl, [forged])).toThrow(/rep|100/);
    // 状态没动（schema 拒 value 108 > 100 或 applier 拒账面——两层任一拦截均可）
    expect(tl.state.ledgers.factionRep['faction.grey_wolves']).toBe(18);
    expect(tl.revision).toBe(0);
  });

  it('gold 账面不一致在 applier 侧被拒（value ≠ old + delta）', () => {
    const tl = new Timeline(makeInitial(), makeRegistry());
    const forged: BuildEventDraft = {
      t: 'gold.changed',
      actor: 'player',
      delta: -100,
      balance: 59999, // 60000 - 100 = 59900 ≠ 59999
      source: { kind: 'buy' },
    };
    expect(() => apply(tl, [forged])).toThrow(/gold 账面不一致/);
    expect(tl.revision).toBe(0);
  });
});
