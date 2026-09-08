/**
 * exec/git-guard 测试——bash 侧 .git 拦截面两腿的纯词法矩阵（04 §252 桥
 * 条款，成熟度缺口 #9 落码批）。
 *
 * 腿一：scanRedirectionTargets 算子族/heredoc/嵌套替换矩阵 +
 * findGitRedirectViolations 三重判定（词面/词法解析漂移/canonical）；
 * 腿二：isGitMetadataExempt 静态洁净白名单分类矩阵 + worktreeGitDir
 * backing 探测。零 spawn 零真网络；fs 面仅 mkdtemp fixture。
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  findGitRedirectViolations,
  isGitMetadataExempt,
  pathHasGitComponent,
  scanRedirectionTargets,
  worktreeGitDir,
} from './git-guard.js';

const CWD = '/ws';

/** 临时目录族（canonical/worktree fixture） */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 目标词面提取速记 */
const raws = (command: string): readonly string[] => scanRedirectionTargets(command, CWD).map((t) => t.raw);

/* ---------------- 腿一：重定向目标扫描算子族 ---------------- */

describe('scanRedirectionTargets 算子族', () => {
  it('基本形：> 与 >> 各捕获一词', () => {
    expect(raws('echo x > out.txt')).toEqual(['out.txt']);
    expect(raws('echo x >> out.txt')).toEqual(['out.txt']);
  });

  it('>| clobber 形与 <> 读写形捕获', () => {
    expect(raws('echo x >| out.txt')).toEqual(['out.txt']);
    expect(raws('exec 3<> pipe-name')).toEqual(['pipe-name']);
  });

  it('&> 与 &>> 双流形捕获', () => {
    expect(raws('cmd &> all.log')).toEqual(['all.log']);
    expect(raws('cmd &>> all.log')).toEqual(['all.log']);
  });

  it('数字前置形捕获（N> / N>>——裸 > 分支自然覆盖）', () => {
    expect(raws('cmd 2> err.txt')).toEqual(['err.txt']);
    expect(raws('cmd 5>> app.log')).toEqual(['app.log']);
  });

  it('fd 复制形跳过（2>&1 非文件目标）', () => {
    expect(raws('cmd 2>&1')).toEqual([]);
    expect(raws('cmd >&2')).toEqual([]);
    expect(raws('cmd > out.txt 2>&1')).toEqual(['out.txt']);
  });

  it('heredoc 体整段跳过（体是数据非执行——防体内 > 假阳性）', () => {
    const cmd = 'cat << EOF\nline > fake-target\nbody\nEOF';
    expect(raws(cmd)).toEqual([]);
  });

  it('heredoc 同行重定向照捕（<< EOF > .git/x 同行形——delimiter 词后本行照扫）', () => {
    const cmd = 'cat << EOF > .git/x\nbody\nEOF';
    expect(raws(cmd)).toEqual(['.git/x']);
  });

  it('<<- 剥前导 tab 匹配 delimiter（体跳过不失效）', () => {
    const cmd = 'cat <<- EOF\n\tline > fake\nEOF';
    expect(raws(cmd)).toEqual([]);
  });

  it('here-string 词为数据跳过', () => {
    expect(raws('cat <<< "a > b"')).toEqual([]);
  });

  it('普通输入重定向 < 跳过（读向量不记录）', () => {
    expect(raws('cmd < in.txt > out.txt')).toEqual(['out.txt']);
  });
});

/* ---------------- 腿一：引号与嵌套 ---------------- */

describe('scanRedirectionTargets 引号与命令替换嵌套', () => {
  it('单引号内容跳过（> 是字面量）', () => {
    expect(raws("echo 'a > b' > out.txt")).toEqual(['out.txt']);
  });

  it('双引号内 > 是字面量；双引号内 $() 嵌套域照扫（替换体里的 > 是真算子）', () => {
    expect(raws('echo "a > b" > out.txt')).toEqual(['out.txt']);
    expect(raws('echo "$(inner > /tmp/x)" > out.txt')).toEqual(['/tmp/x', 'out.txt']);
  });

  it('裸 $() 嵌套照扫 + 嵌套内嵌套', () => {
    expect(raws('echo $(inner > /tmp/y)')).toEqual(['/tmp/y']);
    expect(raws('echo $(a $(b > /tmp/deep))')).toEqual(['/tmp/deep']);
  });

  it('反引号替换域照扫', () => {
    expect(raws('echo `inner > /tmp/z`')).toEqual(['/tmp/z']);
  });

  it("引号拼接对抗形归一（.g'it'/config unquote 后成 .git/config）", () => {
    expect(raws("echo x > .g'it'/config")).toEqual(['.git/config']);
  });

  it('反斜杠转义消费（文件名含空格支持）', () => {
    expect(raws('echo x > a\\ b.txt')).toEqual(['a b.txt']);
  });
});

/* ---------------- 腿一：.git 违例三重判定 ---------------- */

describe('findGitRedirectViolations 三重判定', () => {
  it('词面组件判：.git 树命中、邻形不误伤', () => {
    expect(findGitRedirectViolations('echo x > .git/config', CWD)).toEqual(['.git/config']);
    expect(findGitRedirectViolations('echo x > .git/hooks/pre-commit', CWD)).toEqual(['.git/hooks/pre-commit']);
    expect(findGitRedirectViolations('echo x > sub/.git/refs/heads/main', CWD)).toEqual(['sub/.git/refs/heads/main']);
    expect(findGitRedirectViolations('echo x > /repo/.git/HEAD', CWD)).toEqual(['/repo/.git/HEAD']);
    // 邻形不误伤（.gitignore/.github/x.git/git 裸词）
    expect(findGitRedirectViolations('echo x > .gitignore', CWD)).toEqual([]);
    expect(findGitRedirectViolations('echo x > .github/workflows/ci.yml', CWD)).toEqual([]);
    expect(findGitRedirectViolations('echo x > x.git', CWD)).toEqual([]);
    expect(findGitRedirectViolations('echo x > git', CWD)).toEqual([]);
  });

  it('词面判命中变量拼接形（$X/.git/config 字面命中即真）', () => {
    expect(findGitRedirectViolations('echo x > $X/.git/config', CWD)).toEqual(['$X/.git/config']);
  });

  it('词法解析判：段内 cd 漂移追踪（cd .git && > config 漂移形同捕）', () => {
    expect(findGitRedirectViolations('cd .git && echo x > config', CWD)).toEqual(['config']);
    expect(findGitRedirectViolations('cd sub; cd .git; echo x > HEAD', CWD)).toEqual(['HEAD']);
  });

  it('词法解析判：path.resolve 归一（../.git 归位、.git/../out 放过）', () => {
    expect(findGitRedirectViolations('cd sub && echo x > ../.git/config', CWD)).toEqual(['../.git/config']);
    expect(findGitRedirectViolations('echo x > .git/../out.txt', CWD)).toEqual([]);
  });

  it('静态不可解目标诚实边界：> $X 不命中（腿二运行时兜底）', () => {
    expect(findGitRedirectViolations('echo x > $X', CWD)).toEqual([]);
  });

  it('canonical 判：符号链别名归一（symlink → .git 内真路径）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gg-canonical-'));
    dirs.push(dir);
    mkdirSync(join(dir, '.git'));
    // 别名链接指向 .git 内部——canonical 化后组件判命中
    symlinkSync(join(dir, '.git'), join(dir, 'alias'));
    expect(findGitRedirectViolations('echo x > alias/config', dir)).toEqual(['alias/config']);
  });

  it('pathHasGitComponent 分段判单元（/ 与 \\ 分隔皆判）', () => {
    expect(pathHasGitComponent('.git')).toBe(true);
    expect(pathHasGitComponent('/a/.git/b')).toBe(true);
    expect(pathHasGitComponent('a\\.git\\b')).toBe(true);
    expect(pathHasGitComponent('.gitignore')).toBe(false);
    expect(pathHasGitComponent('x.git')).toBe(false);
    expect(pathHasGitComponent('/a/git/b')).toBe(false);
  });
});

/* ---------------- 腿二：静态洁净白名单分类 ---------------- */

describe('isGitMetadataExempt 白名单分类', () => {
  it('白名单动词直陈形豁免（含旗参与引号载荷）', () => {
    expect(isGitMetadataExempt('git status')).toBe(true);
    expect(isGitMetadataExempt('git commit -m hello')).toBe(true);
    expect(isGitMetadataExempt("git commit -m 'fix: 修复'")).toBe(true);
    expect(isGitMetadataExempt('git commit -m "hello world"')).toBe(true);
    expect(isGitMetadataExempt('git log --oneline -5')).toBe(true);
    expect(isGitMetadataExempt('git push origin main')).toBe(true);
    expect(isGitMetadataExempt('git worktree add ../x')).toBe(true);
    expect(isGitMetadataExempt('git add .')).toBe(true);
    expect(isGitMetadataExempt('/usr/bin/git status')).toBe(true); // basename 词干判
  });

  it('cd 前缀段豁免（恰一参）', () => {
    expect(isGitMetadataExempt('cd sub && git add .')).toBe(true);
    expect(isGitMetadataExempt('cd sub; git status')).toBe(true);
    expect(isGitMetadataExempt('cd a && cd b && git commit -m x')).toBe(true);
  });

  it('重定向允许在豁免形（git log > out.txt——.git 目标由腿一执法）', () => {
    expect(isGitMetadataExempt('git log > out.txt')).toBe(true);
    expect(isGitMetadataExempt('git status 2>&1')).toBe(true);
  });

  it('展开不可静态判定即失豁免（$/反引号——单引号内除外）', () => {
    expect(isGitMetadataExempt('git commit -m "$(cat f)"')).toBe(false);
    expect(isGitMetadataExempt('git commit -m "a$b"')).toBe(false);
    expect(isGitMetadataExempt('git log > $X')).toBe(false);
    expect(isGitMetadataExempt('echo `git status` > x')).toBe(false);
    expect(isGitMetadataExempt("git commit -m '$HOME'")).toBe(true); // 单引号字面量
  });

  it('子壳/管道段失豁免（非 git 段在场）', () => {
    expect(isGitMetadataExempt('(git status)')).toBe(false);
    expect(isGitMetadataExempt('git log | head')).toBe(false);
    expect(isGitMetadataExempt('git status; ls')).toBe(false);
    expect(isGitMetadataExempt('echo hi')).toBe(false);
    expect(isGitMetadataExempt('rm -rf .git')).toBe(false);
  });

  it('非白名单动词/全局旗形失豁免（保守边界）', () => {
    expect(isGitMetadataExempt('git init')).toBe(false);
    expect(isGitMetadataExempt('git clone https://x')).toBe(false);
    expect(isGitMetadataExempt('git fast-import')).toBe(false);
    expect(isGitMetadataExempt('git -C sub status')).toBe(false);
    expect(isGitMetadataExempt('git')).toBe(false);
    expect(isGitMetadataExempt('gitx status')).toBe(false);
  });

  it('空串/空段豁免（无命令面）', () => {
    expect(isGitMetadataExempt('')).toBe(true);
    expect(isGitMetadataExempt('   ')).toBe(true);
  });
});

/* ---------------- worktree 授予腿探测 ---------------- */

describe('worktreeGitDir 授予面探测', () => {
  it('worktree 形（.git 文件 + gitdir: 指针 + commondir 文件）→ common git dir canonical 路径', () => {
    const repo = mkdtempSync(join(tmpdir(), 'gg-repo-'));
    dirs.push(repo);
    const backing = join(repo, '.git', 'worktrees', 'wt');
    mkdirSync(backing, { recursive: true });
    // commondir 文件 = git worktree add 缺省产物（相对 backing 的路径）
    writeFileSync(join(backing, 'commondir'), '../..\n');
    const wt = mkdtempSync(join(tmpdir(), 'gg-wt-'));
    dirs.push(wt);
    writeFileSync(join(wt, '.git'), `gitdir: ${backing}\n`);
    // 授予面 = 主仓 common git dir（对象库/refs 共享落点——非 backing 本身）
    expect(worktreeGitDir(wt)).toBe(realpathSync(join(repo, '.git')));
  });

  it('commondir 缺席（手工 fixture 形）→ 几何回退上两级（worktrees/<n> → .git 根）', () => {
    const repo = mkdtempSync(join(tmpdir(), 'gg-repo2-'));
    dirs.push(repo);
    const backing = join(repo, '.git', 'worktrees', 'wt');
    mkdirSync(backing, { recursive: true });
    const wt = mkdtempSync(join(tmpdir(), 'gg-wt2-'));
    dirs.push(wt);
    writeFileSync(join(wt, '.git'), `gitdir: ${backing}\n`);
    expect(worktreeGitDir(wt)).toBe(realpathSync(join(repo, '.git')));
  });

  it('主仓形（.git 目录）→ undefined（元数据写在 workspace 根内本就可达）', () => {
    const repo = mkdtempSync(join(tmpdir(), 'gg-main-'));
    dirs.push(repo);
    mkdirSync(join(repo, '.git'));
    expect(worktreeGitDir(repo)).toBeUndefined();
  });

  it('非 git 环境缺席 → undefined（fail-soft：授予腿不造值）', () => {
    const plain = mkdtempSync(join(tmpdir(), 'gg-plain-'));
    dirs.push(plain);
    expect(worktreeGitDir(plain)).toBeUndefined();
  });
});
