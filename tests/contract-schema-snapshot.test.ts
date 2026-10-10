// M01 §10 验收 4：JSON Schema golden 快照——schema/ 下入库文件与当前契约一致，
// 任何 schema 变更必须显式重跑 pnpm schema:export（diff 可审）。
// 与 scripts/export-schema.ts 的目标清单保持同步。
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  GameEventSchema,
  GameStateSchema,
  IntentInputSchema,
  IntentSchema,
  MenuSchema,
  NamingPayloadSchema,
  ReceiptSchema,
} from '../src/contract/index.js';

const targets: Record<string, z.ZodType> = {
  'game-event': GameEventSchema,
  'game-state': GameStateSchema,
  'intent-input': IntentInputSchema,
  intent: IntentSchema,
  menu: MenuSchema,
  naming: NamingPayloadSchema,
  receipt: ReceiptSchema,
};

describe('JSON Schema golden 快照（契约版本演进可视）', () => {
  it('golden 文件齐备（无缺漏、无多余）', () => {
    const files = readdirSync('schema').sort();
    expect(files).toEqual(Object.keys(targets).map((n) => `${n}.schema.json`).sort());
  });

  it('golden 文件与当前契约逐字一致（变更需显式 pnpm schema:export）', () => {
    for (const [name, schema] of Object.entries(targets)) {
      const committed = JSON.parse(readFileSync(`schema/${name}.schema.json`, 'utf8'));
      const regenerated = z.toJSONSchema(schema, { target: 'draft-2020-12' });
      expect(regenerated).toEqual(committed);
    }
  });

  it('game-event golden 含全部 34 个判别分支（oneOf）', () => {
    const committed = JSON.parse(readFileSync('schema/game-event.schema.json', 'utf8'));
    expect(committed.oneOf).toHaveLength(34);
  });
});
