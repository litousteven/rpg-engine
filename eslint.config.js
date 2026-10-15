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
  {
    // M07/M06/M08 验收：规则加载、合成与触发器联测跑真实 content/ 文件——
    // fs 读取是 storage 职责（R-6），测试文件是 storage 侧缝隙的替身，获准触碰 fs。
    files: [
      'src/kernel/rules/__tests__/*.ts',
      'src/kernel/entity/__tests__/*.ts',
      'src/kernel/trigger/__tests__/*.ts',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
);
