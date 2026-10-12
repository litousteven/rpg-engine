// M04 验收（模块拆分稿 M04 行）：事务语义。
//   原子回滚（半提交在结构上不存在）/ basedOn stale 拒绝 / unknown-applier / applier 异常
//   / 信封校验（seq 连续、revision 单调性由 replay.test 覆盖）
import { describe, expect, it } from 'vitest';
import { ApplierRegistry } from '../registry.js';
import { Timeline } from '../timeline.js';
import { TimelineError } from '../errors.js';
import { EVENT_TYPES } from '../../../contract/index.js';
import type { GameEvent } from '../../../contract/index.js';

interface TestState {
  gold: number;
  items: number;
}

const initial: TestState = { gold: 100, items: 0 };

function makeRegistry(): ApplierRegistry<TestState> {
  const reg = new ApplierRegistry<TestState>();
  for (const t of EVENT_TYPES) reg.register(t, (s) => s);
  reg.register('gold.changed', (s, e) => {
    if (e.t !== 'gold.changed') return s;
    if (e.delta < 0 && s.gold + e.delta < 0) throw new Error('gold 不足');
    return { ...s, gold: s.gold + e.delta };
  });
  reg.register('item.spawned', (s, e) => {
    if (e.t !== 'item.spawned') return s;
    return { ...s, items: s.items + e.qty };
  });
  return reg;
}

const gold = (seq: number, revision: number, delta: number): GameEvent => ({
  seq,
  turn: 1,
  revision,
  t: 'gold.changed',
  actor: 'player',
  delta,
  balance: 0, // 测试 applier 不校验 balance；只为过 schema
  source: { kind: 'gift' },
});

const spawn = (seq: number, revision: number, qty: number): GameEvent => ({
  seq,
  turn: 1,
  revision,
  t: 'item.spawned',
  to: 'player',
  template: 'item.sword.broken',
  qty,
  rarity: 'common',
  essence: [],
  provenance: { source: 'test', turn: 1 },
  source: { kind: 'initial' },
});

describe('M04 timeline — 事务语义', () => {
  it('revision 随事务单调递增；空事务不推进', () => {
    const tl = new Timeline(initial, makeRegistry());
    expect(tl.revision).toBe(0);
    tl.apply([spawn(0, 1, 5)]);
    expect(tl.revision).toBe(1);
    tl.apply([gold(1, 2, 50), spawn(2, 2, 3)]);
    expect(tl.revision).toBe(2);
    tl.apply([]);
    expect(tl.revision).toBe(2);
    expect(tl.state).toEqual({ gold: 150, items: 8 });
  });

  it('原子回滚：applier 中途抛错 → 状态/日志/revision 均不变（半提交不存在）', () => {
    const tl = new Timeline(initial, makeRegistry());
    tl.apply([spawn(0, 1, 5)]);
    const stateBefore = JSON.stringify(tl.state);
    const logLenBefore = tl.events.length;

    // 第二个事件 applier 抛错（gold 不足），第一个事件本会成功
    try {
      tl.apply([spawn(1, 2, 7), gold(2, 2, -999)]);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(TimelineError);
      expect((e as TimelineError).code).toBe('applier');
    }

    expect(JSON.stringify(tl.state)).toBe(stateBefore);
    expect(tl.events.length).toBe(logLenBefore);
    expect(tl.revision).toBe(1);
    expect(tl.state.items).toBe(5); // 第一个事件未生效

    // 后续事务照常工作，seq 从断点继续（无空洞）
    tl.apply([gold(1, 2, -100)]);
    expect(tl.state).toEqual({ gold: 0, items: 5 });
    expect(tl.events[1]!.seq).toBe(1);
    tl.verifyFold();
  });

  it('基于判定 mutating applier 的回滚：事务开头深拷贝保证半提交不留痕', () => {
    // 构造直接修改入参且第二事件抛错的 applier 组合（违反纯度约定）——stage 的深拷贝兜底
    const reg = makeRegistry();
    reg.register('item.spawned', (s, e) => {
      if (e.t !== 'item.spawned') return s;
      s.items += e.qty; // 故意 mutate
      return s;
    });
    reg.register('gold.changed', () => {
      throw new Error('boom');
    });

    const tl = new Timeline(initial, reg);
    try {
      tl.apply([spawn(0, 1, 5), gold(1, 1, 1)]);
      expect.unreachable();
    } catch (e) {
      expect((e as TimelineError).code).toBe('applier');
    }
    // mutate 的部分变更被深拷贝隔离——权威状态未动
    expect(tl.state.items).toBe(0);
    expect(tl.events.length).toBe(0);
  });

  it('basedOn stale：revision 门控拒绝过期提交（§12.2）', () => {
    const tl = new Timeline(initial, makeRegistry());
    tl.apply([spawn(0, 1, 5)]);
    // 依据 revision 0（过期）提交 → stale
    try {
      tl.apply([gold(1, 2, 10)], { basedOn: 0 });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(TimelineError);
      expect((e as TimelineError).code).toBe('stale');
    }
    expect(tl.revision).toBe(1);
    // 依据当前 revision 提交 → 通过
    tl.apply([gold(1, 2, 10)], { basedOn: 1 });
    expect(tl.state.gold).toBe(110);
  });

  it('unknown-applier：注册表构造时强制全类型完备（E4 前置保障）', () => {
    const missing = new ApplierRegistry<TestState>();
    for (const t of EVENT_TYPES) {
      if (t !== 'arc.selected') missing.register(t, (s) => s);
    }
    expect(() => new Timeline(initial, missing)).toThrowError(/applier 注册不全/);
  });

  it('schema 拒绝：非法事件不入账', () => {
    const tl = new Timeline(initial, makeRegistry());
    const bad = { ...gold(0, 1, 10), actor: 'not-an-actor' } as unknown as GameEvent;
    try {
      tl.apply([bad]);
      expect.unreachable();
    } catch (e) {
      expect((e as TimelineError).code).toBe('schema');
    }
    expect(tl.events.length).toBe(0);
    expect(tl.revision).toBe(0);
  });
});
