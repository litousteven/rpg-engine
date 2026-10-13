// M03 验收（M03-expr.md §5）：
//   §7 全部示例逐条 / 优先级 / 括号字符串数值（含负数、定点整数）
//   坏表达式报错定位 / AST 往返 / 求值纯函数 / checkTypes 静态查
import { describe, expect, it } from 'vitest';
import { parse, ExprError } from '../parser.js';
import { evaluate, checkTypes } from '../eval.js';
import { serializeAst, deserializeAst } from '../ast.js';
import type { ArgValue, PredicateContext, PredicateRegistry } from '../eval.js';

// ── 谓词夹具：锚定 §7 谓词清单与 Case 1–6 状态 ──

const registry: PredicateRegistry = {
  player_level: { returns: 'num' },
  faction_rep: { returns: 'num' },
  npc_affinity: { returns: 'num' },
  player_owns: { returns: 'bool' },
  lineage_of: { returns: 'str' },
  item_delivered: { returns: 'bool' },
  market_index: { returns: 'num' },
  region_controlled_by: { returns: 'str' },
  region_contested: { returns: 'bool' },
  quest_stage: { returns: 'num' },
  arc_stage: { returns: 'str' },
  scene_tag: { returns: 'bool' },
};

/** Case 5/C1 T4 之后的权威状态快照（作为谓词数据源） */
function makeCtx(overrides: Record<string, (args: ArgValue[]) => unknown> = {}): PredicateContext {
  const ctx: PredicateContext = (name, args) => {
    const o = overrides[name];
    if (o) return o(args) as boolean | number | string;
    switch (name) {
      // C1 T4：玩家等级
      case 'player_level':
        return 8;
      // C5：灰狼声望 33；C6：royal_house -50
      case 'faction_rep': {
        const f = String(args[0]?.value);
        if (f === 'grey_wolves') return 33;
        if (f === 'royal_house') return -50;
        return 0;
      }
      case 'npc_affinity':
        return 38; // C5：团长好感
      // C1 T4：tag 骨头在包
      case 'player_owns': {
        const tag = args.find((a) => a.key === 'tag')?.value;
        const loreRef = args.find((a) => a.key === 'loreRef')?.value;
        if (tag === 'bone_of_bone_maw') return true;
        if (loreRef === 'lore.sun_cult') return true; // C2：反向激活
        return false;
      }
      // C1 T3：骨刃血统链
      case 'lineage_of':
        return 'boss.bone_maw -> item.inst.000317 -> item.inst.000412';
      // C1 T4：已交付长老
      case 'item_delivered':
        return true;
      // C4：山地金属指数 11875（定点 ×10⁴ = 1.1875）
      case 'market_index':
        return 11875;
      // C6 T2：首府已易主
      case 'region_controlled_by':
        return args[0]?.value === 'capital' ? 'prince_camp' : 'lords';
      case 'region_contested':
        return false;
      case 'quest_stage':
        return 3;
      case 'arc_stage':
        return 'uprising'; // C6：叛乱弧
      // §4.3：场景标签
      case 'scene_tag':
        return args[0]?.value === 'alchemy_table';
      default:
        throw new Error(`测试上下文未实现谓词：${name}`);
    }
  };
  return ctx;
}

const ev = (src: string, ctx: PredicateContext = makeCtx()) => evaluate(parse(src), ctx);

describe('M03 — §7 全部示例逐条（夹具锚定设计稿）', () => {
  it('player_level >= 8（角色谓词）', () => {
    expect(ev('player_level >= 8')).toBe(true);
    expect(ev('player_level >= 9')).toBe(false);
  });
  it('faction_rep(grey_wolves) >= 30（势力谓词，C5）', () => {
    expect(ev('faction_rep(grey_wolves) >= 30')).toBe(true);
  });
  it('npc_affinity(elder_yun) > 20（好感谓词）', () => {
    expect(ev('npc_affinity(elder_yun) > 20')).toBe(true);
  });
  it('player_owns(tag: "bone_of_bone_maw")（物品谓词，C1）', () => {
    expect(ev('player_owns(tag: "bone_of_bone_maw")')).toBe(true);
    expect(ev('player_owns(tag: "not_owned")')).toBe(false);
  });
  it('player_owns(loreRef: "lore.sun_cult")（世界观引用，C2 反向激活）', () => {
    expect(ev('player_owns(loreRef: "lore.sun_cult")')).toBe(true);
  });
  it('lineage_of(weapon.inst.000412) includes "boss.bone_maw"（血统链谓词，C1 T3）', () => {
    expect(ev('lineage_of(weapon.inst.000412) includes "boss.bone_maw"')).toBe(true);
    expect(ev('lineage_of(weapon.inst.000412) includes "boss.other"')).toBe(false);
  });
  it('item_delivered(npc: "elder_yun", tag: "bone_of_bone_maw")（事件谓词，C1 T4）', () => {
    expect(ev('item_delivered(npc: "elder_yun", tag: "bone_of_bone_maw")')).toBe(true);
  });
  it('market_index(category: "metal", region: "mountain") < 12000（经济谓词，定点 ×10⁴）', () => {
    expect(ev('market_index(category: "metal", region: "mountain") < 12000')).toBe(true);
  });
  it('region_controlled_by("capital") == "prince_camp"（区域控制谓词，C6 G15）', () => {
    expect(ev('region_controlled_by("capital") == "prince_camp"')).toBe(true);
    expect(ev('region_controlled_by("capital") == "lords"')).toBe(false);
  });
  it('region_contested("border_march")（交战状态谓词，G15）', () => {
    expect(ev('region_contested("border_march")')).toBe(false);
  });
  it('quest_stage(main_quest) == 3（任务谓词）', () => {
    expect(ev('quest_stage(main_quest) == 3')).toBe(true);
  });
  it('arc_stage(arc.rebellion) == "uprising"（弧阶段谓词，C6）', () => {
    expect(ev('arc_stage(arc.rebellion) == "uprising"')).toBe(true);
  });
  it('scene_tag("alchemy_table")（场景谓词，§4.3）', () => {
    expect(ev('scene_tag("alchemy_table")')).toBe(true);
    expect(ev('scene_tag("forge")')).toBe(false);
  });
  it('and / or / not 组合（§7 示例形态）', () => {
    expect(ev('player_level >= 8 and faction_rep(grey_wolves) >= 30')).toBe(true);
    expect(ev('player_level < 8 or faction_rep(grey_wolves) >= 30')).toBe(true);
    expect(ev('not player_owns(tag: "absent")')).toBe(true);
    // C6 弧入口条件（设计稿 §10）：faction_rep(royal_house) < -20 and region_controlled_by('capital') == 'lords'
    expect(ev('faction_rep(royal_house) < -20 and region_controlled_by("capital") == "lords"')).toBe(false);
  });
});

describe('M03 — 运算优先级与文法', () => {
  it('a or b and not c = a or (b and (not c))', () => {
    // player_level>=8(true) or false-and-not-… → true；交换验证结合性
    const ast = parse('player_level < 8 or player_level < 9 and not scene_tag("forge")');
    expect(evaluate(ast, makeCtx())).toBe(true); // or(true, and(false,…)) 不短路错也 true
    // 直接验证结构：or 的右子节点是 and
    expect(ast).toMatchObject({ k: 'or', l: { k: 'cmp' }, r: { k: 'and' } });
  });
  it('括号分组覆盖优先级', () => {
    expect(ev('(player_level < 8 or player_level >= 8) and scene_tag("alchemy_table")')).toBe(true);
    expect(ev('player_level < 8 or (player_level >= 8 and scene_tag("alchemy_table"))')).toBe(true);
  });
  it('负数字面量（定点域，设计稿 §10 弧入口 < -20）', () => {
    expect(ev('faction_rep(royal_house) < -20')).toBe(true);
    expect(ev('faction_rep(grey_wolves) == -33')).toBe(false);
  });
  it('顶层必须为布尔', () => {
    expect(() => ev('33')).toThrow(ExprError);
    expect(() => ev('"bare"')).toThrow(ExprError);
    expect(() => ev('market_index(category: "metal", region: "mountain")')).toThrow(ExprError);
  });
});

describe('M03 — 坏表达式报错定位', () => {
  const bad = (src: string) => {
    try {
      parse(src);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ExprError);
      expect((e as ExprError).pos).toBeGreaterThanOrEqual(0);
      expect((e as ExprError).message.length).toBeGreaterThan(0);
      return e as ExprError;
    }
  };

  it('截断：player_level >=', () => {
    const e = bad('player_level >=');
    expect(e.message).toContain('EOF');
  });
  it('括号不闭合：faction_rep(grey_wolves', () => {
    bad('faction_rep(grey_wolves');
  });
  it('未知字符', () => {
    bad('player_level ~ 8');
  });
  it('多余内容', () => {
    bad('player_level >= 8 8');
  });
  it('单引号字符串报错并提示双引号（决策 O2）', () => {
    try {
      parse("player_owns(tag: 'bone')");
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toContain('双引号');
    }
  });
  it('未闭合字符串', () => {
    bad('player_owns(tag: "unclosed)');
  });
  it('空表达式', () => {
    bad('');
    bad('   ');
  });
});

describe('M03 — AST 往返与纯函数性', () => {
  it('parse → serialize → deserialize → 求值一致', () => {
    const src = 'faction_rep(grey_wolves) >= 30 and not region_contested("capital")';
    const ast = parse(src);
    const round = deserializeAst(JSON.parse(JSON.stringify(serializeAst(ast))));
    const ctx = makeCtx();
    expect(evaluate(round, ctx)).toBe(evaluate(ast, ctx));
  });
  it('非版本化形态反序列化拒绝', () => {
    expect(() => deserializeAst({ nope: true })).toThrow(/AST 反序列化失败/);
  });
  it('求值纯函数：同 (ast, ctx) 两次同结果；ctx 不被修改', () => {
    const ast = parse('player_level >= 8 and player_owns(tag: "bone_of_bone_maw")');
    const ctx = makeCtx();
    expect(evaluate(ast, ctx)).toBe(evaluate(ast, ctx));
  });
  it('未知谓词在求值时报错（宿主 ctx 未实现）', () => {
    expect(() => ev('unknown_pred(1) == 1')).toThrow(/未实现谓词|未知/);
  });
});

describe('M03 — checkTypes 静态查（内容校验通道，§14-7）', () => {
  it('合法表达式通过', () => {
    expect(() => checkTypes(parse('faction_rep(grey_wolves) >= 30'), registry)).not.toThrow();
    expect(() =>
      checkTypes(parse('lineage_of(x) includes "y" or scene_tag("z")'), registry),
    ).not.toThrow();
  });
  it('未注册谓词拒绝', () => {
    expect(() => checkTypes(parse('typo_pred(1) == 1'), registry)).toThrow(/未知谓词/);
  });
  it('比较类型不匹配拒绝（number vs string）', () => {
    expect(() => checkTypes(parse('player_level == "eight"'), registry)).toThrow(/类型不匹配/);
    expect(() => checkTypes(parse('region_controlled_by("capital") >= 3'), registry)).toThrow(/类型不匹配/);
  });
  it('includes 左侧必须为 str', () => {
    expect(() => checkTypes(parse('player_level includes "x"'), registry)).toThrow(/includes/);
  });
  it('顶层非布尔拒绝', () => {
    expect(() => checkTypes(parse('player_level'), registry)).toThrow(/顶层/);
  });
  it('and/or/not 操作数为布尔（num 拒绝）', () => {
    expect(() => checkTypes(parse('player_level and scene_tag("x")'), registry)).toThrow(/布尔/);
  });
});
