// M03 expr — 词法（M03-expr.md §2 语法）
//
// 词法域：标识符（可带点段，模板 ID 形态）/ 整数（定点域）/ 双引号字符串 /
//        运算符与标点 / 关键字（and or not includes——关键字不保留，按位置解析）
export type TokenKind =
  | 'id'
  | 'num'
  | 'str'
  | '('
  | ')'
  | ','
  | ':'
  | '-'
  | '>='
  | '<='
  | '=='
  | '!='
  | '>'
  | '<';

export interface Token {
  kind: TokenKind;
  text: string;
  /** 值：num 为整数、str 为去引号内容 */
  value?: number | string;
  pos: number;
}

import { ExprError } from './errors.js';

export class LexError extends ExprError {
  constructor(pos: number, message: string) {
    super(pos, message);
    this.name = 'LexError';
  }
}

const ID_START = /[a-zA-Z_]/;
const ID_PART = /[a-zA-Z0-9_]/;

export function lex(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    // 双引号字符串（决策 O2：单引号报错）
    if (c === '"') {
      const start = i;
      i++;
      let text = '';
      while (i < n && src[i] !== '"') {
        text += src[i]!;
        i++;
      }
      if (i >= n) throw new LexError(start, `字符串未闭合（位置 ${start}）`);
      i++;
      tokens.push({ kind: 'str', text: `"${text}"`, value: text, pos: start });
      continue;
    }
    if (c === "'") {
      throw new LexError(i, `字符串必须用双引号（位置 ${i}，得到 '${c}'）`);
    }
    // 数字（整数；负号由解析器处理为单目减——词法不收，保持 token 单义）
    if (c >= '0' && c <= '9') {
      const start = i;
      while (i < n && src[i]! >= '0' && src[i]! <= '9') i++;
      tokens.push({ kind: 'num', text: src.slice(start, i), value: Number(src.slice(start, i)), pos: start });
      continue;
    }
    // 标识符：段可带点（模板 ID 形态：weapon.inst.000412 / grey_wolves）。
    // 首段字母/下划线开头；后续段允许数字开头（uid 尾段 000412）。浮点不合法——
    // 数字分支不吞 '.'，'1.5' 会在 '.' 处报未识别字符（定点域，M03 §2）。
    if (ID_START.test(c!)) {
      const start = i;
      while (i < n && ID_PART.test(src[i]!)) i++;
      while (i < n && src[i] === '.' && ID_PART.test(src[i + 1] ?? '')) {
        i++;
        while (i < n && ID_PART.test(src[i]!)) i++;
      }
      tokens.push({ kind: 'id', text: src.slice(start, i), pos: start });
      continue;
    }
    // 两字符运算符
    const two = src.slice(i, i + 2);
    if (two === '>=' || two === '<=' || two === '==' || two === '!=') {
      tokens.push({ kind: two, text: two, pos: i });
      i += 2;
      continue;
    }
    if (c === '(' || c === ')' || c === ',' || c === ':' || c === '-' || c === '>' || c === '<') {
      tokens.push({ kind: c as TokenKind, text: c, pos: i });
      i++;
      continue;
    }
    throw new LexError(i, `未识别字符 '${c}'（位置 ${i}）`);
  }
  return tokens;
}
