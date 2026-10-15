// M07 rules — 内容域 schema（模块设计稿 M07-rules.md §2，B1 落地域）
//
// 规则即数据（R-1）：content/ 下按域分文件，每域一个 Zod schema。
// 解析失败/引用悬空 → ContentError 列表（不加载半包）。
//
// B1 落地域：primitives / loot / recipes / triggers / version。
// 其余域（encounters/arcs/topics/templates/pricing/quests…）schema 随批次补——
// 占位域在 parseContent 中按「未知域 → 拒载」处理（防内容包塞私货）。
import { z } from 'zod';
import { SlugSchema, TemplateIdSchema, RaritySchema } from '../../contract/index.js';

/** 定点分数 {num, den}（M07 裁决 O3：chance 全链禁浮点；1.0 = {1,1}，0.25 = {1,4}） */
export const FixedRatioSchema = z.strictObject({
  num: z.number().int().min(0),
  den: z.number().int().min(1),
});
export type FixedRatio = z.infer<typeof FixedRatioSchema>;

// ── primitives 域（原语目录：代码注册表的数据侧镜像，R-5） ─────────
export const PrimitiveDefSchema = z.strictObject({
  id: SlugSchema,
  /** 触发器/配方引用的稳定 id（= effectRegistry 键） */
  params: z.record(z.string(), z.unknown()),
  /** 点数代价（数值层预算，M11 定价输入；B1 只承载） */
  cost: z.number().int().min(0),
  desc: z.string().min(1),
});
export const PrimitivesFileSchema = z.strictObject({
  domain: z.literal('primitives'),
  primitives: z.array(PrimitiveDefSchema).min(1),
});
export type PrimitiveDef = z.infer<typeof PrimitiveDefSchema>;

// ── loot 域（掉落表：encounterId → 条目[]） ────────────────────────
export const LootTableEntrySchema = z.strictObject({
  template: TemplateIdSchema,
  chance: FixedRatioSchema,
  /** true → 产出唯一实例（uid/essence/provenance，E-2）；false → 堆叠 */
  named: z.boolean(),
  essence: z.array(SlugSchema),
  /** 具名掉落的稀有度（普通掉落由掷骰/内容决定，B1 允许可选） */
  rarity: RaritySchema.optional(),
  /** 掉落数量（默认 1；具名恒 1） */
  qty: z.number().int().min(1).optional(),
});
export const LootTableSchema = z.strictObject({
  encounterId: TemplateIdSchema,
  loot: z.array(LootTableEntrySchema).min(1),
});
export const LootFileSchema = z.strictObject({
  domain: z.literal('loot'),
  tables: z.array(LootTableSchema).min(1),
});
export type LootTableEntry = z.infer<typeof LootTableEntrySchema>;
export type LootTable = z.infer<typeof LootTableSchema>;

// ── recipes 域（配方：essence → 效果原语映射，§5.3） ──────────────
export const EssenceMappingSchema = z.record(
  z.string(),
  z.strictObject({
    primitive: SlugSchema,
    /** 原语等级；省略 → rankFrom material（M06 合成时取材料 rank，B1 取默认 1） */
    rank: z.number().int().min(1).max(5).optional(),
  }),
);
export type EssenceMapping = z.infer<typeof EssenceMappingSchema>;
export const RecipeSchema = z.strictObject({
  id: TemplateIdSchema,
  /** 工位场景标签（§4.3 可供性：alchemy_table / smithy…） */
  station: SlugSchema,
  materials: z
    .array(
      z.strictObject({
        ref: TemplateIdSchema,
        qty: z.number().int().min(1),
      }),
    )
    .min(1),
  essenceMapping: EssenceMappingSchema,
});
export const RecipesFileSchema = z.strictObject({
  domain: z.literal('recipes'),
  recipes: z.array(RecipeSchema).min(1),
});
export type Recipe = z.infer<typeof RecipeSchema>;

// ── triggers 域（T-1 触发器是数据；引擎只消费） ───────────────────
export const TriggerDefSchema = z.strictObject({
  id: TemplateIdSchema,
  /** 订阅的事件类型（T-3；EVENT_TYPES 闭集成员） */
  on: z.array(z.string().min(1)).min(1),
  /** M03 表达式源码（T-2 唯一条件语言；解析在 assembleRuleset） */
  when: z.string().min(1),
  /** 效果：原语 id + 参数（defer 可选，T-6） */
  effect: z.strictObject({
    primitive: SlugSchema,
    args: z.record(z.string(), z.unknown()).optional(),
    defer: z
      .strictObject({
        dueTurn: z.number().int().min(1),
      })
      .optional(),
  }),
  cooldownTurns: z.number().int().min(1).optional(),
  /** 级联深度预算覆盖（规则库可配，默认 8） */
  maxDepth: z.number().int().min(1).optional(),
});
export const TriggersFileSchema = z.strictObject({
  domain: z.literal('triggers'),
  triggers: z.array(TriggerDefSchema).min(1),
});
export type TriggerDef = z.infer<typeof TriggerDefSchema>;

// ── VERSION.json（R-3：{ [domain]: semver } 清单） ─────────────────
export const VersionManifestSchema = z.record(z.string(), z.string().regex(/^\d+\.\d+\.\d+$/, 'semver'));
