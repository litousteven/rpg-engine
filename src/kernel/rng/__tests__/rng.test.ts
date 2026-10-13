// M02 验收（M02-rng.md §5）：
//   参考向量（BigInt 参考实现交叉验证）/ 同种子确定性 / 流隔离 / restore 往返 /
//   roll 域与均匀性冒烟 / chance 定点判定
import { describe, expect, it } from 'vitest';
import { createRng } from '../index.js';
import { Pcg32, toHex, fromHex } from '../pcg32.js';

// ── BigInt 参考实现（PCG32 官方算法的精确 64 位形态，作为对照权威） ──

const M = 6364136223846793005n;
const MASK = (2n ** 64n) - 1n;

function* reference(seed: number, initseq: number): Generator<number> {
  let state = 0n;
  const inc = ((BigInt(initseq) << 1n) | 1n) & MASK;
  const step = () => {
    const old = state;
    state = (old * M + inc) & MASK;
    return old;
  };
  const output = (old: bigint) => {
    const xorshifted = Number((((old >> 18n) ^ old) >> 27n) & 0xffffffffn);
    const rot = Number(old >> 59n);
    return Number(
      ((BigInt(xorshifted) >> BigInt(rot)) | (BigInt(xorshifted) << BigInt((-rot) & 31))) &
        0xffffffffn,
    );
  };
  step(); // state = 0*M + inc
  state = (state + BigInt(seed)) & MASK;
  step();
  while (true) {
    yield output(step());
  }
}

describe('M02 PCG32 — 参考向量（BigInt 交叉验证）', () => {
  const cases: [seed: number, seq: number][] = [
    [0, 1], [0, 2], [0, 3], [1, 1], [42, 1], [42, 2], [42, 3],
    [123456789, 1], [0xffffffff, 3], [7919, 2],
  ];

  it.each(cases)('seed=%i initseq=%i：前 1000 个输出与参考实现一致', (seed, seq) => {
    const ref = reference(seed, seq);
    const pcg = new Pcg32(seed, seq);
    for (let i = 0; i < 1000; i++) {
      expect(pcg.nextU32()).toBe(ref.next().value!);
    }
  });
});

describe('M02 分流 RNG', () => {
  it('I1 同 (seed, stream) 序列唯一确定', () => {
    const a = createRng(42, 'loot');
    const b = createRng(42, 'loot');
    expect(a.rollN(20, 50)).toEqual(b.rollN(20, 50));
    expect(a.stateHex()).toBe(b.stateHex());
  });

  it('I2 流间隔离：world 掷骰不推进 combat 流', () => {
    const world = createRng(7, 'world');
    const combatA = createRng(7, 'combat');
    const combatB = createRng(7, 'combat');
    world.rollN(100, 100); // world 大量消耗
    expect(combatA.rollN(20, 20)).toEqual(combatB.rollN(20, 20)); // combat 不受影响
    // world 自身序列继续一致：同消耗量的新实例与旧实例同步
    const worldC = createRng(7, 'world');
    worldC.rollN(100, 100);
    expect(world.roll(1000)).toBe(worldC.roll(1000));
  });

  it('I3 state()/restore() 往返：恢复后序列与不间断一致', () => {
    const a = createRng(99, 'combat');
    a.rollN(6, 10);
    const saved = a.state();
    const hex = a.stateHex();
    const expected = a.rollN(6, 10);
    const b = createRng(99, 'combat');
    b.rollN(6, 10);
    b.restore(saved);
    expect(b.rollN(6, 10)).toEqual(expected);
    b.restoreHex(hex);
    expect(b.rollN(6, 10)).toEqual(expected);
  });

  it('toHex/fromHex 往返', () => {
    const s = { hi: 0xdeadbeef, lo: 0x12345678 };
    expect(fromHex(toHex(s))).toEqual(s);
    expect(toHex(s)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('roll 域：1..sides 含端点；sides 非法抛错', () => {
    const rng = createRng(5, 'world');
    for (let i = 0; i < 1000; i++) {
      const v = rng.roll(6);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
    }
    expect(() => rng.roll(0)).toThrow();
    expect(() => rng.roll(1.5)).toThrow();
  });

  it('nextU32 域：[0, 2^32) 无 NaN/负数', () => {
    const rng = createRng(5, 'world');
    for (let i = 0; i < 5000; i++) {
      const v = rng.nextU32();
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(2 ** 32);
    }
  });

  it('均匀性冒烟：10⁴ 次 d6 各面频率 1/6 ± 5%（防系统性偏置，不做统计断言库）', () => {
    const rng = createRng(2026, 'combat');
    const n = 10_000;
    const freq = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < n; i++) freq[rng.roll(6) - 1]!++;
    for (const f of freq) {
      expect(f / n).toBeGreaterThan(1 / 6 - 0.05);
      expect(f / n).toBeLessThan(1 / 6 + 0.05);
    }
  });

  it('chance 定点：1/2 约半、0 必假、den/den 必真', () => {
    const rng = createRng(31, 'world');
    let hits = 0;
    for (let i = 0; i < 2000; i++) if (rng.chance(1, 2)) hits++;
    expect(hits).toBeGreaterThan(800);
    expect(hits).toBeLessThan(1200);
    expect(rng.chance(0, 3)).toBe(false);
    expect(rng.chance(3, 3)).toBe(true);
    expect(() => rng.chance(4, 3)).toThrow();
  });
});
