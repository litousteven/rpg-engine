# M06 entity — 实体系统

> 对应设计稿：§5（实体系统全部）/ §5.1（实例身份）/ §5.3（essence 继承与血统链）/ §5.4（描述投影）。批次：B1。依赖：contract、M07 Ruleset（模板/配方引用）。被依赖：M05（spawn 入袋）、M12（结算触发 spawn/compose）、M21（内容校验，M4）。
>
> 状态：设计稿 v1.0（2026-10-13），实现前确认稿。

## 1. 数据模型与不变量

| # | 不变量 | 说明 |
|---|---|---|
| E-1 | uid 唯一落点 | `meta.uidCounter` 由 **applier** 在 fold `item.spawned`/`entity.composed` 时推进；applier 强制 `event.uid === counter+1`（严格序——乱序事件被拒，重放确定）。builder 只读预测下一 uid 写入事件 |
| E-2 | named 升级实例 | 掉落表 `named: true` → 产出唯一实例（uid/provenance/essence），永不堆叠；普通掉落 → 堆叠条目（M05 合并） |
| E-3 | essence 快照继承 | 继承在 **spawn/compose 时刻焊死**：来源特质（boss/遗迹主题）→ 实体 essence 字段。运行期只读——「一致性由构造保证」（§5.3）的血统侧 |
| E-4 | 血统链完整 | `provenance.lineage` 在诞生时写入完整链（C1：`boss.bone_maw → item.inst.000317 → item.inst.000412`），§7 lineage 谓词与叙事检索的事实源 |
| E-5 | 组合校验四层 | 展示（naming 消毒，contract）/ 机制（配方合法 + 材料在包 + essence 映射可达）/ 数值（点数预算定价——**B2/M11**）/ 经济出处（creator/lineage/legality）。B1 落前两层 |
| E-6 | 能力槽只引用 | abilities 引用 M07 原语 id；存在性由内容校验（M21）保证，运行时只消费（P4） |

## 2. 公开接口

```ts
// builders（纯函数；uid 预测 + provenance/essence 焊接）
buildItemSpawned(state, cmd: {
  to: ActorId; template: TemplateId; qty: number; rarity: Rarity;
  essence: Slug[]; named: boolean;
  provenance: { source: string; roll?: string; lineage?: string[] };
  source: SourceRef; loreRef?: TemplateId; abilities?: Ability[];
}): Result<GameEvent[], Receipt>

buildEntityComposed(state, cmd: {
  recipe: TemplateId; materials: { ref: EntityRef; qty: number }[];
  naming?: NamingPayload; source: SourceRef;
}): Result<GameEvent[], Receipt>
// 机制层校验：材料在包（M05 查询）、配方在规则库、essence→原语映射存在（M07）
// 产出：entity.composed（新实例）+ item.destroyed（消耗材料）——同事务原子

// appliers
entityAppliers(): item.spawned / entity.composed / ability.applied / naming.sanitized

// 描述投影（§5.4，纯函数）
describeProjection(entity, lore?: LoreEntry, flavor?: string): Description
// 四段：基础模板文案 / provenance 事实行 / loreRef 背景摘要 / 风味缓存（可选）——P2 镜像：事实→文案，永不反向
```

## 3. 依赖端口

- M07 Ruleset：模板定义（物品池/掉落表）、配方（essence→效果原语映射）；
- M05：材料在包查询、spawn 后账本写入（`item.spawned` 的 applier 直接写 inventory——**诞生即入账**，一个事件完成）。

## 4. 事件产出

| 事件 | 说明 |
|---|---|
| `item.spawned` | 诞生即入账（to 字段）；applier 写库存 + uidCounter 推进（E-1） |
| `entity.composed` | 合成产出新实例；与材料消耗（item.destroyed）同事务 |
| `ability.applied` | 装备/携带生效（C2 G8：passive 生效） |
| `naming.sanitized` | 命名消毒审计 |

## 5. 测试与验收

1. **C1 T0 主路径**：掉落表 named 骨头 → `buildItemSpawned` → timeline.apply → 实例入袋（uid/provenance/essence/lineage 全落账）→ `player_owns(tag:...)` 谓词真（M08 联测）。
2. **C2**：护符 spawn（loreRef + passive/active/cost 三型能力槽）。
3. **合成链**（C1 T3）：骨头材料 → 骨刃 → lineage 三段链完整；材料不足 → 回执。
4. **uid 严格序**：伪造乱序 uid 事件 → applier 拒（E-1）。
5. **堆叠 vs 实例**：普通掉落 ×20 → 一条堆叠（qty 20）；named 再掉 → 新实例。
6. **B1 收口**：`tests/b1-closeout.test.ts` 主体（见 M08 §5）。

## 6. 决策状态（2026-10-13 用户裁决）

| # | 问题 | 状态 |
|---|---|---|
| O1 | spawn 与入袋一个事件还是两个（spawned + transferred） | **一个**：`item.spawned.to` 即诞生入账；boss→玩家是 provenance.source 事实，不是账面易主。`item.transferred` 留给已有物易主（买卖/交付/赠予），谓词语义不混 |
| O2 | 描述投影放 M06 还是独立模块 | **M06 内 `describeProjection`**（纯函数）；Narrator/模板文案（M1/M18）是消费者，B1 只落结构 + provenance 行 |
