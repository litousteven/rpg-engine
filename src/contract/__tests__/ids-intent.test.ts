// M01 §2/§3 验收：ID 体系正反例 + intent schema（I1–I4 相关可测部分）。
import { describe, expect, it } from 'vitest';
import {
  ActorIdSchema,
  EntityRefSchema,
  InstanceUidSchema,
  IntentIdSchema,
  SlugSchema,
  TagRefSchema,
  TemplateIdSchema,
} from '../ids.js';
import { IntentInputSchema, IntentSchema } from '../intent.js';

describe('ID 体系（M01 §2）', () => {
  it('Slug：小写字母开头', () => {
    expect(SlugSchema.safeParse('buy').success).toBe(true);
    expect(SlugSchema.safeParse('search_altar').success).toBe(true);
    expect(SlugSchema.safeParse('Buy').success).toBe(false);
    expect(SlugSchema.safeParse('1abc').success).toBe(false);
    expect(SlugSchema.safeParse('').success).toBe(false);
  });

  it('TemplateId：至少两段（item.bone.large / npc.guard / quest.q42）', () => {
    expect(TemplateIdSchema.safeParse('item.bone.large').success).toBe(true);
    expect(TemplateIdSchema.safeParse('npc.guard').success).toBe(true);
    expect(TemplateIdSchema.safeParse('quest.q42').success).toBe(true);
    expect(TemplateIdSchema.safeParse('lore.sun_cult').success).toBe(true);
    expect(TemplateIdSchema.safeParse('craft.weapon.bone_blade').success).toBe(true);
    expect(TemplateIdSchema.safeParse('player').success).toBe(false); // 单段
    expect(TemplateIdSchema.safeParse('item..bone').success).toBe(false);
    expect(TemplateIdSchema.safeParse('Item.Bone').success).toBe(false);
  });

  it('ActorId：player / npc.<slug> / 实例化 npc.guard.12', () => {
    expect(ActorIdSchema.safeParse('player').success).toBe(true);
    expect(ActorIdSchema.safeParse('npc.elder_yun').success).toBe(true);
    expect(ActorIdSchema.safeParse('npc.guard.12').success).toBe(true); // 模板实例（战斗实例化 NPC）
    expect(ActorIdSchema.safeParse('guard.12').success).toBe(false);
    expect(ActorIdSchema.safeParse('player.2').success).toBe(false); // player 无后缀
  });

  it('InstanceUid / IntentId：六位计数', () => {
    expect(InstanceUidSchema.safeParse('item.inst.000318').success).toBe(true);
    expect(InstanceUidSchema.safeParse('item.inst.318').success).toBe(false);
    expect(InstanceUidSchema.safeParse('item.inst.abc123').success).toBe(false);
    expect(IntentIdSchema.safeParse('int.000042').success).toBe(true);
    expect(IntentIdSchema.safeParse('intent.42').success).toBe(false);
  });

  it('EntityRef：uid / 模板 / tag: / loreRef: 四形态', () => {
    expect(EntityRefSchema.safeParse('item.inst.000318').success).toBe(true);
    expect(EntityRefSchema.safeParse('weapon.dwarf_hammer').success).toBe(true);
    expect(TagRefSchema.safeParse('tag:bone_of_bone_maw').success).toBe(true);
    expect(EntityRefSchema.safeParse('tag:bone_of_bone_maw').success).toBe(true);
    expect(EntityRefSchema.safeParse('loreRef:lore.sun_cult').success).toBe(true);
    expect(EntityRefSchema.safeParse('tag:').success).toBe(false);
    expect(EntityRefSchema.safeParse('looseref:lore.sun_cult').success).toBe(false);
  });
});

describe('Intent（M01 §3，I1–I4）', () => {
  /** C3：买入矮人战锤（M15 §8） */
  const buyIntent = {
    clientKey: 'c-8f3a',
    actor: 'player',
    verb: 'buy',
    targets: ['npc.smith', 'weapon.dwarf_hammer'],
    params: { qty: 1, price: 12000 },
    menuItemId: 'buy.weapon.dwarf_hammer',
    basedOnRevision: 87,
  };

  it('合法 IntentInput（C3 夹具）', () => {
    expect(IntentInputSchema.parse(buyIntent)).toEqual(buyIntent);
  });

  it('clientKey 必填（I3：幂等键，决策 O2）', () => {
    const { clientKey: _drop, ...bad } = buyIntent;
    void _drop;
    expect(IntentInputSchema.safeParse(bad).success).toBe(false);
  });

  it('actor 必须是合法 ActorId（player/npc.*，不能是裸模板）', () => {
    expect(IntentInputSchema.safeParse({ ...buyIntent, actor: 'guard.12' }).success).toBe(false);
  });

  it('未知字段被拒（strict）', () => {
    expect(IntentInputSchema.safeParse({ ...buyIntent, provenance: 'player' }).success).toBe(false);
  });

  it('basedOnRevision 非负整数（§12.2 stale 门控）', () => {
    expect(IntentInputSchema.safeParse({ ...buyIntent, basedOnRevision: -1 }).success).toBe(false);
    expect(IntentInputSchema.safeParse({ ...buyIntent, basedOnRevision: 1.5 }).success).toBe(false);
  });

  it('Intent 完整形态：intentId/provenance/turn 由引擎侧补全（I2：来源不在客户端提交内）', () => {
    const full = IntentSchema.parse({
      ...buyIntent,
      intentId: 'int.000042',
      provenance: 'player',
      turn: 43,
    });
    expect(full.intentId).toBe('int.000042');
    expect(full.provenance).toBe('player');
    // provenance 闭集：伪造来源被拒
    expect(IntentSchema.safeParse({ ...buyIntent, intentId: 'int.000042', provenance: 'cheat', turn: 43 }).success).toBe(false);
  });
});
