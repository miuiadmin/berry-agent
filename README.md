# berry-agent

单一、可扩展的个人 Agent——对话与编码即本体，一切能力以**插件**装载。
TypeScript + SQLite + [pi-ai](https://github.com/earendil-works/pi-ai)。

> 状态：`0.1.0-alpha`，开发中——规范先行、契约优先，代码随批次纵切落地。

## 开发

```bash
npm install
npm run typecheck       # 门禁一：tsc --noEmit
npm test                # 门禁二：vitest run
npm run lint:topology   # 门禁三：模块 DAG 边表 + API 治理面门禁
npm run format:check    # 门禁四：prettier 检查
npm run build           # tsc 直出 dist/
```

四门禁提交前全绿。

## 环境变量

| 变量 | 作用 | 缺省 |
| --- | --- | --- |
| `BERRY_AGENT_MODEL` | 覆盖缺省模型 | — |
| `BERRY_AGENT_DATA_DIR` | 覆盖数据目录 | `~/.berry-agent` |
| `BERRY_AGENT_LOG_LEVEL` | 日志级别（error / warn / info / debug / silent） | `info` |

其余 env 前缀一律 `BERRY_AGENT_*`。

## License

[MIT](./LICENSE)
