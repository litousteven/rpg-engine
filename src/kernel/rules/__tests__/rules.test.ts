// M07 验收（模块设计稿 M07-rules.md §5）：
//   1. 合法内容包：C1 骨头掉落表 + 骨刃配方 + 测试原语 → assemble 成功；Ruleset 只读
//   2. 加载拒：缺字段 / 原语引用悬空 / 未知域文件 → ContentError 定位（文件+字段路径）
//   3. 迁移：v1→v2 单跳、v1→v3 链式、断链拒载
//   4. B1 收口前置：loot chance {1,1} named=true（C1 T0 数据源）
// fs 读取属 storage 层（R-6）——测试文件本身是唯一获准碰 fs 的位置（fixtures 读取真实 content/）。
import { readFileSync } from 'node:fs';
import { describe, expect, it, beforeEach } from 'vitest';
import {
  parseContent,
  assembleRuleset,
  registerMigration,
  resetMigrations,
  migrateContent,
} from '../index.js';
import type { ContentPack } from '../index.js';

/** 读取真实 content/ 三件套（O2 裁决 A：fs 缝隙从 B1 被测过） */
function realFiles(): Record<string, string> {
  return {
    'VERSION.json': readFileSync('content/VERSION.json', 'utf8'),
    'primitives.json': readFileSync('content/primitives.json', 'utf8'),
    'loot.json': readFileSync('content/loot.json', 'utf8'),
    'recipes.json': readFileSync('content/recipes.json', 'utf8'),
    'triggers.json': readFileSync('content/triggers.json', 'utf8'),
  };
}

/** 深拷贝 + 覆写单文件（变异测试用——不动真实 content/） */
function withFile(files: Record<string, string>, name: string, text: string) {
  return { ...files, [name]: text };
}

describe('M07 rules — 内容加载（R-1）', () => {
  it('真实三件套 + 触发器 + VERSION 解析成功（C1 数据源）', () => {
    const result = parseContent(realFiles());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version).toEqual({
      primitives: '1.0.0',
      loot: '1.0.0',
      recipes: '1.0.0',
      triggers: '1.0.0',
    });
    expect(result.value.lootTables).toHaveLength(2);
    // C1 T0：boss.bone_maw → item.bone.large named
    const boneMaw = result.value.lootTables.find((t) => t.encounterId === 'boss.bone_maw');
    expect(boneMaw?.loot[0]?.template).toBe('item.bone.large');
    expect(boneMaw?.loot[0]?.named).toBe(true);
    expect(boneMaw?.loot[0]?.chance).toEqual({ num: 1, den: 1 });
  });

  it('缺 VERSION.json → 拒载并定位', () => {
    const files = realFiles();
    delete files['VERSION.json'];
    const result = parseContent(files);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.file).toBe('VERSION.json');
  });

  it('未知域文件 → 拒载（内容包不能塞 schema 外私货）', () => {
    const result = parseContent(withFile(realFiles(), 'economy.json', '{"domain":"economy"}'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.file === 'economy.json' && /未知域/.test(e.message))).toBe(true);
  });

  it('缺域文件 → 拒载（不加载半包）', () => {
    const files = realFiles();
    delete files['loot.json'];
    const result = parseContent(files);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /缺域文件 loot/.test(e.message))).toBe(true);
  });

  it('域内缺字段 → ContentError 带字段路径（C1 掉落表缺 named）', () => {
    const bad = JSON.stringify({
      domain: 'loot',
      tables: [{ encounterId: 'boss.bone_maw', loot: [{ template: 'item.bone.large', chance: { num: 1, den: 1 }, essence: [] }] }],
    });
    const result = parseContent(withFile(realFiles(), 'loot.json', bad));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.file === 'loot.json' && /named/.test(e.path))).toBe(true);
  });

  it('VERSION 缺域版本号 → 拒载（R-3）', () => {
    const bad = JSON.stringify({ primitives: '1.0.0', loot: '1.0.0', recipes: '1.0.0' });
    const result = parseContent(withFile(realFiles(), 'VERSION.json', bad));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /缺域 triggers/.test(e.message))).toBe(true);
  });
});

describe('M07 rules — 组装与引用校验（R-2/R-5）', () => {
  it('合法包 assemble 成功；Ruleset 不可变（R-2）', () => {
    const pack = parseContent(realFiles());
    expect(pack.ok).toBe(true);
    if (!pack.ok) return;
    const result = assembleRuleset(pack.value);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rs = result.value;
    // C1 T0 数据源就绪：chance {1,1} named=true
    const table = rs.lootTables.get('boss.bone_maw');
    expect(table?.loot[0]?.chance).toEqual({ num: 1, den: 1 });
    expect(table?.loot[0]?.named).toBe(true);
    // 不可变断言：顶层字段冻结（R-2；Map 内部可变是 TS 限制，readonly 由类型层约束）
    expect(Object.isFrozen(rs)).toBe(true);
    expect(Object.isFrozen(rs.version)).toBe(true);
    expect(rs.triggerAsts.size).toBe(1);
  });

  it('原语引用悬空 → ContentError（配方 essenceMapping 引用不在目录的 id）', () => {
    const pack = parseContent(realFiles());
    expect(pack.ok).toBe(true);
    if (!pack.ok) return;
    const mutated: ContentPack = {
      ...pack.value,
      recipes: pack.value.recipes.map((r) =>
        r.id === 'craft.weapon.bone_blade'
          ? { ...r, essenceMapping: { poison_affinity: { primitive: 'nonexistent_prim' } } }
          : r,
      ),
    };
    const result = assembleRuleset(mutated);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.errors.some(
        (e) => e.file === 'recipes.json' && /nonexistent_prim/.test(e.message),
      ),
    ).toBe(true);
  });

  it('触发器 when 表达式解析失败 → ContentError（T-2）', () => {
    const pack = parseContent(realFiles());
    expect(pack.ok).toBe(true);
    if (!pack.ok) return;
    const mutated: ContentPack = {
      ...pack.value,
      triggers: pack.value.triggers.map((t) =>
        t.id === 'trigger.elder_yun_bone_delivery' ? { ...t, when: 'player_owns(tag: ' } : t,
      ),
    };
    const result = assembleRuleset(mutated);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.errors.some((e) => e.path === 'triggers[0].when' && /解析失败/.test(e.message)),
    ).toBe(true);
  });

  it('触发器订阅事件类型不在闭集 → ContentError（T-3）', () => {
    const pack = parseContent(realFiles());
    expect(pack.ok).toBe(true);
    if (!pack.ok) return;
    const mutated: ContentPack = {
      ...pack.value,
      triggers: pack.value.triggers.map((t) =>
        t.id === 'trigger.elder_yun_bone_delivery' ? { ...t, on: ['not.an.event'] } : t,
      ),
    };
    const result = assembleRuleset(mutated);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /订阅事件类型/.test(e.message))).toBe(true);
  });
});

describe('M07 rules — 迁移链（R-4）', () => {
  beforeEach(() => resetMigrations());

  it('同版本直通：fromVer == toVer → 原样返回', () => {
    const r = migrateContent('loot', '1.0.0', '1.0.0', { a: 1 });
    expect(r.ok).toBe(true);
  });

  it('v1→v2 单跳', () => {
    registerMigration({
      domain: 'loot',
      fromVer: '1.0.0',
      toVer: '1.1.0',
      fn: (d) => ({ ...(d as object), patched: true }),
    });
    const r = migrateContent('loot', '1.0.0', '1.1.0', { a: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ a: 1, patched: true });
  });

  it('v1→v3 链式（两跳）', () => {
    registerMigration({
      domain: 'loot',
      fromVer: '1.0.0',
      toVer: '1.1.0',
      fn: (d) => ({ ...(d as object), v2: true }),
    });
    registerMigration({
      domain: 'loot',
      fromVer: '1.1.0',
      toVer: '2.0.0',
      fn: (d) => ({ ...(d as object), v3: true }),
    });
    const r = migrateContent('loot', '1.0.0', '2.0.0', {});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ v2: true, v3: true });
  });

  it('断链拒载：缺 1.1.0 → 2.0.0 一跳', () => {
    registerMigration({
      domain: 'loot',
      fromVer: '1.0.0',
      toVer: '1.1.0',
      fn: (d) => d,
    });
    const r = migrateContent('loot', '1.0.0', '2.0.0', {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(/迁移链断裂/.test(r.errors[0]?.message ?? '')).toBe(true);
  });

  it('降级拒载', () => {
    const r = migrateContent('loot', '2.0.0', '1.0.0', {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(/不支持降级/.test(r.errors[0]?.message ?? '')).toBe(true);
  });

  it('同 (domain, fromVer) 重复注册抛错', () => {
    registerMigration({ domain: 'loot', fromVer: '1.0.0', toVer: '1.1.0', fn: (d) => d });
    expect(() =>
      registerMigration({ domain: 'loot', fromVer: '1.0.0', toVer: '2.0.0', fn: (d) => d }),
    ).toThrow(/重复注册/);
  });
});
