// M06 entity — appliers（模块设计稿 M06-entity.md §2，E-1/E-2 fold 侧）
//
// item.spawned：诞生即入账（O1 裁决——to 字段即归属，一个事件完成）；
//   named → 实例条目（uid/provenance/essence 焊死），applier 推进 uidCounter（E-1 严格序）
//   普通 → 堆叠合并（M05 L3：template+rarity）
// entity.composed：uid 严格序推进 + 状态不落（产出实例由同事务 item.spawned 落账）
// ability.applied / naming.sanitized：B1 审计事件（no-op fold——能力生效语义在 B2 结算）
import type { GameState, InventoryEntry, InstanceEntry, StackEntry } from '../../contract/index.js';
import type { Applier } from '../timeline/registry.js';

const inv = (s: GameState) => s.ledgers.inventory;
const setInv = (s: GameState, entries: InventoryEntry[]): GameState => ({
  ...s,
  ledgers: { ...s.ledgers, inventory: entries },
});

// ── item.spawned ──────────────────────────────────────────────────

const applierSpawned: Applier<GameState> = (s, e) => {
  if (e.t !== 'item.spawned') return s;
  if (e.to !== 'player') return s; // B1：玩家账面（NPC 侧库存 B2）

  if (e.uid !== undefined) {
    // E-1：applier 推进 uidCounter——强制 event.uid === counter+1（严格序，乱序拒）
    if (e.uid !== `item.inst.${String(s.meta.uidCounter + 1).padStart(6, '0')}`) {
      throw new Error(
        `uid 严格序违背：事件 ${e.uid} ≠ counter+1（item.inst.${String(s.meta.uidCounter + 1).padStart(6, '0')}）`,
      );
    }
    // E-2：实例条目（qty 恒 1、永不合并）
    const entry: InstanceEntry = {
      uid: e.uid,
      template: e.template,
      qty: 1,
      rarity: e.rarity,
      ...(e.loreRef !== undefined ? { loreRef: e.loreRef } : {}),
      ...(e.abilities !== undefined ? { abilities: e.abilities } : { abilities: [] }),
      essence: e.essence,
      provenance: e.provenance,
    };
    if ('basePrice' in e && typeof e.basePrice === 'number') entry.basePrice = e.basePrice;
    return {
      ...setInv(s, [...inv(s), entry]),
      meta: { ...s.meta, uidCounter: s.meta.uidCounter + 1 },
    };
  }

  // 普通掉落 → 堆叠合并（L3：template+rarity）
  const stack = inv(s).find(
    (x): x is StackEntry => !('uid' in x) && x.template === e.template && x.rarity === e.rarity,
  );
  if (stack) {
    return setInv(
      s,
      inv(s).map((x) => (x === stack ? { ...x, qty: x.qty + e.qty } : x)),
    );
  }
  const entry: StackEntry = { template: e.template, qty: e.qty, rarity: e.rarity };
  return setInv(s, [...inv(s), entry]);
};

// ── entity.composed（E-1：uid 严格序推进；实例本体由同事务 item.spawned 落账） ──

const applierComposed: Applier<GameState> = (s, e) => {
  if (e.t !== 'entity.composed') return s;
  if (e.uid !== `item.inst.${String(s.meta.uidCounter + 1).padStart(6, '0')}`) {
    throw new Error(
      `composed uid 严格序违背：${e.uid} ≠ counter+1（item.inst.${String(s.meta.uidCounter + 1).padStart(6, '0')}）`,
    );
  }
  // composed 事件本身只推进计数器（item.spawned 同事务紧随其后落实例本体——
  // 两事件共享 uid：composed 推进后 spawned 的预测 uid 已对齐？不——设计是
  // composed 推进、spawned 也校验同 uid。为避免双重推进，composed 只在
  // spawned 尚未落账的窗口推进（B1 实现取：composed 推进，spawned 校验时
  // counter 已 +1 会对不上——所以这里不推，交给 spawned）。
  return s;
};

// ── ability.applied / naming.sanitized（B1 审计；能力生效 B2） ────

const applierNoop: Applier<GameState> = (s) => s;

// ── 注册集 ───────────────────────────────────────────────────────

/** 实体域 applier 注册集（E-1 严格序的 fold 侧） */
export function entityAppliers(): [string, Applier<GameState>][] {
  return [
    ['item.spawned', applierSpawned],
    ['entity.composed', applierComposed],
    ['ability.applied', applierNoop],
    ['naming.sanitized', applierNoop],
  ];
}
