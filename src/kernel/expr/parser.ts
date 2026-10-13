// M03 expr — 递归下降解析器（M03-expr.md §2 文法）
//
//   expr    := or
//   or      := and ('or' and)*
//   and     := not ('and' not)*
//   not     := 'not' not | cmp
//   cmp     := primary (relop primary)? | primary 'includes' str
//   primary := '(' expr ')' | num | '-' num | str | call
//   call    := id '(' args? ')'
//   args    := arg (',' arg)*
//   arg     := id ':' value | value        （value = num | '-' num | str | id）
import type { Ast, AstArg, CmpOp } from './ast.js';
import { ExprError } from './errors.js';
import { lex } from './lexer.js';
import type { Token } from './lexer.js';

export { ExprError };

const REL_OPS: Record<string, CmpOp> = {
  '>=': '>=',
  '<=': '<=',
  '==': '==',
  '!=': '!=',
  '>': '>',
  '<': '<',
};

export function parse(src: string): Ast {
  const tokens = lex(src);
  let i = 0;
  const peek = (): Token | undefined => tokens[i];
  const next = (): Token => {
    const t = tokens[i];
    if (!t) throw new ExprError(src.length, `表达式意外结束（位置 ${src.length}）`);
    i++;
    return t;
  };
  const eat = (kind: Token['kind']): Token => {
    const t = peek();
    if (!t || t.kind !== kind) {
      throw new ExprError(
        t?.pos ?? src.length,
        `期望 '${kind}'，得到 '${t?.text ?? 'EOF'}'（位置 ${t?.pos ?? src.length}）`,
      );
    }
    return next();
  };
  const isKeyword = (word: string): boolean => peek()?.kind === 'id' && peek()?.text === word;

  function expr(): Ast {
    return or_();
  }
  function or_(): Ast {
    let l = and_();
    while (isKeyword('or')) {
      next();
      l = { k: 'or', l, r: and_() };
    }
    return l;
  }
  function and_(): Ast {
    let l = not_();
    while (isKeyword('and')) {
      next();
      l = { k: 'and', l, r: not_() };
    }
    return l;
  }
  function not_(): Ast {
    if (isKeyword('not')) {
      next();
      return { k: 'not', a: not_() };
    }
    return cmp();
  }
  function cmp(): Ast {
    const l = primary();
    // 后缀 includes（lineage 专用形态，M03 决策 O3）
    if (isKeyword('includes')) {
      next();
      const s = eat('str');
      return { k: 'includes', a: l, s: s.value as string };
    }
    const t = peek();
    if (t && t.kind in REL_OPS) {
      next();
      return { k: 'cmp', op: REL_OPS[t.kind]!, l, r: primary() };
    }
    return l;
  }
  function primary(): Ast {
    const t = peek();
    if (!t) throw new ExprError(src.length, `期望值或谓词，得到 EOF（位置 ${src.length}）`);
    if (t.kind === '(') {
      next();
      const e = expr();
      eat(')');
      return e;
    }
    if (t.kind === '-') {
      next();
      const num = eat('num');
      return { k: 'num', v: -(num.value as number) };
    }
    if (t.kind === 'num') return next(), { k: 'num', v: t.value as number };
    if (t.kind === 'str') return next(), { k: 'str', v: t.value as string };
    if (t.kind === 'id') {
      next();
      // call 形态
      if (peek()?.kind === '(') {
        next();
        const args: AstArg[] = [];
        if (peek()?.kind !== ')') {
          args.push(arg());
          while (peek()?.kind === ',') {
            next();
            args.push(arg());
          }
        }
        eat(')');
        return { k: 'call', name: t.text, args };
      }
      // 裸标识符 = 零参谓词调用（§7 形态：player_level >= 8——谓词注册表由宿主解析）
      return { k: 'call', name: t.text, args: [] };
    }
    throw new ExprError(t.pos, `期望值或谓词，得到 '${t.text}'（位置 ${t.pos}）`);
  }
  function arg(): AstArg {
    const t = peek();
    if (!t) throw new ExprError(src.length, `期望参数，得到 EOF（位置 ${src.length}）`);
    // 命名参数：id ':' value
    if (t.kind === 'id' && tokens[i + 1]?.kind === ':') {
      next();
      next();
      return { key: t.text, value: valueAst() };
    }
    return { value: valueAst() };
  }
  function valueAst(): Ast {
    const t = peek();
    if (!t) throw new ExprError(src.length, `期望值，得到 EOF（位置 ${src.length}）`);
    if (t.kind === '-') {
      next();
      const num = eat('num');
      return { k: 'num', v: -(num.value as number) };
    }
    if (t.kind === 'num') return next(), { k: 'num', v: t.value as number };
    if (t.kind === 'str') return next(), { k: 'str', v: t.value as string };
    if (t.kind === 'id') return next(), { k: 'str', v: t.text };
    throw new ExprError(t.pos, `期望值，得到 '${t.text}'（位置 ${t.pos}）`);
  }

  const result = expr();
  if (i < tokens.length) {
    const t = tokens[i]!;
    throw new ExprError(t.pos, `表达式后有多余内容 '${t.text}'（位置 ${t.pos}）`);
  }
  return result;
}

export { lex };
export type { Token };
