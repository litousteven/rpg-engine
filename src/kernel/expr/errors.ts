// M03 expr — 错误形态（位置 + 原因；词法/解析共用基类）
export class ExprError extends Error {
  constructor(
    readonly pos: number,
    message: string,
  ) {
    super(message);
    this.name = 'ExprError';
  }
}
