/**
 * memory 域错误码注册（06 §8.1/§3/§5/§7——MEMORY_ 前缀族；02 §5.3 批 18c-1
 * 明列两码 + 批 18c-2 工具面扩三码，本仓新立）。
 *
 * 码语义分层：MEMORY_SECRET_DETECTED 管写前 secret 扫描命中拒写（DAO 入库
 * 单点执法——四写点物理汇入同一入库面，没有绕过扫描的写入方；诊断 log-only
 * 不回写疑似密钥本体）；MEMORY_ENTRY_INVALID 管候选/写请求坏形拒（闭集/
 * 形状/越界判据——18c-2 扩 promotedToSkill 词法与 ttl days 形两判据）；
 * MEMORY_NOT_FOUND / MEMORY_FROZEN / MEMORY_REVISION_NOT_FOUND 管持有面
 * 工具动词守卫（作用行缺席 / 撞冻结行 / 版本缺席）。本文件由模块公开面
 * index.ts 引入（注册纪律：import 发生才注册）。
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
      '候选/写请求坏形拒——kind 非七值闭集、owner_key 形违例（global | project:<根路径哈希> 两形外）、confidence 越界 [0,1]、summary/content 空、source_refs 元素坏形、promotedToSkill 技能名词法违例（^[a-z0-9]+(?:-[a-z0-9]+)*$ 且 ≤64）、ttl days 形违例（非正整数且非 null）',
  },
  {
    code: 'MEMORY_NOT_FOUND',
    module: 'memory',
    description:
      '工具动词作用行缺席——forget/restore/freeze/unfreeze/ttl 携 id 在库缺席响亮拒（GOAL_NOT_FOUND 同构守卫）',
  },
  {
    code: 'MEMORY_FROZEN',
    module: 'memory',
    description:
      '持有面写动词撞冻结行拒——forget（含 promotedToSkill 搬家）/ttl/restore 带 revision 内容回滚腿；frozen 免覆写执法，解冻-再写唯一路径',
  },
  {
    code: 'MEMORY_REVISION_NOT_FOUND',
    module: 'memory',
    description: 'restore 带 revision 而版本缺席——无链条目带版本拒、revision 越界同码（带版本 ⊃ 状态复活）',
  },
  {
    code: 'MEMORY_EXPORT_ROOT_DENIED',
    module: 'memory',
    description:
      '导出落盘路径越界可写根拒（批 18c-8）——/memory-export 命令 handler 内显式 isInsideRoot 判定（守门管道对插件内文件写不可见、memory 件无 safety 拓扑边；同律先例 SKILLS_WRITE_ROOT_DENIED / FS_OUTSIDE_WRITABLE_ROOTS——越界拒、边界分隔符守卫同款）',
  },
  {
    code: 'MEMORY_IMPORT_FORMAT_INVALID',
    module: 'memory',
    description:
      '导入文件首行 header 坏形整文件拒（批 18c-8）——magic 串 berry-agent-memory 不符或 formatVersion ≠ 1；行级坏形不入此码（行级宽容分账 rejectedMalformed——恢复式运维动词不弃批）',
  },
]);
