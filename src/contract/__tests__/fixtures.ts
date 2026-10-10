// M01 §9 验收：Case 1–7 逐 case 的契约覆盖度校验（测试夹具锚定 case 文档实例）。
// 本文件是事件合法样本的唯一来源——events.test.ts 遍历校验，roundtrip 也复用。
import type { GameEvent } from '../events.js';

const seq = (n: number) => n;

/** 34 类事件各一条合法夹具（字段值取自 Case 1–7 / M01 / M15 文档示例） */
export const VALID_EVENT_FIXTURES: Record<string, GameEvent> = {
  // C1 T0：boss 掉落具名骨头（M01 §5 唯一实例示例）
  'item.spawned': {
    seq: seq(102),
    turn: 42,
    revision: 88,
    t: 'item.spawned',
    to: 'player',
    template: 'item.bone.large',
    qty: 1,
    rarity: 'rare',
    essence: ['poison_affinity', 'colossal'],
    uid: 'item.inst.000317',
    provenance: { source: 'boss.bone_maw', turn: 42, roll: 'seed:a91f' },
    source: { kind: 'loot' },
  },
  // C3：买入矮人战锤（M15 §8 微事务路径）
  'item.transferred': {
    seq: seq(130),
    turn: 43,
    revision: 88,
    t: 'item.transferred',
    from: 'npc.smith',
    to: 'player',
    ref: 'weapon.dwarf_hammer',
    qty: 1,
    price: 12000,
    source: { kind: 'buy', intentId: 'int.000042' },
  },
  'item.destroyed': {
    seq: seq(131),
    turn: 50,
    revision: 95,
    t: 'item.destroyed',
    owner: 'player',
    ref: 'item.bone.large',
    qty: 1,
    source: { kind: 'craft-consume' },
  },
  // C3：玩家付款（balance ≥ 0）
  'gold.changed': {
    seq: seq(132),
    turn: 43,
    revision: 88,
    t: 'gold.changed',
    actor: 'player',
    delta: -12000,
    balance: 4800,
    source: { kind: 'buy', intentId: 'int.000042' },
  },
  // C5：声望 +15 → 33（上下限 [-100,100]）
  'rep.changed': {
    seq: seq(200),
    turn: 51,
    revision: 96,
    t: 'rep.changed',
    faction: 'faction.grey_wolves',
    delta: 15,
    value: 33,
    source: { kind: 'quest-delivery', questId: 'quest.q42' },
  },
  'affinity.changed': {
    seq: seq(201),
    turn: 51,
    revision: 96,
    t: 'affinity.changed',
    npc: 'npc.captain_rowan',
    delta: 5,
    value: 38,
    source: { kind: 'gift' },
  },
  // C6：队长倒戈（G16）
  'membership.changed': {
    seq: seq(210),
    turn: 60,
    revision: 105,
    t: 'membership.changed',
    npc: 'npc.captain_marek',
    from: 'faction.royal_house',
    to: 'faction.prince_camp',
    source: { kind: 'quest-delivery', questId: 'quest.rebellion' },
  },
  // C6 T2：首府易主（G15）
  'region.control.changed': {
    seq: seq(211),
    turn: 60,
    revision: 105,
    t: 'region.control.changed',
    region: 'region.capital',
    controller: 'faction.prince_camp',
    contested: false,
    source: { kind: 'quest-delivery', questId: 'quest.rebellion' },
  },
  // C4：倾销 +80 供给触发 flush（M01 §4.2 定点示例 11875 = 1.1875）
  'market.index.changed': {
    seq: seq(220),
    turn: 55,
    revision: 100,
    t: 'market.index.changed',
    category: 'metal',
    region: 'region.mountain',
    index: 11875,
    reason: 'supply+80',
  },
  // C3：铁匠 purse 扣减（拟态模型 §8.2）
  'purse.changed': {
    seq: seq(133),
    turn: 43,
    revision: 88,
    t: 'purse.changed',
    npc: 'npc.smith',
    balance: 6800,
    source: { kind: 'buy', intentId: 'int.000042' },
  },
  // C4 G12：批量卖 80 破剑的汇总审计行
  'ledger.batch': {
    seq: seq(230),
    turn: 55,
    revision: 100,
    t: 'ledger.batch',
    actor: 'player',
    rows: [
      { kind: 'remove', ref: 'item.sword.broken', qty: 80, amount: 600 },
      { kind: 'add', ref: 'gold.coin', qty: 1, amount: 600 },
    ],
    source: { kind: 'sell', intentId: 'int.000045' },
  },
  'hp.changed': {
    seq: seq(103),
    turn: 42,
    revision: 88,
    t: 'hp.changed',
    actor: 'npc.guard.12',
    delta: -14,
    cause: 'player.attack',
  },
  // C1：蚀骨巨蟒死亡
  'actor.defeated': {
    seq: seq(104),
    turn: 42,
    revision: 88,
    t: 'actor.defeated',
    actor: 'npc.bone_maw',
    cause: 'player.attack',
  },
  // C2：护符主动技能（holy_burst，冷却 3）
  'ability.used': {
    seq: seq(105),
    turn: 42,
    revision: 88,
    t: 'ability.used',
    actor: 'player',
    abilityId: 'holy_burst',
    cooldownLeft: 3,
  },
  // C1 T3：骨刃合成（lineage：boss → 骨头 → 成品）
  'entity.composed': {
    seq: seq(140),
    turn: 48,
    revision: 91,
    t: 'entity.composed',
    uid: 'item.inst.000412',
    recipe: 'craft.weapon.bone_blade',
    lineage: ['boss.bone_maw', 'item.inst.000317', 'item.inst.000412'],
    source: { kind: 'craft-consume', intentId: 'int.000060' },
  },
  // C2 G8：装备护符 → passive 生效
  'ability.applied': {
    seq: seq(106),
    turn: 47,
    revision: 89,
    t: 'ability.applied',
    target: 'player',
    slot: 'passive',
    primitive: 'light_resist',
    rank: 2,
  },
  // C1 T4：交付触发
  'trigger.fired': {
    seq: seq(141),
    turn: 49,
    revision: 90,
    t: 'trigger.fired',
    triggerId: 'trigger.bone_delivery',
    matchedExpr: 'item_delivered(npc: elder_yun, tag: bone_of_bone_maw)',
  },
  // C6 G19：级联预算触顶
  'cascade.budget.hit': {
    seq: seq(212),
    turn: 60,
    revision: 105,
    t: 'cascade.budget.hit',
    depth: 6,
    abandoned: 2,
  },
  // C6 G19：传导效果延迟两回合
  'deferred.scheduled': {
    seq: seq(213),
    turn: 60,
    revision: 105,
    t: 'deferred.scheduled',
    dueTurn: 62,
    effect: 'restock_table',
    source: 'region.control.changed',
  },
  'deferred.executed': {
    seq: seq(215),
    turn: 62,
    revision: 107,
    t: 'deferred.executed',
    dueTurn: 62,
    executedAtTurn: 62,
    effect: 'restock_table',
  },
  // C5/C1 T4：任务两阶段
  'quest.stage.prepared': {
    seq: seq(142),
    turn: 44,
    revision: 88,
    t: 'quest.stage.prepared',
    questId: 'quest.q42',
    stage: 'deliver_bone',
  },
  'quest.stage.committed': {
    seq: seq(143),
    turn: 49,
    revision: 90,
    t: 'quest.stage.committed',
    questId: 'quest.q42',
    stage: 'deliver_bone',
  },
  // C6：叛乱弧实例化（slots 绑定）
  'arc.selected': {
    seq: seq(216),
    turn: 30,
    revision: 70,
    t: 'arc.selected',
    arcId: 'arc.rebellion',
    slots: {
      rebel_leader: 'npc.captain_marek',
      capital: 'region.capital',
      rebels: 'faction.prince_camp',
    },
  },
  'arc.stage.advanced': {
    seq: seq(217),
    turn: 60,
    revision: 105,
    t: 'arc.stage.advanced',
    arcId: 'arc.rebellion',
    stage: 'uprising',
  },
  'arc.branch.taken': {
    seq: seq(218),
    turn: 58,
    revision: 103,
    t: 'arc.branch.taken',
    arcId: 'arc.rebellion',
    from: 'spark',
    to: 'uprising',
  },
  'arc.aborted': {
    seq: seq(219),
    turn: 70,
    revision: 112,
    t: 'arc.aborted',
    arcId: 'arc.rebellion',
  },
  // C5：声望跨阈值 → Director 演出拍
  'directive.issued': {
    seq: seq(144),
    turn: 49,
    revision: 90,
    t: 'directive.issued',
    directiveId: 'dir.000001',
    verb: 'act_respect',
    target: 'npc.captain_rowan',
    ttlTurns: 2,
    strength: 'bias',
    reason: '声望跨过里程碑 30',
    provenance: 'director',
  },
  'directive.expired': {
    seq: seq(145),
    turn: 52,
    revision: 93,
    t: 'directive.expired',
    directiveId: 'dir.000001',
  },
  // §6：命名消毒审计
  'naming.sanitized': {
    seq: seq(146),
    turn: 48,
    revision: 91,
    t: 'naming.sanitized',
    target: 'item.inst.000412',
    maxLength: 64,
    truncated: false,
  },
  // 元 + 随机 + 菜单（I1 校验锚点：完整三态入日志）
  'turn.began': { seq: seq(100), turn: 42, revision: 87, t: 'turn.began', mode: 'combat' },
  'turn.settled': {
    seq: seq(118),
    turn: 42,
    revision: 88,
    t: 'turn.settled',
    intentCount: 3,
    maxCascadeDepth: 2,
  },
  // M15 §5：快速失败回执（提交值 vs 规则要求）
  'intent.rejected': {
    seq: seq(119),
    turn: 43,
    revision: 88,
    t: 'intent.rejected',
    intentId: 'int.000043',
    receipt: {
      clientKey: 'c-8f3a',
      retryable: true,
      reasons: [
        {
          field: 'params.price',
          submitted: 50000,
          expected: '≤ 14400',
          rule: 'economy.negotiation_band',
        },
      ],
    },
  },
  // C3：商业态菜单（visible + locked+hint，§4.4 三态直出）
  'menu.presented': {
    seq: seq(120),
    turn: 43,
    revision: 88,
    t: 'menu.presented',
    mode: 'commercial',
    menu: {
      mode: 'commercial',
      items: [
        {
          id: 'buy.weapon.dwarf_hammer',
          verb: 'buy',
          label: '买入：矮人战锤',
          state: 'visible',
          origin: 'base',
          paramsSchemaRef: 'buy.v1',
          context: { price: 12000 },
        },
        {
          id: 'hire.elite',
          verb: 'hire',
          label: '雇佣精锐',
          state: 'locked',
          hint: '需要 声望 ≥ 60',
          origin: 'base',
        },
      ],
    },
  },
  // §14-1：掷骰入日志（C1 掉落判定）
  'rng.rolled': {
    seq: seq(101),
    turn: 42,
    revision: 88,
    t: 'rng.rolled',
    stream: 'loot',
    stateBefore: '853f2a41c7d2e09b',
    rolls: [7],
  },
};
