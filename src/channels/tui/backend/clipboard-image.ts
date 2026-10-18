/**
 * 剪贴板图片读取纯函数件 + DI 缝（TUI 剪贴板图片直贴批——35 池件 2 + 39 轮
 * normalize_pasted_path 变体面；07 §4.1 R5 editor.paste-image 词条的读链侧）。
 *
 * 三段分立（native-clipboard.ts 同形纪律）：
 * - **计划纯函数** planClipboardImageReads：env + 平台 → 候选命令计划列表，
 *   零进程零副作用（探测形态 = env 判定非 which 探测）；
 * - **子进程执行器 seam** ClipboardCommandRunner：command + args →
 *   { ok, stdout }（缺省真身 spawn 带 2s 超时帽——测试注入假执行器，
 *   MemoryTerminalIO 测试面零真子进程纪律）；
 * - **读器工厂** createClipboardImageReader：候选逐试（ENOENT 落次候选），
 *   返回 base64 载荷或 null（四静默形——无图/无命令/读失败/超时）。win32
 *   矩阵外形另有显式回执词（clipboardImageReadUnsupportedReason——56 轮
 *   件 1a：spawn 前即知不支持，受理面 info 呈报非静默空集）。
 *
 * 另辖两段提交侧纯逻辑：
 * - splitImageMarkerLines：稿面 `[图片]` 独占占位行计数与剥除（提交期
 *   附图数判定真源——计数 × 暂存数取小；入史净稿缝同消费——56 轮件 1e）；
 * - pastedImagePath / readImageFilePayload：bracketed paste 文本恰为图片
 *   绝对路径 / `~/` 短写（homedir 展开——56 轮件 1b）/ file:// URL 的变体面
 *   判定与读载荷（同步 fs 只读——readGitHead 先例；字节帽预检防大文件读爆）。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 稿面图片占位行词面（受理成功入稿形）：与 transcript 回显占位行（IMAGE_
 * PLACEHOLDER_LINE，backend/transcript.ts 模块私有）同词面——提交前稿面占位、
 * 提交后回显占位两形同词，用户视觉零跳变。此处自立常量非跨模块 import
 * （transcript 常量模块私有——同词面双源注记，改词两处同笔）。
 */
export const COMPOSER_IMAGE_PLACEHOLDER = '[图片]';

/** 图片四族扩展名 → 声明 MIME（受理链魔数核验的族域——扩展名只作入域门） */
const IMAGE_EXT_MIME: ReadonlyMap<string, string> = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
]);

/**
 * 路径变体面字节帽预检（5 MiB）：与受理链字节帽（host/attachment-intake
 * MAX_BYTES）同值的本地预检——channels 不 import host（28 席 DAG），受理链
 * 仍是权威执法位，此处只为 readFileSync 前挡大文件。
 */
const PASTE_PATH_MAX_BYTES = 5 * 1024 * 1024;

/**
 * TUI 侧每消息暂存图帽（冷读闸 P3②——受理链每调用帽的暂存累积补位）：
 * 受理链 ATTACHMENT_INTAKE_MAX_IMAGES（host/attachment-intake）按单次调用
 * 执法，TUI 逐次贴图各调一次单图恒过帽——每消息累积帽须在暂存入栈前把关
 * （与 webui「每消息恒 ≤4」语义对齐）。同值双源注记（channels 不 import
 * host——改值两处同笔）。
 */
export const PASTE_IMAGE_MAX_STAGED = 4;

/** env 键型（进程 env 的只读子集面——测试桩注入受控形；native-clipboard 同形） */
type EnvLike = Record<string, string | undefined>;

/** 剪贴板图片载荷（base64 + 声明 MIME——结构同 host PasteImageInput，结构类型桥接免跨席 import） */
export interface ClipboardImagePayload {
  /** 图片原文 base64（受理链 base64 严格解码核验） */
  readonly data: string;
  /** 声明 MIME（受理链魔数嗅探核验——勿信声明单源执法） */
  readonly mimeType: string;
}

/**
 * 剪贴板图片读器 seam（backend 注入面）：() → 载荷或 null。
 * **null = 四静默形合流**（无图/无命令/读失败/超时）——调用方零弹错零入稿。
 */
export type ClipboardImageReader = () => Promise<ClipboardImagePayload | null>;

/** 读器候选计划（route 两形：darwin 临时文件路 / linux stdout 路） */
export interface ClipboardImageReadPlan {
  readonly command: string;
  readonly args: readonly string[];
  readonly route: 'tempfile' | 'stdout';
}

/**
 * 子进程执行器 seam：command + args → { ok, stdout }。缺省真身
 * createDefaultClipboardCommandRunner（spawn + 2s 超时帽）；测试注入假执行器
 * （零真子进程纪律——externalEditor/tmuxSpawn seam 同例）。
 */
export type ClipboardCommandRunner = (
  command: string,
  args: readonly string[],
) => Promise<{ ok: boolean; stdout: Buffer }>;

/**
 * 平台矩阵计划：SSH 会话 → 空集（剪贴板属客户端本地机不可达——planNativeClipboard
 * 同判）；darwin → osascript 临时 PNG 文件路；linux WAYLAND → wl-paste（image/png
 * 目标类型），缺席回落 xclip（-selection clipboard -t image/png -o——X11 双选区
 * 陷阱与写侧同防）；linux X11 → xclip；win32 → 空集（PowerShell 路挂账未采）；
 * 余 → 空集。SSH/WAYLAND_DISPLAY/DISPLAY 均调时读现值（调用方传 process.env
 * 当帧——与 TMUX/externalEditor 调时读同律）。
 */
export function planClipboardImageReads(
  env: EnvLike,
  platform: NodeJS.Platform = process.platform,
): readonly ClipboardImageReadPlan[] {
  // SSH 会话跳过——剪贴板图属客户端本地机（写侧 planNativeClipboard 同判真源）
  if (env.SSH_TTY !== undefined || env.SSH_CONNECTION !== undefined) return [];
  if (platform === 'darwin') {
    // osascript 路的 args 在读器内现构（临时文件路径读时才定——见 createClipboardImageReader）
    return [{ command: 'osascript', args: [], route: 'tempfile' }];
  }
  if (platform === 'linux') {
    const plans: ClipboardImageReadPlan[] = [];
    if (env.WAYLAND_DISPLAY !== undefined) {
      plans.push({ command: 'wl-paste', args: ['--type', 'image/png'], route: 'stdout' });
    }
    if (env.DISPLAY !== undefined || env.WAYLAND_DISPLAY !== undefined) {
      // xclip 回落腿：wl-paste 缺席（ENOENT）时的次候选（WAYLAND 兼容层常配 xclip）
      plans.push({
        command: 'xclip',
        args: ['-selection', 'clipboard', '-t', 'image/png', '-o'],
        route: 'stdout',
      });
    }
    return plans;
  }
  return []; // win32（PowerShell 路挂账未采——真链属后续真机批）与其余平台矩阵外
}

/**
 * 读链平台不支持回执词（56 轮件 1a——win32 空集显式化）：win32 返「此平台
 * 暂不支持读剪贴板图」（受理面 notify info 呈报——spawn 前即知不支持，非
 * 静默空集暗亏）；其余一律 null（走读链四静默形域）。SSH 判先于 win32
 * （planClipboardImageReads 同序）：SSH 会话的空集属「客户端本地机不可达」
 * 非本机能力缺席——维持静默不回执。
 *
 * 规范锚：07 §4.1 R5 editor.paste-image 词条读链面（darwin osascript /
 * linux wl-paste→xclip 先行、win32 空集——56 轮件 1a 翻档补注：win32 空集
 * + 显式 info 回执；PowerShell 真链挂账属后续真机批）。backend 注桩缝
 * （options.clipboardImageUnsupportedReason）缺省闭包 = 本函数调时读 process
 * 现值（planNativeClipboard 同律）。
 */
export const CLIPBOARD_IMAGE_UNSUPPORTED_TEXT = '此平台暂不支持读剪贴板图';

/** 读链支持面判定（null = 走读链四静默形域；非 null = 回执词——受理面 info 呈报） */
export function clipboardImageReadUnsupportedReason(
  env: EnvLike,
  platform: NodeJS.Platform = process.platform,
): string | null {
  // SSH 判先（写侧 planNativeClipboard / 读侧 planClipboardImageReads 同序真源）
  if (env.SSH_TTY !== undefined || env.SSH_CONNECTION !== undefined) return null;
  if (platform === 'win32') return CLIPBOARD_IMAGE_UNSUPPORTED_TEXT; // PowerShell 真链挂账——显式呈报非静默
  return null; // darwin/linux/其余矩阵外——四静默形域（无命令形合流 null）
}

/**
 * 读器工厂：候选逐试 → 首个成功载荷；全败 → null（四静默形合流）。
 *
 * tempfile 路（darwin）：mkdtemp 临时目录 + osascript 三段脚本把剪贴板 PNG
 * 写入临时文件（«class PNGf» 取图——剪贴板无图时 osascript 非零退出即静默）→
 * readFile → finally rmSync 用后即删（成功/失败两路都删——不留残骸）。
 * stdout 路（linux）：退出码 0 且 stdout 非空 → base64 载荷（空 stdout = 剪贴板
 * 无图，静默不视为错误）。
 */
export function createClipboardImageReader(
  run: ClipboardCommandRunner = createDefaultClipboardCommandRunner(),
  env: EnvLike = process.env,
  platform: NodeJS.Platform = process.platform,
): ClipboardImageReader {
  return async () => {
    for (const plan of planClipboardImageReads(env, platform)) {
      try {
        if (plan.route === 'tempfile') {
          const payload = await readViaTempFile(run);
          if (payload !== null) return payload;
          continue; // 本候选无图/失败——次候选（无次候选即合流 null）
        }
        const result = await run(plan.command, plan.args);
        if (result.ok && result.stdout.length > 0) {
          return { data: result.stdout.toString('base64'), mimeType: 'image/png' };
        }
      } catch {
        continue; // 执行器异常面同静默（缝契约四静默形的兜底位）——次候选
      }
    }
    return null;
  };
}

/** darwin 临时文件路编舞（mkdtemp → osascript 写 PNG → 读 → finally 删目录） */
async function readViaTempFile(run: ClipboardCommandRunner): Promise<ClipboardImagePayload | null> {
  const dir = mkdtempSync(join(tmpdir(), 'clip-')); // 中性前缀（命名去品牌化——external-editor 'draft-' 同律）
  const file = join(dir, 'clipboard.png');
  // POSIX file 字符串字面量嵌入 AppleScript：反斜杠与双引号转义（TMPDIR 含空格形防劈）
  const escaped = file.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const args = [
    '-e',
    `set theFile to (open for access POSIX file "${escaped}" with write permission)`,
    '-e',
    'write (the clipboard as «class PNGf») to theFile',
    '-e',
    'close access theFile',
  ];
  let payload: ClipboardImagePayload | null = null;
  try {
    const result = await run('osascript', args);
    if (result.ok) {
      try {
        const bytes = readFileSync(file); // 用后即读（osascript 已落盘）
        if (bytes.length > 0) payload = { data: bytes.toString('base64'), mimeType: 'image/png' };
      } catch {
        payload = null; // 读失败（osascript 报 ok 但未落图——防御位）
      }
    }
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true }); // 用后即删（成功/失败两路）
    } catch {
      // 尽力清理（删失败不升格——临时目录随 OS 清理域）
    }
  }
  return payload;
}

/**
 * 子进程执行器真身（装配显式传入——读器工厂缺省参）：spawn 异步形 + 2s 超时帽
 * （SIGKILL → close 归非零即静默失败）。stdio stdin/stderr ignore（子进程杂音
 * 不污染原始终端屏面——nativeClipboardSpawn 确认形同律）、stdout pipe。
 * spawnFn 注入面 = 测试假 spawn（零真子进程纪律——超时帽/退出码两路锁）。
 */
export function createDefaultClipboardCommandRunner(
  timeoutMs: number = 2000,
  spawnFn: typeof spawn = spawn,
): ClipboardCommandRunner {
  return (command, args) =>
    new Promise((resolve) => {
      let settled = false;
      let child;
      try {
        child = spawnFn(command, args, { stdio: ['ignore', 'pipe', 'ignore'] });
      } catch {
        resolve({ ok: false, stdout: Buffer.alloc(0) }); // spawn 同步报错——失败形
        return;
      }
      const chunks: Buffer[] = [];
      const timer = setTimeout(() => {
        child.kill('SIGKILL'); // 超时帽——SIGKILL 兜底（close 事件随后归非零）
      }, timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      child.on('error', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, stdout: Buffer.concat(chunks) }); // ENOENT 等——失败形
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: code === 0, stdout: Buffer.concat(chunks) });
      });
    });
}

/* ---------------- 提交侧纯逻辑（占位行计数与剥除） ---------------- */

/** 稿面占位行分拆产物：剥除后文本 + 独占占位行计数 */
export interface ImageMarkerSplit {
  readonly text: string;
  readonly markerCount: number;
}

/**
 * `[图片]` 独占占位行计数与剥除：行 trim 后恰等于占位词面的行计为占位行并
 * 全数剥除（前后缀换行收敛——剥行不留空行残骸）；非独占形（行内有别的字）
 * 不计不剥。**剥除与否由调用方按暂存数定夺**（暂存空调用方不采本函数剥除形
 * ——手敲 `[图片]` 文本零误伤律）。
 */
export function splitImageMarkerLines(text: string): ImageMarkerSplit {
  const lines = text.split('\n');
  const kept: string[] = [];
  let markerCount = 0;
  for (const line of lines) {
    if (line.trim() === COMPOSER_IMAGE_PLACEHOLDER) {
      markerCount += 1;
      continue;
    }
    kept.push(line);
  }
  // 边界换行收敛：剥行后首尾空行归零（占位插入的省侧形对称剥除；内部空行保留）
  const stripped = kept.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
  return { text: stripped, markerCount };
}

/* ---------------- 路径变体面（normalize_pasted_path） ---------------- */

/**
 * 粘贴文本 → 图片绝对路径判定：trim 后恰一路径（无换行；`/` 起头绝对路径、
 * `~/` 短写经 os.homedir 展开、file:// URL 经 fileURLToPath 归一）且扩展名在
 * 四族 → 路径；否则 null（多行文本/相对路径/~user 命名短写/非图片扩展名均
 * 不转——保守域，文件在场与字节帽由 readImageFilePayload 二道门把守）。内部
 * 空格放行（macOS 路径含空格常态——存在性 + 扩展名双门足以挡误报）。
 *
 * `~` 展开（56 轮件 1b）只用于读盘：返回值即 readImageFilePayload 的读盘
 * 路径；稿面词面不涉——成功路占位行词面恒 `[图片]` 常量、拒形回退原文本
 * 粘贴（`~` 原词零改写）。homedir 调时读现值（POSIX 读 $HOME——测试可桩）。
 */
export function pastedImagePath(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.includes('\n')) return null;
  let path: string;
  if (/^file:\/\//i.test(trimmed)) {
    try {
      path = fileURLToPath(trimmed);
    } catch {
      return null; // 畸形 file URL——静默不转
    }
  } else if (trimmed.startsWith('/')) {
    path = trimmed;
  } else if (trimmed === '~' || trimmed.startsWith('~/')) {
    // ~ 短写展开：裸 ~ / ~/ 前导形——slice(1) 留「/x」段，join 拼主目录
    //（裸 ~ 展开后无扩展名，ext 门自拒——受理面只认文件不收目录）
    path = join(homedir(), trimmed.slice(1));
  } else {
    return null; // 相对路径 / ~user 命名短写 / 纯词——变体面外
  }
  return IMAGE_EXT_MIME.has(extname(path).toLowerCase()) ? path : null;
}

/**
 * 图片文件读载荷（同步 fs 只读——readGitHead 先例；backend 变体面消费）：
 * 文件在场（statSync isFile）+ 字节帽预检（5 MiB——受理链同值预检）+ 读
 * base64。任一门不过 → null（调用方静默回退原文本粘贴）。
 */
export function readImageFilePayload(path: string): ClipboardImagePayload | null {
  const mimeType = IMAGE_EXT_MIME.get(extname(path).toLowerCase());
  if (mimeType === undefined) return null; // 扩展名门（pastedImagePath 已判——防御双门）
  let size: number;
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return null;
    size = stat.size;
  } catch {
    return null; // 缺席/不可达——变体面外
  }
  if (size <= 0 || size > PASTE_PATH_MAX_BYTES) return null; // 字节帽预检（防大文件读爆）
  try {
    if (!existsSync(path)) return null; // stat 与 read 间竞窗防御（读失败面同归 null）
    return { data: readFileSync(path).toString('base64'), mimeType };
  } catch {
    return null; // 读失败——静默回退
  }
}
