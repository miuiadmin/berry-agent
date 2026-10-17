/**
 * host/builtins — Node 内建模块裸名闭集（import 门禁裁决核的裸名分类面）。
 *
 * 名单 = Node LTS 内建集（node: 协议合法名）。白名单道②只收 `node:` 前缀
 * 形（03 §3.3 字面）——本清单用于裁决核把裸名分类为「裸内建被拒——用
 * node: 前缀」（报文指路），与裸第三方说明符的「树内不可解析」报文分流。
 * 随 Node 版本演进的名单差异：门禁语义按「可被 node: 前缀合法访问的内建」
 * 对账，新增内建随真实需求补列（fail-closed：不在清单的裸名走裸说明符道，
 * 树内不可解析同拒）。
 */
export const BARE_BUILTINS: ReadonlySet<string> = new Set([
  'assert',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'domain',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'sys',
  'timers',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
]);

/**
 * 道②分级·放行档闭集（03 §3.3 :357——纯计算内建，缺省免门）。
 *
 * 名单定谳判据（03 §3.3 :357）：无文件系统/网络/进程生成/环境面副作用——
 * 纯计算/纯数据族（纯函数与不可变数据结构变换，不触宿主可观察态）。
 * 逐名定谳：assert（断言纯判定）/ buffer（二进制数据结构）/ events
 * （ EventEmitter 内存对象）/ path（路径字符串纯变换）/ querystring（纯
 * 解析）/ string_decoder（字节流解码纯变换）/ url（URL 纯解析——WHATWG
 * 形无网络腿）/ util（格式化与纯工具）。
 *
 * fail-closed：不在本清单的内建一律受门档（os 读环境面、crypto/tls 载密
 * 码学随机源、stream/timers 触发异步调度、process 全局面、fs/net/http/
 * child_process 等有副作用面——常拒名与白名单的取舍按「副作用的机器可
 * 观察性」从严）。随 Node 演进的新内建：不在清单 = 受门档，有真实需求再
 * 评审补列（与 BARE_BUILTINS 同 fail-closed 律）。
 *
 * 子径族（node:fs/promises、node:url/whatwg 等）按首段裸名归级——声明面
 * 是裸名单枚（03 §4.2 深校验三拒之一「不在 BARE_BUILTINS 册」即裸名形）。
 */
export const PURE_COMPUTATION_BUILTINS: ReadonlySet<string> = new Set([
  'assert',
  'buffer',
  'events',
  'path',
  'querystring',
  'string_decoder',
  'url',
  'util',
]);
