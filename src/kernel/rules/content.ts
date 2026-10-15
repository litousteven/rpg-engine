// M07 rules — 内容加载与规则库组装（模块设计稿 M07-rules.md §2，R-1/R-2/R-4）
//
// parseContent(files)：纯函数（R-6）——文件读取属 storage 层，这里只吃字符串。
//   域 schema 校验失败/JSON 坏 → ContentError[]（不加载半包）。
// assembleRuleset(pack)：引用校验（原语 id ⊆ 注册表、配方材料/essence 引用、
//   触发器 when 表达式解析 + on 事件类型合法）→ 不可变 Ruleset（R-2）。
// migrateContent：版本链迁移（R-4）——注册表按 (domain, fromVer) 索引，
//   链式可达即接受，不可达拒载。
import { z } from 'zod';
import type { TemplateId } from '../../contract/index.js';
import { EVENT_TYPES } from '../../contract/index.js';
import { ExprError } from '../expr/index.js';
import type { Ast } from '../expr/index.js';
import { parse } from '../expr/parser.js';
import {
  LootFileSchema,
  PrimitivesFileSchema,
  RecipesFileSchema,
  TriggersFileSchema,
  VersionManifestSchema,
} from './schemas.js';
import type { LootTable, PrimitiveDef, Recipe, TriggerDef } from './schemas.js';
import { effectRegistry } from './registry.js';

// ── 错误形态 ──────────────────────────────────────────────────────

/** ContentError：文件 + 字段路径定位（R-1 验收 2 的要求形态） */
export interface ContentError {
  /** 来源文件名（或「version」） */
  file: string;
  /** 字段路径（如 tables[0].loot[1].template） */
  path: string;
  message: string;
}

export type ContentResult<T> = { ok: true; value: T } | { ok: false; errors: ContentError[] };

const ok = <T>(value: T): ContentResult<T> => ({ ok: true, value });
const err = <T>(errors: ContentError[]): ContentResult<T> => ({ ok: false, errors });

// ── Ruleset（R-2 不可变快照） ─────────────────────────────────────

export interface Ruleset {
  readonly version: Readonly<Record<string, string>>;
  readonly primitives: ReadonlyMap<string, PrimitiveDef>;
  readonly lootTables: ReadonlyMap<TemplateId, LootTable>;
  readonly recipes: ReadonlyMap<TemplateId, Recipe>;
  readonly triggers: readonly TriggerDef[];
  /** 触发器 when 解析缓存（T-2；id → AST） */
  readonly triggerAsts: ReadonlyMap<TemplateId, Ast>;
}

// ── ContentPack（parseContent 的产物：逐域已校验数据） ────────────

export interface ContentPack {
  readonly version: Readonly<Record<string, string>>;
  readonly primitives: readonly PrimitiveDef[];
  readonly lootTables: readonly LootTable[];
  readonly recipes: readonly Recipe[];
  readonly triggers: readonly TriggerDef[];
}

/** B1 已知域闭集（未知域拒载——内容包不能塞 schema 外私货） */
const KNOWN_DOMAINS = ['primitives', 'loot', 'recipes', 'triggers'] as const;

type Domain = (typeof KNOWN_DOMAINS)[number];

const DOMAIN_SCHEMAS: Record<Domain, z.ZodType> = {
  primitives: PrimitivesFileSchema,
  loot: LootFileSchema,
  recipes: RecipesFileSchema,
  triggers: TriggersFileSchema,
};

/** 收集 Zod issues → ContentError（带字段路径） */
const collectIssues = (
  file: string,
  parsed: { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } },
): ContentError[] =>
  parsed.error.issues.map((issue) => ({
    file,
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));

/** 从文件名推断域（primitives.json → primitives；非 .json 拒） */
const domainOf = (file: string): Domain | null => {
  const m = /^([a-z][a-z0-9_]*)\.json$/.exec(file);
  if (!m) return null;
  const name = m[1] as string;
  return (KNOWN_DOMAINS as readonly string[]).includes(name) ? (name as Domain) : null;
};

// ── parseContent（R-1） ───────────────────────────────────────────

export function parseContent(files: Record<string, string>): ContentResult<ContentPack> {
  const errors: ContentError[] = [];

  // VERSION.json 必在（R-3）
  if (!('VERSION.json' in files)) {
    errors.push({ file: 'VERSION.json', path: '(root)', message: '内容包缺 VERSION.json 清单' });
  } else {
    const parsed = VersionManifestSchema.safeParse(JSON.parse(files['VERSION.json']!));
    if (!parsed.success) errors.push(...collectIssues('VERSION.json', parsed));
  }

  const byDomain: Partial<Record<Domain, unknown>> = {};
  for (const [file, text] of Object.entries(files)) {
    if (file === 'VERSION.json') continue;
    const domain = domainOf(file);
    if (!domain) {
      errors.push({ file, path: '(root)', message: `未知域文件（B1 已知域：${KNOWN_DOMAINS.join('/')}）` });
      continue;
    }
    if (byDomain[domain] !== undefined) {
      errors.push({ file, path: '(root)', message: `域 ${domain} 重复文件` });
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (cause) {
      errors.push({ file, path: '(root)', message: `JSON 解析失败：${String(cause)}` });
      continue;
    }
    const parsed = DOMAIN_SCHEMAS[domain].safeParse(json);
    if (!parsed.success) {
      errors.push(...collectIssues(file, parsed));
      continue;
    }
    if ((parsed.data as { domain: Domain }).domain !== domain) {
      errors.push({ file, path: 'domain', message: `文件名域 ${domain} 与内容 domain 字段不符` });
      continue;
    }
    byDomain[domain] = parsed.data;
  }

  // 缺域：全部四个 B1 域必在（半包拒载）
  for (const domain of KNOWN_DOMAINS) {
    if (byDomain[domain] === undefined) {
      errors.push({ file: `${domain}.json`, path: '(root)', message: `内容包缺域文件 ${domain}.json` });
    }
  }

  if (errors.length > 0) return err(errors);

  // 版本清单：每个已加载域必须有版本记录（R-3）
  const version = VersionManifestSchema.parse(JSON.parse(files['VERSION.json']!));
  for (const domain of KNOWN_DOMAINS) {
    if (version[domain] === undefined) {
      errors.push({
        file: 'VERSION.json',
        path: domain,
        message: `版本清单缺域 ${domain} 的版本号`,
      });
    }
  }
  if (errors.length > 0) return err(errors);

  return ok({
    version,
    primitives: (byDomain.primitives as z.infer<typeof PrimitivesFileSchema>).primitives,
    lootTables: (byDomain.loot as z.infer<typeof LootFileSchema>).tables,
    recipes: (byDomain.recipes as z.infer<typeof RecipesFileSchema>).recipes,
    triggers: (byDomain.triggers as z.infer<typeof TriggersFileSchema>).triggers,
  });
}

// ── assembleRuleset（引用校验 → 不可变 Ruleset） ─────────────────

export function assembleRuleset(pack: ContentPack): ContentResult<Ruleset> {
  const errors: ContentError[] = [];

  // 原语目录：id 唯一 + ⊆ 代码注册表（R-5）
  const primitives = new Map<string, PrimitiveDef>();
  for (const [i, p] of pack.primitives.entries()) {
    if (primitives.has(p.id)) {
      errors.push({ file: 'primitives.json', path: `primitives[${i}].id`, message: `原语重复：${p.id}` });
      continue;
    }
    if (!effectRegistry.has(p.id)) {
      errors.push({
        file: 'primitives.json',
        path: `primitives[${i}].id`,
        message: `原语不在代码注册表（R-5 原语封闭）：${p.id}`,
      });
    }
    primitives.set(p.id, p);
  }

  // 掉落表：encounterId 唯一
  const lootTables = new Map<TemplateId, LootTable>();
  for (const [i, t] of pack.lootTables.entries()) {
    if (lootTables.has(t.encounterId)) {
      errors.push({
        file: 'loot.json',
        path: `tables[${i}].encounterId`,
        message: `掉落表重复：${t.encounterId}`,
      });
      continue;
    }
    lootTables.set(t.encounterId, t);
  }

  // 配方：id 唯一 + essenceMapping.primitive ⊆ 原语目录
  const recipes = new Map<TemplateId, Recipe>();
  for (const [i, r] of pack.recipes.entries()) {
    if (recipes.has(r.id)) {
      errors.push({ file: 'recipes.json', path: `recipes[${i}].id`, message: `配方重复：${r.id}` });
      continue;
    }
    for (const [essence, mapping] of Object.entries(r.essenceMapping)) {
      if (!primitives.has(mapping.primitive)) {
        errors.push({
          file: 'recipes.json',
          path: `recipes[${i}].essenceMapping.${essence}.primitive`,
          message: `配方原语不在目录：${mapping.primitive}`,
        });
      }
    }
    recipes.set(r.id, r);
  }

  // 触发器：id 唯一 + on ⊆ EVENT_TYPES + when 解析 + effect.primitive ⊆ 目录
  const triggerAsts = new Map<TemplateId, Ast>();
  const seenTriggers = new Set<TemplateId>();
  for (const [i, t] of pack.triggers.entries()) {
    if (seenTriggers.has(t.id)) {
      errors.push({ file: 'triggers.json', path: `triggers[${i}].id`, message: `触发器重复：${t.id}` });
      continue;
    }
    seenTriggers.add(t.id);
    for (const [j, on] of t.on.entries()) {
      if (!(EVENT_TYPES as readonly string[]).includes(on)) {
        errors.push({
          file: 'triggers.json',
          path: `triggers[${i}].on[${j}]`,
          message: `订阅事件类型不在闭集：${on}`,
        });
      }
    }
    try {
      triggerAsts.set(t.id, parse(t.when));
    } catch (cause) {
      const pos = cause instanceof ExprError ? cause.pos : -1;
      errors.push({
        file: 'triggers.json',
        path: `triggers[${i}].when`,
        message: `条件表达式解析失败（位置 ${pos}）：${String(cause instanceof Error ? cause.message : cause)}`,
      });
    }
    if (!primitives.has(t.effect.primitive)) {
      errors.push({
        file: 'triggers.json',
        path: `triggers[${i}].effect.primitive`,
        message: `触发器原语不在目录：${t.effect.primitive}`,
      });
    }
  }

  if (errors.length > 0) return err(errors);

  // R-2 不可变快照：顶层字段冻结（内部 Map 的 readonly 视图由类型层约束）
  return ok(
    Object.freeze({
      version: Object.freeze(pack.version),
      primitives,
      lootTables,
      recipes,
      triggers: pack.triggers,
      triggerAsts,
    }),
  );
}

// ── migrateContent（R-4 迁移链） ──────────────────────────────────

/** 迁移注册条目：fromVer → toVer 的一跳（纯函数） */
export interface Migration {
  domain: string;
  fromVer: string;
  toVer: string;
  fn: (data: unknown) => unknown;
}

const migrations: Migration[] = [];

/** 注册一条迁移（内容管线/测试用；同 (domain, fromVer) 重复注册抛错） */
export function registerMigration(m: Migration): void {
  if (migrations.some((x) => x.domain === m.domain && x.fromVer === m.fromVer)) {
    throw new Error(`迁移重复注册：${m.domain}@${m.fromVer}`);
  }
  migrations.push(m);
}

const cmpSemver = (a: string, b: string): number => {
  const [ax = 0, ay = 0, az = 0] = a.split('.').map(Number);
  const [bx = 0, by = 0, bz = 0] = b.split('.').map(Number);
  if (ax !== bx) return Math.sign(ax - bx);
  if (ay !== by) return Math.sign(ay - by);
  return Math.sign(az - bz);
};

/** 清空迁移注册表（测试隔离用） */
export function resetMigrations(): void {
  migrations.length = 0;
}

/**
 * 版本链迁移（R-4）：从 fromVer 走到 toVer，每步必须在注册表内（链式可达即接受，
 * 不可达拒载——缺一跳都不行）。贪心取最大步长：注册表是边集，semver 三段跳数极小，
 * 不引入图搜索。
 */
export function migrateContent(
  domain: string,
  fromVer: string,
  toVer: string,
  data: unknown,
): ContentResult<unknown> {
  const errors: ContentError[] = [];
  for (const v of [fromVer, toVer]) {
    if (!/^\d+\.\d+\.\d+$/.test(v)) {
      errors.push({ file: 'VERSION.json', path: domain, message: `版本号非法：${v}` });
    }
  }
  if (errors.length > 0) return err(errors);

  if (cmpSemver(fromVer, toVer) === 0) return ok(data);
  if (cmpSemver(fromVer, toVer) > 0) {
    return err([
      { file: 'VERSION.json', path: domain, message: `不支持降级迁移：${fromVer} → ${toVer}` },
    ]);
  }

  let current = data;
  let ver = fromVer;
  let hops = 0;
  while (ver !== toVer) {
    // 可用边：fromVer === ver 且不越过 toVer；取 toVer 最大者（贪心大步）
    const usable = migrations
      .filter((m) => m.domain === domain && m.fromVer === ver && cmpSemver(m.toVer, toVer) <= 0)
      .sort((a, b) => cmpSemver(b.toVer, a.toVer));
    const step = usable[0];
    if (!step) {
      return err([
        {
          file: 'VERSION.json',
          path: domain,
          message: `迁移链断裂：${domain} 无 ${ver} → 下一版 的注册（链 ${fromVer} → ${toVer} 不可达）`,
        },
      ]);
    }
    current = step.fn(current);
    ver = step.toVer;
    hops++;
    if (hops > 1_000) {
      return err([{ file: 'VERSION.json', path: domain, message: '迁移链超过 1000 跳（注册环？）' }]);
    }
  }
  return ok(current);
}
