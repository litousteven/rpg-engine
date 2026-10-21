# M09 menu — 行动菜单基础层与三态门控

> 对应设计稿：§4.2（基础层+增富层）/ §4.3（场景可供性）/ §4.4（条件可见性统一形态）/ §4.5（商业态交互模式）。批次：B2。依赖：contract、M03（expr）、M07（动作表/库存表数据）、M05（账本查询）、M08（谓词上下文）。被依赖：M10（L0 在菜单内决策）、M12（I1 校验锚点）、M13（每回合管线步骤 2）、M15（协议投影）。
>
> 状态：设计稿 v1.1（2026-10-15 裁决收编：动作表代码注册表、菜单无 id + target 字段、F1 稀有度模板化联动）。

## 1. 数据模型与不变量

菜单 = 行动空间的边界本身（P3）。M09 只做**基础层**（增富层属 M1/M18，其校验闭环挂在本模块 `menu.enrich` 钩子）。

| # | 不变量 | 说明 |
|---|---|---|
| N-1 | 基础层全覆盖 | 每回合对每个决策者产出全部合法动作：**结构上不存在菜单外动作**（P3 的数据侧）——I1 校验锚点即本模块产出（**锚定 verb 级 visible 闭集**，非条目级 id） |
| N-2 | 三态语义 | `visible` 可执行 / `locked` 显示 + hint（引擎渲染，M2 不变量）/ `hidden` 不出现在协议投影（M1 不变量）——三态由条件表达式评估决定，非手工标注 |
| N-3 | 数组序确定性 | 菜单条目**无 id 字段**（O2 裁决）：菜单为有序数组、**位置即键**；同状态重生成逐字节相同（menu.presented 重算比对自校验的前提） |
| N-4 | 条件同源 | 门控条件与触发器共享同一门 §7 语言 + 同一 predicateContext（G14：两侧行为不漂移；M08 落地复用） |
| N-5 | 锁定/隐藏是内容决策 | 条目携带 `gate: { visible?: Expr, locked?: Expr }`（缺省 visible）——声望权益倾向 locked、剧透内容倾向 hidden，由内容期决定 |
| N-6 | 菜单是派生快照 | 菜单不是权威状态：每回合 `menu.presented` 入日志（审计 + I1 锚点 + 客户端重放 UX），重放时可重算比对 |
| N-7 | 场景可供性闭集 | 环境动作 = 场景标签 → verb 映射（content 数据）；无标签场景结构上无环境动作（LLM/玩家不能发明） |

## 2. 公开接口

```ts
// 动作表：verb → 生成器（代码注册表，见裁决 O1）
type ActionGenerator = (ctx: MenuContext) => MenuItemDraft[]
interface VerbSpec {
  verb: Slug                          // contract 闭集枚举成员
  label: string                       // 模板文案（无 LLM 依赖，C7）
  modes: Mode[]                       // 该 verb 出现在哪些交互模式
  generate: ActionGenerator            // 从状态产出候选条目（含 gate 评估）
}
registerVerb(spec: VerbSpec): void            // 启动期注册，运行时闭集（P4）

// 门控评估（N-2/N-4：expr + M08 predicateContext）
evalGate(expr: Ast, ctx: MenuContext): 'visible' | 'locked' | 'hidden'
// 评估序：visible 条件真 → visible；locked 条件真 → locked + hint 渲染；否则 hidden

// 主入口：为一个决策者生成本回合菜单（M13 步骤 2 调用）
buildMenu(state, logView, ruleset, actor: ActorId, mode: Mode): Menu
// 全 verb 遍历 → generate → gate 评估 → 三态落定 → menu.presented 事件草稿

// hint 渲染（M2：模板渲染，零 LLM）
renderHint(expr: Ast, ctx: MenuContext): string   // "需要 声望 ≥ 30" 形态（C5/C3 锚点）

// I1 校验面（M12 消费；O2 裁决：锚定 verb 级）
menuVerbs(logView, actor, turn): Set<Slug> | undefined  // 本回合 visible 条目的 verb 闭集
```

**B2 落地的 verb 最小集**（M0 两阵营互殴 + C3/C4 商业 + C1 T4 交付）：

```text
战斗态   attack / guard            （B3 M0 验收：两阵营互殴 10 回合）
对话态   talk（话题树占位）/ give    （C1 T4：给予物品 = give）
探索态   search / interact          （C2 搜查祭坛 → 物品池实例化）
商业态   buy / sell / barter        （C3；拍卖 B3/M3）
```

## 3. 依赖端口

M03（parse/checkTypes——gate 表达式静态查）、M08（predicateContext + EventLogView）、M05（ownedQty/purse 查询——卖出条目来源）、M07（库存表 `requires` 条件、场景标签映射）。**不依赖 timeline 写路径**（菜单只读 + 派生事件）。

## 4. 事件产出

| 事件 | 说明 |
|---|---|
| `menu.presented` | `{ mode, menu: Menu }` 派生快照——每回合每决策者一条，入日志不入状态（N-6） |

## 5. 测试与验收

1. **三态渲染**（C3/C5 锚点）：等级 6 玩家看矮人战锤 → `locked` + hint「需要 等级 ≥ 8」；灰狼 rep 33 → 拍卖行 `visible`、rep 18 → `locked` + hint「需要 声望 ≥ 30」。
2. **P3 结构性**：menu.presented 之外的 verb 提交，M12 I1 校验必拒（联测）。
3. **N-3 确定性**：同状态重生成两遍逐字节相同；menu.presented 重放重算比对一致。
4. **场景可供性**（C1 T3/C2）：`smithy` 标签 → craft 菜单出现；无标签 → 结构上无该条目。
5. **N-4 同源**：同一 `faction_rep >= 30` 在触发器（M08）与门控两侧求值一致（参数化）。
6. **B2 收口**：菜单 → L0 决策 → 结算全链（M10/M12 联测）。

## 6. 决策状态（2026-10-15 用户裁决）

| # | 问题 | 状态 |
|---|---|---|
| O1 | 动作表形态：代码注册表 vs content 数据 | **代码注册表**（VerbSpec 代码常量；label/场景映射/库存 gate 走 content——与原语封闭同型分层，ContentGen 结构上不能发明新 verb） |
| O2 | MenuItem.id 派生规则 | **菜单无 id 字段**：位置即键（数组序确定性派生）。语义信息的载体是 menu.presented 快照的结构化字段（verb/target/params/context），不是 id。`intent.menuItemId` 保留为可选回显（审计）；I1 校验锚定 verb 级 visible 闭集。**联动新增**：MenuItem 加 `target?: EntityRef` 字段（审计直读 + 增富层结构化匹配），契约演进见 M12-O6 汇总 |
| O3 | 拍卖是否 B2 落地 | **不**——buy/sell/barter B2；拍卖交互（出价/议价状态模型）B3/M3。拍卖的「门控可见」部分 B2 经 buy/sell 条目可验 |
| O4 | 未声明 gate 的默认态 | **visible**（门控 opt-in）；「该锁未锁」由 M21 内容校验告警兜底 |
