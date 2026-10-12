// M04 timeline — 事件 applier 注册表（E4 的落地：fold 语义与事件类型一一绑定）
//
// 每个事件类型 t 必须注册一个纯 applier： (state, event) => state'
// - 无 IO、无随机、无时钟（kernel 硬规则，ESLint 拦截）
// - 不可变更新：不修改入参（幂等 fold 的前提）
// - 状态迁移与 GameEvent 判别联合 exhaustive 对齐（少注册即 unknown-applier 拒绝）
import type { GameEvent, EventType } from '../../contract/index.js';
import { EVENT_TYPES } from '../../contract/index.js';

/** applier：返回新状态；抛错则整笔事务回滚（原子性由 TransactionContext 保证） */
export type Applier<S> = (state: S, event: GameEvent) => S;

export class ApplierRegistry<S> {
  #appliers = new Map<EventType, Applier<S>>();

  register(t: EventType, applier: Applier<S>): void {
    this.#appliers.set(t, applier);
  }

  /** 全集完备性：每个事件类型都有 fold 语义（E4/unknown-applier 的前置保障） */
  assertComplete(): void {
    const missing = EVENT_TYPES.filter((t) => !this.#appliers.has(t));
    if (missing.length > 0) {
      throw new Error(`applier 注册不全，缺：${missing.join(', ')}`);
    }
  }

  get(t: EventType): Applier<S> | undefined {
    return this.#appliers.get(t);
  }
}
