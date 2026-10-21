# M10 ai — L0 效用 AI 与舞台指令解释器（L1）

> 对应设计稿：§3（NPC AI 三层：L0 效用 + 行为树 / L1 舞台指令偏置注入 / L2 B4）。批次：B2。依赖：contract、M09（菜单 = 决策空间）、M05（账本/好感查询）、M08（EventLogView）。被依赖：M13（步骤 3 决策收集——L0 毫秒级）、M14（弧 hook 的 L1 指令解释）、M19（sim 千局全自动）。
>
> 状态：设计稿 v1.0（2026-10-15），实现前确认稿。

## 1. 数据模型与不变量

L0 = 普通 NPC 的全部决策机制（毫秒级、可批量：百人混战无压力，M19 千局模拟的可行性前提）。L2（Actor LLM）B4 落地，**其兜底就是本模块**——G21 内容校验硬规则（L2 必有完整 L0 profile）使降级在结构上成立。

| # | 不变量 | 说明 |
|---|---|---|
| A-1 | 决策在菜单内 | L0 的候选 = M09 为该 NPC 生成的 visible 条目；菜单外动作结构上不可选（P3） |
| A-2 | 确定性 | 同状态同种子同决策：效用函数纯函数 + 种子扰动（combat 流 RNG 注入），重放逐字节一致（P7） |
| A-3 | 驱力即数据 | 驱力权重（生存/恐惧/忠诚/贪婪…）是 NPC 数据字段（content）；效用函数是代码注册表（P4 分层同 M07 原语） |
| A-4 | 效用定点且归一 | 效用分数定点整数（禁浮点，P7）且每函数**归一化到 [0,10000]**（clamp+scale）——权重 × 效用的乘法结构要求量纲一致（O1 裁决），跨 verb 可比、调参一致 |
| A-5 | 忠诚重定向 | 忠诚驱力指向 `membership` 字段解析的当前势力——倒戈后自动重定向（G16 的 L0 侧；权益折扣在 M09 门控侧） |
| A-6 | 指令是偏置不是命令 | 舞台指令（L1）注入为效用偏置或硬目标覆盖（strength 枚举）——指令本身也是 intent 走校验（§3 L1 硬规则 1）；瘸腿 NPC 冲锋被 M12 拒并回执 |
| A-7 | 无台词决策权 | 产出只有 intent；台词渲染（模板文案库）属 M1/M18（G20）——B2 不做 |

## 2. 公开接口

```ts
// 驱力权重（content 侧 NPC profile 数据；contract 已有 drives 字段）
interface NpcProfile {
  drives: Record<DriveSlug, number>    // 定点权重（如 survival: 8000 = 0.8）
  behaviorTree?: Slug                  // 行为树引用（B2 骨架：无树 = 逐回合单步效用）
  portrait?: { greed?: number /* 定点，定价画像 M11 复用 */ }
}

// 效用函数注册表（代码常量，A-3；键 = verb）
type UtilityFn = (ctx: DecisionContext) => number   // 定点效用分
registerUtility(verb: Slug, fn: UtilityFn): void

// 决策上下文（只读闭包：state + menu + 指令偏置）
interface DecisionContext {
  actor: ActorId
  state: GameState
  menu: Menu                                    // A-1：候选集
  affinity: number                              // 对玩家好感（base+personal）
  hpRatio: number                               // 定点（hp 满值入 content；B2 取 hp/30 夹 [0,10000]）
  directives: ActiveDirective[]                 // 生效中的舞台指令（L1 偏置）
  rng: Rng                                      // 种子扰动（combat 流）
}

// L0 决策主入口（M13 步骤 3 调用；毫秒级）
decide(ctx: DecisionContext): IntentInput | null
// 全 visible 条目 → 逐条效用（基础效用 × 驱力权重 + 指令偏置 ± 种子扰动）→ 最高分
// null = 无 visible 条目（跳过本回合；menu.presented 已留痕）

// L1 舞台指令解释器（M14/Director 消费侧）
applyDirective(scores: Map<MenuItemId, number>, d: ActiveDirective): Map<MenuItemId, number>
// strength: bias → 效用 ± bias 幅度；hard → 目标条目效用 = MAX_UTILITY（唯一，冲突取后发）
```

**B2 效用函数最小集**（M0 两阵营互殴 + C3 商人）：`attack`（敌意 × hpRatio 反比）、`guard`（低血优先）、`sell/buy`（贪婪度 × purse 余量）、`flee`（恐惧 × 低血，探索态）、`give`（好感 × 任务相关）。

## 3. 依赖端口

M09（菜单产出 = A-1 候选集）、M05（npcAffinity/membership 查询）、contract（ActiveDirective、IntentInput）。RNG（combat 流，种子扰动）。**不依赖 LLM**（P5 的正面陈述：本模块零 LLM）。行为树 B2 只落骨架（逐回合单步效用即足够 M0 验收）——完整树 B3 按需扩。

## 4. 事件产出

**无直接事件**——决策表现为 IntentInput，结算后成为事件（M12 产）。指令记账 `directive.issued/expired` 由 M14/Director 侧产出（本模块只解释）。

## 5. 测试与验收

1. **确定性**：同状态同种子双跑，L0 决策逐字节一致（A-2；M19 前提）。
2. **百人毫秒级**：100 个 L0 一次 decideAll < 50ms（性能锚，M0 验收支撑）。
3. **指令偏置生效**（§3 L1）：`retreat` bias → 恐惧驱动 NPC 选 flee；`hard` 覆盖 → 必选目标条目（A-6）。
4. **忠诚重定向**（C6 G16）：队长倒戈后，忠诚效用读 prince_camp 阵营值（A-5）。
5. **好感效用**：elder_yun 好感高 → give 骨头效用高于 sell（C1 T4 的 L0 侧）。
6. **菜单外不可选**：L0 从不产出 menu.visible 之外的 verb（A-1 断言）。
7. **B2 收口**：菜单 → decide → 结算全链（M09/M12 联测）。

## 6. 决策状态（2026-10-15 用户裁决）

| # | 问题 | 状态 |
|---|---|---|
| O1 | 效用分数是否归一化 | **归一化 [0,10000]**——权重语义统一（survival 0.8 对所有 verb 同等缩放），M19 跨 verb 分布统计有共同轴。推演中修订初判：不归一则跨 verb 数字不可比，调参退化为逐 NPC × 逐 verb 魔数 |
| O2 | 行为树 B2 是否落 | **骨架**——逐回合单步效用（M0 互殴够用）；多步例程树 B3 按真实用例（如巡逻卫兵）定 schema |
| O3 | tie-breaking（同分） | **稳定序**——同分按菜单条目序取先；扰动只加在分数上不加在选序上（RNG 消耗数稳定，重放序列不漂移） |
| O4 | hp 满值来源 | **content 侧 actor profile**（hpMax）；函数签名收参数，B2 测试传 30（B0 夹具惯例）；actors content 域 B3/M0 开 |
