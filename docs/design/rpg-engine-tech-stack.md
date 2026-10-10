# RPG 引擎技术选型与实现方案

> 状态：技术选型稿 v1.0（2026-10-09）。配合设计稿 v0.5（文中 §x 均指该稿章节）与验证 case 集 v5 使用。回答一个问题：从 M0 起步（零 LLM、CLI/简单界面即可、零外部数据库）到 Godot 轻量 RPG 终态，技术栈选什么、怎么分层、怎么演进。整体架构图见同目录 `rpg-engine-architecture.html`。

## 0. 结论速览

| 维度 | 选择 | 一句话理由 |
|---|---|---|
| 引擎语言 | **TypeScript（strict）** | §13 移植清单 14 行全是 `tavern-plugin/lib/domain/*.js`——同语系意味着「移植」而不是「翻译重写」；类型系统直接承住 intent/事件/schema 密集的设计 |
| 运行时 | **Node.js 22 LTS（headless 进程）** | 无头 API 本来就是 §13 组件与 M0 验收形态；LLM 异步、L2 并行会话、SEA 单文件打包路径齐备 |
| 客户端终态 | **Godot 4（GDScript）作为协议客户端** | 引擎零渲染依赖是 P1 的推论；Godot 不进内核，边界即协议 |
| 接口 seam | **同一消息集 × 三种传输**：同进程 TS API / stdio JSON-RPC / WebSocket | CLI 与测试同进程直连；Godot 以 sidecar + stdio；Web 调试台走 WS；行为测试跨同一 seam（§13 模式） |
| 存储 | **纯本地文件**：JSONL 事件日志 + 内容寻址增量块 + 版本化规则数据 | §11 设计本来就是事件溯源 + 内容寻址；零外部数据库；规则即数据可 git 审校 |
| 校验 | **Zod（边界处）+ TS 类型（内核处）** | intent / 协议消息 / LLM 结构化输出 / 内容管线四处 schema 同源，可导出 JSON Schema |
| 随机数 | **PCG32 自实现**（状态可序列化，分流 world/combat/loot） | 零依赖、种子化、掷骰入日志（§14-1 硬需求） |
| 测试 | **vitest + 重放等价 + 无头模拟批跑** | 直接对应 P7 与 M0 验收（1000 局数值分布） |
| LLM 接入 | **Provider 接口 + OpenAI 兼容 HTTP 适配器 + Mock** | M0 零 LLM；接口先行；DSH 宿主复用（待决 5）的门不关 |

一句话：**用 TypeScript 写一个 headless 引擎进程（确定性内核 + 可拔 LLM 外设 + 纯文件存储），对外暴露一套版本化的消息协议；CLI、Web 调试台、Godot 4 客户端都只是该协议的消费者。**

## 1. 选型约束（从设计稿与目标反推）

| # | 约束 | 来源 | 技术推论 |
|---|---|---|---|
| C1 | 确定性可重放：同输入同输出 | P7、§14-1 | 语言要能围出「纯函数子集」并被工具强制（禁时钟/随机/网络） |
| C2 | 核心可移植资产是 dsh-tavern 的 JS 代码模式 | §13（14 行移植清单全是 JS 源） | 同语系 = 移植；换语言 = 全部翻译 + 重测 |
| C3 | 开发期客户端 = CLI/网页；终态客户端 = Godot | 目标；M0 验收「无头跑 1000 局」 | 引擎必须 headless、以协议为边界；客户端可替换 |
| C4 | 零外部数据库、单机 | 目标；§11 本来就是事件溯源 + 内容寻址 | 存储即本地文件；进程即服务 |
| C5 | LLM 可拔，M0 零 LLM | P5、§15 | LLM 以 Provider 接口外置；M0 全 Mock/无 |
| C6 | 后期有即时制变体（10Hz tick、revision 门控） | §12.2 | 协议要能承载事件流；内核调度与传输解耦 |

## 2. 语言与运行时

### 2.1 为什么是 TypeScript

1. **移植不重写**（C2）：§13 的回合事务、timeline、intent 校验协议、账本、菜单增富校验、任务阶段机、触发器、上下文管理、存档、异步可靠性，源文件全部是 JS。TS 起步 = 按清单搬运 + 改造；换语言 = 逐模块翻译并全部重验。
2. **类型系统与设计同构**：discriminated union 恰好表达 `intent { verb, targets, provenance }`、§7 表达式 AST、事件流类型；strict null 检查是账本硬约束（上下限、字段存在性）的编译期预演。
3. **生态对口**：Zod（四处 schema 同源）、vitest（快 + watch）、LLM 网关 SDK 全 TS-first。
4. **DSH 宿主的门不关**（待决 5）：`@deepseek-ai/dsh-*` 是 npm 包，若最终复用 DSH 作 Agent 基建，TS 引擎直接嵌。

内核只用 TS 的一个子集：无 `any`、无环境副作用、时钟与存储以端口注入——ESLint 把这个子集围出来（§4）。

### 2.2 备选与否决

| 备选 | 结论 | 理由 |
|---|---|---|
| Rust（编译 WASM / 独立进程） | 否（当前） | §13 清单全部变翻译工程；M0–M4 是设计验证期，迭代速度优先于运行性能；回合制负载（L0 毫秒级、百人混战无压力）远未触 JS 瓶颈。协议边界保留日后整体重写内核的选项（§10 终态备选） |
| GDScript 全内嵌 Godot | 否 | 同上翻译成本；且失去无头千局模拟与 vitest 生态；用 UI 引擎当内核宿主会把开发期迭代绑死在 Godot 编辑器里 |
| Python | 否 | 确定性纪律最难维持（dict 序、隐式全局）；类型系统弱于 TS；与 C2 语系不符 |
| Go / Java / Kotlin | 否 | 无 C2 资产可移植；「LLM 结构化输出 + schema 校验」生态弱一档；分发重 |

### 2.3 Node.js 22 LTS（而非 Bun / Deno）

- headless 进程就是 M0 交付形态（无头 API 是 §13 组件、M0 验收载体）。
- `fetch` / WebSocket / 子进程 / Worker threads 齐备：LLM deadline 与 L2 并行会话（§14-6）天然映射到 async + Worker。
- 打包路径：Node SEA（single executable application）产出单可执行 sidecar，供桌面游戏分发（§10）。
- vs Bun/Deno：性能不是当前瓶颈，稳定性与 SEA 成熟度优先。传输层、存储层不绑死运行时专属 API，未来可换。

## 3. 进程拓扑与协议 seam

```text
┌ CLI REPL ┐  ┌ Web 调试台 ┐  ┌ Godot 4 客户端（终态）┐
└────┬─────┘  └─────┬─────┘  └──────────┬───────────┘
     │ 同进程 TS API │ WebSocket + JSON-RPC │ stdio + JSON-RPC（sidecar）
     └──────────────┼─────────────────────┼───────────┘
                    ▼                     ▼
        ┌────────────────────────────────────────┐
        │  引擎进程（Node 22，headless，无渲染）     │
        │  Gameplay API（seam：命令 / 事件 / 投影）  │
        │  ├─ 确定性内核（无 LLM / 无网络 / 无时钟）  │
        │  ├─ LLM 外设（Provider 接口，可拔 P5）     │
        │  └─ 存储端口 → 本地文件（事件日志 / 块）    │
        └────────────────────────────────────────┘
```

| 传输 | 消费者 | 场景 |
|---|---|---|
| 同进程 TS API | CLI、vitest、模拟批跑 | 最快路径；行为测试与真客户端跨同一 seam（§13「无头 API 与测试」行） |
| stdio JSON-RPC | Godot sidecar、CI 脚本 | 无端口、无防火墙问题；Godot `OS.create_process` 拉起 |
| WebSocket JSON-RPC | Web 调试台 | 浏览器唯一可用通道 |

**同一消息集 × 三种传输**：命令（`turn.submitIntent` / `query.menu` / `save.load` / `replay.seek` …）与事件（`menu.updated` / `turn.settled` / `narrative.appended` / `director.directive` …）。协议版本化（`protoVer`），只增不改——与规则库版本化同策略（§14-2）。

seam 的关键收益：**Godot 客户端、CLI、LLM 外设在引擎眼里同权**——都只有「读投影 + 写 intent」。这正好是 §2 权限矩阵的形状（玩家行与 Agent 行读写形态一致），一套协议闭环同时服务客户端与外设；Godot 不需要任何引擎私有接口。

## 4. 确定性内核的工程硬规则（P7 落地）

1. `src/kernel/` **禁止** import：`node:fs`、`node:net`、`node:crypto`、时钟；**禁止** `Math.random`、全局可变单例。ESLint `no-restricted-imports` / `no-restricted-globals` + CI 强制。
2. 随机只经 **PCG32**（自实现约 40 行，状态可序列化），按用途分流（world / combat / loot）；每次掷骰把 `stream + state + result` 写入事件日志（§14-1）。
3. 权威状态 = `fold(事件日志)`；任何内存态可从日志重建；checkpoint 只是加速器，启动与测试时校验 `fold(log) ≡ snapshot`。
4. 集合迭代只依赖插入序（Map / Array）；禁止依赖对象键序、哈希序。
5. 实体 uid 确定性生成：模板 id + 实例计数器（状态字段）派生，即 §5.1 实例身份形态。
6. 效果原语是注册表中的纯函数：`(state, intent, rng) → events[]`；原语内无 IO；触发器级联受深度与大事件级联预算约束（§12.1 步骤 5、G19）。
7. 时间不是 `Date.now()`：回合号与到期队列是状态字段（§12.1 延迟结算）；文件时间戳只存在于存储层。
8. 条件表达式语言（§7）：**手写递归下降解析器 → 可序列化 AST**（版本化）。不 `eval`、不引第三方表达式库——理由：谓词集只随内容版本扩展（要版本控制）、内容校验需要分析 AST（引用检查）、杜绝注入面。

## 5. 存储设计（零外部数据库）

```text
rpg-engine/
├─ content/                    # 规则库：版本化数据文件，git 审校（§11 规则库行）
│  ├─ primitives.json  recipes.json  loot.json  encounters.json
│  ├─ arcs/  topics/  templates/    # 故事弧池 / 话题树 / 模板文案库
│  └─ VERSION.json                  # 各域版本号集合
├─ saves/<slot>/
│  ├─ manifest.json            # 种子、规则版本集、protoVer、revision、引擎版本
│  ├─ events.jsonl             # 追加 only 事件日志（含掷骰与到期回合记录）
│  ├─ blocks/                  # 内容寻址增量状态块（sha256 → JSON）
│  ├─ checkpoints/             # 周期快照 + 事件后缀（重放等价校验）
│  └─ archive/                 # 叙事归档 / 舞台指令账本（追加 only）
└─ src/…                       # 见 §7
```

- **写通道唯一**：timeline 事务（原子、`revision++`、审计尾日志）；无第二写入者，无文件并发问题（P2 的直接红利）。
- **规则即数据放在 git 里**：内容管线的 diff / 人工审校（§14-7）就是 code review；运行时只读不写（P4）。
- **存档迁移**：规则版本 + 确定性迁移函数注册表（§14-2）；manifest 记录版本集，旧档遇到新规则走注册表路径。
- **为什么不用 SQLite**：数据形态是追加日志 + 重放派生态；每回合状态在内存、账本索引是 Map——关系查询与事务能力用不上，反而引入原生依赖与打包负担。跨存档的平衡性分析走 `src/sim/` 离线批跑（本来就不需要在线库）。出现真实的在线跨档查询需求时再评估，且属工具侧、不动引擎。

## 6. 协议消息形态（v0 草案）

```json
// C → S 命令
{ "id": 7, "method": "turn.submitIntent",
  "params": { "intent": { "actor": "player", "verb": "attack",
    "targets": ["npc.guard.12"], "params": {},
    "provenance": "player" } } }

// S → C 事件（回合结算完成，携带下一菜单）
{ "event": "turn.settled", "seq": 341,
  "data": { "turn": 42, "revision": 87,
    "events": [ /* 结算事件流，含掷骰记录 */ ],
    "menu": { "mode": "combat", "items": [
      { "id": "strike",     "state": "visible", "label": "劈砍" },
      { "id": "guard_ally", "state": "locked",  "hint": "需要 声望 ≥ 30" } ] } } }
```

- 命令与事件全部由 Zod schema 定义，**单源三用**：TS 类型、运行时校验、导出 JSON Schema（供 Godot 侧与协议文档）。
- 事件携带全局 `seq`：投影同步、断线重连、即时制 revision 门控（§12.2）的公共底座。
- 菜单条目三态（visible / locked / hidden + hint）直接进协议，§4.4 的门控语义对客户端透明。

## 7. 代码结构与模块边界

```text
src/
├─ kernel/          # 确定性内核：不 import 任何上层与 Node API
│  ├─ rng/          #   PCG32 + 分流
│  ├─ expr/         #   条件表达式语言：词法/解析/AST/求值（§7）
│  ├─ timeline/     #   事务、revision、事件定义
│  ├─ turn/         #   回合管线（§12.1 八步）
│  ├─ menu/         #   菜单基础层 + 三态门控
│  ├─ rules/        #   规则注册表（原语/定价/配方/遭遇表）
│  ├─ trigger/      #   触发器引擎 + 级联预算 + 延迟结算队列
│  ├─ quest/        #   任务阶段机 + 故事弧池
│  ├─ ai/           #   L0 效用 AI + 行为树 + 舞台指令解释器（L1）
│  ├─ economy/      #   定价引擎 / purse / 市场账本 / 批量交易
│  ├─ ledger/       #   物品/声望/区域控制/membership 账本
│  └─ entity/       #   实例身份 / 能力槽 / 血统链 / 组合校验
├─ storage/         # 端口实现：fs、内容寻址块、快照、迁移（sha256 在此层）
├─ llm/             # Provider 接口 + OpenAI 兼容适配器 + Mock + 消毒管道（§6）
├─ api/             # Gameplay API：组装 kernel + storage + llm 成会话（seam）
├─ server/          # stdio / WebSocket 传输 + 静态调试台托管
├─ cli/             # REPL（同进程直连 api）
└─ sim/             # 无头批量模拟（千局分布）
web/                # 调试控制台静态页（vanilla，无构建步骤）
```

依赖方向（ESLint 强制）：

```text
kernel  ←  storage / llm / api
api     ←  server / cli / sim        （api 是唯一组装点）
```

- 接口在 kernel（端口），实现在外层（storage / llm）——依赖倒置保证内核可脱离 Node 单测。
- 包管理 pnpm；测试 vitest；构建 tsup（CLI 与 SEA 入口）；开发期 tsx 直跑。
- **不做 monorepo**：单包 + 目录边界已足够轻；M1 后内容工具增多再评估拆包。

## 8. LLM 外设接入（接口先行，M1 才接真模型）

```ts
interface LlmProvider {
  complete(req: {
    system: string; messages: Msg[];
    output: ZodSchema;          // 结构化输出直接过 schema（候选生成校验闭环的入口）
    deadlineMs: number;         // SLO 表（§14-4）数据化：每类调用一行
    budget: { maxTokens: number };
  }): Promise<Ok | { error: 'timeout' | 'schema' | 'network' }>;
}
```

- 适配器：`OpenAICompatHttpProvider`（fetch，兼容主流网关）/ `DshHostProvider`（待决 5 的门）/ `MockProvider`（回放固定剧本，M0 与 CI 全覆盖用）。
- 超时降级按 §12.3 阶梯：调用级 timeout → 对应 NPC 落回 L0、菜单剩基础层、文案走模板库；deadline / 重试 / 降级路径全部是配置数据。
- 注入防御（§6）在 llm 层实现：玩家文本消毒管道（长度 / 字符集 / 定界符包裹 / 注入审计）——内核结构上见不到自由文本。

## 9. 测试与验收（直接映射 M0）

| 测试层 | 工具 | 验收对象 |
|---|---|---|
| 单元 | vitest | 表达式语言、定价纯函数、账本硬约束、效用 AI 打分 |
| 重放等价 | vitest + golden 日志 | `fold(events) ≡ checkpoint`；同种子双跑日志逐字节相等（P7） |
| 行为（seam） | vitest 跨 GameplayAPI | 门控三态、批量交易原子性、失败回执重试（§13「跨同一 seam」） |
| 平衡性模拟 | src/sim 无头批跑 | M0 验收：1000 局数值分布 / 胜率曲线（`pnpm sim --runs 1000`） |
| 传输矩阵 | vitest | 同一消息集在 同进程 / stdio / WS 三种传输下行为一致 |
| 降级 | MockProvider 注错 | 拔掉 LLM 全链路仍完整可玩（P5 验收，对应 case 7） |

## 10. Godot 集成路径

| 阶段 | 时机 | 内容 |
|---|---|---|
| G0 协议冻结 | M0 期间并行 | 协议 v0 + JSON Schema 导出；Godot 侧先落协议客户端骨架（GDScript 数据结构与编解码，不碰 UI） |
| G1 最小客户端 | M1 后 | 菜单列表 + 事件流面板两个控件；`OS.create_process` 拉起引擎 sidecar，stdio JSON-RPC 跑通完整回合往返 |
| G2 游戏化 | M2 / M3 | 场景渲染、输入 → intent 映射、叙事事件驱动演出层；打包：Node SEA 按平台产出单可执行 sidecar |
| 终态备选 | M3 后评估 | 内核 TS → WASM + Godot wasmtime GDExtension 进程内运行，消灭 sidecar；协议不变则迁移无痛。当前只保门，不承诺 |

为什么 sidecar 而非内嵌：M0–M3 的迭代速度与测试生态全在 Node 侧；Godot 只承担渲染与输入——规则判定权留在引擎是 P1 本身。双运行时分发成本由 SEA 缓解，并保留 wasm 终态备选：**协议边界让这个决定可以推迟到有真实分发需求时再拍板。**

## 11. 风险与权衡

| 风险 | 应对 |
|---|---|
| 双运行时分发（Godot + Node sidecar） | SEA 单文件；wasm 终态备选（§10）；协议稳定使内核可整体替换而不动客户端 |
| 确定性被无意破坏 | §4 硬规则 + lint + CI 重放等价测试每次提交都跑 |
| 协议漂移 | schema 单源（Zod）+ `protoVer` 只增不改 + 传输矩阵测试 |
| JSON 开销（即时制 10Hz 变体） | 回合制起步无感；即时制上批量事件 + 增量投影，必要时换 msgpack（传输层实现细节，不改消息集） |
| JS 性能上限 | 账本按模板堆叠（§5.1）天然抗量；L0 毫秒级可测；瓶颈实证出现再议内核语言（协议不变） |
| 内容文件体量增长 | 按域拆分 JSON（git 文本 diff 友好）；内容工具 CLI 化放 M4 |

## 12. 落地顺序

- **Phase 0（脚手架，先行数日）**：TS strict + ESLint 边界规则 + vitest；kernel 骨架（timeline revision、事件日志、PCG32、表达式解析器）+ 第一条重放等价测试；CLI 能 `new / save / load`。
- **Phase 1 = M0**：回合管线八步、菜单基础层 + 三态门控、L0 效用 AI、账本（实例身份 / 批量 delta）、定价 + purse 最小闭环、CLI REPL、`pnpm sim` 千局分布。
- **Phase 2 = M1**：LLM Provider（Mock → 真模型）、模板文案库渲染、Web 调试台（WS）。
- **Phase 3 = M2 / M3**：Director + 舞台指令总线、Actor L2、经济 / 区域控制 / membership 全量、即时制 tick 变体、Godot G1。
- **Phase 4 = M4 + G2**：内容管线与校验器、长战役压缩；Godot 游戏化与 SEA 打包。
