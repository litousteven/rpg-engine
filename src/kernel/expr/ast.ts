// M03 expr — AST 与可序列化形态（M03-expr.md §1/§2）
//
// AST 为可序列化 JSON（存档记录版本，谓词集只增不删）。
// 求值是纯函数（P7）：同 (ast, ctx) 同结果，ctx 只读。

export type Ast =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'bool'; v: boolean }
  | { k: 'and'; l: Ast; r: Ast }
  | { k: 'or'; l: Ast; r: Ast }
  | { k: 'not'; a: Ast }
  | { k: 'cmp'; op: CmpOp; l: Ast; r: Ast }
  | { k: 'call'; name: string; args: AstArg[] }
  /** 后缀运算：primary includes "..."（lineage 谓词专用形态，M03 决策 O3） */
  | { k: 'includes'; a: Ast; s: string };

export type CmpOp = '>=' | '<=' | '==' | '!=' | '>' | '<';

export interface AstArg {
  /** 命名参数键（tag:/npc:/category:…）；裸参数无 key */
  key?: string;
  value: Ast;
}

/** 版本化序列化（v1；字段只增不改） */
export const AST_VERSION = 1;

export const serializeAst = (ast: Ast): unknown => ({ v: AST_VERSION, ast });

export function deserializeAst(json: unknown): Ast {
  if (
    typeof json !== 'object' ||
    json === null ||
    (json as { v?: unknown }).v !== AST_VERSION ||
    !('ast' in json)
  ) {
    throw new Error(`AST 反序列化失败：非版本化形态`);
  }
  return (json as { ast: Ast }).ast;
}
