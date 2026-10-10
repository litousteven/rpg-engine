// M01 contract — 菜单条目三态（模块设计稿 M01-contract.md §6，设计稿 §4.4）
//
// 不变量：
//   M1 hidden 条目不出现在协议投影（玩家侧不存在，P3）——完整三态只在引擎内部/审计日志
//   M2 locked 必带 hint 且 hint 文案由模板渲染（无 LLM 依赖，C7）
//   M3 enriched 条目 verb 必须是基础层某 verb 的参数化变体（增富层校验闭环，G22，M1 落地）
import { z } from 'zod';
import { MenuOriginSchema, MenuStateSchema, ModeSchema } from './enums.js';
import { SlugSchema } from './ids.js';

export const MenuItemSchema = z
  .strictObject({
    id: z.string().min(1).max(128),
    verb: SlugSchema,
    label: z.string().min(1).max(64),
    state: MenuStateSchema,
    /** locked 时必填（达成条件提示，引擎渲染）——见下方 superRefine */
    hint: z.string().max(128).optional(),
    origin: MenuOriginSchema,
    /** verb 参数 schema 引用（I1 校验锚点） */
    paramsSchemaRef: z.string().min(1).optional(),
    /** 建议参数（如当前估值） */
    prefill: z.record(z.string(), z.unknown()).optional(),
    /** 展示用派生值（定点整数，如 price/region） */
    context: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((item, ctx) => {
    if (item.state === 'locked' && (item.hint === undefined || item.hint.length === 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['hint'],
        message: 'locked 条目必须携带 hint（M01 不变量 M2，§4.4 达成条件提示）',
      });
    }
  });

export const MenuSchema = z.strictObject({
  mode: ModeSchema,
  items: z.array(MenuItemSchema).max(256),
});

export type MenuItem = z.infer<typeof MenuItemSchema>;
export type Menu = z.infer<typeof MenuSchema>;
