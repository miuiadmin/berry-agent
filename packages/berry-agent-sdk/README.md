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
  // 默认 command = process.execPath（node 直跑形）；入口路径 = 主包 bin 真源
  // （package.json「bin.berry」→ dist/src/host/main.js）
  args: ['<berry-agent 包路径>/dist/src/host/main.js', 'serve'],
});

const client = createSdkClient(transport);

// 发起会话（sessionId 缺席即新建；messageId 默认客户端计数器形 sdk-N）
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
const { sessions, total } = await client.sessions(); // 会话清单（默认最近 100 个、按更新时间倒序）；total = 全量总数（超窗即截断披露判据）
const first = sessions[0]!;
const page = await client.getEntries({ sessionId: first.id }); // 断线补齐（since 默认从头）
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
  —— 两实装同 `SdkTransport` 三种抽象：请求形（单帧返回）、无返回形
  （interrupt）、直播形（SSE / 线内 hello，replay-end 后建立）。
- 类型面（与 `src/index.ts` 桶导出对拍——增删导出须同笔改本清单）：客户端面
  `SdkFrameListener` / `SdkLiveHandle` / `SdkLiveParams` / `SdkTransport` /
  `SdkClient` / `SdkPromptInput` / `SdkPromptImage` / `SdkEntriesInput` /
  `SdkSessionsResult`；线协议/契约面 `AgentEvent` / `ApprovalAskAnswer` /
  `ApprovalDecideAnswer` /
  `SdkRequest` / `SdkWireFrame` / `SdkAckFrame` / `SdkEntriesFrame` /
  `SdkSessionsFrame` / `SdkSessionSummary` / `SdkDurableEntry` / `SdkEventFrame` /
  `SdkHelloFrame` / `SdkErrorFrame` / `SdkHeartbeatStage` / `SdkHeartbeatFrame` /
  `SdkReplayEndFrame` / `SdkDecideResultFrame` / `SdkAskFrame`；传输选项面
  `SpawnServeOptions` / `SdkStdioTransport` / `HttpSdkOptions`；值常量
  `SDK_FRAME_KINDS` / `SDK_PROTOCOL_VERSION`。

## 状态

`0.1.0-alpha.12`——随主仓演进（版本真源 = 本包 `package.json` 的 `version` 字段）；npm 分发走主仓发布机器 `release:sdk`。
