/**
 * persist 域错误码注册（05 篇 §6 物理存储——物理层码族 PERSIST_ 首批）。
 *
 * 前缀族明列见 contracts/errors.ts ERROR_CODE_PREFIXES（02 §5.3 #1；2026-09-05
 * persist 落码批补列）。本文件由模块公开面 index.ts 引入（注册纪律：写入点
 * 文件必须实际 import 本文件，注册才发生——与 session/codes.ts 同款）。
 */
import { registerErrorCodes } from '../contracts/index.js';

registerErrorCodes([
  {
    code: 'PERSIST_SCHEMA_TOO_NEW',
    module: 'persist',
    description: '版本门禁红：库内 user_version 高于宿主迁移链 head（降级运行拒开，05 §6.4）',
  },
  {
    code: 'PERSIST_SCHEMA_UNRECOGNIZED',
    module: 'persist',
    description: '库文件不可识别：非空库但 user_version=0（外来 SQLite 文件/损坏残卷，宁拒绝不误读）',
  },
  {
    code: 'PERSIST_DATA_CORRUPT',
    module: 'persist',
    description: '库内数据损坏：JSON 列解析失败等外因损坏（断电半写/手编库），fail-loud 拒误读',
  },
  {
    code: 'PERSIST_WRITE_EXHAUSTED',
    module: 'persist',
    description: 'write-behind 批级重试耗尽（首版 3 次）——进程 fail-loud（写不进库的会话继续跑 = 谎报持久化，05 §6.3）',
  },
  {
    code: 'PERSIST_SECRET_UNREADABLE',
    module: 'persist',
    description: '凭证密文不可解读：密钥丢失/不匹配（AES-256-GCM 解密失败）——重录凭证即恢复',
  },
]);
