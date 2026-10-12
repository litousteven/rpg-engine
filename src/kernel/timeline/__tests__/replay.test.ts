// M04 验收（模块拆分稿 B0 收口）：重放等价测试。
//   fold ≡ snapshot（verifyFold + 手动 fromTxs）
//   同种子双跑逐字节相等
//   branch 后重放一致
//   checkpoint 恢复
//   篡改日志拒绝（seq 跳号 / schema）
import { describe, expect, it } from 'vitest';
import { ApplierRegistry } from '../registry.js';
import { Timeline } from '../timeline.js';
import { TimelineError } from '../errors.js';
import { EVENT_TYPES } from '../../../contract/index.js';
import type { GameEvent } from '../../../contract/index.js';

// ── 测试状态与 applier（真实账本 applier 属 M05；此处为 timeline 机制的验证夹具） ──

interface TestState {
  gold: number;
  items: number;
  rep: Record<string, number>;
}

const initial: TestState = { gold: 60000, items: 0, rep: {} };

function makeRegistry(): ApplierRegistry<TestState> {
  const reg = new ApplierRegistry<TestState>();
  // 全部 34 类注册（assertComplete 硬要求）；多数为 no-op（审计类事件不改账面）
  for (const t of EVENT_TYPES) {
    reg.register(t, (s) => s);
  }
  reg.register('gold.changed', (s, e) => {
    if (e.t !== 'gold.changed') return s;
    const next = s.gold + e.delta;
    if (next !== e.balance) throw new Error(`balance 不一致：${next} ≠ ${e.balance}`);
    return { ...s, gold: next };
  });
  reg.register('item.spawned', (s, e) => {
    if (e.t !== 'item.spawned') return s;
    return { ...s, items: s.items + e.qty };
  });
  reg.register('rep.changed', (s, e) => {
    if (e.t !== 'rep.changed') return s;
    return { ...s, rep: { ...s.rep, [e.faction]: e.value } };
  });
  return reg;
}

// ── 事件夹具（信封：seq 全局连续；revision 事务内一致） ──

const gold = (seq: number, revision: number, delta: number, balance: number): GameEvent => ({
  seq,
  turn: 1,
  revision,
  t: 'gold.changed',
  actor: 'player',
  delta,
  balance,
  source: { kind: 'buy' },
});

const spawn = (seq: number, revision: number): GameEvent => ({
  seq,
  turn: 1,
  revision,
  t: 'item.spawned',
  to: 'player',
  template: 'item.sword.broken',
  qty: 5,
  rarity: 'common',
  essence: [],
  provenance: { source: 'test', turn: 1 },
  source: { kind: 'initial' },
});

const rep = (seq: number, revision: number, value: number): GameEvent => ({
  seq,
  turn: 1,
  revision,
  t: 'rep.changed',
  faction: 'faction.grey_wolves',
  delta: value,
  value,
  source: { kind: 'quest-delivery' },
});

/** 场景脚本：4 笔事务（rev 1–4），seq 0..8 */
function scriptTxs(): GameEvent[][] {
  return [
    [spawn(0, 1), gold(1, 1, -100, 59900)],
    [gold(2, 2, 500, 60400)],
    [rep(3, 3, 33), spawn(4, 3), gold(5, 3, -9999, 50401)],
    [gold(6, 4, 300, 50701), rep(7, 4, -5), spawn(8, 4)],
  ];
}

const canon = JSON.stringify;

describe('M04 timeline — 重放等价（B0 收口验收）', () => {
  it('fold ≡ snapshot：verifyFold 通过；fromTxs 重放逐字节相等（E1）', () => {
    const tl = Timeline.fromTxs(initial, makeRegistry(), scriptTxs());
    expect(tl.revision).toBe(4);
    expect(tl.state).toEqual({ gold: 50701, items: 15, rep: { 'faction.grey_wolves': -5 } });

    tl.verifyFold(); // 不抛即通过

    const rebuilt = Timeline.fromTxs(initial, makeRegistry(), scriptTxs());
    expect(canon(rebuilt.state)).toBe(canon(tl.state));
    expect(canon([...rebuilt.events])).toBe(canon([...tl.events]));
  });

  it('同种子双跑：状态与日志逐字节相等（P7）', () => {
    const a = Timeline.fromTxs(initial, makeRegistry(), scriptTxs());
    const b = Timeline.fromTxs(initial, makeRegistry(), scriptTxs());
    expect(canon(a.state)).toBe(canon(b.state));
    expect(canon([...a.events])).toBe(canon([...b.events]));
    expect(a.lastSeq).toBe(b.lastSeq);
  });

  it('branch：分叉线重放前缀 ≡ 母线对应快照；两线独立演进', () => {
    const main = Timeline.fromTxs(initial, makeRegistry(), scriptTxs());

    // 在 rev 2 分叉
    const fork = main.branch(2);
    expect(fork.revision).toBe(2);
    expect(canon(fork.state)).toBe(canon({ gold: 60400, items: 5, rep: {} }));

    // 母线 rev 2 的独立重放与分叉线一致（分叉线重放前缀 ≡ 母线对应快照）
    const snap = Timeline.fromTxs(initial, makeRegistry(), scriptTxs().slice(0, 2));
    expect(canon(fork.state)).toBe(canon(snap.state));

    // 分叉线独立演进（走不同于母线的第 3 笔）
    fork.apply([rep(3, 3, 60)], { basedOn: 2 });
    fork.verifyFold();
    expect(fork.state.rep['faction.grey_wolves']).toBe(60);

    // 母线不受影响
    expect(main.state.rep['faction.grey_wolves']).toBe(-5);
    main.verifyFold();
  });

  it('branch 越界拒绝', () => {
    const tl = Timeline.fromTxs(initial, makeRegistry(), scriptTxs().slice(0, 1));
    expect(() => tl.branch(2)).toThrow(TimelineError);
    expect(() => tl.branch(-1)).toThrow(TimelineError);
  });

  it('checkpoint / restore：快照 + 事务后缀 ≡ 完整重放', () => {
    const full = Timeline.fromTxs(initial, makeRegistry(), scriptTxs());

    // 玩到 rev 2 落快照，继续到 rev 4
    const live = Timeline.fromTxs(initial, makeRegistry(), scriptTxs().slice(0, 2));
    const cp = live.checkpoint();
    expect(cp.revision).toBe(2);
    expect(cp.eventCount).toBe(3);
    live.apply(scriptTxs()[2]!);
    live.apply(scriptTxs()[3]!);
    expect(live.revision).toBe(4);

    // restore：快照 + 后两笔事务 → 与完整重放逐字节一致
    const restored = Timeline.restore(initial, makeRegistry(), cp, scriptTxs().slice(2));
    expect(restored.revision).toBe(4);
    expect(canon(restored.state)).toBe(canon(full.state));

    // 快照是深拷贝：快照后演进不污染快照
    expect(cp.state.gold).toBe(60400);
  });

  it('篡改日志拒绝：seq 跳号 → log-integrity', () => {
    const tampered = scriptTxs();
    (tampered[1]![0] as { seq: number }).seq = 9; // 期望 2，篡改为 9
    try {
      Timeline.fromTxs(initial, makeRegistry(), tampered);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(TimelineError);
      expect((e as TimelineError).code).toBe('log-integrity');
    }
  });

  it('篡改日志拒绝：payload 破坏契约 → schema', () => {
    const tampered = scriptTxs();
    delete (tampered[0]![0] as Partial<{ rarity: unknown }>).rarity; // item.spawned 必填字段
    try {
      Timeline.fromTxs(initial, makeRegistry(), tampered);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(TimelineError);
      expect((e as TimelineError).code).toBe('schema');
    }
  });
});
