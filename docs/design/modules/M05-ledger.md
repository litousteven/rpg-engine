# M05 ledger — 账本

> 对应设计稿：§8.4（批量交易）/ §9（声望好感 membership）/ §11（账本行）。批次：B1。依赖：M01 contract、M04 timeline。被依赖：M06（入袋）、M08（触发器谓词查询）、M11（市场/purse builder，B2）、M12（结算器调用 builders，B2）。
>
> 状态：设计稿 v1.0（2026-10-13），实现前确认稿。

## 1. 数据模型与不变量

账本域覆盖 `ledgers` 分片（inventory / factionRep / npcAffinity）与 `actors.gold/purse`、`world.regions/market` 的账面写入。

| # | 不变量 | 说明 |
|---|---|---|
| L1 | 唯一写路径 | 状态只经 timeline.fold 变更。M05 提供**builders**（生成事件）与**appliers**（fold 写入+校验）两类构件 |
| L2 | 成对一致 | builder 产出的事件必须被对应 applier 接受——参数化测试锁死（防「生成器造出账本不认的账」） |
| L3 | 双身份 | 堆叠：同 `template+rarity` 合并 qty，无 uid；实例：uid 唯一、qty 恒 1、永不合并。qty ≥ 0，负库存被 applier 拒 |
| L4 | 声望/好感域 | rep/affinity ∈ [-100,100]，越界 delta 被 applier 拒（S3/G13） |
| L5 | 交易原子性 | 交易型转移必须双向同事务（§4.5）——复用 M04 原子性：任一侧 builder 预检失败 → 整笔回执，无事件产生 |
| L6 | 批量形态 | 批量 = 多事件单事务：N 个 `item.transferred` + 1 个汇总 `gold.changed`（C4：200 件 = 4 transfer + 1 gold）。`ledger.batch` 事件仅当行数 ≥ 50 时附加为审计摘要（applier no-op） |
| L7 | 两级好感 | base = f(势力声望) 查规则库映射表（阶梯表，P4 规则即数据）；personal 独立累计。membership 变更 → base 重算、personal 保留（G16） |

## 2. 公开接口

```ts
// builders：纯函数（读 state，产出事件或回执；不写状态）
buildItemTransfer(state, cmd: { from, to, ref, qty, price?, source }): Result<GameEvent[], Receipt>
buildGoldChange(state, cmd: { actor, delta, source }): Result<GameEvent[], Receipt>
buildRepChange(state, cmd: { faction, delta, source }): Result<GameEvent[], Receipt>
buildAffinityChange(state, cmd: { npc, delta, source }): Result<GameEvent[], Receipt>
buildMembershipChange(state, cmd: { npc, to, source }): Result<GameEvent[], Receipt>
buildPurseChange(state, cmd: { npc, balance, source }): Result<GameEvent[], Receipt>
buildBatchSell(state, cmd: { seller, merchant, stacks: [{ ref, qty }], unitPrices }): Result<GameEvent[], Receipt>

// appliers：注册进 ApplierRegistry 的账本域 fold 实现（含校验，抛错即整笔回滚）
ledgerAppliers(): 账本域事件注册集
```

**Result 形态**：`{ ok: true, events } | { ok: false, receipt }`——回执带 rule 出处（R1「提交值 vs 规则要求」），M12 直接透传给客户端。

**校验双层**：builder 预检（乐观，产出回执）；applier 兜底（fold 时硬校验，L2 测试保证两层一致）。

## 3. 依赖端口

contract（事件/状态 schema）、timeline（ApplierRegistry）。不依赖 M03（账本无表达式）；不依赖 fs（M07 内容加载属 M07/storage）。

## 4. 事件产出

| 事件 | builder | applier 写入 |
|---|---|---|
| `item.transferred` | ✓ | 双方 inventory 增减（含堆叠合并，L3） |
| `item.destroyed` | ✓（B2 结算用） | owner inventory 扣减 |
| `gold.changed` | ✓ | actors.gold（校验 balance = old + delta，L5） |
| `rep.changed` | ✓ | factionRep（校验 value = old + delta 且域内，L4） |
| `affinity.changed` | ✓ | npcAffinity（value 分解 base+personal 由调用方给） |
| `membership.changed` | ✓ | actors.membership + 内联 affinity base 重算（同事务，L7） |
| `purse.changed` | ✓ | actors.purse（balance 直接落账） |
| `region.control.changed` | B2（M11 经济） | ✓（regions 账本写入，G15） |
| `market.index.changed` | B2（M11 flush） | ✓（market 账本写入，M15 §7 惰性刷新的落账点） |
| `ledger.batch` | ✓（≥50 行时附加） | no-op（审计摘要） |

## 5. 测试与验收

1. **双向原子**（C3）：买锤 = 2 transfer + 2 gold 同事务；purse 不足侧 → 回执 `economy.purse`，无任何事件。
2. **批量**（C4）：4 堆叠 × N 件卖杂货商 → 4 transfer + 1 gold，单事务；purse 扣减联动。
3. **两级好感**（C5）：rep 18→33 时按映射表出 base；membership 变更（C6 队长倒戈）→ base 重算、personal 保留。
4. **域校验**：rep 150 拒；gold 负余额拒；qty 0/负拒。
5. **L2 成对一致性**：所有 builder 正反例参数化过 applier。
6. **B1 收口集成**：`tests/b1-closeout.test.ts`——C1 T0 掉落入袋（见 M06 §5）。

## 6. 开放问题（实现前裁决）

| # | 问题 | 建议 |
|---|---|---|
| O1 | builder 失败返回 Result 还是抛错 | **Result**：回执即 R1 形态，M12/协议零转换；applier 侧照抛（fold 兜底） |
| O2 | 堆叠合并键 | `template+rarity`——具名物是实例天然不参与堆叠（C1 骨头不与普通骨头合并无需 essence 参与） |
| O3 | 好感重算位置 | `buildMembershipChange` **内联**（同事务出 membership.changed + affinity.changed），不依赖 M08 级联时序 |
