// M04 timeline — 权威状态机（模块拆分稿 M04 行，移植改造自 dsh-tavern story-timeline.js）
//
// 职责（§13：revision/branch/checkpoint/basedOn stale 拒绝）：
//   - apply(events)：原子事务——任何 applier 抛错整笔回滚，半提交状态在结构上不存在
//   - revision++：每笔事务单调递增；事务边界（累计事件数）入账，branch/restore 的依据
//   - basedOn 检查：决策依据过期（stale）的提交被拒（§12.2 revision 门控）
//   - branch(revision)：从历史 revision 分叉新时间线（分叉后两线独立）
//   - checkpoint / restore：快照 + 按事务分块的日志后缀；fold ≡ snapshot 的加速器
//   - verifyFold：fold(全量日志) ≡ 当前状态（E1；启动与测试时校验）
//
// 确定性硬规则：无 IO、无时钟、无随机（kernel ESLint 拦截）。
import { GameEventSchema } from '../../contract/index.js';
import type { GameEvent, EventType } from '../../contract/index.js';
import { ApplierRegistry } from './registry.js';
import { TimelineError } from './errors.js';

/** 提交选项 */
export interface ApplyOptions {
  /** 提交方声称依据的 revision；与当前不符 → stale 拒绝 */
  basedOn?: number;
}

/** checkpoint：快照 + 账面（事件计数与事务边界，restore 分块重放的依据） */
export interface Checkpoint<S> {
  state: S;
  revision: number;
  lastSeq: number;
  /** 已提交事件总数（前缀长度） */
  eventCount: number;
  /** 每笔事务的累计事件数（第 i 项 = 前 i+1 笔事务的事件总数） */
  txBoundaries: number[];
}

const deepEq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export class Timeline<S> {
  readonly #registry: ApplierRegistry<S>;
  readonly #initial: S;
  #state: S;
  #revision = 0;
  readonly #log: GameEvent[] = [];
  #lastSeq = -1;
  #txBoundaries: number[] = [];

  constructor(initialState: S, registry: ApplierRegistry<S>) {
    registry.assertComplete();
    this.#registry = registry;
    this.#initial = initialState;
    this.#state = initialState;
  }

  /** 从分块日志重建（加载/重放/校验共用——按原始事务边界逐笔 apply，全验证路径同源） */
  static fromTxs<S>(
    initialState: S,
    registry: ApplierRegistry<S>,
    txs: readonly (readonly GameEvent[])[],
  ): Timeline<S> {
    const timeline = new Timeline(initialState, registry);
    for (const tx of txs) timeline.apply(tx);
    return timeline;
  }

  /** 从 checkpoint + 事务后缀恢复（存储加载路径；后缀按事务分块） */
  static restore<S>(
    _initialState: S,
    registry: ApplierRegistry<S>,
    checkpoint: Checkpoint<S>,
    suffixTxs: readonly (readonly GameEvent[])[],
  ): Timeline<S> {
    const timeline = new Timeline(_initialState, registry);
    timeline.#state = structuredClone(checkpoint.state);
    timeline.#revision = checkpoint.revision;
    timeline.#lastSeq = checkpoint.lastSeq;
    timeline.#txBoundaries = [...checkpoint.txBoundaries];
    timeline.#log.length = 0; // 前缀不进内存日志——checkpoint 即前缀真相；verifyFold 用重放校验
    for (const tx of suffixTxs) timeline.apply(tx);
    return timeline;
  }

  get state(): S {
    return this.#state;
  }

  get revision(): number {
    return this.#revision;
  }

  get events(): readonly GameEvent[] {
    return this.#log;
  }

  get lastSeq(): number {
    return this.#lastSeq;
  }

  /**
   * 原子事务：逐事件 schema 校验 → applier 执行（在副本上）→ 全部通过才 finalize。
   * 半提交状态在结构上不存在：任何一步失败，状态、日志、revision 均不动。
   */
  apply(events: readonly GameEvent[], options: ApplyOptions = {}): number {
    if (options.basedOn !== undefined && options.basedOn !== this.#revision) {
      throw new TimelineError(
        'stale',
        `basedOn revision ${options.basedOn} ≠ 当前 ${this.#revision}（决策依据过期，丢弃或重新决策）`,
      );
    }
    if (events.length === 0) return this.#revision;

    // stage：副本上执行（prepare/stageChanges，dsh-tavern 四段式）——applier 即便直接
    // 修改入参，中途失败也不会污染权威状态（半提交在结构上不存在）
    let state = structuredClone(this.#state);
    let lastSeq = this.#lastSeq;
    const staged: GameEvent[] = [];
    for (const raw of events) {
      const parsed = GameEventSchema.safeParse(raw);
      if (!parsed.success) {
        throw new TimelineError(
          'schema',
          `事件不符合契约：${parsed.error.issues[0]?.message ?? ''}`,
        );
      }
      const event = parsed.data;
      if (event.seq !== lastSeq + 1) {
        throw new TimelineError(
          'log-integrity',
          `seq 必须连续递增：期望 ${lastSeq + 1}，得到 ${event.seq}`,
        );
      }
      const applier = this.#registry.get(event.t as EventType);
      if (!applier) {
        throw new TimelineError('unknown-applier', `事件类型无 applier：${event.t}`);
      }
      try {
        state = applier(state, event);
      } catch (cause) {
        throw new TimelineError('applier', `applier 执行失败（${event.t}）：${String(cause)}`, {
          cause,
        });
      }
      staged.push(event);
      lastSeq = event.seq;
    }

    // finalize：一步换入，无中间态可见
    this.#state = state;
    this.#log.push(...staged);
    this.#lastSeq = lastSeq;
    this.#txBoundaries.push(this.#log.length);
    this.#revision += 1;
    return this.#revision;
  }

  /** 从任意历史 revision 分叉（E1 分叉形态：分叉线重放前缀后独立演进） */
  branch(upToRevision: number): Timeline<S> {
    if (!Number.isInteger(upToRevision) || upToRevision < 0 || upToRevision > this.#revision) {
      throw new TimelineError(
        'log-integrity',
        `branch revision ${upToRevision} 越界 [0, ${this.#revision}]`,
      );
    }
    // 取前 upToRevision 笔事务重放（事务边界语义见 #txs 注释）
    const all = this.#txs();
    return Timeline.fromTxs(this.#initial, this.#registry, all.slice(0, upToRevision));
  }

  /** 快照当前账面（存储层每 N 事务落盘；state 为深拷贝，快照后演进互不影响） */
  checkpoint(): Checkpoint<S> {
    return {
      state: structuredClone(this.#state),
      revision: this.#revision,
      lastSeq: this.#lastSeq,
      eventCount: this.#log.length,
      txBoundaries: [...this.#txBoundaries],
    };
  }

  /**
   * E1 真相源自检：fold(全量日志) ≡ 当前状态（逐字节）。
   * equals 默认 JSON 序列化比较（kernel 状态为 JSON 安全数据）；可注入自定义等价。
   */
  verifyFold(equals: (a: S, b: S) => boolean = deepEq as (a: S, b: S) => boolean): void {
    const rebuilt = Timeline.fromTxs(this.#initial, this.#registry, this.#txs());
    if (rebuilt.revision !== this.#revision) {
      throw new TimelineError(
        'log-integrity',
        `verifyFold：revision 不一致（重放 ${rebuilt.revision} ≠ 当前 ${this.#revision}）`,
      );
    }
    if (!equals(rebuilt.state, this.#state)) {
      throw new TimelineError('log-integrity', 'verifyFold：fold(日志) ≠ 当前状态');
    }
  }

  /** 按事务边界切分全量日志（fromTxs/verifyFold/存储导出共用）。
   *  txBoundaries[i] = 前 i+1 笔事务的累计事件数 → 第 i 笔事务 = log[(i===0?0:boundaries[i-1]) .. boundaries[i]] */
  #txs(): (readonly GameEvent[])[] {
    const txs: (readonly GameEvent[])[] = [];
    for (let i = 0; i < this.#txBoundaries.length; i++) {
      const start = i === 0 ? 0 : this.#txBoundaries[i - 1]!;
      const end = this.#txBoundaries[i]!;
      txs.push(this.#log.slice(start, end));
    }
    return txs;
  }
}

export { ApplierRegistry };
export type { Applier } from './registry.js';
