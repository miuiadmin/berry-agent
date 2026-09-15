/**
 * 引擎出口代理件（03 §10.3 安全卫生条——引擎网络栈出口钉死，2026-09-15 批）。
 *
 * 病灶（「钉死不可达」定案翻案后的闭口件）：Chrome 引擎子进程自身网络栈的
 * 全部流量（重定向链/子资源/页内 JS fetch——navigate 首跳预检射程外）绕过
 * web 卫生单源与 dns-pin；DNS rebinding 在 browser 载体全窗敞开（预检时
 * Node 解析公网 → Chrome 连接时二次独立解析可获内网）。本件以「引擎全部
 * 出网流量改走本地回环出口代理」接管：
 *   - spawn 旗（engine 件编舞）：--proxy-server 指向本件侦听端点 + 剥
 *     loopback bypass + Chrome 侧自发 DNS 全灭 + 禁 QUIC + 禁非代理 UDP
 *     ——代理是引擎唯一出网口；
 *   - 代理端（本件）：每条 CONNECT 隧道 / http 明文 absolute-form 请求按
 *     host 过 web 卫生单源同源两查（parseWebUrl 协议白名单 +
 *     assertPublicHost 字面 IP 私网拒 + DNS 全地址私网拒），通过即直连
 *     经校验地址集首址（校验结果 = 连接目标，无二次解析、单飞无 TOCTOU
 *     窗——较 Node 面 dns-pin「首钉保留」更强形：每连接新查，DNS 真变更
 *     走新校验）；拒即断连（Chrome 面折连接失败 fail-closed——旁路执法面
 *     不产模型可见错误码）。
 *
 * 侦听恒回环 bind（127.0.0.1——LAN 面不开口，开放代理红线）；零新增依赖
 * （node:net 原生）；窄面注入 {resolveDns, netConnect, logger} 保纯逻辑可
 * 测。进程级单例（engineEgressProxy）惰性 listen + unref 不阻进程退出；
 * 代理不可用 = 引擎全部出网请求失败（安全缺省，非可用性回退）。
 */
import { connect as tcpConnect, createServer } from 'node:net';
import type { Socket } from 'node:net';
import { BaseError } from '../contracts/index.js';
import { assertPublicHost, defaultDnsResolver, parseWebUrl } from '../web/index.js';
import type { DnsResolver } from '../web/index.js';
import type { BrowserLoggerFace, BrowserProxyFace } from './types.js';

/** peek 首段帽（字节——请求行/头块超帽未完结即病态腿，fail-closed 断连） */
const PEEK_CAP_BYTES = 16 * 1024;

/** CONNECT 腿缺省端口（authority 形无端口按 https 语义——Chrome 恒显式携带，防御位） */
const CONNECT_DEFAULT_PORT = 443;

/** 上游连接目标（经校验地址集首址 + 目的端口） */
export interface ProxyConnectTarget {
  readonly host: string;
  readonly port: number;
}

/** 编排依赖（窄面注入——纯逻辑可测；import 仅 web 公开面，零扩面消费） */
export interface BrowserProxyDeps {
  /** DNS 解析器（缺省 web 公开面 defaultDnsResolver——卫生单源同源） */
  readonly resolveDns?: DnsResolver;
  /** TCP 连接面（缺省 node:net 直连经校验地址；测试注入重定向桩——目标可断言） */
  readonly netConnect?: (target: ProxyConnectTarget) => Promise<Socket>;
  /** logger 窄面（缺省静默——装配单例无 context 边，同 dns-pin dispatcher 律） */
  readonly logger?: BrowserLoggerFace;
}

/** 缺省 TCP 连接面：直连经校验地址（连接即回执 socket；错误经 reject） */
const defaultNetConnect = (target: ProxyConnectTarget): Promise<Socket> =>
  new Promise<Socket>((resolve, reject) => {
    const sock = tcpConnect(target, () => resolve(sock));
    // 拒后仍留错误监听（管道期错误不至未处理事件炸进程——真处置在接管面级联）
    sock.once('error', reject);
  });

/**
 * 组引擎出口代理（回环侦听器 + 分腿状态机）。
 * 两类腿同序执法：peek 请求行 → host 过卫生单源同源两查 → 直连经校验地址
 * → 双向字节管道；任何拒/败即双双断连 fail-closed。
 */
export function createBrowserProxy(deps: BrowserProxyDeps = {}): BrowserProxyFace {
  const resolveDns = deps.resolveDns ?? defaultDnsResolver;
  const netConnect = deps.netConnect ?? defaultNetConnect;
  const logger = deps.logger;

  const server = createServer((socket: Socket) => {
    // 相位机：peek（攒首段找请求行/头块）→ validating（校验+连接中续攒）→
    // piping（双向管道）→ dead（断连收口）
    let phase: 'peek' | 'validating' | 'piping' | 'dead' = 'peek';
    let buffered: Buffer = Buffer.alloc(0);
    let upstream: Socket | undefined;

    /** 双断收口（幂等——任一向失败/关闭即两向皆断，不留半开管道） */
    const killBoth = (): void => {
      phase = 'dead';
      socket.destroy();
      upstream?.destroy();
    };

    /** 拒连收口：断连 + warn 日志（旁路执法面——不产模型可见错误码） */
    const rejectLeg = (target: string, err: unknown): void => {
      const detail =
        err instanceof BaseError ? `${err.code}：${err.message}` : err instanceof Error ? err.message : String(err);
      logger?.warn(`browser 出口代理拒连：${target}（${detail}）`);
      killBoth();
    };

    /** 校验 + 接管一条腿（kind 分初始转发语义；skipBytes = 代理语义前缀字节数——CONNECT 头块不抵上游，接管时刷活量 buffered 尾〔含校验窗内到达字节〕） */
    const openLeg = async (kind: 'connect' | 'plain', line: string, skipBytes: number): Promise<void> => {
      // —— 请求行三段形分腿（METHOD target HTTP/x——病态即拒 fail-closed）——
      const parts = line.split(' ');
      const method = parts[0] ?? '';
      const target = parts[1] ?? '';
      const version = parts[2] ?? '';
      if (method === '' || target === '' || !version.startsWith('HTTP/')) {
        throw new Error('请求行非三段形（非代理协议腿）');
      }
      let url: URL;
      let port: number;
      if (kind === 'connect') {
        // CONNECT authority 形（host:port / [v6]:port）——构 http:// 前缀走卫生
        // 单源（hostname/port 由 URL 解析归一；v6 字面经 [] 包裹形正确解出）
        url = parseWebUrl(`http://${target}`);
        port = url.port === '' ? CONNECT_DEFAULT_PORT : Number(url.port);
      } else {
        // http 明文 absolute-form（request-target 即完整 URL；origin-form 非
        // 绝对形在此不可解析即拒——未知腿 fail-closed）。协议面显式收紧：
        // https:// absolute-form 明文腿拒（Chrome 明文腿恒 http——病态腿即拒，
        // 防按缺省 80 端口伪连）
        url = parseWebUrl(target);
        if (url.protocol !== 'http:') {
          throw new Error('明文腿非 http 协议（absolute-form 须 http://）');
        }
        port = url.port === '' ? 80 : Number(url.port);
      }
      // —— web 卫生单源同源两查：字面 IP 私网拒 + DNS 全地址私网拒 ——
      const addresses = await assertPublicHost(url, resolveDns);
      const address = addresses[0];
      if (address === undefined || address === '') {
        throw new Error('经校验地址集为空（无可连目标——fail-closed）');
      }
      // —— 直连经校验地址集首址（校验结果 = 连接目标，无二次解析、无 TOCTOU 窗）——
      const sock = await netConnect({ host: address, port });
      if (phase === 'dead') {
        // 校验/连接窗内客户端已断——迟到连接即收（不留孤儿上游）
        sock.destroy();
        return;
      }
      upstream = sock;
      if (kind === 'connect') {
        // 隧道应答先行（客户端等 200 才发 TLS 字节——代理 CONNECT 语义）
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      }
      // 已读字节原样抵上游——刷**活量** buffered 尾（skipBytes 截去代理语义前缀：
      // 明文腿 0 = 请求行+头+已到体全量；隧道腿 = 头块后早发载荷），**含校验窗内
      // 到达的追加减字节**（活量单次刷抵——本句与置 piping 间无 await，数据事件
      // 无穿插窗；快照视图形已废——彼形窗内到达字节滞留 buffered 无人补抵）
      const pending = buffered.subarray(skipBytes);
      if (pending.length > 0) sock.write(pending);
      buffered = Buffer.alloc(0); // piping 后 buffered 不再被读——即时弃置（不滞留窗内字节内存）
      logger?.debug?.(`browser 出口代理透传：${url.hostname}:${String(port)} → ${address}:${String(port)}`);
      // —— 双向字节管道（背压不理会——回环垫片，环回带宽远超引擎消费）——
      phase = 'piping';
      sock.on('data', (chunk) => {
        if (!socket.destroyed) socket.write(chunk);
      });
      sock.on('close', () => killBoth());
      sock.on('error', () => killBoth());
    };

    /** peek 分腿派发（请求行齐即派；CONNECT 另需头块完结定隧道载荷起点） */
    const tryDispatch = (): void => {
      if (buffered.length > PEEK_CAP_BYTES) {
        logger?.warn('browser 出口代理：首段超帽无完整请求行/头块（病态腿）——断连');
        killBoth();
        return;
      }
      const lineEnd = buffered.indexOf('\r\n');
      if (lineEnd === -1) return; // 请求行未完——续攒
      const line = buffered.subarray(0, lineEnd).toString('latin1');
      const method = (line.split(' ')[0] ?? '').toUpperCase();
      if (method === 'CONNECT') {
        // CONNECT 腿：头块（至 \r\n\r\n）属代理语义不抵上游——隧道载荷自头块后始
        const headerEnd = buffered.indexOf('\r\n\r\n');
        if (headerEnd === -1) return; // 头块未完——续攒
        phase = 'validating';
        void openLeg('connect', line, headerEnd + 4).catch((err: unknown) => {
          rejectLeg(line.split(' ')[1] ?? '?', err);
        });
        return;
      }
      // http 明文 absolute-form 腿：全量已读字节原样转发（前缀 0）
      phase = 'validating';
      void openLeg('plain', line, 0).catch((err: unknown) => {
        rejectLeg(line.split(' ')[1] ?? '?', err);
      });
    };

    socket.on('data', (chunk: Buffer) => {
      if (phase === 'piping') {
        // 管道向：客户端字节原样抵上游
        if (upstream !== undefined && !upstream.destroyed) upstream.write(chunk);
        return;
      }
      if (phase === 'dead') return; // 已收口——丢弃迟到字节
      // peek/validating：续攒（校验窗内到达的字节不丢——接管时原样补抵上游）
      buffered = buffered.length === 0 ? chunk : Buffer.concat([buffered, chunk]);
      if (phase === 'validating') return;
      tryDispatch();
    });
    socket.on('error', () => killBoth());
    socket.on('close', () => killBoth());
  });

  // 进程级不阻退出（unref——句柄不持活；代理随消费位生命周期恒在）
  server.unref();

  // 服务级错误监听**单挂**（闭包级一次——listen 重试不再累积监听器，防
  // MaxListeners 警告）：listen 窗内经 reject 面折断引擎启动，listen 后的
  // 迟到错误只 warn（同 listenReject 指针翻转律——reject 面单次有效）
  let listenReject: ((err: Error) => void) | undefined;
  server.on('error', (err: Error) => {
    const rejectFn = listenReject;
    listenReject = undefined;
    if (rejectFn !== undefined) rejectFn(err);
    else logger?.warn(`browser 出口代理侦听面错误：${err.message}`);
  });

  // 惰性单次 listen（重复 endpoint() 复用同一次——进程级单例语义）
  let listening: Promise<string> | undefined;
  return {
    endpoint(): Promise<string> {
      if (listening === undefined) {
        listening = new Promise<string>((resolve, reject) => {
          listenReject = reject;
          // 回环 bind（127.0.0.1——LAN 面不开口；零端口竞态同引擎 DevTools 律）
          server.listen(0, '127.0.0.1', () => {
            listenReject = undefined;
            const addr = server.address();
            if (addr === null || typeof addr === 'string') {
              // 理论不达（TCP listen 回执恒对象形）——防御位
              reject(new Error('出口代理侦听回执异常'));
              return;
            }
            resolve(`127.0.0.1:${String(addr.port)}`);
          });
        });
        // listen 败即清粘滞（下次 endpoint() 重试——安全缺省下 spawn 面已折断）
        listening.catch(() => {
          listening = undefined;
        });
      }
      return listening;
    },
  };
}

/** 进程级单例（装配位消费——dns-pin dispatcher 单例同律；惰性 listen） */
let singleton: BrowserProxyFace | undefined;

/** 引擎出口代理单例取用面（core:browser 装配位传真身到 service/engine 编舞） */
export function engineEgressProxy(): BrowserProxyFace {
  if (singleton === undefined) {
    singleton = createBrowserProxy();
  }
  return singleton;
}
