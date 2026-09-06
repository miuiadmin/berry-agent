/**
 * scheduler 域错误码注册（04 §12 调度条——SCHEDULER_ 前缀族；02 §5.3 批 15a
 * 明列八码）。
 *
 * 码语义分层：四码守 /tick 六动词与程序面的行管理（NAME_INVALID/NAME_EXISTS/
 * NOT_FOUND/JOB_INVALID）；一码管 schedule 串词法（SCHEDULE_INVALID——
 * GoalJobsFace register 坏串响亮拒不炸装配时 message 即引此码）；三码管
 * OS cron 可选后端（CRON_UNSUPPORTED/CRON_UNAUTHORIZED/CRON_WRITE_FAILED
 * ——04 §12「OS 定时注册态」已裁乙案条的跨平台处置与人面授权链执法面）。
 * 本文件由模块公开面 index.ts 引入（注册纪律：import 发生才注册）。
 */
import { registerErrorCodes } from '../contracts/index.js';

registerErrorCodes([
  {
    code: 'SCHEDULER_NAME_INVALID',
    module: 'scheduler',
    description: '任务名词法违例——须匹配 ^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$（goal 挂钟行名 goal-<goalId> 同型合法）',
  },
  {
    code: 'SCHEDULER_NAME_EXISTS',
    module: 'scheduler',
    description: '名冲突守卫——add/挂钟 register 撞既有行拒（jobs 表行即唯一事实源）',
  },
  {
    code: 'SCHEDULER_NOT_FOUND',
    module: 'scheduler',
    description: '幽灵名零行守卫——enable/disable/rm 作用行缺席响亮拒（04 §12 /tick 瘦身条 2026-09-04 同款守卫）',
  },
  {
    code: 'SCHEDULER_SCHEDULE_INVALID',
    module: 'scheduler',
    description:
      'schedule 串词法/语义坏形——四形 every:/once@+相对/once@绝对/daily@/weekly@ 之外，含 interval 下限 5s 违反与 cron 后端 sub-minute/非 60 倍数拒',
  },
  {
    code: 'SCHEDULER_JOB_INVALID',
    module: 'scheduler',
    description: '行载荷坏——prompt 空/超 16KiB、cwd 非绝对路径或建行时不存在',
  },
  {
    code: 'SCHEDULER_CRON_UNSUPPORTED',
    module: 'scheduler',
    description:
      'cron 可选后端诚实拒——win32 无用户 crontab 形态、后端缺席形态下启用 OS 注册面（04 §12 OS 定时注册态已裁条）',
  },
  {
    code: 'SCHEDULER_CRON_UNAUTHORIZED',
    module: 'scheduler',
    description: '人面授权链未过——写系统 crontab 需一次人面授权，授权拒即拒写（04 §12 OS 定时注册态已裁条）',
  },
  {
    code: 'SCHEDULER_CRON_WRITE_FAILED',
    module: 'scheduler',
    description: 'crontab 读改写链失败——保留他人行的写回失败亮拒不静默（以 # berry-agent:<名> 标记行定位自有条目）',
  },
]);
