// M03 expr — 公共出口
export { lex, LexError } from './lexer.js';
export type { Token, TokenKind } from './lexer.js';
export { parse, ExprError } from './parser.js';
export { AST_VERSION, serializeAst, deserializeAst } from './ast.js';
export type { Ast, AstArg, CmpOp } from './ast.js';
export { evaluate, checkTypes } from './eval.js';
export type { PredValue, ArgValue, PredicateContext, PredicateRegistry } from './eval.js';
