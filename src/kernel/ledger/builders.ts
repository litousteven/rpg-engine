// M05 ledger — builders（模块设计稿 M05-ledger.md §2，L1/L5/L6）
//
// 纯函数（读 state，产出事件或回执；不写状态）。校验双层中的 builder 预检侧：
// 乐观预检产出 R1 回执；applier 兜底硬校验（两层一致由 L2 参数化测试锁死）。
//
// 夹具锚定（dev-process §4）：
//   C3 买锤：2 transfer + 2 gold 同事务、purse 不足 → 回执 economy.purse
//   C4 批量：4 transfer + 1 gold、≥50 行附 ledger.batch
//   C5 rep 18→33；C6 队长倒戈 membership → base 重算、personal 保留
import type {
  ActorId,
  EntityRef,
  GameState,
  SourceRef,
  TemplateId,
} from '../../contract/index.js';
import { findEntries } from './query.js';
import { reject } from './builder-kit.js';
import type { BuildEventDraft, BuildResult } from './builder-kit.js';

const DEFAULT_CLIENT_KEY = 'engine.internal';

// ── gold ──────────────────────────────────────────────────────────

/** C3 锚点：玩家付款 balance = old + delta（负余额拒） */
export function buildGoldChange(
  state: GameState,
  cmd: { actor: ActorId; delta: number; source: SourceRef; clientKey?: string },
): BuildResult {
  const actor = state.actors[cmd.actor];
  if (!actor) {
    return reject(cmd.clientKey ?? DEFAULT_CLIENT_KEY, [
      { field: 'actor', submitted: cmd.actor, expected: '已注册 Actor', rule: 'ledger.actor_exists' },
    ]);
  }
  const old = actor.gold ?? 0;
  const balance = old + cmd.delta;
  if (balance < 0) {
    return reject(cmd.clientKey ?? DEFAULT_CLIENT_KEY, [
      { field: 'delta', submitted: cmd.delta, expected: `≥ ${-old}（余额 ${old} 不足）`, rule: 'ledger.gold_nonnegative' },
    ]);
  }
  return ok([
    { t: 'gold.changed', actor: cmd.actor, delta: cmd.delta, balance, source: cmd.source },
  ]);
}

// ── purse（C3：铁匠 purse 800，收购后 500；不足 → 回执 economy.purse） ──

export function buildPurseChange(
  state: GameState,
  cmd: { npc: ActorId; balance: number; source: SourceRef; clientKey?: string },
): BuildResult {
  const npc = state.actors[cmd.npc];
  if (!npc) {
    return reject(cmd.clientKey ?? DEFAULT_CLIENT_KEY, [
      { field: 'npc', submitted: cmd.npc, expected: '已注册 Actor', rule: 'ledger.actor_exists' },
    ]);
  }
  if (cmd.balance < 0) {
    return reject(cmd.clientKey ?? DEFAULT_CLIENT_KEY, [
      { field: 'balance', submitted: cmd.balance, expected: '≥ 0', rule: 'economy.purse' },
    ]);
  }
  return ok([
    { t: 'purse.changed', npc: cmd.npc, balance: cmd.balance, source: cmd.source },
  ]);
}

// ── rep / affinity（L4 域 [-100,100]；C5 锚点 18→33） ──────────────

export function buildRepChange(
  state: GameState,
  cmd: { faction: TemplateId; delta: number; source: SourceRef; clientKey?: string },
): BuildResult {
  const old = state.ledgers.factionRep[cmd.faction] ?? 0;
  const value = old + cmd.delta;
  if (value < -100 || value > 100) {
    return reject(cmd.clientKey ?? DEFAULT_CLIENT_KEY, [
      { field: 'delta', submitted: cmd.delta, expected: `声望 ${old} + delta ∈ [-100, 100]`, rule: 'ledger.rep_domain' },
    ]);
  }
  return ok([{ t: 'rep.changed', faction: cmd.faction, delta: cmd.delta, value, source: cmd.source }]);
}

export function buildAffinityChange(
  state: GameState,
  cmd: { npc: ActorId; delta: number; value: number; source: SourceRef; clientKey?: string },
): BuildResult {
  if (cmd.value < -100 || cmd.value > 100) {
    return reject(cmd.clientKey ?? DEFAULT_CLIENT_KEY, [
      { field: 'value', submitted: cmd.value, expected: '∈ [-100, 100]', rule: 'ledger.affinity_domain' },
    ]);
  }
  return ok([{ t: 'affinity.changed', npc: cmd.npc, delta: cmd.delta, value: cmd.value, source: cmd.source }]);
}

// ── membership（L7：内联 base 重算、personal 保留——C6 队长倒戈） ──

export function buildMembershipChange(
  state: GameState,
  cmd: {
    npc: ActorId;
    to: TemplateId;
    source: SourceRef;
    /** base = f(势力声望) 阶梯表（P4 规则即数据；规则库未配时默认 0） */
    repToBase?: (faction: TemplateId, rep: number) => number;
    clientKey?: string;
  },
): BuildResult {
  const npc = state.actors[cmd.npc];
  if (!npc) {
    return reject(cmd.clientKey ?? DEFAULT_CLIENT_KEY, [
      { field: 'npc', submitted: cmd.npc, expected: '已注册 Actor', rule: 'ledger.actor_exists' },
    ]);
  }
  const from = npc.membership;
  const events: BuildEventDraft[] = [
    { t: 'membership.changed', npc: cmd.npc, from: from ?? 'faction.none', to: cmd.to, source: cmd.source },
  ];
  // base 重算：新势力声望 → base（personal 保留在状态侧——applier 只改 base）
  const rep = state.ledgers.factionRep[cmd.to] ?? 0;
  const base = cmd.repToBase ? cmd.repToBase(cmd.to, rep) : defaultRepToBase(rep);
  const cur = state.ledgers.npcAffinity[cmd.npc];
  events.push({ t: 'affinity.changed', npc: cmd.npc, delta: base - (cur?.base ?? 0), value: base + (cur?.personal ?? 0), source: cmd.source });
  return ok(events);
}

/** 阶梯表（P4 规则即数据；B1 默认表——内容侧可覆写） */
export function defaultRepToBase(rep: number): number {
  if (rep >= 60) return 40;
  if (rep >= 30) return 20;
  if (rep >= 0) return 0;
  if (rep >= -30) return -20;
  return -40;
}

// ── item.transferred（L3：堆叠按 template+rarity 合并、实例 uid 唯一） ──

export function buildItemTransfer(
  state: GameState,
  cmd: {
    from: ActorId;
    to: ActorId;
    ref: EntityRef;
    qty: number;
    price?: number;
    source: SourceRef;
    clientKey?: string;
  },
): BuildResult {
  if (cmd.qty < 1) {
    return reject(cmd.clientKey ?? DEFAULT_CLIENT_KEY, [
      { field: 'qty', submitted: cmd.qty, expected: '≥ 1', rule: 'ledger.qty_positive' },
    ]);
  }
  // 实例类引用：qty 必须为 1（G1 实例不堆叠）——先于库存检查（语义更准）
  if (/^item\.inst\./.test(cmd.ref) || cmd.ref.startsWith('tag:') || cmd.ref.startsWith('loreRef:')) {
    if (cmd.qty !== 1) {
      return reject(cmd.clientKey ?? DEFAULT_CLIENT_KEY, [
        { field: 'qty', submitted: cmd.qty, expected: '= 1（唯一实例不可拆分）', rule: 'ledger.instance_no_split' },
      ]);
    }
  }
  // B1 账本单侧（玩家 inventory 是权威账面；from 的商人库 B2 进 M11）
  const owned = findEntries(state, cmd.ref).reduce((n, e) => n + e.qty, 0);
  if (owned < cmd.qty) {
    return reject(cmd.clientKey ?? DEFAULT_CLIENT_KEY, [
      { field: 'qty', submitted: cmd.qty, expected: `≤ ${owned}（库存 ${owned}）`, rule: 'ledger.stock_sufficient' },
    ]);
  }
  const event: BuildEventDraft = {
    t: 'item.transferred',
    from: cmd.from,
    to: cmd.to,
    ref: cmd.ref,
    qty: cmd.qty,
    source: cmd.source,
  };
  if (cmd.price !== undefined) event.price = cmd.price;
  return ok([event]);
}

// ── item.destroyed（B2 结算用；B1 合成链材料消耗） ────────────────

export function buildItemDestroyed(
  state: GameState,
  cmd: { owner: ActorId; ref: EntityRef; qty: number; source: SourceRef; clientKey?: string },
): BuildResult {
  if (cmd.qty < 1) {
    return reject(cmd.clientKey ?? DEFAULT_CLIENT_KEY, [
      { field: 'qty', submitted: cmd.qty, expected: '≥ 1', rule: 'ledger.qty_positive' },
    ]);
  }
  const owned = findEntries(state, cmd.ref).reduce((n, e) => n + e.qty, 0);
  if (owned < cmd.qty) {
    return reject(cmd.clientKey ?? DEFAULT_CLIENT_KEY, [
      { field: 'qty', submitted: cmd.qty, expected: `≤ ${owned}（库存 ${owned}）`, rule: 'ledger.stock_sufficient' },
    ]);
  }
  return ok([{ t: 'item.destroyed', owner: cmd.owner, ref: cmd.ref, qty: cmd.qty, source: cmd.source }]);
}

// ── buildBatchSell（C4：N transfer + 1 gold；≥50 行附 ledger.batch） ──

export function buildBatchSell(
  state: GameState,
  cmd: {
    seller: ActorId;
    merchant: ActorId;
    stacks: { ref: EntityRef; qty: number }[];
    unitPrices: number[];
    source: SourceRef;
    clientKey?: string;
  },
): BuildResult {
  const clientKey = cmd.clientKey ?? DEFAULT_CLIENT_KEY;
  if (cmd.stacks.length !== cmd.unitPrices.length) {
    return reject(clientKey, [
      {
        field: 'unitPrices',
        submitted: cmd.unitPrices.length,
        expected: `= stacks.length (${cmd.stacks.length})`,
        rule: 'ledger.batch_shape',
      },
    ]);
  }
  const events: BuildEventDraft[] = [];
  let total = 0;
  for (const [i, s] of cmd.stacks.entries()) {
    const owned = findEntries(state, s.ref).reduce((n, e) => n + e.qty, 0);
    if (owned < s.qty) {
      return reject(clientKey, [
        { field: `stacks[${i}].qty`, submitted: s.qty, expected: `≤ ${owned}（库存 ${owned}）`, rule: 'ledger.stock_sufficient' },
      ]);
    }
    events.push({
      t: 'item.transferred',
      from: cmd.seller,
      to: cmd.merchant,
      ref: s.ref,
      qty: s.qty,
      source: cmd.source,
    });
    total += s.qty * cmd.unitPrices[i]!;
  }
  const old = state.actors[cmd.seller]?.gold ?? 0;
  events.push({
    t: 'gold.changed',
    actor: cmd.seller,
    delta: total,
    balance: old + total,
    source: cmd.source,
  });
  // L6：行数 ≥ 50 时附加审计摘要（applier no-op）
  if (cmd.stacks.length >= 50) {
    events.push({
      t: 'ledger.batch',
      actor: cmd.seller,
      rows: cmd.stacks.map((s, i) => ({
        kind: 'remove' as const,
        ref: s.ref,
        qty: s.qty,
        amount: -s.qty * cmd.unitPrices[i]!,
      })),
      source: cmd.source,
    });
  }
  return ok(events);
}

// ── 内部 ─────────────────────────────────────────────────────────

const ok = (events: BuildEventDraft[]): BuildResult => ({ ok: true, events });

