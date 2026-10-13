# M08 trigger — 触发器引擎

> 对应设计稿：§7（条件表达式，硬规则）/ §12.1 步骤 0/5（开局触发器、级联预算、延迟结算）/ §13（worldbook-recall 移植改造：条件、递归、冷却、预算）。批次：B1。依赖：M03（表达式）、M05（账本查询）、M07（触发器定义）、M04（事件提交）。被依赖：M13 回合管线（步骤 0/5 接线，B3）、M14（弧阶段 hook，B2）。
>
> 状态：设计稿 v1.0（2026-10-13），实现前确认稿。

## 1. 数据模型与不变量

| # | 不变量 | 说明 |
|---|---|---|
| T-1 | 触发器是数据 | 规则库 `triggerDefs`（M07 内容包一域）；引擎只消费 |
| T-2 | 唯一条件语言 | `when` 是 M03 表达式（G14 收敛：触发器与菜单门控两侧不漂移）；解析缓存 AST |
| T-3 | 事件订阅 | `on: EventType[]`——订阅哪些事件类型触发评估；全量订阅+条件过滤是内容决策不是机制 |
| T-4 | 级联深度预算 | 深度上限默认 **8**（规则库可配 `cascade.maxDepth`）；超限 → `cascade.budget.hit {depth, abandoned}` + **中止本轮剩余级联**（§12.1 步骤 5） |
| T-5 | 回合触发预算 | 每回合触发总数上限（默认 64，可配）——防雪崩的量维度（G19 深度之外的第二道闸） |
| T-6 | 延迟结算（G19） | 效果可带 `defer: { dueTurn }` → `deferred.scheduled` 入账；到期由**管线步骤 0** 执行 → `deferred.executed` + 实际效果。B1 落队列查询与 builder；执行接线在 B3（M13）——队列数据与到期序是 B1 验收内容 |
| T-7 | 评估纯函数 | when 对当前权威状态求值（M03 evaluate）；谓词上下文只读（S4：队列按 dueTurn 有序，重放同序） |
| T-8 | 冷却 | 触发器可配 `cooldownTurns`：N 回合内不重触发（记入权威状态——重放确定） |
| T-9 | 递归防环 | 同一事务内同一 (triggerId, 起因事件签名) 不二次触发（dsh-tavern 防串场模式的移植） |

## 2. 公开接口

```ts
// 主入口：事件驱动的级联循环（§12.1 步骤 5 的引擎本体）
processTriggers(state, ruleset, incoming: GameEvent[]): TriggerResult
// 循环：incoming → 命中订阅的触发器 → evaluate(when, 谓词上下文) → 冷却检查
//       → 效果原语执行（产出新事件，按级分事务）→ 新事件入队，直到无新事件/超深度/超回合预算
interface TriggerResult {
  txs: GameEvent[][];              // 每级一个事务数组（M13 逐级 timeline.apply）
  budgetHit?: GameEvent;           // cascade.budget.hit（T-4）
  fired: { triggerId: string; atDepth: number }[];  // 审计摘要
}

// 谓词上下文（GameState → M03）：§7 谓词清单的账本索引实现
predicateContext(state, ruleset): PredicateContext
// player_level/faction_rep/npc_affinity/player_owns(tag|template|uid|loreRef)/
// lineage_of/item_delivered(事件日志查询——B1 需要事件流引用，见开放问题 O2)/
// market_index/region_controlled_by/region_contested/quest_stage/arc_stage/scene_tag

// 延迟结算（G19）
dueDeferreds(state, turn): DeferredEffect[]          // 步骤 0 查询（按 dueTurn 有序）
buildDeferredScheduled(effect, dueTurn, source): GameEvent
buildDeferredExecuted(due, executedAtTurn): GameEvent
```

## 3. 依赖端口

M03（parse/evaluate）、M05（账本查询）、M07（triggerDefs/原语目录）、M02（原语执行注入 Rng）。

## 4. 事件产出

`trigger.fired`（含 matchedExpr 溯源）、`cascade.budget.hit`、`deferred.scheduled`、`deferred.executed`（B3 接线）；效果事件由原语产出（归属调用方域——M12 的 hp/gold、M05 的 rep 等）。

## 5. 测试与验收

1. **C1 T4 联测**：`item.transferred{kind: quest-delivery}` 事件 → 订阅触发器评估 `item_delivered(npc: elder_yun, tag: bone_of_bone_maw)` → 效果原语产出任务事件。
2. **级联**：A 触发 B、B 触发 C——事务逐级、深度推进正确；8 层上限超限 → budgetHit + 中止。
3. **冷却**：同触发器 N 回合内二连事件只触发一次。
4. **重放确定**：级联产出的全事件流，同输入双跑逐字节相等（P7 引擎级）。
5. **谓词上下文**：C5 faction_rep（账本直查）、C2 loreRef 反向激活（player_owns）。
6. **B1 收口**（`tests/b1-closeout.test.ts`）：
   ```text
   M07 掉落表（骨头 named）→ M02 掷骰（chance 判定 + roll 事件）
   → M06 buildItemSpawned（uid/essence/lineage/provenance 焊入）
   → timeline.apply（M05 账本 fold：实例入袋）
   → M08 predicateContext(player_owns(tag)) 求值为真
   → verifyFold + 重放后求值仍真
   ```

## 6. 开放问题（实现前裁决）

| # | 问题 | 建议 |
|---|---|---|
| O1 | 评估时机：事件后即时级联 vs 回合末批处理 | **即时级联**（结算步内逐级事务）——§12.1 步骤 5 的字面语义；回合末批处理会改变事件序（重放语义复杂化） |
| O2 | `item_delivered` 是事件谓词——需要事件日志查询，但 M08 的 processTriggers 只拿 state | 谓词上下文签名升级为 `(state, eventLogView)`：注入**只读事件流视图**（按 source.kind 索引的投影，M05 审计层建的索引）——B1 先做线性扫描版（存档小），索引优化 B2 |
| O3 | budgetHit 丢弃的效果要不要记明细 | **只记计数**（`cascade.budget.hit.abandoned`）——明细太吵；真需要审计时事件日志已含未触发侧的 fired 缺席 |
| O4 | 延迟队列执行是否也要过级联（deferred 触发新级联） | **要**：步骤 0 执行的 deferred 效果事件同样入 processTriggers——统一路径，G19 传导链才能滚雪球（改朝换代全流程依赖此语义） |
