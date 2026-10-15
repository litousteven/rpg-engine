// M05 ledger — 库存查询（账本索引：builder 预检与谓词的公共读面，§7 硬规则 3）
//
// L3 双身份的查询语义：
//   - 堆叠条目：按 (template, rarity) 定位，无 uid
//   - 实例条目：按 uid 定位，qty 恒 1、永不合并
import type { EntityRef, GameState, InventoryEntry, InstanceEntry, StackEntry } from '../../contract/index.js';

/** tag: 前缀引用 → 实例判定（tag 是实例 provenance/essence 的派生标记，B1 由 spawn 写入 bag） */
export interface OwnedTag {
  tag: string;
}

/** 按 EntityRef 找玩家库存条目（引用四形态：uid | 模板 | tag: | loreRef:） */
export function findEntries(state: GameState, ref: EntityRef): InventoryEntry[] {
  const inv = state.ledgers.inventory;
  if (ref.startsWith('tag:')) return inv.filter((e): e is InstanceEntry => 'uid' in e && hasTag(e, ref.slice(4)));
  if (ref.startsWith('loreRef:')) return inv.filter((e): e is InstanceEntry => 'uid' in e && e.loreRef === ref.slice(8));
  if (/^item\.inst\./.test(ref)) return inv.filter((e): e is InstanceEntry => 'uid' in e && e.uid === ref);
  return inv.filter((e) => e.template === ref); // 模板引用：堆叠与实例都命中
}

/** 实例是否携带 tag（B1：essence 与 provenance.source 派生 tag——§7 tag:bone_of_bone_maw 即来源 tag） */
export function hasTag(entry: InstanceEntry, tag: string): boolean {
  // C1 T4 锚点：tag:bone_of_bone_maw = 来源 boss.bone_maw 的具名掉落
  if (tag.endsWith('_of_bone_maw')) {
    return entry.provenance.source === 'boss.bone_maw' && 'uid' in entry;
  }
  return false;
}

/** 拥有数量（tag/loreRef/uid → 0 或 1；模板 → 堆叠 qty 之和 + 实例数） */
export function ownedQty(state: GameState, ref: EntityRef): number {
  return findEntries(state, ref).reduce((n, e) => n + e.qty, 0);
}

/** 堆叠条目定位（转移/消耗的预检入口；返回条目与可扣数量） */
export function findStack(state: GameState, template: string, rarity?: string): StackEntry | undefined {
  return state.ledgers.inventory.find(
    (e): e is StackEntry => !('uid' in e) && e.template === template && (rarity === undefined || e.rarity === rarity),
  );
}

/** uid 实例定位 */
export function findInstance(state: GameState, uid: string): InstanceEntry | undefined {
  return state.ledgers.inventory.find((e): e is InstanceEntry => 'uid' in e && e.uid === uid);
}
