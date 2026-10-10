// M01 §10 验收：事件判别联合完备性 + Case 夹具合法性 + strict 拒未知字段 + JSON 往返稳定。
import { describe, expect, it } from 'vitest';
import { EVENT_TYPES, GameEventSchema } from '../events.js';
import { VALID_EVENT_FIXTURES } from './fixtures.js';

/** 负例测试用：宽松取夹具（合法样本本身已在上面的正例中强类型校验过） */
const f = (k: string): Record<string, unknown> => VALID_EVENT_FIXTURES[k]!;

describe('GameEvent 判别联合（E4：payload 由 t 唯一决定）', () => {
  it('EVENT_TYPES 与判别联合一一对应（34 类）', () => {
    expect(EVENT_TYPES).toHaveLength(34);
    expect(Object.keys(VALID_EVENT_FIXTURES).sort()).toEqual([...EVENT_TYPES].sort());
  });

  it('每类事件的有效夹具全部通过校验', () => {
    for (const [kind, fixture] of Object.entries(VALID_EVENT_FIXTURES)) {
      const r = GameEventSchema.safeParse(fixture);
      if (!r.success) {
        throw new Error(`${kind} 夹具校验失败: ${JSON.stringify(r.error.issues)}`);
      }
      expect(r.data.t).toBe(kind);
    }
  });

  it('夹具 JSON 往返逐字节稳定（E3 序列化确定性）', () => {
    for (const fixture of Object.values(VALID_EVENT_FIXTURES)) {
      const round = JSON.parse(JSON.stringify(fixture));
      expect(GameEventSchema.parse(round)).toEqual(fixture);
      expect(JSON.stringify(round)).toBe(JSON.stringify(fixture));
    }
  });

  it('strict：未知字段被拒（E4）', () => {
    const bad = { ...f('turn.began'), extra: 'oops' };
    expect(GameEventSchema.safeParse(bad).success).toBe(false);
  });

  it('未知事件类型被拒（O3 方案 B：不设动词级类型，item.bought 不存在）', () => {
    const bad = { ...f('item.transferred'), t: 'item.bought' };
    expect(GameEventSchema.safeParse(bad).success).toBe(false);
  });
});

describe('事件字段硬约束（逐条对齐设计稿不变量）', () => {
  it('rep.changed value 超 [-100,100] 被拒（S3/G13）', () => {
    const bad = { ...f('rep.changed'), value: 150 };
    expect(GameEventSchema.safeParse(bad).success).toBe(false);
  });

  it('item.transferred 缺 source 归因被拒（O3：凭证必填）', () => {
    const bad = { ...f('item.transferred') };
    delete bad['source'];
    expect(GameEventSchema.safeParse(bad).success).toBe(false);
  });

  it('item.spawned uid 格式错误被拒（item.inst.NNNNNN）', () => {
    const bad = { ...f('item.spawned'), uid: 'item.317' };
    expect(GameEventSchema.safeParse(bad).success).toBe(false);
  });

  it('gold.changed 负余额被拒（§4.5：purse 不足则交易回滚）', () => {
    const bad = { ...f('gold.changed'), balance: -1 };
    expect(GameEventSchema.safeParse(bad).success).toBe(false);
  });

  it('market.index.changed 浮点指数被拒（定点 ×10⁴，决策 O1）', () => {
    const bad = { ...f('market.index.changed'), index: 1.1875 };
    expect(GameEventSchema.safeParse(bad).success).toBe(false);
  });

  it('intent.rejected 空 reasons 被拒（R1：至少一条且含差异）', () => {
    const receipt = f('intent.rejected')['receipt'] as Record<string, unknown>;
    const bad = { ...f('intent.rejected'), receipt: { ...receipt, reasons: [] } };
    expect(GameEventSchema.safeParse(bad).success).toBe(false);
  });

  it('rng.rolled 空掷骰数组被拒（掷骰必须留痕，§14-1）', () => {
    const bad = { ...f('rng.rolled'), rolls: [] };
    expect(GameEventSchema.safeParse(bad).success).toBe(false);
  });

  it('rng.rolled 非十六进制状态串被拒', () => {
    const bad = { ...f('rng.rolled'), stateBefore: 'zz-not-hex' };
    expect(GameEventSchema.safeParse(bad).success).toBe(false);
  });

  it('menu.presented 内 locked 条目缺 hint 被拒（不变量 M2）', () => {
    const menu = f('menu.presented')['menu'] as Record<string, unknown>;
    const bad = {
      ...f('menu.presented'),
      menu: {
        ...menu,
        items: [{ id: 'hire.elite', verb: 'hire', label: '雇佣精锐', state: 'locked', origin: 'base' }],
      },
    };
    expect(GameEventSchema.safeParse(bad).success).toBe(false);
  });

  it('信封字段：seq/turn/revision 必须为非负整数（§4.1）', () => {
    const bad = { ...f('turn.began'), seq: -1 };
    expect(GameEventSchema.safeParse(bad).success).toBe(false);
    const bad2 = { ...f('turn.began'), revision: 1.5 };
    expect(GameEventSchema.safeParse(bad2).success).toBe(false);
  });
});
