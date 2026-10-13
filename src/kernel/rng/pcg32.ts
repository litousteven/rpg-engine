// M02 rng — PCG32 核心（O'Neill 2014，XSH-RR 64→32 输出）
//
// u64 状态用 {hi, lo} 两个 u32 表示（不用 BigInt：JSON 兼容 + 序列化稳定）。
// 乘法 64 位进位用 16 位分块实现，全部中间值 < 2^53（double 精确域）。
//
// 不变量（M02-rng.md §1）：
//   I1 同 (seed, stream) 序列唯一确定（重放等价落点）
//   I2 流间隔离：流状态独立派生，互不推进
//   I3 状态可序列化（{hi,lo} ↔ 16 位十六进制串，contract rng.rolled.stateBefore 形态）

const MULTIPLIER_HI = 0x5851f42d;
const MULTIPLIER_LO = 0x4c957f2d;

/** (a * b) mod 2^32（a, b 为 u32；16 位分块保证精确） */
function mul32mod(a: number, b: number): number {
  const a0 = a & 0xffff;
  const a1 = a >>> 16;
  const b0 = b & 0xffff;
  const b1 = b >>> 16;
  const p = a0 * b0; // < 2^32
  const q = a0 * b1 + a1 * b0; // < 2^33
  return (p + (q & 0xffff) * 0x10000) >>> 0;
}

/** u64 乘法分块：返回 (a * b) mod 2^64，输入输出都是 {hi,lo}（全为无符号 32 位）。
 *  product mod 2^64 = a.lo*b.lo + (a.hi*b.lo + a.lo*b.hi)*2^32（a.hi*b.hi*2^64 丢弃） */
function mul64(
  a: { hi: number; lo: number },
  b: { hi: number; lo: number },
): { hi: number; lo: number } {
  // a.lo * b.lo 的 64 位积（16 位分块）
  const a0 = a.lo & 0xffff;
  const a1 = a.lo >>> 16;
  const b0 = b.lo & 0xffff;
  const b1 = b.lo >>> 16;
  const p = a0 * b0; // < 2^32
  const q = a0 * b1 + a1 * b0; // < 2^33
  const r = a1 * b1; // < 2^32
  const lowSum = p + (q & 0xffff) * 0x10000; // < 2^33
  const lo = lowSum >>> 0; // mod 2^32（>>>0 对 < 2^53 精确）
  const carry = Math.floor(lowSum / 0x100000000); // 0 或 1
  // 两个交叉项各取 mod 2^32（直接乘会超 2^53 丢精度 → 16 位分块）
  const hi =
    (r + Math.floor(q / 0x10000) + carry + mul32mod(a.hi, b.lo) + mul32mod(a.lo, b.hi)) >>> 0;
  return { hi, lo };
}

/** u64 加法（mod 2^64） */
function add64(
  a: { hi: number; lo: number },
  b: { hi: number; lo: number },
): { hi: number; lo: number } {
  const lowSum = a.lo + b.lo; // < 2^33
  const lo = lowSum >>> 0;
  const hi = (a.hi + b.hi + Math.floor(lowSum / 0x100000000)) >>> 0;
  return { hi, lo };
}

export interface U64 {
  hi: number;
  lo: number;
}

export class Pcg32 {
  #state: U64;
  readonly #inc: U64;

  /** 官方播种：state=0 → advance → state += initstate → advance */
  constructor(initstate: number, initseq: number) {
    const inc = { hi: (initseq >>> 31) & 1, lo: ((initseq << 1) | 1) >>> 0 };
    this.#inc = inc;
    this.#state = { hi: 0, lo: 0 };
    this.advance(); // state = 0*M + inc
    this.#state = add64(this.#state, { hi: 0, lo: initstate >>> 0 });
    this.advance();
  }

  private advance(): U64 {
    const old = this.#state;
    this.#state = add64(mul64(old, { hi: MULTIPLIER_HI, lo: MULTIPLIER_LO }), this.#inc);
    return old;
  }

  /** 基础输出：XSH-RR（rot 与 xorshift 均在 u64 上推导，输出 u32） */
  nextU32(): number {
    const old = this.advance();
    // xorshifted = ((old >> 18) ^ old) >> 27，取低 32 位
    // 注意：^ 返回有符号 int32 → 必须 >>>0 归一化，否则后续 % 运算取到负余数
    const t = u64shr(old, 18);
    const s: U64 = { hi: (t.hi ^ old.hi) >>> 0, lo: (t.lo ^ old.lo) >>> 0 };
    const xorshifted = ((s.lo >>> 27) | ((s.hi % 0x8000000) * 0x20)) >>> 0;
    // rot = old >> 59（u64 高位低 5 位）
    const rot = old.hi >>> 27;
    // 循环右移 rot
    return ((xorshifted >>> rot) | (xorshifted << ((32 - rot) % 32))) >>> 0;
  }

  get state(): U64 {
    return { ...this.#state };
  }

  restore(state: U64): void {
    this.#state = { ...state };
  }
}

/** u64 逻辑右移（shift ∈ [0,64)），返回 {hi,lo} */
function u64shr(v: U64, shift: number): U64 {
  if (shift === 0) return { ...v };
  if (shift >= 32) {
    return { hi: 0, lo: v.hi >>> (shift - 32) };
  }
  // value = hi*2^32 + lo → 低 32 位 = (hi mod 2^shift)*2^(32-shift) + (lo >>> shift)
  const lo = ((v.hi % 2 ** shift) * 2 ** (32 - shift) + (v.lo >>> shift)) >>> 0;
  return { hi: v.hi >>> shift, lo };
}

export const toHex = (s: U64): string =>
  s.hi.toString(16).padStart(8, '0') + s.lo.toString(16).padStart(8, '0');

export const fromHex = (hex: string): U64 => ({
  hi: Number.parseInt(hex.slice(0, 8), 16),
  lo: Number.parseInt(hex.slice(8, 16), 16),
});
