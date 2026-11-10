/**
 * host/acp-share — ACP 多连接复用件（03 §10.6「撞锁代理形」批注的码面承载：
 * 聚合端〔hapi/Zed 等〕每会话 spawn 一 `berry acp`，撞单活跃机锁〔04 §1〕即
 * 让位先会话——修向 = 不放宽单活跃律，首进程持锁后顺带听数据目录内 unix
 * socket，后到 spawn 撞锁自动代理）。
 *
 * 两原语（编排归 acp-entry——本件纯机制零装配依赖）：
 * - `listenAcpShare`（holder 侧）：数据目录内 unix domain socket 监听
 *   （`acp.sock`）；陈旧 socket 文件 bind 前净除；listen 失败降级返 null
 *   （warn 不阻断——单连接现行为兜底）。
 * - `proxyAcpShare`（busy 侧）：探测该 socket 并纯字节代理 stdio↔socket
 *   （零协议解析零聚合端改配）；探测重试窗内仍不通返 null（调用方回落
 *   既有 fail-loud 呈报——锁持有者非 ACP 形态〔TUI 等〕时的诚实拒入）。
 *
 * 域界：同用户本机域信任——socket 锚数据目录内（0700 目录界），与数据
 * 目录同权界不另设门；跨机/跨用户不在 v1 射程（unix socket 天然本机）。
 */
import net from 'node:net';
import type { Readable, Writable } from 'node:stream';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

/** 数据目录内 ACP 复用 socket 路径（恒锚数据目录——零旗标：无配置面） */
export function acpSocketPath(dataDir: string): string {
  return join(dataDir, 'acp.sock');
}

/** holder 侧监听柄（close = 停止接受新连接；既有连接收口归调用方 faces 集） */
export interface AcpShareServer {
  readonly close: () => void;
}

/**
 * holder 侧：数据目录内 unix socket 监听。
 *
 * 每连接经 onConnection 交宿主 spawn face（io = {input: socket, output:
 * socket}——传输环 data/error/end 三事件面 Socket 全兼容）。resolve null =
 * 降级单连接（listen 失败 warn 后——启动不为此阻断）。
 */
export function listenAcpShare(opts: {
  readonly dataDir: string;
  readonly onConnection: (socket: net.Socket) => void;
  readonly warn: (message: string) => void;
}): Promise<AcpShareServer | null> {
  const path = acpSocketPath(opts.dataDir);
  return new Promise((resolve) => {
    // 陈旧 socket 文件净除（bind 语义：文件在场即 EADDRINUSE——上一持有者
    // 已退场的残文件不拦新听者；活听者在场则锁必被其持有，本进程到不了这里）。
    try {
      rmSync(path, { force: true });
    } catch {
      // 净除失败交由 listen 报错降级（只读目录等罕见形）
    }
    const server = net.createServer((socket) => opts.onConnection(socket));
    let settled = false;
    const settle = (result: AcpShareServer | null) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    server.once('listening', () =>
      settle({
        close: () =>
          server.close(() => {
            // 退场净除（best-effort——残文件由下一持有者 bind 前净除兜底）
            try {
              rmSync(path, { force: true });
            } catch {
              /* 残文件无害：下轮净除 */
            }
          }),
      }),
    );
    server.once('error', (err) => {
      opts.warn(`acp-share: socket listen 失败（降级单连接形）——${err.message}`);
      settle(null);
    });
    server.listen(path);
  });
}

/** 单次 connect（ECONNREFUSED/ENOENT 折 reject——重试窗判定素材） */
function connectOnce(path: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(path);
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

const PROXY_RETRY_INTERVAL_MS = 100;

/**
 * busy 侧：探测复用 socket 并纯字节代理 input↔socket→output。
 *
 * resolve 0 = 干净收场（任一侧收线）；1 = 传输面坏死；**null = 探测不通**
 * （重试窗〔缺省 1.5s——holder 启动竞窗〕内 ECONNREFUSED/ENOENT 持续——
 * 调用方回落既有 fail-loud 呈报，锁持有者非 ACP 形态即此形）。
 */
export async function proxyAcpShare(opts: {
  readonly dataDir: string;
  readonly input: Readable;
  readonly output: Writable;
  /** 探测重试窗（缺省 1500ms——测试可缩短） */
  readonly retryMs?: number;
  readonly warn: (message: string) => void;
}): Promise<number | null> {
  const path = acpSocketPath(opts.dataDir);
  const deadline = Date.now() + (opts.retryMs ?? 1500);
  let socket: net.Socket | undefined;
  for (;;) {
    try {
      socket = await connectOnce(path);
      break;
    } catch {
      if (Date.now() >= deadline) return null; // 探测不通——调用方回落 fail-loud
      await new Promise((resolve) => setTimeout(resolve, PROXY_RETRY_INTERVAL_MS));
    }
  }
  const wire = socket;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      wire.destroy();
      resolve(code);
    };
    // 纯字节双管（零协议解析——聚合端协议帧原样透传）
    opts.input.pipe(wire);
    wire.pipe(opts.output);
    // input EOF → 半关写向（holder face 见 end → 收口该连接；其余连接不受涉）
    opts.input.on('end', () => wire.end());
    opts.input.on('error', () => finish(1));
    // holder 侧收线（正常 face 收口 end / 异常 destroy）→ 代理退场
    wire.on('end', () => finish(0));
    wire.on('close', (hadError) => finish(hadError ? 1 : 0));
    wire.on('error', (err) => {
      opts.warn(`acp-share: 复用连接坏死——${err.message}`);
      finish(1);
    });
  });
}
