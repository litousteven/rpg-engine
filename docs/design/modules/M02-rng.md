# M02 rng — PCG32 种子随机

> 对应设计稿：§14-1（掷骰入日志）。批次：B0。依赖：contract。被依赖：M06 掉落、M12 结算、M08 触发器。

## 1. 数据模型与不变量

- PCG32（O'Neill 2014）：62 位 LCG 状态 + XSH-RR 输出函数；自实现 ~40 行，零依赖。
- **分流**：`world / combat / loot` 三个独立流（RngStreamSchema）；每流独立 64 位状态。
  - I1 同一 (seed, stream) 序列唯一确定——重放等价的落点；
  - I2 流间隔离：combat 掷骰不推进 world 流（战斗顺序不影响世界事件判定，P7 的工程形态）；
  - I3 流状态可序列化（u64 用两个 u32 扰码序存，避免 JS number 精度丢失——**不用 BigInt**，保持 JSON 数字兼容）。
- 每次掷骰产出 `rng.rolled` 事件：`stateBefore`（十六进制串）、`rolls[]`——入 timeline 日志。

## 2. 公开接口

```ts
createRng(seed: u32, stream: RngStream): Rng           // 流状态由 seed 派生（确定性分流）
interface Rng {
  nextU32(): number                                     // 基础输出 [0, 2^32)
  roll(sides: number): number                           // 1..sides（含端点）
  rollN(sides: number, count: number): number[]         // 批量（一次事件多条结果）
  chance(p: number): boolean                            // p ∈ [0,1]；定点用分子分母？见 §6
  state(): { hi: number; lo: number }                   // 可序列化状态（I3）
  restore(state: { hi: number; lo: number }): void
}
```

## 3. 依赖端口

contract 的 RngStreamSchema / `rng.rolled` 事件形态。kernel 纯函数（无 IO）。

## 4. 事件产出

`rng.rolled { stream, stateBefore, rolls }`——由调用方（M12/M06）组装并随事务提交；M02 本身不写日志（纯计算）。

## 5. 测试与验收

1. **参考向量**：固定 seed 的前 N 个输出与已知 PCG32 测试向量比对（melody/oracle 交叉实现自算 + 手工锚定首值）。
2. 同 seed 双流实例序列逐字节相等；不同 seed 必不同。
3. 流隔离：world.next() 不改变 combat 流序列。
4. roll 均匀性冒烟（10⁴ 次频率分布 ±5%——不做统计断言库，只防系统性偏置）。
5. state()/restore 往返：恢复后序列与不间断一致。
6. u32 全域取值无 NaN/负数/超界。

## 6. 开放问题

| # | 问题 | 建议 |
|---|---|---|
| O1 | `chance(p)` 的 p 用浮点还是定点分子/分母 | 定点：`chanceNum/chanceDen`（如 1/3 = {1,3}）——全链禁浮点的推论。**按建议实现**（首项数据） |
| O2 | u64 状态存 {hi, lo} 还是十六进制串 | 事件里是十六进制串（contract 定死）；内存 {hi,lo}。转换函数在 M02 内 |
