// RPG 引擎 ESLint 配置。
// 边界硬规则（技术选型稿 §4，承设计稿 P7）：
//   kernel 与 contract 是确定性核心——禁止 Node API、时钟、非种子随机。
//   storage / llm / api / server / cli / sim 是外层，不受此限制。
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules', 'dist', 'coverage', 'schema'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/kernel/**/*.ts', 'src/contract/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'fs', 'path', 'os', 'process', 'util', 'crypto', 'events', 'stream', 'http', 'https', 'net', 'ws'],
              message: 'kernel/contract 禁止 Node API 与网络（技术选型稿 §4 硬规则 1）。',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: '禁时钟：回合号/到期队列是状态字段（技术选型稿 §4 硬规则 7）。' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: '禁 Math.random：随机只经 M02 PCG32（技术选型稿 §4 硬规则 2）。' },
      ],
    },
  },
);
