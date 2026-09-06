/**
 * session 模块域错误码注册（05 篇会话与存储——append 流水线/遮蔽/导入/fork 各执法点）。
 *
 * contracts CORE_ERROR_CODES 已含三枚（第一批）：SESSION_UNKNOWN_EVENT_TYPE
 * （词汇检查）/ SESSION_EVENT_OVER_BUDGET（预算刀身份码——裁腿不抛、warn 落账
 * 带码标识）/ SESSION_CORE_TYPE_FORBIDDEN（核心词身份双闸）。本文件补域内五枚。
 */
import { registerErrorCodes } from '../contracts/index.js';

registerErrorCodes([
  // 05 §1.2 步 3：data 单遍校验——非法载荷 fail-loud（undefined 织进载荷/类实例/循环引用等）
  {
    code: 'SESSION_EVENT_DATA_INVALID',
    module: 'session',
    description: '事件 data 非法（非纯 JSON 值：undefined/function/symbol/bigint/NaN·Infinity/类实例/循环引用）',
  },
  // 05 §2.1 边缘纪律五条执法：appendWithSurfaceOp 与 compaction 内部同一码
  {
    code: 'SESSION_SURFACE_OP_INVALID',
    module: 'session',
    description: '遮蔽指令非法（区间越界/溯源不完整/切在 tool 配对中间/二次遮蔽/嵌套遮蔽）',
  },
  // 05 §5.1 身份闸：导入文件自描述不认识即拒载
  {
    code: 'SESSION_IMPORT_BAD_FORMAT',
    module: 'session',
    description: '导入文件格式不认识（自描述格式版本/导出器标识缺或未知）',
  },
  // 05 §5.1 洪水闸：会话增生限流（首版 100/分钟）——码名已裁（2026-09-05 拍板题 15：沿用此名，改名收益不抵扫引成本）
  {
    code: 'SESSION_SPAWN_RATE_LIMIT',
    module: 'session',
    description: '会话增生限流触发（单进程单位时间导入/fork 新建会话数超帽）',
  },
  // 05 §5.1：persist:false（内存会话）上调 forkSession/导入——fork 语义需要物理新会话
  {
    code: 'SESSION_PERSISTENCE_REQUIRED',
    module: 'session',
    description: '该操作需要持久化会话（内存会话不支持 fork/导入——静默降级为拷贝 = 语义谎言）',
  },
]);
