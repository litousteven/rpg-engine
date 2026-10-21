# M12 settle — intent 校验与结算器

> 对应设计稿：§4.1（intent 管线）/ §4.5（商业态原子双向转移）/ §12.1 步骤 4–5（校验排序 + 逐 intent 确定性结算）。批次：B2（汇聚点，接口最重）。依赖：contract、M04（timeline）、M05（builders/appliers）、M06（spawn/compose）、M07（verb 注册表/原语）、M08（processTriggers）、M09（I1 锚点）、M11（定价/谈判区间）、M02（rng）。被依赖：M13（步骤 4–6 唯一执行体）、M16（submitIntent seam）。
>
> 状态：设计稿 v1.0（2026-10-15），实现前确认稿。

## 1. 数据模型与不变量

模块拆分稿风险预案：先按「**校验器 / 结算器**」内部两文件起步（`validate.ts` / `execute.ts`），超 2 周再拆 M12a/M12b。

| # | 不变量 | 说明 |
|---|---|---|
| S-1 | 校验五面 | 资源/距离/状态/冷却/legality——每面产出 R1 回执差异（提交值 vs 规则要求），不合并报错 |
| S-2 | I1 菜单锚定 | `verb` 必须命中本回合本决策者 `menu.presented` 的 **visible 条目 verb 闭集**（M09 menuVerbs 产出；条目无 id——O2 联动裁决：锚定 verb 级）——菜单外提交结构上不存在（P3） |
| S-3 | 幂等去重 | `clientKey` 重发不重复结算（I3）——已受理 key 的真相源是**事件日志**（intent.accepted/rejected 携带 clientKey，fold 可重建），运行时 Map 缓存加速（O2 裁决） |
| S-4 | 排序确定 | initiative 定点整数（种子扰动 combat 流）；同分按 intentId 序——重放逐字节一致 |
| S-5 | 结算原子 | 逐 intent 结算为一笔 timeline 事务 + 级联事务（M08 txs 逐级 apply）；任一步失败整笔回滚（M04 原子性复用）——**不存在半结算** |
| S-6 | 回执闭环 | 非法 intent → `intent.rejected` 事件**独立微事务**入日志（R3：重试可审计；不与结算事务混批——拒绝不是结算）；receipt 直接透传 M05 builder 的 Result 形态（零转换，M05 裁决 O1 的收益兑现点） |
| S-7 | 结算确定性 | 效果原语执行注入 rng（combat/loot 流）；掷骰入 rng.rolled 事件（M02 既有模式） |
| S-8 | 微事务通道 | 商业态（mode=commercial）intent 走微事务：校验→结算→apply（revision++）不推进回合（§4.5）；**双导出共享内部**（settleMicro / settle；O4 裁决）——M13 决定调谁（B3 接线，B2 两通道都落） |
| S-9 | 受理即占号 | intentId 在 **validate 通过时分配**（含后续被拒者）；`intent.accepted` 事件推进 meta.intentCounter（O1 裁决：counter 推进走 E1 正路，受理/拒绝/结算三语义各有事件锚） |

## 2. 公开接口

```ts
// ── 校验器（validate.ts） ──────────────────────────────────────
validate(state, ruleset, logView, intent: IntentInput, turn: number): Result<Intent, Receipt>
// 1. I1 菜单锚定（S-2：menuVerbs(logView, actor, turn) 闭集比对）
// 2. clientKey 去重（S-3：受理事件日志重建 + Map 缓存）
// 3. verb 注册表 params 形状校验（per-verb Zod，注册进 M09 VerbSpec.paramsSchemaRef）
// 4. 五面规则校验（S-1）：逐面失败即回执（多面失败合并 reasons[]）
// 5. 通过 → intent.accepted 事件草稿（intentId = int.{counter+1}，S-9）+ Intent

// ── 结算器（execute.ts） ───────────────────────────────────────
// per-verb 结算器注册表（代码常量；B2 最小集见 §2.1）
type VerbExecutor = (s: GameState, ruleset, rng, intent: Intent) => Result<BuildEventDraft[], Receipt>
registerExecutor(verb: Slug, fn: VerbExecutor): void

// 双导出共享内部（S-8；O4 裁决）：校验器/执行器/去重/counter 单源
settleMicro(...): SettleOutcome       // 微事务：单 intent 即批（commercial 模式）
settle(...): SettleOutcome            // 回合级：initiative 排序 + 批结算 + 结算尾 flush 扫描（M11-O3）

interface SettleOutcome {
  txs: GameEvent[][]            // S-5：逐 intent 一笔（intent.accepted + 效果事件）
                               //     + 级联事务（M08 txs 逐级附后）+ flush 事务（M11）
  rejected: GameEvent[]         // intent.rejected 独立微事务事件（S-6）
  receipts: Receipt[]           // 透传给协议/CLI（M05 Result 零转换）
}
```

**B2 verb 结算器最小集**（对齐 M09 verb 集）：

```text
attack   hp.changed / actor.defeated（掷骰 combat 流；M0 互殴主体）
guard    无账面事件（防御态标记 B3 战斗细节；B2 落 hp 减伤结算占位）
buy/sell M05 builders 编排 + M11 定价 + pending 累积（C3/C4 双向原子）
give     M05 buildItemTransfer（source.kind = quest-delivery，C1 T4）
search   M07 物品池掷骰 → M06 buildItemSpawned（C2 路径复用）
craft    M06 buildEntityComposed（C1 T3）
```

## 3. 依赖端口

M09（menuVerbs = I1 锚点）、M05/M06（全部 builders——**结算器只编排不造账**）、M11（appraise/negotiationBand——buy/sell 定价与区间校验）、M08（processTriggers——结算尾级联）、M02（rng）、M04（apply/verifyFold）。验收每模块 builder 正反例参数化进本模块联测（L2 成对一致性的第三层）。

## 4. 事件产出

| 事件 | 说明 |
|---|---|
| `intent.accepted` | **B2 新增事件类型**：受理即占号（S-9；{intentId, actor, verb, clientKey}——applier 推进 intentCounter；clientKey 为 O2 去重锚点） |
| `intent.rejected` | S-6：非法 intent 回执独立微事务入日志（R3） |
| `market.pending.changed` | M11 buildPendingMarketDelta（buy/sell 执行器产出，随结算事务提交） |
| `rng.rolled` | S-7：结算掷骰（attack/search） |
| 效果事件 | **全部经 M05/M06/M11 builders**——本模块不手写 payload（「结算器只编排」：verb → builder 编排 + 事务封装） |
| `turn.settled` | B3 M13 编排事件（B2 不产；maxCascadeDepth 由 M08 结果统计） |

## 5. 测试与验收

1. **I1 结构性**（S-2）：菜单外 verb 提交 → rejected + reasons 含 menu.gate 出处；重放重验一致。
2. **差异回执**（C3 锚点）：超区间报价 → `economy.negotiation_band` + submitted/expected 字面值；等级不足 → `menu.gate`（S-1 两面各自独立报错）。
3. **双向原子**（C3/S-5）：buy = 2 transfer + 2 gold 同事务；purse 不足侧 → 回执且**无任何事件**。
4. **幂等**（S-3）：同 clientKey 重发 → 第二次零结算、零事件。
5. **排序确定**（S-4）：同种子双跑全事件流逐字节相等（B2 收口主断言之一）。
6. **级联受控**（C1 T4 联测）：give 骨头 → 结算事务 + M08 触发 quest_effect 级联事务逐级 apply → verifyFold。
7. **C1 T3 全链**（B2 收口）：骨头在包 → craft 结算 → 骨刃实例 + lineage 三段链 + 材料 destroyed 同事务。
8. **C4 定价驱动**：批量卖 unitPrices = appraise 输出（非手写）→ flush 判定 → 指数下移（M11 联测）。

## 6. 决策状态（2026-10-15 用户裁决）

| # | 问题 | 状态 |
|---|---|---|
| O1 | intentId 分配位置 | **validate 通过时分配 + 新增 `intent.accepted` 事件**（推演修订初判）：受理/拒绝/结算三语义各有事件锚；counter 推进走 E1 正路。初判「rejected 不占号」与契约现状冲突（intent.rejected 的 intentId 必填），废弃 |
| O2 | clientKey 去重的持久面 | **事件日志**（intent.accepted/rejected 携带 clientKey）+ 运行时 Map 缓存——fold/存档加载天然重建；与 O1-A 强联动（受理事件即去重锚点，一次决策两题） |
| O3 | intent.rejected 是否入事务 | **独立微事务**——拒绝与结算 revision 边界清晰；结算回滚不吞拒绝记录；重放 apply no-op |
| O4 | 微事务/回合事务通道合流点 | **双导出共享内部**（settleMicro / settle；校验器/执行器/去重/counter 单源）——mode 判定归编排层（M13 显式调），符合「turn 只编排」边界规则 |
| O5 | guard B2 落多深 | **占位**——guard 受理无效果事件；防御修正 = attack 结算读「目标上回合 guard 受理记录」（EventLogView 查询，零契约变更）；完整战斗数值 B3 M0 互殴调优期落 |
| O6 | 契约演进汇总（B2 全部新事件/字段） | ① 新事件 `intent.accepted`（+intentCounter 推进语义）② 新事件 `market.pending.changed`（M11-O1）③ MenuItem 加 `target?: EntityRef` 可选字段（M09-O2 联动）④ MenuItem.id 转可选（存量协议兼容：菜单位置即键，id 保留为客户端回显）——事件 34→36 类，schema golden + EVENT_TYPES + 完备性测试 + 快照同步走，protoVer 保持 0（草案期） |
