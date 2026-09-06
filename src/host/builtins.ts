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
