# M07 rules — 规则注册表与内容加载

> 对应设计稿：§5.2（原语目录三旋钮）/ §8.1（定价函数注册表）/ §14-2（规则版本化与存档迁移）。批次：B1。依赖：contract。被依赖：M06（模板/配方）、M08（触发器定义）、M11（定价，B2）、M21（内容校验，M4）。
>
> 状态：设计稿 v1.0（2026-10-13），实现前确认稿。

## 1. 数据模型与不变量

**分层：数据包 + 代码注册表。** 规则内容是 JSON 数据（content/ 目录，git 审校）；效果原语与定价函数的实现是代码（运行时注册表）。数据引用代码 id，加载即校验引用存在——「不在目录中的效果，结构上不可能被组合出来」（§5.2 旋钮 1）。

| # | 不变量 | 说明 |
|---|---|---|
| R-1 | 规则即数据 | content/ 下按域分文件；每域一个 Zod schema；解析失败/引用悬空 → ContentError 列表（不加载半包） |
| R-2 | 不可变快照 | `Ruleset` 是会话构造时注入的不可变对象；运行时只读（P4） |
| R-3 | 版本化 | `VERSION.json` 清单 `{ [domain]: semver }`；存档 manifest 记录规则版本集 |
| R-4 | 迁移确定性 | `migrate(domain, fromVer, data) → data` 纯函数链，注册表按 (domain, fromVer) 索引；链式可达即接受，不可达拒载 |
| R-5 | 原语封闭 | `EffectPrimitive` 注册表是代码常量；数据侧原语目录 id ⊆ 注册表（加载校验）；运行时不新增（P4） |
| R-6 | fs 隔离 | M07 是纯函数（`parseContent(files)`）；文件读取属 storage 层（kernel 禁 fs，ESLint 拦截） |

## 2. 公开接口

```ts
// 内容 schema（B1 落地域：primitives / loot / recipes / version；其余域 schema 随批次补）
interface PrimitiveDef { id: Slug; params: unknown /* per-原语 schema */; cost: number; desc: string }
interface LootTableEntry { template: TemplateId; chance: FixedRatio /* num/den */; named: boolean; essence: Slug[] }
interface LootTable { encounterId: TemplateId; loot: LootTableEntry[] }
interface Recipe { id: TemplateId; station: Slug; materials: { ref: TemplateId; qty: number }[];
                   essenceMapping: Record<Slug, { primitive: Slug; rank?: number }> }

parseContent(files: Record<string, string>): Result<ContentPack, ContentError[]>

// 代码注册表（kernel 内常量；B1 骨架 + 测试原语）
effectRegistry: ReadonlyMap<Slug, EffectPrimitive>
type EffectPrimitive = (state: GameState, args: unknown, rng: Rng) => GameEvent[]   // 技术选型稿 §4.6

// 组装与版本
assembleRuleset(pack: ContentPack): Result<Ruleset, ContentError[]>   // 引用校验：原语 id、模板存在性
migrateContent(domain, fromVer, data): Result<unknown, ContentError[]>  // R-4 链
```

## 3. 依赖端口

contract（schema 复用：TemplateId/Rarity/Slug）；M02（原语执行时注入 Rng）；不依赖 timeline（规则只被消费）。

## 4. 事件产出

无直接产出——`EffectPrimitive` 的执行产出事件（由 M08 触发器/M12 结算调用，事件归属调用方域）。

## 5. 测试与验收

1. **合法内容包**：C1 骨头掉落表 + 骨刃配方 + 测试原语 → assemble 成功；Ruleset 只读断言。
2. **加载拒**：缺字段 / 原语引用悬空 / 模板不存在 → ContentError 定位（文件+字段路径）。
3. **迁移**：v1→v2 单跳、v1→v3 链式、断链拒载。
4. **B1 收口联测**：`loot.roll(rng)` 骨头 chance 1.0 named=true（C1 T0 数据源）。

## 6. 开放问题

| # | 问题 | 建议 |
|---|---|---|
| O1 | 定价函数 B1 就落吗 | **不**——Case 1 T0 不需要定价（T2 属 B2）；B1 落 `pricing` 域 schema 占位 + 注册表骨架，实现随 M11 |
| O2 | content/ 样例文件与 schema 同批交付 | **同批**——手写 M0 内容（骨头/骨刃/护符三件套），测试夹具即样例，git diff 可审 |
| O3 | chance 用定点分数（num/den）还是整数百分比 | 定点分数 `{num, den}`（全链禁浮点推论；1.0 = {1,1}，0.25 = {1,4}） |
