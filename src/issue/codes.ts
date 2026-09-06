/**
 * issue 域错误码注册（03 §10.7——ISSUE_ 前缀族首批）。
 *
 * 前缀族明列见 contracts/errors.ts ERROR_CODE_PREFIXES（02 §5.3 #1）；码名清
 * 单与语义真源 = 03 篇 §10.7 入队/触发/交付条 ISSUE_ 四码。本文件由模块公开
 * 面 index.ts 引入（注册纪律：写入点文件必须实际 import 本文件注册才发
 * 生——与 llm/session/persist/tools 的 codes.ts 同款）。
 */
import { registerErrorCodes } from '../contracts/index.js';

registerErrorCodes([
  {
    code: 'ISSUE_SOURCE_UNREACHABLE',
    module: 'issue',
    description: 'issue 源不可达（轮询/webhook 取数网络折——DNS/连接/5xx 等非限额类失败）',
  },
  {
    code: 'ISSUE_SOURCE_RATE_LIMITED',
    module: 'issue',
    description: 'issue 源限额（GitHub 403/429——detail 携 retryAfter 秒；轮询下轮自退避，入队不重试风暴）',
  },
  {
    code: 'ISSUE_WEBHOOK_INVALID',
    module: 'issue',
    description: 'webhook 请求坏形（签名不符/JSON 坏/载荷非 issue 域形——响亮拒不静默吞）',
  },
  {
    code: 'ISSUE_JOB_DUPLICATE',
    module: 'issue',
    description: '同 dedupeKey（repo#issue）在飞互斥撞锁（03 §10.7 入队条——进程内语义，双触发源竞速护栏）',
  },
]);
