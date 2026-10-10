// M01 contract — 公共数据契约总出口（模块设计稿 M01-contract.md）
//
// 单源三用（技术选型稿 §6）：TS 类型 + 运行时校验（Zod）+ JSON Schema 导出（scripts/export-schema.ts）。
// 边界规则：本包不含任何行为（解析/求值/校验逻辑分属 M03/M12）；禁止 Node API 与时钟。
export * from './ids.js';
export * from './enums.js';
export * from './intent.js';
export * from './receipt.js';
export * from './menu.js';
export * from './naming.js';
export * from './state.js';
export * from './events.js';

/** 协议版本（M15：0 = 草案期，M0 收口冻结为 1；只增不改） */
export const PROTO_VER = 0 as const;
