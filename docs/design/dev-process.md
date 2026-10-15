# 开发流程规范

> 状态：v1.0（2026-10-13）。本文件是**执行纪律**，不是建议——后续所有模块开发遵守本流程。配合 `rpg-engine-modules.md`（模块清单与批次）与 `modules/Mxx-*.md`（单模块设计）使用。
>
> 流程来源：B0 批次（M01/M04）两轮实践的提炼。已被验证有效的做法固化，踩过的坑写成硬规则。

## 1. 模块开发六步流程

每个模块（模块拆分稿 §2 清单中的一行）严格走六步：

```text
① 设计确认   写/更新 docs/design/modules/Mxx-<name>.md（六节模板）
             开放问题在动代码前裁决——没有「先写代码回头再说」
             （M01 教训：ActorId 不支持 npc.guard.12 实例形态，测试期才暴露）
② 接口冻结   契约/端口 schema 先行落地（Zod），批内其他模块只依赖这个冻结接口
             不依赖未完成的实现（D2）
③ 实现       严格按设计稿；实现期发现设计缺陷 → 停下改设计稿 → 继续
             （设计与代码不允许分叉超过一个提交）
④ 模块验收   不变量 ↔ 测试断言一一对应（见 §3）
             夹具逐条锚定验证 case 文档实例（见 §4）
⑤ 集成验收   被 M04 Timeline 依赖的模块：真实 applier 替换测试夹具
             每个写状态的模块测试必过 verifyFold()
⑥ 提交       独立 commit（feat/test/docs 分开），推送前跑全量三件套
```

### 1.1 每步的准入/准出

| 步骤 | 准入条件 | 准出条件 |
|---|---|---|
| ① | 模块批次启动（见 §2 批次表） | 设计稿入库、开放问题全部裁决 |
| ② | ①完成 | schema/typecheck 通过，接口 review 过 |
| ③ | ②完成 | `pnpm typecheck` 零错 |
| ④ | ③完成 | 模块测试全绿，覆盖率不看数字看**不变量清单是否每条有断言** |
| ⑤ | ④完成 | 集成点测试绿（timeline verifyFold / case 夹具回归） |
| ⑥ | ⑤完成 | `pnpm test && pnpm lint && pnpm exec tsc --noEmit` 三绿 + push |

## 2. 批次收口验收表

批次是并行开发的容器，**收口不过不进下一批**：

| 批次 | 模块 | 收口验收（全部为可执行断言） | 状态 |
|---|---|---|---|
| B0 | M01 M02 M03 M04 | ① 同种子双跑事件流逐字节相等 ② fold≡snapshot（timeline.verifyFold）③ **B0 全链路：M02 掷骰 → rng.rolled 事件 → timeline 提交 → M03 表达式在重放状态上求值一致** ④ Case 夹具回归（M01 51 项） | **✅ 全部通过（src/kernel/__tests__/b0-closeout.test.ts）** |
| B1 | M05 M06 M07 M08 | ① **Case 1 T0 全链路**：掉落表掷骰(M02) → item.spawned(M06) → 账本入袋(M05) → 触发器条件(M03/M08) ② 两级好感/批量 delta/实例身份不变量断言 ③ 规则加载校验（M07） | **✅ 全部通过（tests/b1-closeout.test.ts；171/171 绿）** |
| B2 | M09 M10 M11 M12 | ① 一回合完整机制：菜单三态(M09) → L0 决策(M10) → 结算(M12) ② Case 1 T2/T3：定价纯函数、essence 继承 ③ 批量交易原子性 ④ 非法 intent 带差异回执 | ⬜ |
| B3 | M13 M15 M16 M17 M19 | **M0 全验收**（设计稿 §15）：两阵营互殴 10 回合、可存档/重放/分支、门控三态、批量交易、`pnpm sim --runs 1000` 出数值分布 | ⬜ |
| B4 | M18 M20 | ① 拔 LLM 完整可玩（MockProvider 注错全链路，C7）② 增富选项 100% 合法 ③ protoVer 冻结为 1 | ⬜ |

## 3. 防偏离机制（结构性，不靠自觉）

| 机制 | 落点 | 验证方式 |
|---|---|---|
| kernel 禁 Node API/时钟/随机 | `eslint.config.js` no-restricted-* | 探针文件注入违规 import，lint 必须报错 |
| 事件契约完备 | M01 discriminatedUnion + schema/ golden 快照 | 契约变更必须显式 `pnpm schema:export`，快照测试锁死 |
| applier 完备 | registry.assertComplete 构造期拦截 | 缺注册 → Timeline 构造即抛 |
| 状态可重放 | 每模块不变量 → verifyFold | 写状态模块的集成测试必跑 |
| 数字确定性 | 定点整数（FIXED_SCALE=10⁴） | 契约层 schema 拒浮点 |
| 判定权在引擎 | P1–P8 原则映射到模块边界 | code review 清单（§5） |
| case 回归 | C1–C7 夹具 + 集成测试 | 设计变更触发重跑（case 集文末规则） |
| LLM 可拔 | M0 全程零 LLM；M1 起注入失败测试 | P5 验收即测试形态 |

## 4. 夹具锚定规则

测试夹具的**字段值必须可追溯到验证 case 文档的实例**，注释标注来源（例：`// C1 T0：boss 掉落具名骨头（M01 §5 唯一实例示例）`）。禁止凭空编造「看起来合理」的数据——夹具是 case 集的可执行形态，两边漂移就失去回归意义。

新 case 的落地路径：case 文档 → M01 夹具更新 → 集成测试扩展 → （若契约缺口）设计稿变更走 §6。

## 5. code review 清单（自审，每提交前过一遍）

```text
[ ] 本提交的每个新函数能对应到设计稿某节/某不变量吗？（不能 → 设计稿缺了，补）
[ ] 是否有「顺手」加了设计稿没有的功能/参数？（有 → 删，或先改设计稿）
[ ] 写状态路径是否全部过 timeline 事务？（P2）
[ ] 新数值是否定点整数？（P7）
[ ] 新事件类型是否走 contract + schema:export？
[ ] 夹具是否锚定 case 文档？
[ ] 是否引入了 LLM 依赖而本阶段不该有？（P5 分期）
```

## 6. 设计变更流程

实现期发现设计缺陷（必然发生）：

1. **停实现**，改设计稿（`rpg-engine-design.md` 或模块稿），版本号 +0.1；
2. 触发条件命中（§3 case 回归行）→ 重跑 C1–C7 推演，记录到 case 集文末；
3. 相关模块测试同步更新；
4. 一个 commit 内完成「设计稿 + 代码 + 测试」三方同步——**不允许设计与代码分叉过夜**。

## 7. 工具命令速查

```bash
pnpm test              # 全量测试（提交前必绿）
pnpm lint              # ESLint（含 kernel 边界规则）
pnpm exec tsc --noEmit # 类型检查
pnpm schema:export     # 契约 JSON Schema golden 导出（契约变更后必须重跑）
```
