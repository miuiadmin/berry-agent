/**
 * cron 可选后端乙案（04 §12：缺省进程内挂钟〔甲案〕；OS cron 后端 = 宿主
 * 停机期不断保的可选增强）。写用户 crontab 的编舞：
 *
 *   - 自有条目行尾标记 `# berry-agent:<名>`（对外声明值位——去品牌化例外）；
 *     读改写全程保留他人行（只增删自有标记行）；
 *   - 人面授权链（authorize 注入——写 crontab 是改用户系统态，授权缺席
 *     即未授权：亮拒 SCHEDULER_CRON_UNAUTHORIZED，不猜默认放行）；
 *   - win32 诚实拒（crontab 生态不在——SCHEDULER_CRON_UNSUPPORTED，不装能）；
 *   - schedule 可表达性：cron 分钟粒度——sub-minute 间隔与非 60 倍数分钟
 *     间隔拒（UNSUPPORTED）；once 形拒（cron 表达不了单发——单发归进程内
 *     挂钟独辖）；every/daily/weekly 可表达形全量映射；
 *   - 写失败（crontab 非零退出）SCHEDULER_CRON_WRITE_FAILED。
 *
 * 联动契约（service 消费）：register/unregister **同步**亮拒——调用方（行
 * 翻转/删行前的 service 面）先 OS 后行库的序，错在 OS 段即行未动（不半态）；
 * 故本件用 spawnSync 直读直写（启停/删行低频动作，短暂阻塞可接受）。
 */
import { spawnSync } from 'node:child_process';
import { BaseError } from '../contracts/index.js';
import type { Schedule } from './schedule.js';
import type { JobRow } from './types.js';

/** 注册器接缝（service 面联动消费——enable→register、disable/rm→unregister） */
export interface CronRegistrar {
  /** 挂 OS 注册（行启用即挂；不可表达/未授权/写失败抛 SCHEDULER_CRON_*） */
  register(row: JobRow): void;
  /** 注销 OS 注册（自有标记行摘除；无条目 no-op） */
  unregister(name: string): void;
}

/** crontab 执行结果（注入面契约——code 为退出码；-1 = spawn 本身失败） */
export interface CrontabResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** 装配依赖（全注入缺省真身——测试注假件零进程） */
export interface CronBackendDeps {
  /** 平台判（缺省 process.platform；win32 诚实拒） */
  platform?: NodeJS.Platform;
  /** 人面授权链（缺省缺席 = 未授权——写操作亮拒不猜） */
  authorize?: () => boolean;
  /** berry-agent 可执行（crontab 行命令段；缺省 'berry-agent'——PATH 名） */
  command?: string;
  /** crontab 执行器（缺省 spawnSync 真身；测试注入） */
  execCrontab?: (args: string[], input?: string) => CrontabResult;
}

/** 自有条目标记（行尾注释——读改写的身份判据；对外声明值位去品牌化例外） */
export function cronMarker(name: string): string {
  return `# berry-agent:${name}`;
}

/**
 * schedule → cron 表达式（纯函数，导出供测试）。
 *
 * day 编号两系同构（0=周日……6=周六：Date.getDay 与 cron dow 一致）——直接映射。
 */
export function scheduleToCron(s: Schedule): string {
  switch (s.kind) {
    case 'every': {
      if (s.seconds % 60 !== 0) {
        throw new BaseError(
          'SCHEDULER_CRON_UNSUPPORTED',
          `cron 分钟粒度：every:${s.seconds}s 非 60 整除秒不可表达（进程内挂钟可跑——OS 后端不挂）`,
        );
      }
      const minutes = s.seconds / 60;
      if (minutes === 1) return '* * * * *';
      if (minutes < 60) return `*/${minutes} * * * *`;
      if (minutes % 60 === 0) {
        const hours = minutes / 60;
        return hours === 1 ? '0 * * * *' : `0 */${hours} * * *`;
      }
      throw new BaseError(
        'SCHEDULER_CRON_UNSUPPORTED',
        `cron 表达不了 every:${s.seconds}s（非整分钟/整小时间隔——进程内挂钟可跑）`,
      );
    }
    case 'daily': {
      const [h, m] = s.time.split(':');
      return `${Number(m)} ${Number(h)} * * *`; // 域序换位 + 去零垫（cron 规范形）
    }
    case 'weekly': {
      const [h, min] = s.time.split(':');
      const dow = [...s.days].sort((a, b) => a - b).join(',');
      return `${Number(min)} ${Number(h)} * * ${dow}`;
    }
    case 'once':
      throw new BaseError(
        'SCHEDULER_CRON_UNSUPPORTED',
        'cron 表达不了 once 单发形（单发归进程内挂钟独辖——行停机错过即跳过）',
      );
  }
}

/** OS crontab 注册器实装（同步编舞——联动契约见头注） */
export function createOsCronRegistrar(deps: CronBackendDeps = {}): CronRegistrar {
  const platform = deps.platform ?? process.platform;
  const command = deps.command ?? 'berry-agent';
  const exec = deps.execCrontab ?? execCrontabViaSpawnSync;

  /** 平台前置（两动词同判——win32 无 crontab 生态，读写皆不可为） */
  function assertPlatform(): void {
    if (platform === 'win32') {
      throw new BaseError(
        'SCHEDULER_CRON_UNSUPPORTED',
        'win32 无 crontab 生态——OS cron 后端不支持（缺省进程内挂钟形态不受影响）',
      );
    }
  }

  /** 授权前置（写动作判——读 crontab 无害不判；注销摘自有行属收敛不判） */
  function assertAuthorized(): void {
    if (!deps.authorize || !deps.authorize()) {
      throw new BaseError(
        'SCHEDULER_CRON_UNAUTHORIZED',
        'OS cron 后端未获人面授权（写用户 crontab 须显式授权——不猜默认放行）',
      );
    }
  }

  /** 读当前 crontab（无 crontab = 空表——exit 1 且空 stdout 视为常态非错误） */
  function readCrontab(): string {
    const r = exec(['-l']);
    if (r.code === 0) return r.stdout;
    if (r.code === 1 && r.stdout.trim() === '') return ''; // 「no crontab for <user>」常态
    throw new BaseError(
      'SCHEDULER_CRON_WRITE_FAILED',
      `crontab -l 读失败（exit ${r.code}）：${r.stderr.trim() || '无 stderr'}`,
    );
  }

  /** 写新 crontab（stdin 注入形；非零退出亮拒） */
  function writeCrontab(content: string): void {
    const r = exec(['-'], content.endsWith('\n') || content === '' ? content : `${content}\n`);
    if (r.code !== 0) {
      throw new BaseError(
        'SCHEDULER_CRON_WRITE_FAILED',
        `crontab 写入失败（exit ${r.code}）：${r.stderr.trim() || '无 stderr'}`,
      );
    }
  }

  /** 自有标记行摘除（他人行原样保留；返回 [新内容, 是否有摘除]） */
  function stripMarkerLines(content: string, name: string): [string, boolean] {
    const marker = cronMarker(name);
    const kept: string[] = [];
    let removed = false;
    for (const line of content.split('\n')) {
      if (line.includes(marker)) removed = true;
      else kept.push(line);
    }
    return [kept.join('\n'), removed];
  }

  return {
    register(row) {
      assertPlatform();
      const cron = scheduleToCron(row.schedule); // 可表达性判先于授权（不授权也先知道形不行）
      assertAuthorized();
      const current = readCrontab();
      const [withoutSelf] = stripMarkerLines(current, row.name);
      const entry = `${cron} ${command} run --read-only --tick ${row.name} ${cronMarker(row.name)}`;
      const next = withoutSelf.trim() === '' ? entry : `${withoutSelf.trimEnd()}\n${entry}`;
      writeCrontab(next);
    },
    unregister(name) {
      assertPlatform();
      const current = readCrontab();
      const [next, removed] = stripMarkerLines(current, name);
      if (!removed) return; // 无自有条目——no-op（不重写用户 crontab）
      writeCrontab(next);
    },
  };
}

/** 缺省 crontab 执行器（spawnSync；错误折 exit code——-1 = spawn 失败） */
function execCrontabViaSpawnSync(args: string[], input?: string): CrontabResult {
  const r = spawnSync('crontab', args, input === undefined ? undefined : { input });
  return {
    stdout: r.stdout?.toString() ?? '',
    stderr: r.stderr?.toString() ?? '',
    code: r.error ? -1 : (r.status ?? -1),
  };
}
