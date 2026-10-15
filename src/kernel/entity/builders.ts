// M06 entity — builders（模块设计稿 M06-entity.md §2，E-1 至 E-4）
//
// 纯函数：uid 预测（E-1：builder 只读下一 uid 写入事件，applier 严格序推进）、
// provenance/essence 焊接（E-3/E-4：继承在 spawn/compose 时刻焊死）。
//
// 夹具锚定：
//   C1 T0：boss.bone_maw → item.bone.large named（uid/provenance.roll/essence 继承）
//   C1 T3：骨头 → 骨刃（entity.composed + item.destroyed 同事务、lineage 三段链）
//   C2：护符 spawn（loreRef + 三型能力槽）
import type {
  Ability,
  ActorId,
  GameState,
  InstanceUid,
  Rarity,
  SourceRef,
  TemplateId,
} from '../../contract/index.js';
import type { Ruleset } from '../rules/index.js';
import { reject } from '../ledger/builder-kit.js';
import type { BuildEventDraft, BuildResult } from '../ledger/builder-kit.js';
import { findEntries } from '../ledger/query.js';

const DEFAULT_CLIENT_KEY = 'engine.internal';

/** 下一实例 uid（E-1 预测侧：counter+1；applier 校验 event.uid === counter+1） */
export function nextUid(state: GameState): InstanceUid {
  return `item.inst.${String(state.meta.uidCounter + 1).padStart(6, '0')}`;
}

// ── buildItemSpawned（E-2：named → 唯一实例；普通 → 堆叠） ────────

export interface SpawnCmd {
  to: ActorId;
  template: TemplateId;
  qty: number;
  rarity: Rarity;
  essence: string[];
  named: boolean;
  provenance: { source: string; roll?: string; lineage?: string[] };
  source: SourceRef;
  loreRef?: TemplateId;
  abilities?: Ability[];
  basePrice?: number;
  clientKey?: string;
}

export function buildItemSpawned(state: GameState, cmd: SpawnCmd): BuildResult {
  const clientKey = cmd.clientKey ?? DEFAULT_CLIENT_KEY;
  if (cmd.qty < 1) {
    return reject(clientKey, [
      { field: 'qty', submitted: cmd.qty, expected: '≥ 1', rule: 'entity.spawn_qty' },
    ]);
  }
  if (cmd.named && cmd.qty !== 1) {
    return reject(clientKey, [
      { field: 'qty', submitted: cmd.qty, expected: '= 1（named 升级实例，G1 不堆叠）', rule: 'entity.named_qty_one' },
    ]);
  }
  const event: BuildEventDraft = {
    t: 'item.spawned',
    to: cmd.to,
    template: cmd.template,
    qty: cmd.qty,
    rarity: cmd.rarity,
    essence: cmd.essence, // E-3：essence 快照继承——spawn 时刻焊死
    provenance: {
      source: cmd.provenance.source,
      turn: state.meta.turn,
      ...(cmd.provenance.roll !== undefined ? { roll: cmd.provenance.roll } : {}),
      ...(cmd.provenance.lineage !== undefined ? { lineage: cmd.provenance.lineage } : {}),
    },
    source: cmd.source,
  };
  if (cmd.named) {
    event.uid = nextUid(state); // E-1：预测下一 uid
  }
  if (cmd.loreRef !== undefined) event.loreRef = cmd.loreRef;
  if (cmd.abilities !== undefined) event.abilities = cmd.abilities;
  if (cmd.basePrice !== undefined) event.basePrice = cmd.basePrice;
  return ok([event]);
}

// ── buildEntityComposed（E-5 机制层：配方 + 材料在包 + essence 映射可达） ──

export interface ComposeCmd {
  recipe: TemplateId;
  materials: { ref: string; qty: number }[];
  naming?: { name: string; flavor?: string };
  source: SourceRef;
  clientKey?: string;
}

export function buildEntityComposed(state: GameState, ruleset: Ruleset, cmd: ComposeCmd): BuildResult {
  const clientKey = cmd.clientKey ?? DEFAULT_CLIENT_KEY;
  const recipe = ruleset.recipes.get(cmd.recipe);
  if (!recipe) {
    return reject(clientKey, [
      { field: 'recipe', submitted: cmd.recipe, expected: '规则库内已注册配方', rule: 'entity.recipe_exists' },
    ]);
  }
  // 材料在包：逐条核对（ref 形态支持模板/uid/tag）
  for (const [i, m] of cmd.materials.entries()) {
    const owned = findEntries(state, m.ref as never).reduce((n, e) => n + e.qty, 0);
    if (owned < m.qty) {
      return reject(clientKey, [
        { field: `materials[${i}].qty`, submitted: m.qty, expected: `≤ ${owned}（库存 ${owned}）`, rule: 'ledger.stock_sufficient' },
      ]);
    }
  }
  // 配方材料清单匹配：按模板语义对齐（材料 ref 可以是模板/uid/tag——归一到模板比对）
  const templateOf = (ref: string): string => {
    if (ref.startsWith('item.inst.')) {
      const hit = findEntries(state, ref as never).find((e) => 'uid' in e && e.uid === ref);
      return hit ? hit.template : ref;
    }
    if (ref.startsWith('tag:') || ref.startsWith('loreRef:')) {
      const hits = findEntries(state, ref as never).filter((e) => 'uid' in e);
      return hits[0]?.template ?? ref;
    }
    return ref;
  };
  for (const need of recipe.materials) {
    const got = cmd.materials.find((m) => templateOf(m.ref) === need.ref);
    if (!got || got.qty < need.qty) {
      return reject(clientKey, [
        { field: 'materials', submitted: cmd.materials.map((m) => m.ref).join(','), expected: `含 ${need.ref} × ${need.qty}`, rule: 'entity.recipe_materials' },
      ]);
    }
  }
  // essence 映射可达：材料实例的 essence ⊆ 配方 essenceMapping 键集
  const materialEssence = new Set<string>();
  for (const m of cmd.materials) {
    for (const e of findEntries(state, m.ref as never)) {
      if ('uid' in e) for (const tag of e.essence) materialEssence.add(tag);
    }
  }
  const unknown = [...materialEssence].filter((tag) => !(tag in recipe.essenceMapping));
  if (unknown.length > 0) {
    return reject(clientKey, [
      {
        field: 'materials.essence',
        submitted: unknown.join(','),
        expected: `⊆ 配方映射键集（${Object.keys(recipe.essenceMapping).join(',')}）`,
        rule: 'entity.essence_mapping_reachable',
      },
    ]);
  }

  // 产出：uid 预测 + lineage 焊接（E-4：诞生时写完整链——材料链 + 材料uid + 成品uid）
  const uid = nextUid(state);
  const lineage: string[] = [];
  for (const m of cmd.materials) {
    for (const e of findEntries(state, m.ref as never)) {
      if ('uid' in e) {
        // 材料实例：其 lineage（若有）+ 自身 uid 入链
        for (const anc of e.provenance.lineage ?? []) if (!lineage.includes(anc)) lineage.push(anc);
        if (!lineage.includes(e.uid)) lineage.push(e.uid);
      }
    }
  }
  if (!lineage.includes(uid)) lineage.push(uid); // 成品 uid 收尾（C1 T3 三段链）
  const events: BuildEventDraft[] = [
    // 材料消耗（同事务原子——O1 裁决的 compose 侧）
    ...cmd.materials.map(
      (m): BuildEventDraft => ({
        t: 'item.destroyed',
        owner: 'player',
        ref: m.ref,
        qty: m.qty,
        source: cmd.source,
      }),
    ),
    // 新实例诞生
    {
      t: 'entity.composed',
      uid,
      recipe: cmd.recipe,
      lineage,
      source: cmd.source,
    },
    // 产出入袋（spawn 语义：诞生即入账）
    {
      t: 'item.spawned',
      to: 'player',
      template: cmd.recipe,
      qty: 1,
      rarity: 'rare',
      essence: [...materialEssence], // E-3：essence 快照继承到成品
      uid,
      provenance: {
        source: `craft:${cmd.recipe}`,
        turn: state.meta.turn,
        lineage,
      },
      source: cmd.source,
    },
  ];
  return ok(events);
}

const ok = (events: BuildEventDraft[]): BuildResult => ({ ok: true, events });

