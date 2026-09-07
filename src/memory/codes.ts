/**
 * memory 域错误码注册（06 §8.1/§3——MEMORY_ 前缀族；02 §5.3 批 18c-1
 * 明列两码，本仓新立）。
 *
 * 码语义分层：MEMORY_SECRET_DETECTED 管写前 secret 扫描命中拒写（DAO 入库
 * 单点执法——四写点物理汇入同一入库面，没有绕过扫描的写入方；诊断 log-only
 * 不回写疑似密钥本体）；MEMORY_ENTRY_INVALID 管候选/写请求坏形拒（闭集/
 * 形状/越界判据）。本文件由模块公开面 index.ts 引入（注册纪律：import 发生
 * 才注册）。
 */
import { registerErrorCodes } from '../contracts/index.js';

registerErrorCodes([
  {
    code: 'MEMORY_SECRET_DETECTED',
    module: 'memory',
    description:
      '写前 secret 扫描命中拒写——DAO 入库单点执法（即时路/周期路/memory_write/导入直插四写点汇入同一入库面）；诊断 log-only 不回写疑似密钥本体（报 pattern 名，不落命中文本）',
  },
  {
    code: 'MEMORY_ENTRY_INVALID',
    module: 'memory',
    description:
      '候选/写请求坏形拒——kind 非七值闭集、owner_key 形违例（global | project:<根路径哈希> 两形外）、confidence 越界 [0,1]、summary/content 空、source_refs 元素坏形',
  },
]);
