// M05 ledger — appliers（模块设计稿 M05-ledger.md §2，L1–L7 的 fold 侧）
//
// 注册进 ApplierRegistry 的账本域 fold 实现（含校验，抛错即整笔回滚）。
// 校验双层中的兜底侧（L2 测试保证与 builder 预检一致）。
import type { GameState, InventoryEntry } from '../../contract/index.js';
import type { Applier } from '../timeline/registry.js';
import { hasTag } from './query.js';
import { defaultRepToBase } from './builders.js';

const inv = (s: GameState) => s.ledgers.inventory;
const setInv = (s: GameState, entries: InventoryEntry[]): GameState => ({
  ...s,
  ledgers: { ...s.ledgers, inventory: entries },
});

// ── item.transferred（L3：堆叠合并 template+rarity、实例 uid 移动） ──

const applierTransfer: Applier<GameState> = (s, e) => {
  if (e.t !== 'item.transferred') return s;
  // B1：账面只有玩家侧 inventory（to=player 入账 / from=player 出账）
  if (e.to === 'player') return setInv(s, addToInventory(inv(s), e.ref, e.qty));
  if (e.from === 'player') return setInv(s, removeFromInventory(inv(s), e.ref, e.qty));
  return s; // 双 NPC 之间的转移 B1 不入玩家账（B2 商人库存表）
};

/** 入账（堆叠合并：同 template+rarity 合 qty；实例引用按 uid/tag/loreRef 落实例条目） */
function addToInventory(entries: InventoryEntry[], ref: string, qty: number): InventoryEntry[] {
  if (/^item\.inst\./.test(ref)) {
    // uid 引用：从 from 侧来的实例原样入账（字段由 spawn/compose 时焊死）
    const existing = entries.find((x): x is InventoryEntry & { uid: string } => 'uid' in x && x.uid === ref);
    if (existing) throw new Error(`实例重复入账：${ref}`);
    // 实例字段未知（transfer 不携带）——B1 转移路径只支持堆叠与 tag/loreRef；
    // uid 实例的转移在 M06 spawn 路径内完成（诞生即入账）
    throw new Error(`uid 实例转移需经 spawn 路径重建字段（B1 限制）：${ref}`);
  }
  if (ref.startsWith('tag:')) {
    const tagged = entries.find((x) => 'uid' in x && hasTag(x, ref.slice(4)));
    if (!tagged) throw new Error(`tag 引用无实例可转移：${ref}`);
    return entries; // tag→player 已拥有：本条目已在账（转移即移动到 player——已在，幂等）
  }
  if (ref.startsWith('loreRef:')) {
    const hit = entries.find((x): x is InventoryEntry & { loreRef: string } => 'uid' in x && x.loreRef === ref.slice(8));
    if (!hit) throw new Error(`loreRef 引用无实例可转移：${ref}`);
    return entries;
  }
  // 模板引用：堆叠合并（template+rarity 未携带时取首个堆叠的 rarity——B1 转移堆叠默认 common）
  const stack = entries.find((x): x is InventoryEntry & { rarity: string } => !('uid' in x) && x.template === ref);
  if (stack && !('uid' in stack)) {
    return entries.map((x) => (x === stack ? { ...x, qty: x.qty + qty } : x));
  }
  return [...entries, { template: ref, qty, rarity: 'common' }];
}

/** 出账（扣减堆叠 qty / 移除实例；不足抛错回滚） */
function removeFromInventory(entries: InventoryEntry[], ref: string, qty: number): InventoryEntry[] {
  if (ref.startsWith('tag:') || ref.startsWith('loreRef:') || /^item\.inst\./.test(ref)) {
    const idx = entries.findIndex(
      (x) =>
        ('uid' in x && ((ref.startsWith('tag:') && hasTag(x, ref.slice(4))) ||
          (ref.startsWith('loreRef:') && x.loreRef === ref.slice(8)) ||
          (ref.startsWith('item.inst.') && x.uid === ref))),
    );
    if (idx === -1) throw new Error(`实例不在账：${ref}`);
    if (qty !== 1) throw new Error(`实例转移 qty 必须为 1（G1 不堆叠）：${ref}`);
    return entries.filter((_, i) => i !== idx);
  }
  const stack = entries.find((x): x is InventoryEntry & { qty: number; template: string } => !('uid' in x) && x.template === ref);
  if (!stack || stack.qty < qty) throw new Error(`库存不足：${ref} 需 ${qty}`);
  // 扣减；qty 归零的堆叠条目剔除（账面不留死条目）
  return entries
    .map((x) => (x === stack ? { ...x, qty: x.qty - qty } : x))
    .filter((x) => 'uid' in x || x.qty > 0);
}

// ── item.destroyed ────────────────────────────────────────────────

const applierDestroyed: Applier<GameState> = (s, e) => {
  if (e.t !== 'item.destroyed') return s;
  if (e.owner !== 'player') return s;
  return setInv(s, removeFromInventory(inv(s), e.ref, e.qty));
};

// ── gold.changed（L5：balance = old + delta 校验） ────────────────

const applierGold: Applier<GameState> = (s, e) => {
  if (e.t !== 'gold.changed') return s;
  const actor = s.actors[e.actor];
  if (!actor) throw new Error(`未知 Actor：${e.actor}`);
  const old = actor.gold ?? 0;
  if (old + e.delta !== e.balance) {
    throw new Error(`gold 账面不一致：${old} + ${e.delta} ≠ ${e.balance}`);
  }
  return { ...s, actors: { ...s.actors, [e.actor]: { ...actor, gold: e.balance } } };
};

// ── purse.changed（直接落账；balance ≥ 0 由 schema） ──────────────

const applierPurse: Applier<GameState> = (s, e) => {
  if (e.t !== 'purse.changed') return s;
  const npc = s.actors[e.npc];
  if (!npc) throw new Error(`未知 Actor：${e.npc}`);
  return { ...s, actors: { ...s.actors, [e.npc]: { ...npc, purse: e.balance } } };
};

// ── rep.changed（L4：value = old + delta 且域内） ─────────────────

const applierRep: Applier<GameState> = (s, e) => {
  if (e.t !== 'rep.changed') return s;
  const old = s.ledgers.factionRep[e.faction] ?? 0;
  if (old + e.delta !== e.value) throw new Error(`rep 账面不一致：${old} + ${e.delta} ≠ ${e.value}`);
  return { ...s, ledgers: { ...s.ledgers, factionRep: { ...s.ledgers.factionRep, [e.faction]: e.value } } };
};

// ── affinity.changed（L7 两级模型的 fold 侧） ─────────────────────
//
// 两种合法形态（调用方给出分解，M05 §4）：
//   1. 重算审计：membership.changed 的 applier 已内联重算 base——同事务紧随的
//      affinity.changed 只做审计（value == 当前 total → no-op）
//   2. 个体变化：total + delta == value → delta 记 personal（独立累计）

const applierAffinity: Applier<GameState> = (s, e) => {
  if (e.t !== 'affinity.changed') return s;
  const cur = s.ledgers.npcAffinity[e.npc] ?? { base: 0, personal: 0 };
  const total = cur.base + cur.personal;
  if (e.value === total) {
    // 重算审计：membership applier 已完成 base 重算（内联，L7）
    return s;
  }
  if (total + e.delta !== e.value) {
    throw new Error(`affinity 账面不一致：${total} + ${e.delta} ≠ ${e.value}`);
  }
  return {
    ...s,
    ledgers: {
      ...s.ledgers,
      npcAffinity: { ...s.ledgers.npcAffinity, [e.npc]: { base: cur.base, personal: cur.personal + e.delta } },
    },
  };
};

// ── membership.changed（L7：membership 落账 + 内联 affinity base 重算） ──
//
// base = f(新势力声望)（阶梯表，P4 规则即数据——B1 默认表）；personal 保留。

const applierMembership: Applier<GameState> = (s, e) => {
  if (e.t !== 'membership.changed') return s;
  const npc = s.actors[e.npc];
  if (!npc) throw new Error(`未知 Actor：${e.npc}`);
  const rep = s.ledgers.factionRep[e.to] ?? 0;
  const cur = s.ledgers.npcAffinity[e.npc] ?? { base: 0, personal: 0 };
  const base = defaultRepToBase(rep);
  return {
    ...s,
    actors: { ...s.actors, [e.npc]: { ...npc, membership: e.to } },
    ledgers: {
      ...s.ledgers,
      npcAffinity: { ...s.ledgers.npcAffinity, [e.npc]: { base, personal: cur.personal } },
    },
  };
};

// ── market.index.changed / region.control.changed（B2 builder；B1 applier 落账） ──

const applierMarket: Applier<GameState> = (s, e) => {
  if (e.t !== 'market.index.changed') return s;
  const key = `${e.category}::${e.region}`;
  const cur = s.world.market[key] ?? { index: 10_000, pendingSupply: 0, pendingDemand: 0 };
  return {
    ...s,
    world: { ...s.world, market: { ...s.world.market, [key]: { ...cur, index: e.index } } },
  };
};

const applierRegion: Applier<GameState> = (s, e) => {
  if (e.t !== 'region.control.changed') return s;
  return {
    ...s,
    world: { ...s.world, regions: { ...s.world.regions, [e.region]: { controller: e.controller, contested: e.contested } } },
  };
};

// ── ledger.batch（L6：no-op 审计摘要） ────────────────────────────

const applierBatch: Applier<GameState> = (s) => s;

// ── 注册集 ───────────────────────────────────────────────────────

/** 账本域 applier 注册集（assertRegistry 组装用；L1 唯一写路径） */
export function ledgerAppliers(): [string, Applier<GameState>][] {
  return [
    ['item.transferred', applierTransfer],
    ['item.destroyed', applierDestroyed],
    ['gold.changed', applierGold],
    ['purse.changed', applierPurse],
    ['rep.changed', applierRep],
    ['affinity.changed', applierAffinity],
    ['membership.changed', applierMembership],
    ['market.index.changed', applierMarket],
    ['region.control.changed', applierRegion],
    ['ledger.batch', applierBatch],
  ];
}
