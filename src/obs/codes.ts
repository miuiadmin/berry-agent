/**
 * obs 域错误码注册（02 §5.3 OBS_ 族批 18b 明列两码；03 §10.8 错误码族条款）。
 *
 * 两码分层：OBS_DB_OPEN_FAILED 管开库/建链失败（fail-loud——派生库坏
 * 不拖垮宿主：构造即抛、由装载面降级跳件）；OBS_ROLLUP_CORRUPT 管查询
 * 命中坏行（fail-loud 拒误读，同 PERSIST_DATA_CORRUPT 律——派生物宁弃
 * 读不误读，重算即修复）。
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
]);
