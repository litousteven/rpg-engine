# M15 protocol — 消息协议与传输

> 对应：技术选型稿 §3（进程拓扑）/ §6（协议形态）；设计稿 §2（权限矩阵）、§12.2（revision 门控）。批次：B3（schema 骨架随 B0 的 M01 先行起草）。依赖：M01 contract。被依赖：M16 api（同进程）、server/stdio/WS、CLI、Web 调试台、Godot 客户端。
>
> 状态：详细设计稿 v1.0（2026-10-09），实现前确认稿。**protoVer = 0（草案期），M0 收口时冻结为 v1。**

## 1. 目标与边界

协议是引擎对外的唯一 surface：CLI、Web 调试台、Godot、测试、模拟器全部经它对话。设计目标按优先级：

1. **同一消息集 × 三种传输**（同进程 TS 调用 / stdio / WebSocket）——行为测试跨同一 seam（§13）。
2. **客户端无特权**：协议能力 = §2 权限矩阵的「玩家行」——读投影 + 写 intent，别无他物（P2/P3 的协议化）。
3. **事件流驱动**：客户端状态 = `fold(收到的事件)`，断线重连 = `query.events(sinceSeq)` 补齐（§12.2 revision 门控的客户端形态）。
4. 骨架先行：M0 只需命令/事件各一个子集；本文标注各消息的启用批次。

## 2. 帧信封（传输无关）

三种帧，NDJSON 每帧一行（stdio）或一帧一消息（WS）：

```jsonc
// 请求（客户端 → 引擎）
{ "protoVer": 0, "id": 7, "method": "turn.submitIntent", "params": { ... } }
// 响应（引擎 → 客户端，与请求 id 配对）
{ "id": 7, "ok": true, "result": { ... } }
{ "id": 7, "ok": false, "error": { "code": "E_REJECTED", "message": "...", "data": { receipt } } }
// 事件（引擎 → 客户端，单向推送）
{ "protoVer": 0, "event": "turn.settled", "seq": 341, "data": { ... } }
```

规则：F1 `id` 客户端自增、引擎原样回填（无需全局唯一）；F2 事件帧不带 id；F3 `protoVer` 不匹配返回 `E_PROTO_VERSION` 后由客户端决定断开或降级；F4 未知字段**保留不报错**（前向兼容），未知 `method`/`event` 返回 `E_UNKNOWN`（后向兼容探测）。

## 3. 命令集目录

### 3.1 会话与存档（B3 / M0）

| method | params | result | 说明 |
|---|---|---|---|
| `session.new` | `{ seed?, scenarioId? }` | `{ sessionId, turn: 0, revision: 0 }` | seed 缺省=1（测试友好） |
| `session.load` | `{ slot }` | `{ sessionId, turn, revision, seq }` | 校验 `fold ≡ snapshot`（加载即重放校验） |
| `save.list` | — | `{ slots: [ { slot, turn, revision, ts } ] }` | ts 为文件层元数据，不入权威状态 |
| `save.snapshot` | `{ slot }` | `{ turn, revision, seq }` | 显式存档（触发 checkpoint） |
| `save.branch` | `{ fromSlot, toSlot }` | `{ ... }` | 从任意存档分叉（M0「可分支」验收的协议入口） |

### 3.2 回合与意图（B3 / M0）

| method | params | result / 事件 | 说明 |
|---|---|---|---|
| `turn.submitIntent` | `{ intent }`（M01 §3 形态） | 见 §5 关键决策 | 玩家行动唯一入口 |
| `turn.end` | — | 触发管线推进 | 见 §7 回合边界 |
| `query.menu` | `{ actor? }` | `{ mode, items[] }`（投影：无 hidden） | 主动拉取菜单（推送见事件） |
| `turn.state` | — | `{ phase, pendingDecisions[] }` | 当前管线阶段与待决策者 |

### 3.3 查询（B3 / M0）

| method | params | result | 说明 |
|---|---|---|---|
| `query.events` | `{ sinceSeq?, limit? }` | `{ events[], lastSeq }` | 断线重连/回放补齐 |
| `query.state` | `{ projection: "public" \| "debug" }` | 状态投影 JSON 树 | public=玩家可见（POV 最小集）；debug 仅同进程/开发模式开放（**不进 WS 生产开关**） |
| `query.ledger` | `{ kind: "inventory"\|"rep"\|"affinity"\|"market"\|"regions", filter? }` | 条目列表 | C3/C4/C5 的界面数据源 |
| `query.narrative` | `{ sinceTurn? }` | `{ entries[] }` | 叙事归档（M1 起有内容；模板文案同通道） |
| `query.entity` | `{ ref: uid \| template }` | 实例/模板详情（含描述投影四段） | C1 T1/C2 的物品卡 |

### 3.4 开发与模拟（B3，仅同进程 / stdio 显式开启）

| method | params | 说明 |
|---|---|---|
| `debug.eval` | `{ expr }` | 对当前状态求值条件表达式（M03 联调利器） |
| `debug.pov` | `{ actor }` | 任意 actor 的 POV 投影（未来 Actor Agent 上下文的检视通道） |
| `replay.step` | `{ turn }` | 步进重放模式（sim 与金测试用；等价 `query.events` 分页消费） |

约定：`debug.*` 与 `replay.*` 在传输层可配置禁用；Godot 生产包只开 §3.1–3.3。

## 4. 事件集目录（协议层）

协议事件 = kernel 事件（M01 §4）的**投影包装**：加 `event` 名与轻量聚合，不重复定义 payload。

| event | data | 启用 | 说明 |
|---|---|---|---|
| `session.ready` | manifest（seed、规则版本、protoVer） | M0 | 建连/加载完成 |
| `menu.updated` | `{ mode, items[] }`（无 hidden） | M0 | 菜单重算推送（回合结算后、模式切换时） |
| `turn.settled` | `{ turn, revision, events[]（本回合内核事件）, lastSeq }` | M0 | **客户端主同步点**：fold 本事件的 events 即追平状态 |
| `turn.began` | `{ turn, deferred[]（本回合到期执行的延迟效果摘要） }` | M0 | 步骤 0 执行后（C6 的传导过程感） |
| `intent.rejected` | receipt（M01 §8） | M0 | 回执推送（重试闭环的客户端侧） |
| `narrative.appended` | `{ turn, text, source: "narrator"\|"template" }` | M1 | C7 模板渲染也走此通道（客户端无感降级） |
| `director.directive` | 指令摘要（叙事演出提示） | M2 | 客户端可渲染演出，可忽略 |
| `arc.progressed` | `{ arcId, stage, summary }` | M2 | 主线进度播报 |

规则：P-E1 每个协议事件的 `seq` 与内核事件流 `seq` 同源连续（`turn.settled.lastSeq` 即游标）；P-E2 推送顺序 = seq 顺序，传输层保证（WS/stdio 天然有序）；P-E3 事件不确认、不重发——可靠性由 `query.events` 补齐承担。

## 5. 关键决策：submitIntent 的应答形态

`turn.submitIntent` 的**协议层响应只表达「受理」**，规则校验结果走事件：

```jsonc
// 受理（已入管线，不表示合法）
{ "id": 7, "ok": true, "result": { "intentId": "int.000042", "accepted": true } }
// 非法（同步可判的快速失败，如 schema/菜单外 verb）
{ "id": 7, "ok": false, "error": { "code": "E_REJECTED", "data": { receipt } } }
// 结算结果 → 事件流（turn.settled 内含该 intent 的全部账面事件）
```

理由：校验失败是**游戏数据**（重试、审计、统计），不是协议错误——receipt 走事件流才能入日志、被测试断言（R3）。同步拒绝仅限「不需要管线参与就能判定」的形态错误，两者以 receipt 结构一致（客户端一个代码路径处理）。

## 6. 传输矩阵

| 传输 | 帧格式 | M0 范围 | 备注 |
|---|---|---|---|
| 同进程 TS API | 直接函数调用（同一信封对象） | 全部 | 测试/sim/CLI 主路径；零序列化开销 |
| stdio | NDJSON（每帧一行 `\n`） | 全部（含 debug.*） | Godot sidecar、CI 脚本；选 NDJSON 而非 LSP Content-Length 分帧——Godot `read_line` + `JSON.parse_string` 零依赖即解（见开放问题 O2） |
| WebSocket | 每帧一条 text message | §3.1–3.3 | Web 调试台（M1）；M0 仅实现到「传输矩阵测试可跑」 |

不变量：T1 三传输跑同一消息集测试夹具（同一断言集，仅适配层不同）——这是「跨同一 seam」的测试形态；T2 引擎不感知传输（M16 api 之上只有薄适配器，每传输 ≤200 行）。

## 7. 已确认决策：双层提交 + 传导惰性刷新（2026-10-09 用户裁决）

回合管线（§12.1）的「回合」适合战斗/探索，但商业态/对话态是高频微交互——逛一次铁匠铺买 5 件不该耗 5 个回合。**已确认采纳双层提交**（否决「一切皆回合」），并按用户裁决细化：**世界侧派生态不随每笔微事务立即刷新**，改为「立即效果 / 传导效果」两档——与 G19 大事件延迟结算（§12.1）统一为同一模式：

```text
回合事务（macro-turn）   turn.submitIntent → 全管线八步 → turn.settled
模式内微事务（micro-tx） turn.submitIntent（mode 内）→ 校验→结算→原子提交 → revision++ → menu.updated
                        （不推进回合、不跑步骤 0/8、LLM 不介入）

微事务的账面分两档：
  立即效果（本事务内提交）  物品/金钱/purse 转移——交易自身的状态
  传导效果（pending 累积）  市场指数、区域控制、声望/好感传导等世界派生态
                           → 权威状态的 pending 累积器（M01 §5），不立即改指数

flush 触发（先到先刷，规则库数据）：
  ① 量阈值：|pending| ≥ threshold（按 类别×区域 配置）
  ② 周期：回合边界——管线步骤 0 统一 flush 全部 pending（可配为每 N 回合）
```

- **涌现保持**：C4 倾销 80 破剑——单笔 +80 供给超阈值 ①，同事务内立即 flush → 金属指数下移 → 收购价降；买 5 件小东西——累积不足阈值，静默入 pending，回合边界 ② 才刷新。压价涌现不变，小额交互零噪声。
- **确定性**：pending 累积器是权威状态字段（随微事务 revision++ 提交）；阈值与周期是数据——重放同结果（E1/S4 同型）。
- **统一性**：G19 大事件级联（立即效果本回合提交 + 传导效果按 dueTurn 扩散）与经济 flush 是同一个「立即/传导」二分，只是触发器不同（级联用 dueTurn，经济用 threshold/周期）——M08/M11 实现时共用这条管线语义。
- 协议层表现：`turn.submitIntent` 一个入口两种深度，响应带 `{ depth: "micro" | "turn" }`；`market.index.changed` **只在 flush 点发出**（微事务 commit 内或步骤 0）；`menu.updated` 的 context.price 读已提交指数——两次 flush 之间价格稳定，即「买 5 件不漂移 5 次」的形态。

## 8. 验证 case 推演（协议覆盖度校验）

逐 case 写最小消息序列（缩写：Q=请求帧，E=事件帧）：

**C1 Boss 掉落**：`Q query.menu` → `E menu.updated{combat}` → `Q turn.submitIntent{attack}` → `E turn.settled{ events:[rng.rolled, hp.changed…, actor.defeated, rng.rolled(loot), item.spawned{uid,essence,provenance}] }` → `Q query.entity{ref: item.inst.000317}` → 描述投影四段返回。✔ 掉落入袋、来源可查、定价（`menu.updated` 内 context.price 定点数）。

**C2 遗迹护符**：`E menu.updated{exploration, items:[search_altar(场景标签解锁)]}` → `Q turn.submitIntent{search_altar}` → `E turn.settled{ rng.rolled, item.spawned{loreRef, abilities} }` →（M1）`E narrative.appended{source:narrator}`。✔ 可供性菜单、loreRef 随实体查询返回。

**C3 城镇交易（微事务路径）**：`E menu.updated{commercial, dwarf_hammer: locked+hint"等级≥8"}` → `Q turn.submitIntent{buy, params:{price}}` → 超区间 → `Q` 收 `E_REJECTED + receipt{提交50000 vs ≤14400}` → 修正 → `E menu.updated`（事件流含 `item.transferred`+`gold.changed`×2+`purse.changed` 同 revision；单笔小额不触市场事件——pending 静默累积，回合边界才 flush）。✔ 原子转移可由客户端 fold 验证；锁定条目与提示直出。

**C4 批量倾销**：`Q turn.submitIntent{sell, params:{qty:80}}` → 微事务 → `ledger.batch{摘要行}` + pending 累积 +80 供给 → 量阈值命中同事务 flush → `market.index.changed`。✔ 单 intent 批量；倾销压价在后续 `menu.updated` 的 context.price 中可见（收购价下移）。

**C5 声望权益**：`E turn.settled{rep.changed{grey_wolves +15→33}}` → `E menu.updated{ 拍卖行: visible（原 locked）, 雇佣精锐: locked+hint"声望≥60" }`。✔ 解锁即时反映、分档门控三态直出。

**C6 政权更迭**：`E turn.settled{ region.control.changed, rep.changed×N, membership.changed, deferred.scheduled×M }` → 后续 `E turn.began{deferred 摘要}` × M 回合（传导过程感）→ `Q query.events{sinceSeq:0}` 重放全链 → `Q save.branch` 分叉验证另一走向。✔ 延迟结算对客户端可见且可重放；分支是协议一等能力。

**C7 拔 LLM**：协议帧**零变化**——`narrative.appended{source:"template"}`、菜单只剩 `origin:base`、无 `director.directive`。✔ 降级对客户端透明（P5 的协议侧验收）。

**结论：七 case 全部可由「§3.1–3.3 命令 + §4 M0 事件集」表达，无缺口。** 唯一结构性新增是 §7 的双层提交（C3/C4 的直接动因）。

## 9. 测试与验收

1. **传输矩阵测试**：同一夹具（session.new → 3 回合脚本 → 断言事件流）在 同进程/stdio/WS 三传输逐字节等价。
2. **断线重连**：随机断在任意 seq，`query.events(sinceSeq)` 补齐后客户端 fold 状态 ≡ 不断线。
3. **重放等价**：`session.load` + `query.events` 全量 与首次游玩事件流逐字节相同（P7 协议侧）。
4. **回执闭环**：C3 超区间报价 → receipt → 修正重提 → 成功，全程事件日志完整。
5. **前向兼容**：注入未知字段/未知 method，验证 F4 行为。

## 10. 演进规则

- `protoVer` 0（开发期）→ 1（M0 收口冻结）。此后：加命令/事件=minor、改语义=major+迁移层；帧内未知字段永远容忍。
- 协议事件目录与 M01 事件目录**同版本演进**（M15 只做投影包装，不私造 payload）；JSON Schema 从 Zod 单源导出，随版本入库存档（`manifest.protoVer`）。
- Godot 侧以导出的 JSON Schema 生成 GDScript 常量与解码器（G0 阶段产出，非运行时依赖）。

## 11. 决策状态（2026-10-09 用户裁决后）

| # | 问题 | 状态 |
|---|---|---|
| O1 | 双层提交（回合事务 + 模式内微事务） | **已确认采纳**，并按用户裁决细化为「立即效果 / 传导效果」+ pending 惰性 flush（§7 已更新） |
| O2 | stdio 分帧 NDJSON vs LSP Content-Length | **已确认 NDJSON** |
| O3 | `menu.updated` 推送 vs 纯拉取 | **已按默认建议确认**：推+拉都保留（推保实时、拉保幂等，同一函数两个出口） |
| O4 | 微事务期 L2 商人决策等待的进度事件 | M1 再定（先靠区间外快速失败，L2 实测延迟后决定是否加 `engine.busy`） |
| O5 | `save.branch` 的并发语义 | **已按默认建议确认**：M0 限定单 session 写、branch 产出新 slot 只读母档 |
