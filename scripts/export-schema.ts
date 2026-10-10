// 契约 → JSON Schema 导出（M01 §10 验收 4：golden 文件入库，schema 变更显式 diff）。
// 运行：pnpm schema:export
import { mkdirSync, writeFileSync } from 'node:fs';
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

mkdirSync('schema', { recursive: true });
for (const [name, schema] of Object.entries(targets)) {
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12' });
  const file = `schema/${name}.schema.json`;
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`written ${file}`);
}
