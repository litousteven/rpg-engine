// M06 entity — 描述投影（模块设计稿 M06-entity.md §2，§5.4 裁决 O2）
//
// P2 镜像：事实 → 文案，永不反向。四段：基础模板文案 / provenance 事实行 /
// loreRef 背景摘要 / 风味缓存（可选）。纯函数。
import type { InstanceEntry, TemplateId } from '../../contract/index.js';

export interface LoreEntry {
  id: TemplateId;
  /** 背景摘要（§5.4 [背景] 段；lore 条目内容期产出） */
  summary: string;
}

export interface Description {
  /** [基础] 模板文案（C1 T1：一根粗大的兽骨，断面密布蜂窝状孔洞） */
  base: string;
  /** [来源] provenance 事实行（C1 T1：取自「蚀骨巨蟒」· 第 42 回合 · 具名掉落） */
  origin?: string;
  /** [背景] loreRef 检索摘要（C2：遗迹背景） */
  lore?: string;
  /** [风味] 缓存文案（可选——Narrator/ContentGen 润色） */
  flavor?: string;
}

/** 模板文案库（B1 内联表；M1/M18 模板库是消费者——本表是 C1/C2 夹具的投影数据源） */
const TEMPLATE_BASE: Partial<Record<TemplateId, string>> = {
  'item.bone.large': '一根粗大的兽骨，断面密布蜂窝状孔洞。',
  'relic.sun_amulet': '一枚太阳纹护符，边缘残留镀金痕迹。',
  'craft.weapon.bone_blade': '以巨兽骨骼打磨的骨刃，刃口泛着暗色光泽。',
};

/**
 * 描述投影：结构化事实渲染为文案（渲染层只读事实，来源不可能说谎——
 * provenance 由引擎写入，渲染只消费）。
 */
export function describeProjection(
  entity: InstanceEntry,
  lore?: LoreEntry,
  flavor?: string,
): Description {
  const desc: Description = {
    base: TEMPLATE_BASE[entity.template] ?? `（模板文案缺失：${entity.template}）`,
  };
  // [来源] 事实行：source · 第 N 回合 ·（roll 则带掷骰引用）
  const parts = [entity.provenance.source, `第 ${entity.provenance.turn} 回合`];
  if (entity.provenance.roll !== undefined) parts.push('具名掉落');
  desc.origin = `取自「${parts[0]}」· ${parts.slice(1).join(' · ')}`;
  if (lore !== undefined) desc.lore = lore.summary;
  if (flavor !== undefined) desc.flavor = flavor;
  return desc;
}
