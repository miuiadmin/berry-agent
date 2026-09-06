# berry-agent-sdk

berry-agent 的类型化 SDK 客户端。两种传输同一方法面：

- **spawn serve stdio**——托管子进程（一条 stdin/stdout NDJSON 线，适合脚本内嵌）；
- **直连 HTTP**——daemon Unix socket 或前台 TCP（POST + SSE，适合常驻服务）。

类型面与线协议词汇与主仓单源同编译（零拷贝漂移）：`AgentEvent`、
`SdkWireFrame` 等帧类型直出自 berry-agent 契约件。

## 安装与快速上手

```bash
npm install berry-agent-sdk
```

### stdio 形（spawn serve 子进程）

```ts
import { createSdkClient, spawnServeTransport } from 'berry-agent-sdk';

const transport = spawnServeTransport({
  // 缺省 command = process.execPath（node 直跑形）；args 由调用方知悉安装布局
  args: ['<berry-agent 包路径>/dist/host/main.js', 'serve'],
});

const client = createSdkClient(transport);

// 发起会话（sessionId 缺席即新建；messageId 缺省客户端计数器形 sdk-N）
const ack = await client.prompt({ content: '帮我看看这个仓库' });

// 直播订阅：重放段（entries → replay-end）与直播段（event/heartbeat/ask）
// 一律入 onFrame；订阅柄在 replay-end 后 resolve
const handle = await client.subscribe({ sessionId: ack.sessionId }, (frame) => {
  if (frame.kind === 'event') console.log(frame.event);
});

await client.close(); // 收线子进程（stdin EOF → 优雅退出）
```

### HTTP 形（daemon socket / 前台 TCP）

```ts
import { createSdkClient, httpSdkTransport } from 'berry-agent-sdk';

const transport = httpSdkTransport({
  socketPath: '<daemon socket 路径>', // 或 host + port（TCP 形）
  token: '<面侧预置 token>',
});

const client = createSdkClient(transport);
const sessions = await client.sessions(); // 会话清单
const first = sessions[0]!;
const page = await client.getEntries({ sessionId: first.id }); // 断线对账（since 缺省从头）
const handle = await client.subscribe(
  { sessionId: first.id, after: 41 }, // after = 已收末条 seq（重放窗口 (after, 高水位]）
  (frame) => {
    /* … */
  },
);
await client.close();
```

## API 面

- `createSdkClient(transport)` —— `prompt` / `getEntries` / `sessions` /
  `interrupt` / `decide` / `subscribe` / `close`；错误帧统一投形
  `SdkError`（`code` / `message` / `sessionId?`）。
- `spawnServeTransport({ args, … })` / `httpSdkTransport({ socketPath | host+port, token })`
  —— 两实装同 `SdkTransport` 三档抽象：请求档（单帧应答）、无应答档
  （interrupt）、直播档（SSE / 线内 hello，replay-end 后建立）。
- 类型面：`AgentEvent` / `ApprovalAskAnswer` / `SdkRequest` / `SdkWireFrame` /
  `SdkAckFrame` / `SdkEntriesFrame` / `SdkSessionSummary` / `SdkDurableEntry` /
  `SdkEventFrame` / `SdkHelloFrame` / `SdkErrorFrame` / `SDK_PROTOCOL_VERSION`。

线协议语义（重放窗口、幂等键、心跳、审批竞速）见主仓规范篇
`设计文档/01-规范/`（03 §10.6 / 05 §3.5 / 07 §5）。

## 状态

0.1.0-alpha——随主仓批 13（SDK 通道）演进；发布机器批落定前暂不经 npm 分发。
