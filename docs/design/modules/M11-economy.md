# M11 economy — 定价引擎与市场状态账本

> 对应设计稿：§8（经济子系统：8.1 定价 / 8.2 purse / 8.3 市场账本 / 8.4 批量）/ §4.5（谈判区间）。批次：B2。依赖：contract、M05（purse/inventory builder、pending 累积器 applier）、M07（pricing 域——B1 占位，本模块落地）。被依赖：M09（商业菜单条目 context.price）、M12（结算调定价 + 谈判区间校验）、M19（倾销压价分布）。
>
> 状态：设计稿 v1.0（2026-10-15），实现前确认稿。

## 1. 数据模型与不变量

| # | 不变量 | 说明 |
|---|---|---|
| E-1 | 定价纯函数 | `price = f(base, rarity, essence, 市场因子, 画像)`——输入全结构化，同输入同输出（P7）；版本化随规则库（pricing 域，B1 已占位 schema） |
| E-2 | 全链定点 | 系数/溢价/指数一律定点 ×10⁴（C1 T2 示例 376 系整数域；rarity 分档 白1×/绿2×/蓝4× 即 10000/20000/40000） |
| E-3 | pending 显式入账 | 供需增量随转移事务同事务产出 **`market.pending.changed`** 事件（{category, region, supply, demand}；applier 累积进 pendingSupply/pendingDemand）——E1 对 pending 显式成立，审计可直读哪笔交易动了哪个市场。达量阈值或回合边界才 flush 为 index（S6；M15 §7）——flush 产出 `market.index.changed`（仅 flush 点发，C4） |
| E-4 | 指数下界 | index ≥ 下限（默认 2000 = 0.2×，规则库可配）——倾销压价边际递减但不归零（防通胀阀门的对偶面） |
| E-5 | purse 拟态 | purse 有上限、按周期恢复（回合边界 +refreshRate，规则库数据）；收购扣减，不足 → M09 条目 locked（§8.2 的门控表达） |
| E-6 | 谈判区间引擎定 | `[price×0.8, price×1.2]`（画像可调幅）；超区间提交被 M12 校验拒并回执 `economy.negotiation_band`（C1 T2/C3 锚点；报价上限引擎计算，L2 只能在区间内决策） |
| E-7 | 定价因子可审计 | 估价返回分解明细（base/rarity/essence/market/portrait 各因子值）——R1 回执与平衡统计（M19）共用 |

## 2. 公开接口

```ts
// ── 定价（E-1/E-7） ───────────────────────────────────────────
interface PriceBreakdown {
  base: number            // 模板基础价（定点）
  rarityFactor: number   // 定点系数
  essenceFactor: number  // 溢价系数（essence 数量 × 单价表）
  marketFactor: number   // 指数/10000（读 §8.3 账本）
  portraitFactor: number // 画像修正（贪婪度偏置）
  price: number          // 合成基准价（全整数运算）
}
appraise(state, ruleset, cmd: { item: EntityRef, merchant?: ActorId }): PriceBreakdown
// 卖出价 = price × 折价系数；买入价 = price × 溢价系数（系数 = 画像 × 固定表）

// 谈判区间（E-6；C1 T2：120 × 1.8 × 1.7 × 0.9 ≈ 376 的整数化）
negotiationBand(state, ruleset, cmd): { low: number, high: number }

// ── 市场账本（E-3/E-4） ────────────────────────────────────────
// 微事务路径：pending 增量显式入账（O1 裁决——E1 显式成立）
buildPendingMarketDelta(state, cmd: { category, region, supply?, demand? }): BuildEventDraft[]
// 产出 market.pending.changed 事件草稿（随转移事务同事务提交）

// flush 判定与执行（管线步骤 0 / 阈值即时触发；M13 B3 接线）
shouldFlush(entry: MarketEntry, ruleset): boolean
buildFlush(state, cmd: { category, region }): Result<market.index.changed 事件草稿>
// index 新值 = clamp(index × 漂移公式(pending), E-4 下限)；重放确定

// ── purse（E-5） ───────────────────────────────────────────────
// 扣减/恢复走 M05 buildPurseChange；本模块提供刷新逻辑（回合边界，M13 接线）
buildPurseRefresh(state, ruleset): BuildEventDraft[]   // 全商人 purse → min(purse + rate, cap)
```

**pricing 域 schema（B1 占位 → B2 落地）**：`{ domain: 'pricing', factors: { rarity: Record<Rarity, 定点系数>, essencePrice: Record<Slug, 定点溢价>, flush: { threshold, indexFloor, driftBaseline } } }` + `VERSION.json` 增 pricing 域。

## 3. 依赖端口

M05（purse/gold/inventory builder + pending 字段 applier）、M07（pricing 域内容 + 模板 basePrice）、contract（MarketEntry）。**不依赖 M12**（定价先于结算被调用）；不依赖 LLM（P1 正面压力测试：C4 全程无 LLM）。

## 4. 事件产出

| 事件 | builder | 说明 |
|---|---|---|
| `market.pending.changed` | buildPendingMarketDelta | **B2 新增事件类型**（35 类 → 36）；随转移事务同事务提交，applier 累积 pending 字段 |
| `market.index.changed` | buildFlush | 仅 flush 点（E-3；applier B1 已落账） |
| `purse.changed` | buildPurseRefresh（+M05 已有收购扣减） | 回合边界恢复（E-5） |

## 5. 测试与验收

1. **定价纯函数**（C1 T2 锚点）：骨头 120 × rare(18000) × essence(+7000) × 市场(9000) → 整数化 ≈ 376 × FIXED_SCALE；分解明细七因子全可审计（E-7）。
2. **倾销压价涌现**（C4）：卖 80 破剑 → pending +80 → flush → 金属指数下移 → 后续收购价下降——重放同结果（P7）。
3. **惰性刷新**：买 5 件不 flush（pending 静默累积）；+80 供给达阈值同事务 flush（E-3 两面）。
4. **指数下界**：极端倾销 index 钳在 2000（E-4）。
5. **谈判区间**（C1 T2/C3）：超 high 提交 → 回执 `economy.negotiation_band`（与 M12 联测）。
6. **purse**（C3）：铁匠 800 收购 300 → 500；不足 → 卖出菜单 locked + hint（M09 联测）；回合边界恢复。
7. **B2 收口**：C4 批量 580 金 ← 定价驱动（unitPrices 来自 appraise 而非测试手写）。

## 6. 决策状态（2026-10-15 用户裁决）

| # | 问题 | 状态 |
|---|---|---|
| O1 | pending 写入是否开新事件类型 | **开 `market.pending.changed`**（推演修订初判）：转移事件 payload 无 category/region，「fold 还原 pending」推导不成立；开事件是 E1 唯一显式成立的路，审计直读。契约 34→35 类，草案期一次付清 |
| O2 | 买卖系数放哪 | **公式代码 + 数值 content**（pricing 域落地，B1 M07-O1 承诺兑现）——平衡调参走 content diff 可审 |
| O3 | flush 阈值即时判定位置 | **M12 结算尾部扫 pending**（结算必经路径，B2 可独立验收）+ M13 步骤 0 兜底——shouldFlush 单源两处调用 |
| O4 | essence 溢价公式 | **加法合并**（因子内 Σ、因子间 Π）：essenceFactor = 1.0 + Σ标签溢价——C1 T2 文档口径（+0.7 = 0.4+0.3），夹具锚定成立；多标签堆叠由原语目录收录范围控制（§5.2 旋钮 1） |

**F1 联动（M09-O2 裁决的稀有度模板化）**：rarity 成为模板属性（templates content 域声明）——pricing 域的 rarity 系数表按模板品阶直读；`loot.json` 条目的 `rarity` 字段降级为可选冗余（M21 校验对齐「条目 rarity ≡ 模板品阶」告警，不参与堆叠语义）。
