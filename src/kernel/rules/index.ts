// M07 rules — 公共出口
export {
  parseContent,
  assembleRuleset,
  registerMigration,
  resetMigrations,
  migrateContent,
} from './content.js';
export type { ContentError, ContentResult, ContentPack, Ruleset, Migration } from './content.js';
export { effectRegistry } from './registry.js';
export type { EffectPrimitive, EffectRegistry } from './registry.js';
export {
  FixedRatioSchema,
  PrimitiveDefSchema,
  PrimitivesFileSchema,
  LootTableEntrySchema,
  LootTableSchema,
  LootFileSchema,
  EssenceMappingSchema,
  RecipeSchema,
  RecipesFileSchema,
  TriggerDefSchema,
  TriggersFileSchema,
  VersionManifestSchema,
} from './schemas.js';
export type {
  FixedRatio,
  PrimitiveDef,
  LootTableEntry,
  LootTable,
  EssenceMapping,
  Recipe,
  TriggerDef,
} from './schemas.js';
