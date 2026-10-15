// M08 trigger — 事件日志视图（模块设计稿 M08-trigger.md §2，裁决 O2）
//
// 只读事件流投影：已提交事件的查询面（§7 硬规则 3——查事件走事件日志）。
// 级联中途评估只看已提交（timeline.events 快照）；在途事件天然不在其中。
// B1 线性扫描；B2 由 M05 审计层建 source.kind 索引。
import type { GameEvent, SourceKind } from '../../contract/index.js';

export interface EventLogView {
  /** 按 source.kind 过滤的事件（item_delivered 等 §7 事件谓词的查询面） */
  byKind(kind: SourceKind): readonly GameEvent[];
  all(): readonly GameEvent[];
}

/** 从已提交事件序列构造视图（timeline.events 的薄包装） */
export function eventLogView(committed: readonly GameEvent[]): EventLogView {
  return {
    byKind: (kind) =>
      committed.filter((e): e is GameEvent & { source: { kind: SourceKind } } =>
        'source' in e && typeof e.source === 'object' && e.source !== null && 'kind' in e.source && e.source.kind === kind,
      ),
    all: () => committed,
  };
}
