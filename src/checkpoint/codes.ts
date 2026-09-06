/**
 * checkpoint 域错误码注册（05 §5.3——CHECKPOINT_ 前缀族；02 §5.3 批 15d
 * 明列四码）。
 *
 * 码语义分层：CAPTURE_FAILED 管 pre-mutation 捕获 fail-closed（快照是
 * rewind 语义承诺的前提）；NOT_FOUND 管回退点缺席守卫；STORE_CORRUPT 管
 * 快照仓坏形 fail-loud（宁拒不误读）；RESTORE_FAILED 管恢复执行 IO 失败
 * （pre-rewind 保底快照在场可重跑收敛）。本文件由模块公开面 index.ts
 * 引入（注册纪律：import 发生才注册）。
 */
import { registerErrorCodes } from '../contracts/index.js';

registerErrorCodes([
  {
    code: 'CHECKPOINT_CAPTURE_FAILED',
    module: 'checkpoint',
    description: 'pre-mutation 捕获失败——守门段 fail-closed block 位（拍不了就放行变异 = 伪承诺；含 walk 超文件帽）',
  },
  {
    code: 'CHECKPOINT_NOT_FOUND',
    module: 'checkpoint',
    description: '回退点缺席——已裁剪或坏 id（/rewind 作用目标守卫）',
  },
  {
    code: 'CHECKPOINT_STORE_CORRUPT',
    module: 'checkpoint',
    description: '快照仓坏形——manifest 坏形或 blob 哈希不符，fail-loud 拒误读',
  },
  {
    code: 'CHECKPOINT_RESTORE_FAILED',
    module: 'checkpoint',
    description: '恢复执行 IO 失败——pre-rewind 保底快照在场，重跑同 manifest 幂等收敛',
  },
]);
