# M03 expr — 条件表达式语言

> 对应设计稿：§7（条件表达式语言）。批次：B0。依赖：contract。被依赖：M08 触发器、M09 菜单门控、M14 弧入口/分支。

## 1. 数据模型与不变量

- 手写**递归下降解析器**（词法 → AST），**不 eval、不引第三方**——理由（设计稿 §7/技术选型稿 §4）：谓词集随内容版本扩展（要版本控制）、内容校验要分析 AST、杜绝注入面。
- AST 为**可序列化 JSON**（存档记录版本，谓词集只增不删）。
- 求值是**纯函数**：`(ast, context) => boolean`；无副作用、无 LLM、同输入同输出（P7）。
- 上下文 = 权威状态快照 + 规则版本的只读投影（谓词只读权威状态——账本走索引，不扫描叙事归档）。

## 2. 语法（§7 文档示例对齐）

```text
expr        := or
or          := and ( 'or' and )*
and         := not ( 'and' not )*
not         := 'not' not | cmp
cmp         := primary ( ( '>=' | '<=' | '==' | '!=' | '>' | '<' ) primary )?
primary     := '(' expr ')' | number | '-' number | string | call
call        := id '(' args? ')'
args        := arg ( ',' arg )*
arg         := id ( ':' value )? | value
```

实现期裁决（2026-10-13，已落地）：
- **裸标识符在 primary 位置 = 零参谓词调用**（`player_level >= 8` 即 `player_level() >= 8`）；在 arg 值位置 = 字符串（`faction_rep(grey_wolves)` 的 grey_wolves）——位置消歧，无需注册表。
- **§7 示例中的短名（grey_wolves）是文档速写**；内容与账本一律用命名空间键（`faction.grey_wolves`）。
- 顶层与逻辑运算操作数严格布尔（数字≠0 不是真值）——非布尔是内容错误，checkTypes 静态查。

- 比较两侧均为值（number/string/bool）；`==`/`!=` 类型必须匹配（number≠string 不等是**类型错误**不是 false——静态可查）。
- 首批谓词（§7 列表）：`player_level / faction_rep / npc_affinity / player_owns(tag|template|uid|loreRef) / lineage_of(...) includes "..." / item_delivered(npc:, tag:) / market_index(category:, region:) / region_controlled_by(...) / region_contested(...) / quest_stage(...) / arc_stage(...) / scene_tag(...)`。

## 3. 公开接口

```ts
parse(src: string): Ast                        // 抛 ExprError（位置+原因）
evaluate(ast: Ast, ctx: PredicateContext): boolean
serializeAst(ast: Ast): JsonValue              // 版本化落盘
deserializeAst(json: JsonValue): Ast
checkTypes(ast: Ast, registry: PredicateRegistry): void   // 内容校验用（§14-7）
```

`PredicateContext = (name: string, args: Args) => boolean | number | string`——谓词注册表由宿主（M08/M09）注入，M03 只管语法与求值框架。

## 4. 依赖端口

contract（无专用 schema；AST 是引擎内 JSON）。

## 5. 测试与验收

1. **§7 全部示例逐条**解析+求值（夹具锚定设计稿与 Case 1–6 实例：`faction_rep(grey_wolves) >= 30`、`player_owns(tag: "bone_of_bone_maw")`、`region_controlled_by("capital") == "lords"`…）。
2. 运算优先级：`a or b and not c` = `a or (b and (not c))`。
3. 括号、字符串、数值（含定点 10⁴ 整数）。
4. **坏表达式报错定位**：`player_level >=`（截断）、`faction_rep(grey_wolves >=`（括号不闭合）、未知谓词、类型不匹配比较——每个抛 ExprError 且消息含位置（行:列）与原因。
5. AST 往返：parse → serialize → deserialize → 求值一致。
6. 求值纯函数：同 (ast, ctx) 两次调用同结果；ctx 不被修改（冻结快照断言）。

## 6. 开放问题

| # | 问题 | 建议 |
|---|---|---|
| O1 | 谓词返回值统一 bool 还是允许 number/string（比较运算用） | 允许 number/string：`faction_rep(...) >= 30` 这类半谓词天然需要。谓词签名声明返回类型，checkTypes 静态查 |
| O2 | 字符串字面量引号：单/双引号都收还是只双引号 | 双引号（与 §7 示例一致）；单引号报错（错误信息提示用双引号） |
| O3 | `includes`（lineage 谓词专用形态）进语法还是做谓词 | 进语法做**后缀运算** `includes "..."` 只挂 primary——§7 示例形态，别泛化成集合运算 |
