# M01 contract — 公共数据契约

> 对应设计稿：§4.1（intent 管线）/ §4.4（条件可见性三态）/ §5（实体）/ §7（条件语言）/ §11（存储）/ §12.1（回合管线）。批次：B0 首位。依赖：无。被依赖：全部模块。
>
> 状态：详细设计稿 v1.0（2026-10-09），实现前确认稿。本文所有类型均为**设计级 schema 描述**（Zod 定义的蓝本），不是实现代码。

## 1. 目标与边界

`contract` 是全引擎的公共数据语言：intent、GameEvent、权威状态分片、菜单条目、回执、ID 体系、revision/seq 语义。**它只定义形状与不变量，不含任何行为**（解析、求值、校验逻辑分属 M03/M12 等模块）。

三条边界规则：

1. 只放跨模块共享的 schema；模块私有类型留在模块内（模块拆分稿 D2 的推论）。
2. 每个类型 = Zod schema + 推导的 TS 类型，**单源**（运行时校验与编译期类型永不漂移），并可导出 JSON Schema 供 M15 与 Godot 侧。
3. 契约按版本演进：字段只增不删不改语义（与 `protoVer`、规则库版本化同策略）。

## 2. ID 与标识体系

全部 ID 为带命名空间前缀的字符串，schema 用正则约束（防内容期手写错）：

| 类别 | 形态 | 示例 | 说明 |
|---|---|---|---|
| 模板 ID | `<域>.<slug>` | `item.bone.large`、`relic.sun_amulet`、`npc.guard`、`faction.grey_wolves`、`region.mountain_city`、`quest.q42`、`arc.rebellion`、`lore.sun_cult`、`craft.weapon.bone_blade` | 规则库资产的引用键 |
| 实例 UID | `item.inst.<6位计数>` | `item.inst.000318` | 唯一实例（§5.1）；计数器是权威状态字段，**确定性生成**（禁随机） |
| Actor ID | `player` \| `npc.<slug>` | `npc.elder_yun` | 决策者标识 |
| Intent ID | `int.<6位计数>` | `int.000042` | 引擎按提交顺序分配；客户端另带幂等键（见 §3） |
| 事件引用 | `<实体ID>` \| `tag:<slug>` \| `loreRef:<id>` | `tag:bone_of_bone_maw` | 物品谓词的引用形态（§7） |

## 3. Intent（§4.1）

```jsonc
{
  "clientKey": "c-8f3a",            // 客户端幂等键：重发同 key 不重复结算（见开放问题 2）
  "actor": "player",
  "verb": "buy",                     // 闭集：来自菜单条目的 verb（P3——菜单外 verb 结构上无法提交）
  "targets": ["npc.smith.mountain", "weapon.dwarf_hammer"],   // 0..n，类型由 verb 决定
  "params": { "qty": 1, "price": 300 },   // 形状由 verb 注册表定义（Zod per-verb）
  "menuItemId": "buy.weapon.dwarf_hammer", // 来源菜单条目（审计 + P3 验证锚点）
  "basedOnRevision": 87              // 决策所依据的 revision；即时制 stale 门控（§12.2）
}
```

不变量：

- I1 `verb ∈ 当前菜单生成器产出的闭集`——intent 校验（M12）的第一步就是对照「本回合已呈现菜单」（见 §6 菜单事件），菜单外提交必拒（P3 的结构性落地）。
- I2 `provenance` 不在 intent 内，而在**事件侧**记录：同一 intent 从客户端（player）、L2（actor-l2）、导演（director）进入时由提交通道标注，玩家不能伪造来源。
- I3 `clientKey` 引擎侧去重：断线重发/重试不产生双结算。
- I4 `params` 全部为 JSON 基本类型或受 schema 约束的嵌套对象；**不含自由文本**（玩家命名/风味走独立的 `naming` 载荷，字段受限，见 §7）。

## 4. GameEvent（事件契约，全引擎唯一耦合面）

事件是模块间唯一的真实通信载体（模块模板硬规则「事件产出必填」）。**权威事件日志 = fold 输入 = 协议事件流的原材料**。

### 4.1 公共信封

```jsonc
{
  "seq": 341,          // 会话内全局递增，事件流游标（重连/重放/断点续传）
  "turn": 42,          // 所属回合
  "revision": 88,      // 本事件落在哪个已提交事务上（timeline revision++）
  "t": "item.transferred",   // 判别字段（闭集，见 4.3 目录）
  ...payload           // 各类型私有字段
}
```

不变量：E1 `fold(events) ≡ snapshot`（M04 的验收基准）；E2 事件 append-only、不可变；E3 同种子重放产生逐字节相同的事件流（P7）；E4 每个事件的 payload 字段集由 `t` 唯一决定（判别联合，Zod discriminated union）。

### 4.2 数字表示（确定性关键决策）

**权威状态与事件中禁用浮点**。价格、市场指数、效用分数一律定点整数（缩放 10⁴）：

```jsonc
{ "t": "market.index.changed", "category": "metal", "region": "mountain",
  "index": 11875,              // = 1.1875，缩放 10⁴ 存储
  "reason": "supply+80" }
```

理由：IEEE 754 浮点在 fold/重放跨平台存在尾差风险，P7 要求逐字节重放等价。派生展示值（客户端格式化）不在此列。

### 4.3 事件类型目录（v0 初集，按来源 case 标注）

| 分组 | `t` | 关键 payload | Case |
|---|---|---|---|
| 元 | `turn.began` / `turn.settled` | turn、意图数、触发器深度统计 | — |
| 元 | `intent.rejected` | intentId、reasons[]（见 §8 回执） | C1 T2 |
| 随机 | `rng.rolled` | stream（world/combat/loot）、state（掷前状态）、results[] | §14-1 |
| 账本·物品 | `item.spawned` | template、qty、rarity、essence[]、uid?、provenance | C1 T0、C2 |
| 账本·物品 | `item.transferred` | from、to、ref（uid \| template）、qty、price? | C3、C4 |
| 账本·物品 | `item.destroyed` | ref、qty、reason | — |
| 账本·金钱 | `gold.changed` | actor、delta、balance、source（intentId/事件 id） | C3 |
| 账本·声望 | `rep.changed` | faction、delta、value、source | C5、C6 T1 |
| 账本·好感 | `affinity.changed` | npc、delta、value、source | C5 |
| 账本·归属 | `membership.changed` | npc、from、to、source | C6 G16 |
| 账本·区域 | `region.control.changed` | region、controller、contested、source | C6 T2 G15 |
| 账本·市场 | `market.index.changed` | category、region、index、reason | C4；**仅在 flush 点发出**（量阈值/周期触发，见 M15 §7） |
| 账本·purse | `purse.changed` | npc、balance、reason | C3 |
| 账本·批量 | `ledger.batch` | 摘要行[]（kind、ref、qty、金额），行数上限可配 | C4 G12 |
| 战斗 | `hp.changed` / `actor.defeated` / `ability.used` | actor、delta/cause、abilityId、cooldownLeft | M0 |
| 实体 | `entity.composed` | uid、recipe、lineage[]（完整血统链） | C1 T3 G3 |
| 实体 | `ability.applied`（装备/携带生效） | target、slot、primitive、rank | C2 G8 |
| 触发 | `trigger.fired` | triggerId、matchedExpr（AST 引用） | C1 T4 |
| 触发 | `cascade.budget.hit` | depth、abandonedCount | C6 G19 |
| 触发 | `deferred.scheduled` / `deferred.executed` | dueTurn、effect、实际执行回合 | C6 G19 |
| 任务 | `quest.stage.prepared` / `quest.stage.committed` | questId、stage | C5、C1 T4 |
| 弧 | `arc.selected` / `arc.stage.advanced` / `arc.branch.taken` / `arc.aborted` | arcId、stage、slots、branchWhen | C6 G17/G18 |
| 指令 | `directive.issued` / `directive.expired` | verb、target、ttl、strength、reason | C5、C6 |
| 命名 | `naming.sanitized` | target、maxLength、truncated | §6 |

注：事件目录**随模块批次扩展**（如 M1 的 `narrative.archived`、M2 的 `proposal.received`），但已发布事件的 payload 语义只增不改——这是「契约版本演进」规则的直接应用。

### 4.4 事件产出责任矩阵（谁产生哪组事件）

| 模块 | 产出事件 |
|---|---|
| M12 settle | intent.rejected、hp.changed、ability.used、item.transferred、gold.changed、ledger.batch |
| M08 trigger | trigger.fired、cascade.budget.hit、deferred.scheduled/executed |
| M06 entity | item.spawned、entity.composed、ability.applied |
| M05 ledger | rep/affinity/membership/region/market/purse.changed |
| M14 quest | quest.stage.*、arc.* |
| M13 turn | turn.began/settled（编排事件） |
| M10 ai | 无直接事件（其决策表现为 intent，结算后成为上述事件） |

### 4.5 事件粒度与 source 归因（已裁决：方案 B，2026-10-09）

事件类型按 **fold 语义**划分（目录长期稳定，~30 个），交互动词归因走事件内 `source` 字段（闭集枚举，只增不改）：

```jsonc
{ "t": "item.transferred", "seq": 351, "turn": 42, "revision": 88,
  "from": "npc.smith", "to": "player", "ref": "weapon.dwarf_hammer", "qty": 1, "price": 12000,
  "source": { "kind": "buy", "intentId": "int.000042" } }
```

- **判据：fold 语义不同才开新类型**——易主 `item.transferred` / 消失 `item.destroyed` / 诞生 `item.spawned` 各一类；买/卖/送/掉落/任务交付同为易主，`source.kind` 区分。
- `source.kind` 初始枚举：`buy | sell | barter | auction | gift | loot | quest-delivery | craft-consume | initial`。
- 谓词查询按 source 过滤（§7 `item_delivered` = `item.transferred` + `kind=quest-delivery` + `to=npc`）；source 索引属 M05 审计层，不影响 fold。
- 类比复式记账：**类型 = 分录科目（怎么变），source = 原始凭证（为什么变）**。科目少而稳，凭证可扩展。

## 5. 权威状态分片（§11）

```jsonc
GameState = {
  meta:    { turn, revision, seed, ruleVersions, protoVer, uidCounter, intentCounter },
  world:   { regions: { [region]: { controller, contested } },
             market:  { [category×region]: { index(定点), pendingSupply, pendingDemand } },
                       // pending 累积器：微事务的传导效果先入 pending（随事务 revision++ 提交），
                       // 达量阈值或回合边界才 flush 为 index（M15 §7「立即/传导」二分）
             delayed: [ { dueTurn, effect, source } ],
             arcs:    [ { arcId, stage, slots, branchHistory } ] },
  scene:   { sceneId, tags[]（可供性依据，§4.3）, actorsPresent[] },
  actors:  { player: { hp, level, gold, purse?, membership? },
             [npc]: { hp, drives, purse, membership, l2: bool, profileRef } },
  ledgers: { inventory: [ 堆叠条目 | 唯一实例 ],
             factionRep: { [faction]: value },
             npcAffinity: { [npc]: { base, personal } },
             activeDirectives: [ { verb, target, ttl, strength } ] }
}
```

不变量：S1 分片只经 timeline 事务变更（P2）；S2 inventory 堆叠条目无 uid、实例必带 uid 且不堆叠（G1）；S3 rep/affinity ∈ [-100,100]（G13）；S4 delayed 队列按 dueTurn 有序、重放时同序执行（G19）；S5 uidCounter/intentCounter 单调递增——ID 确定性的落点；S6 market.pending 随微事务累积提交，只在 flush 点（阈值 |pending| ≥ threshold 或回合边界）清零并改 index——阈值与周期为规则库数据，重放同结果（与 G19 同型）。

堆叠条目与实例（G1，Case 1/4 的分叉点）：

```jsonc
// 堆叠（Case 4 的 200 件杂物 = 4 条）
{ "template": "item.sword.broken", "qty": 80, "rarity": "common" }
// 唯一实例（Case 1 的具名骨头 / Case 2 的护符）
{ "uid": "item.inst.000317", "template": "item.bone.large", "qty": 1,
  "rarity": "rare", "basePrice": 120, "essence": ["poison_affinity", "colossal"],
  "loreRef": null, "abilities": [],
  "provenance": { "source": "boss.bone_maw", "turn": 42, "roll": "seed:a91f",
                  "lineage": ["boss.bone_maw"] } }
```

## 6. 菜单条目（§4.4 三态）

```jsonc
// 引擎内部（事件/审计）完整三态；协议侧投影过滤 hidden（见 M15）
MenuItem = {
  "id": "buy.weapon.dwarf_hammer",
  "verb": "buy",
  "label": "买入：矮人战锤",
  "state": "visible" | "locked" | "hidden",
  "hint": "需要 等级 ≥ 8",              // locked 时必填（达成条件提示，引擎渲染）
  "origin": "base" | "enriched",        // 增富层选项来源标注（M1，G22 话题树变体同字段）
  "paramsSchemaRef": "buy.v1",          // verb 参数 schema 引用（I1 校验锚点）
  "prefill": { "qty": 1 },              // 建议参数（如当前估值）
  "context": { "price": 12000, "region": "mountain" }   // 展示用派生值（定点数）
}
```

不变量：M1 hidden 条目**不出现在协议投影**（玩家侧不存在，P3）；M2 locked 必带 hint 且 hint 文案由模板渲染（无 LLM 依赖，C7）；M3 enriched 条目 verb 必须是基础层某 verb 的参数化变体（增富层校验闭环，G22）。

菜单呈现的落点：每回合在事件日志记录一条派生快照事件 `menu.presented { turn, mode, items[](完整三态) }`——**不是权威状态变更**，但入日志（审计 + 客户端重放 UX + I1 校验锚点「intent 必须命中本回合 menu.presented」）。此事件允许在重放时重算比对（自校验：重算菜单 ≡ 记录菜单，P7 的菜单侧形态）。

## 7. 玩家文本载荷（§6 注入防御）

```jsonc
NamingPayload = { "kind": "char_name" | "item_name" | "flavor" | "note",
                  "text": "蝰蛇之吻",          // 长度/字符集受限（Zod regex + maxLen）
                  "targetRef": "item.inst.000412" }
```

规则：N1 永远是数据不是指令；N2 过消毒管道（llm 层）后才进 LLM 上下文；N3 引擎侧唯一消费方是描述投影与叙事归档——判定与数值与它正交。

## 8. 失败回执（receipt，§4.1 / §13 MVU 模式）

```jsonc
{ "t": "intent.rejected", "seq": 342, "turn": 43, "revision": 88,
  "intentId": "int.000043", "clientKey": "c-8f3a",
  "retryable": true,
  "reasons": [ { "field": "params.price", "submitted": 50000,
                 "expected": "≤ 14400", "rule": "economy.negotiation_band" },
               { "field": "actor.level", "submitted": 6,
                 "expected": "≥ 8", "rule": "menu.gate" } ] }
```

规则：R1 reasons 至少一条且必含「提交值 vs 规则要求」（Case 3 超区间报价、等级不足都由此表达）；R2 `retryable` 区分「可修正重试」（参数错）与「不可重试」（回合已过、菜单已失效）；R3 回执本身入事件日志——重试闭环可审计。

## 9. 验证 case 推演（契约覆盖度校验）

逐 case 把关键数据落点对到上述类型（推演正文见 case 集，此处只验契约）：

| Case | 关键数据 | 契约落点 | 结论 |
|---|---|---|---|
| C1 T0 掉落入袋 | 具名升级 uid、rarity、basePrice、essence、dropRoll | `item.spawned` + 实例形态（§5）+ `rng.rolled(loot)` | 覆盖 |
| C1 T1 来源描述 | provenance（source/turn/roll） | 实例 provenance 字段 + 描述投影输入 | 覆盖 |
| C1 T2 拍卖定价 | 定价函数输入全结构化、谈判区间 | `MenuItem.context.price`（定点）+ intent params.price + receipt 规则 `economy.negotiation_band` | 覆盖 |
| C1 T3 制药/制武器 | essence 继承、血统链 | `entity.composed { lineage[] }`（essence 沿链继承于 M06，契约承载链数据） | 覆盖 |
| C1 T4 剧情交付 | item_delivered 谓词、任务两阶段 | `item.transferred` + `quest.stage.committed`（谓词查询走事件日志索引，M03/M08） | 覆盖 |
| C2 遗迹护符 | loreRef、能力槽（passive/active/cost）、discoveryRoll | 实例 `loreRef`+`abilities[]` + `ability.applied` + provenance.discoveryRoll | 覆盖 |
| C3 城镇交易 | 双向原子转移、purse、region/等级门控 | `item.transferred`+`gold.changed`+`purse.changed` 同 revision（原子性=E1+S1）；锁定条目 `state:locked`+hint | 覆盖 |
| C4 批量倾销 | 200 件堆叠、批量 delta、市场指数 | 堆叠形态（§5）+ `ledger.batch` + pending 累积 → 阈值 flush `market.index.changed`（定点指数） | 覆盖 |
| C5 声望权益 | rep delta 上下限、两级好感、分档门控 | `rep.changed`+`affinity.changed{base,personal}`+locked/hint 分档 | 覆盖 |
| C6 政权更迭 | 区域控制、membership、弧操作、延迟结算 | `region.control.changed`+`membership.changed`+`arc.*`+`deferred.*`+`cascade.budget.hit` | 覆盖 |
| C7 拔 LLM | 模板文案、话题树、auto 弧 | 契约无 LLM 依赖字段；`origin:base` 菜单、模板渲染入叙事归档（M1） | 覆盖 |

**契约层无缺口**。两个跨 case 的结构性确认：① 原子性全部由「同 revision 落账」表达（不需要新类型）；② 三态门控（C3 等级、C5 声望、C1 拍卖入场）统一为 MenuItem.state + hint，符合 G14 的收敛意图。

## 10. 测试与验收（M01 自身）

1. 每个类型一组 Zod 正反例（含 ID 正则、定点数范围、枚举闭集）。
2. 序列化往返测试：类型 → JSON → 类型，逐字节稳定（含字段顺序固定）。
3. 事件判别联合完备性测试：payload 与 `t` 的绑定（错配必拒）。
4. 契约快照测试：导出的 JSON Schema 入库为 golden 文件，任何 schema 变更显式 diff（版本演进可视）。

## 11. 决策状态（2026-10-09 用户裁决后）

| # | 问题 | 状态 |
|---|---|---|
| O1 | 定点数缩放系数 | **已确认 10⁴ 起步**；存储统一 i64 + scale 元数据（内部计算允许更大整数） |
| O2 | `clientKey` 客户端幂等键 | **已确认**：M0 起一律必填，引擎只去重不解读 |
| O3 | 事件粒度：通用事件 + source 归因 vs 动词级事件 | **已确认方案 B**（2026-10-09）：类型按 fold 语义划分、动词进 `source.kind` 闭集枚举——不提供无限自由度，判据与枚举见 §4.5 |
| O4 | `menu.presented` 入权威日志 | **已按默认建议确认**：入日志（P3 审计锚点收益 > 体积成本） |
| O5 | 事件侧 provenance 枚举含 `system`（延迟结算/回合 tick/弧 hook 归因） | **已按默认建议确认**：含 |
