/**
 * lsp 桥域错误码注册（03 §10.2——LSP_ 前缀族首批，02 §5.3 明列三码）。
 *
 * 码名清单与语义真源 = 03 篇 §10.2 生命周期条 LSP_ 三码。本文件由模块公开
 * 面 index.ts 引入（注册纪律：写入点文件必须实际 import 本文件注册才发生
 * ——与 issue/scheduler/mcp 先例同款）。
 */
import { registerErrorCodes } from '../contracts/index.js';

registerErrorCodes([
  {
    code: 'LSP_CONNECT_FAILED',
    module: 'lsp',
    description:
      'LSP 实例 spawn/initialize 握手失败或超时（实例标 failed + ui.notify warn、在途/后续调用工具结果 error、下用再试并计熔断一败）',
  },
  {
    code: 'LSP_FRAME_INVALID',
    module: 'lsp',
    description:
      'Content-Length 帧坏形或帧资源双帽超限（攒头 16KiB / 攒正文 16MiB——声明值即缓冲吸收上界）——连接死归因 + 同步树杀，计熔断一败（坏帧 crash 与 close 事件经幂等闸不双计）',
  },
  {
    code: 'LSP_CIRCUIT_OPEN',
    module: 'lsp',
    description:
      '同 server 3 连败熔断开（实例级旗标、复位走 /reload、行内他服务器不受累；作用域回卷的协议化关停不计熔断计数）',
  },
]);
