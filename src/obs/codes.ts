/**
 * obs 域错误码注册（02 §5.3 OBS_ 族批 18b 明列两码；03 §10.8 错误码族条款；
 * 2026-09-08 e-2 观测腿批扩 SESSION_OBSERVE_DENIED——module 段 obs，与
 * SESSION_ 族操控四码〔module 段 conversation〕分域并存〔02 §5.3 跨功能域
 * 共用前缀注〕）。
 *
 * 两码分层：OBS_DB_OPEN_FAILED 管开库/建链失败（fail-loud——派生库坏
 * 不拖垮宿主：构造即抛、由装载面降级跳件）；OBS_ROLLUP_CORRUPT 管查询
 * 命中坏行（fail-loud 拒误读，同 PERSIST_DATA_CORRUPT 律——派生物宁弃
 * 读不误读，重算即修复）。
 * SESSION_OBSERVE_DENIED 管跨树观测门拒（03 §4.6 v1 首批第五枚
 * sessions.observe-cross——CREDENTIALS_NAMESPACE_DENIED 同构门检拒码
 * 先例；obs 会话维工具族 execute 内执法）。
 * 本文件由模块公开面 index.ts 引入（注册纪律：import 发生才注册）。
 */
import { registerErrorCodes } from '../contracts/index.js';

registerErrorCodes([
  {
    code: 'OBS_DB_OPEN_FAILED',
    module: 'obs',
    description:
      'rollup 自管库开库/建链失败 fail-loud（03 §10.8——派生库坏不拖垮宿主：构造即抛、由装载面降级跳件；含 schema 版本高于本件的拒开档与 dispose 后再调用的拒用档）',
  },
  {
    code: 'OBS_ROLLUP_CORRUPT',
    module: 'obs',
    description:
      '查询命中 rollup 坏行（计数/桶值非数或负数）——fail-loud 拒误读，同 PERSIST_DATA_CORRUPT 律（派生物重算即修复）',
  },
  {
    code: 'SESSION_OBSERVE_DENIED',
    module: 'obs',
    description:
      '跨树观测未开门拒（03 §4.6 v1 首批第五枚 sessions.observe-cross 门检执法——obs 会话维工具族跨树目标/全会话枚举；树内 self/tree 两档零开门〔03 §10.8 可见性分轴——观测轴树内白给〕；CREDENTIALS_NAMESPACE_DENIED 同构先例）',
  },
  {
    code: 'SESSION_OBSERVE_SCOPE_INVALID',
    module: 'obs',
    description:
      '活体订阅作用域坏形拒（04 §6 e-2——ctx.events.subscribeSessionLifecycle 的 scope self/tree 档缺 sessionId 锚、或 scope 非三值词面；fail-loud 拒不静默降档——静默升 all 档等价于绕门）',
  },
]);
