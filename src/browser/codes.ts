/**
 * browser 桥域错误码注册（03 §10.3——BROWSER_ 前缀族首批）。
 *
 * 前缀族明列见 contracts/errors.ts ERROR_CODE_PREFIXES（02 §5.3 #1）；码名清
 * 单与语义真源 = 03 篇 §10.3 引擎发现序/生命周期条 + 02 §5.3 BROWSER_ 族四
 * 码。本文件由模块公开面 index.ts 引入（注册纪律：写入点文件必须实际 import
 * 本文件注册才发生——与 mcp/lsp 先例同款）。
 */
import { registerErrorCodes } from '../contracts/index.js';

registerErrorCodes([
  {
    code: 'BROWSER_ENGINE_NOT_FOUND',
    module: 'browser',
    description:
      '引擎发现序四步全缺席（显式覆盖 / 系统 Chrome 知名位 + PATH / 数据目录专用引擎）——工具调用诚实缺席拒附安装指引，不自动下载；显式覆盖指名路径缺席同码（显式误配 fail-loud 不静默回退）',
  },
  {
    code: 'BROWSER_CONNECT_FAILED',
    module: 'browser',
    description:
      '引擎 spawn 后 CDP 载体级失败（DevTools 侦听行缺席/启动超时、WebSocket 建立失败、连接中断）——结清在途请求 + 引擎降级（下用再试），不炸宿主',
  },
  {
    code: 'BROWSER_DIGEST_MISMATCH',
    module: 'browser',
    description:
      '/browser install 同版本重装摘要不符即拒执行（TOFU 锚定执法——账本既有指纹 vs 本次实收指纹），既有引擎不动',
  },
  {
    code: 'BROWSER_CONFIG_INVALID',
    module: 'browser',
    description: 'config.browser 行载荷坏（executablePath 非空字符串形 / providers 非数组形——装载时刻响亮拒）',
  },
]);
