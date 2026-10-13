// M03 expr — 纯函数求值（M03-expr.md §3）
//
// 求值上下文 = 谓词注册表（由宿主注入：M08 触发器 / M09 菜单门控 / M14 弧入口）。
// 谓词只读权威状态（§7 硬规则 3）；求值无副作用、同输入同输出（P7）。
import type { Ast } from './ast.js';
import { ExprError } from './parser.js';

export type PredValue = boolean | number | string;

export interface ArgValue {
  key?: string;
  value: PredValue;
}

/** 谓词上下文：宿主实现查表（账本走索引，不扫描叙事归档） */
export type PredicateContext = (name: string, args: ArgValue[]) => PredValue;

/** 谓词签名注册表（checkTypes 静态查用；宿主声明全部可用谓词的返回类型） */
export type PredicateRegistry = Record<string, { returns: 'bool' | 'num' | 'str' }>;

export function evaluate(ast: Ast, ctx: PredicateContext): boolean {
  return toBool(evalNode(ast, ctx));
}

function evalNode(ast: Ast, ctx: PredicateContext): PredValue {
  switch (ast.k) {
    case 'num':
      return ast.v;
    case 'str':
      return ast.v;
    case 'bool':
      return ast.v;
    case 'and':
      return toBool(evalNode(ast.l, ctx)) && toBool(evalNode(ast.r, ctx));
    case 'or':
      return toBool(evalNode(ast.l, ctx)) || toBool(evalNode(ast.r, ctx));
    case 'not':
      return !toBool(evalNode(ast.a, ctx));
    case 'cmp':
      return cmpOp(ast.op, evalNode(ast.l, ctx), evalNode(ast.r, ctx));
    case 'includes': {
      const left = evalNode(ast.a, ctx);
      if (typeof left !== 'string') {
        throw new ExprError(0, `includes 左侧必须为字符串（lineage 谓词），得到 ${typeof left}`);
      }
      return left.includes(ast.s);
    }
    case 'call':
      return ctx(ast.name, ast.args.map((a) => ({ key: a.key, value: evalNode(a.value, ctx) })));
  }
}

/** 严格布尔：数字/字符串不是真值（P7 严格性——非布尔操作数是内容错误，由 checkTypes 静态查） */
function toBool(v: PredValue): boolean {
  if (typeof v === 'boolean') return v;
  throw new ExprError(0, `期望布尔值，得到 ${typeof v}（${JSON.stringify(v)}）`);
}

/** 比较两侧类型必须匹配（number vs string 是类型错误不是 false——静态可查，决策 O1） */
function cmpOp(op: string, l: PredValue, r: PredValue): boolean {
  if (typeof l !== typeof r) {
    throw new ExprError(0, `比较类型不匹配：${typeof l} ${op} ${typeof r}`);
  }
  switch (op) {
    case '>=':
      return l >= r;
    case '<=':
      return l <= r;
    case '==':
      return l === r;
    case '!=':
      return l !== r;
    case '>':
      return l > r;
    case '<':
      return l < r;
    default:
      throw new ExprError(0, `未知比较运算：${op}`);
  }
}

/** 静态类型检查（内容校验用，§14-7）：谓词存在性、返回类型、比较两侧类型匹配、顶层为布尔 */
export function checkTypes(ast: Ast, registry: PredicateRegistry): void {
  const typeOf = (node: Ast): 'bool' | 'num' | 'str' => {
    switch (node.k) {
      case 'num':
        return 'num';
      case 'str':
        return 'str';
      case 'bool':
        return 'bool';
      case 'and':
      case 'or':
      case 'not':
        return 'bool';
      case 'cmp':
      case 'includes':
        return 'bool';
      case 'call': {
        const sig = registry[node.name];
        if (!sig) throw new ExprError(0, `未知谓词：${node.name}（不在注册表）`);
        for (const a of node.args) typeOf(a.value); // 参数是值——只查类型，不做顶层布尔断言
        return sig.returns;
      }
    }
  };
  const walk = (node: Ast): void => {
    switch (node.k) {
      case 'and':
      case 'or': {
        const lt = typeOf(node.l);
        const rt = typeOf(node.r);
        if (lt !== 'bool') throw new ExprError(0, `逻辑运算左操作数必须为布尔（得到 ${lt}）`);
        if (rt !== 'bool') throw new ExprError(0, `逻辑运算右操作数必须为布尔（得到 ${rt}）`);
        break;
      }
      case 'not': {
        const t = typeOf(node.a);
        if (t !== 'bool') throw new ExprError(0, `not 操作数必须为布尔（得到 ${t}）`);
        break;
      }
      case 'cmp': {
        const lt = typeOf(node.l);
        const rt = typeOf(node.r);
        if (lt !== rt) {
          throw new ExprError(0, `比较类型不匹配：${lt} ${node.op} ${rt}`);
        }
        break;
      }
      case 'includes': {
        const lt = typeOf(node.a);
        if (lt !== 'str') throw new ExprError(0, `includes 左侧必须为 str，得到 ${lt}`);
        break;
      }
      case 'call':
        typeOf(node);
        break;
      default:
        break;
    }
  };
  walk(ast);
  const top = typeOf(ast);
  if (top !== 'bool') {
    throw new ExprError(0, `顶层表达式必须为布尔，得到 ${top}`);
  }
}
