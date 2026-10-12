// M04 timeline — 错误形态（模块拆分稿 M04 行，移植自 dsh-tavern story-timeline 的回执语义）
export type TimelineErrorCode =
  /** intent 基于过期 revision 提交（§12.2 stale 门控） */
  | 'stale'
  /** 事件形状不符合契约（M01 schema） */
  | 'schema'
  /** 事件类型无注册 applier（E4：payload 由 t 唯一决定 → 每个 t 必须有 fold 语义） */
  | 'unknown-applier'
  /** applier 执行抛错——整笔回滚（原子性） */
  | 'applier'
  /** 日志自检失败：seq 非索引 / revision 非单调（重放侧） */
  | 'log-integrity';

export class TimelineError extends Error {
  constructor(
    readonly code: TimelineErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'TimelineError';
  }
}
