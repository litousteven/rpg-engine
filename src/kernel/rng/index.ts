// M02 rng — 分流 RNG（M02-rng.md §2 公开接口）
//
// 三个独立流由同一 seed 派生（initseq 常量区分）——I2 流间隔离。
// 本模块纯计算，不写日志；rng.rolled 事件由调用方组装（M02-rng.md §4）。
import type { RngStream } from '../../contract/index.js';
import { Pcg32, fromHex, toHex } from './pcg32.js';
import type { U64 } from './pcg32.js';

const STREAM_SEQ: Record<RngStream, number> = {
  world: 1,
  combat: 2,
  loot: 3,
};

export interface Rng {
  readonly stream: RngStream;
  /** 基础输出 [0, 2^32) */
  nextU32(): number;
  /** 1..sides（含端点；floor(u32/2^32 * sides)+1，无模偏置） */
  roll(sides: number): number;
  /** 批量掷骰（一次 rng.rolled 事件的多条结果） */
  rollN(sides: number, count: number): number[];
  /** 概率判定：num/den（定点分子/分母，M02 决策 O1——全链禁浮点） */
  chance(num: number, den: number): boolean;
  /** 可序列化状态（I3；hex 形态即 contract rng.rolled.stateBefore） */
  stateHex(): string;
  restoreHex(hex: string): void;
  state(): U64;
  restore(state: U64): void;
}

export function createRng(seed: number, stream: RngStream): Rng {
  const pcg = new Pcg32(seed >>> 0, STREAM_SEQ[stream]);
  const rng: Rng = {
    stream,
    nextU32: () => pcg.nextU32(),
    roll: (sides) => {
      if (!Number.isInteger(sides) || sides < 1 || sides > 2 ** 31) {
        throw new Error(`roll sides 非法：${sides}`);
      }
      return Math.floor((pcg.nextU32() / 2 ** 32) * sides) + 1;
    },
    rollN: (sides, count) => {
      if (!Number.isInteger(count) || count < 1 || count > 512) {
        throw new Error(`rollN count 非法：${count}`);
      }
      return Array.from({ length: count }, () => rng.roll(sides));
    },
    chance: (num, den) => {
      if (!Number.isInteger(num) || !Number.isInteger(den) || num < 0 || den < 1 || num > den) {
        throw new Error(`chance 分子分母非法：${num}/${den}`);
      }
      // u32/2^32 为 double 精确值；* den 与比较确定性
      return Math.floor((pcg.nextU32() / 2 ** 32) * den) < num;
    },
    stateHex: () => toHex(pcg.state),
    restoreHex: (hex) => {
      if (!/^[0-9a-f]{16}$/.test(hex)) throw new Error(`状态十六进制串非法：${hex}`);
      pcg.restore(fromHex(hex));
    },
    state: () => pcg.state,
    restore: (state) => {
      if (!Number.isInteger(state.hi) || !Number.isInteger(state.lo)) {
        throw new Error('状态必须为整数 {hi, lo}');
      }
      pcg.restore({ hi: state.hi >>> 0, lo: state.lo >>> 0 });
    },
  };
  return rng;
}

export { toHex, fromHex };
export type { U64 };
