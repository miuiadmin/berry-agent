/**
 * mcp 桥域错误码注册（03 §10.1——MCP_ 前缀族首批）。
 *
 * 前缀族明列见 contracts/errors.ts ERROR_CODE_PREFIXES（02 §5.3 #1）；码名清
 * 单与语义真源 = 03 篇 §10.1 连接语义/行帧卫生条 MCP_ 两码。本文件由模块公
 * 开面 index.ts 引入（注册纪律：写入点文件必须实际 import 本文件注册才发
 * 生——与 issue/scheduler 先例同款）。
 */
import { registerErrorCodes } from '../contracts/index.js';

registerErrorCodes([
  {
    code: 'MCP_CONNECT_FAILED',
    module: 'mcp',
    description:
      '单服务器连接失败降级（spawn 失败 / initialize 握手超时 / 运行期 crash / 行帧坏或 stdout 单行超 8MiB 帽的载体级失败——不阻同行其余、撤工具 + ui.notify warn、不自动重连）',
  },
  {
    code: 'MCP_CONFIG_INVALID',
    module: 'mcp',
    description: 'config.servers 行载荷坏（键词法违例 / command 非绝对路径 / 字段类型坏形——响亮拒不静默吞）',
  },
]);
