/**
 * 合并三分支纯函数测试（06 §5 + 批 18c-1 落码定形注——token 形 / Jaccard
 * 交并比钉死 / 极性词面 / 效用综合分 / 溯源并集；零 IO 纯逻辑面）。
 */
import { describe, expect, it } from 'vitest';
import {
  decideMerge,
  detectPolarityConflict,
  jaccard,
  normalizeForMerge,
  tokenizeForMerge,
  unionSourceRefs,
  utilityScore,
} from './merge.js';

describe('tokenizeForMerge（token 形——ASCII ≥3 + CJK bigram）', () => {
  it('ASCII 词段小写化、≥3 字符保留、短段滤除', () => {
    expect(tokenizeForMerge('Uses PNPM, not npm!')).toEqual(['uses', 'pnpm', 'not', 'npm']);
  });

  it('CJK 连续段二元切；单字符段保单字', () => {
    expect(tokenizeForMerge('包管理器')).toEqual(['包管', '管理', '理器']);
    expect(tokenizeForMerge('快')).toEqual(['快']);
  });

  it('中英混排各自切段（中文整段不产巨型 token——落码定形注立清单由）', () => {
    expect(tokenizeForMerge('本仓库永远用 pnpm')).toEqual(['本仓', '仓库', '库永', '永远', '远用', 'pnpm']);
  });

  it('归一形 = token 序列拼接串（精确合并比较面——Mercury 同形）', () => {
    expect(normalizeForMerge('User prefers PNPM')).toBe(normalizeForMerge('user  prefers pnpm'));
    // 词序进归一形（拼接串非集合）——<3 字符段全被滤时两形同归空串
    expect(normalizeForMerge('alpha beta gamma')).not.toBe(normalizeForMerge('gamma beta alpha'));
    expect(normalizeForMerge('a b c')).toBe(normalizeForMerge('c b a'));
  });
});

describe('jaccard（交并比钉死——非 overlap coefficient）', () => {
  it('同集 = 1、全异 = 0、空集恒 0', () => {
    expect(jaccard(['a', 'b'], ['a', 'b'])).toBe(1);
    expect(jaccard(['a'], ['b'])).toBe(0);
    expect(jaccard([], ['a'])).toBe(0);
    expect(jaccard(['a'], [])).toBe(0);
  });

  it('子集关系不恒 1（与 overlap coefficient 的分水岭——更严同阈的立清单由）', () => {
    // |{a,b}∩{a,b,c}| / |{a,b}∪{a,b,c}| = 2/3 ≈ 0.667 < 0.74（overlap coefficient 会给 1）
    expect(jaccard(['a', 'b'], ['a', 'b', 'c'])).toBeCloseTo(2 / 3, 6);
  });

  it('0.74 阈值边界：7 词共享 8 词并集 = 0.875 过线；2/3 不过线', () => {
    const a = ['user', 'prefers', 'dark', 'mode', 'editor', 'theme', 'always'];
    const b = ['user', 'prefers', 'dark', 'mode', 'editor', 'theme', 'always', 'forever'];
    expect(jaccard(a, b)).toBeGreaterThanOrEqual(0.74);
    expect(jaccard(['user', 'prefers'], ['user', 'prefers', 'dark'])).toBeLessThan(0.74);
  });
});

describe('detectPolarityConflict（四对极性词 + 否定词）', () => {
  it('极性对交叉 + 同主题（去极性后 ≥0.5）判冲突', () => {
    const r = detectPolarityConflict('user prefers dark mode in editor', 'user does not prefer dark mode in editor');
    expect(r.conflict).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(0.5);
  });

  it('likes/dislikes 单词对（词边界防子串误命中——dislikes 内嵌 likes 不自触发）', () => {
    expect(detectPolarityConflict('user likes fish', 'user dislikes fish').conflict).toBe(true);
    // 双方同极（都 dislikes）非交叉——不冲突
    expect(detectPolarityConflict('user dislikes fish', 'user dislikes fish raw').conflict).toBe(false);
  });

  it('wants / enabled 对同律', () => {
    expect(detectPolarityConflict('user wants verbose output', 'user does not want verbose output').conflict).toBe(
      true,
    );
    expect(detectPolarityConflict('telemetry enabled by default', 'telemetry disabled by default').conflict).toBe(true);
  });

  it('否定词不对称（not/never/avoid）同主题判冲突（0.7 门槛——信号弱门槛高）', () => {
    expect(
      detectPolarityConflict('user runs tests before commit', 'user never runs tests before commit').conflict,
    ).toBe(true);
    // 主题不同（去极性后相似度低）——不冲突
    expect(
      detectPolarityConflict('user runs tests before commit', 'user never drinks coffee after lunch').conflict,
    ).toBe(false);
  });

  it('双方同极或双方皆无否定——永不判冲突', () => {
    expect(detectPolarityConflict('user prefers pnpm', 'user prefers yarn sometimes').conflict).toBe(false);
    expect(detectPolarityConflict('user not here', 'user not there').conflict).toBe(false);
  });

  it('去极性后不同主题的极性对交叉不判冲突（≥0.5 门槛执法）', () => {
    expect(
      detectPolarityConflict('user prefers dark mode', 'admin does not prefer database migrations on fridays').conflict,
    ).toBe(false);
  });
});

describe('decideMerge（三分支判序——exact → polarity → fuzzy → none）', () => {
  it('分支 1 精确：归一 token 相等（词序保持、大小写/分隔归一）', () => {
    const d = decideMerge(
      { summary: 'User prefers PNPM', confidence: 0.8 },
      { summary: 'user prefers pnpm', confidence: 0.5 },
    );
    expect(d.branch).toBe('exact');
    expect(d.score).toBe(1);
  });

  it('分支 2 模糊：Jaccard ≥0.74 且非冲突', () => {
    // token 面：a = [user,prefers,dark,mode,editor,windows]，b 同集 + and → 6/7 ≈ 0.857
    const a = 'user prefers dark mode in editor windows';
    const b = 'user prefers dark mode in editor and windows';
    const d = decideMerge({ summary: a, confidence: 0.8 }, { summary: b, confidence: 0.6 });
    expect(d.branch).toBe('fuzzy');
    expect(d.score).toBeGreaterThanOrEqual(0.74);
  });

  it('判序执法：极性冲突先行于模糊（对立主张不得走吸收合并）', () => {
    // 去极性后文本高度相似——若先判模糊会误入分支 2
    const d = decideMerge(
      { summary: 'user prefers dark mode', confidence: 0.5 },
      { summary: 'user does not prefer dark mode', confidence: 0.5 },
    );
    expect(d.branch).toBe('polarity');
  });

  it('分支 3 胜负：高 confidence 胜、相等新胜', () => {
    const existingWins = decideMerge(
      { summary: 'user prefers dark mode', confidence: 0.9 },
      { summary: 'user does not prefer dark mode', confidence: 0.5 },
    );
    expect(existingWins.branch).toBe('polarity');
    expect(existingWins.winner).toBe('existing');

    const incomingWins = decideMerge(
      { summary: 'user prefers dark mode', confidence: 0.5 },
      { summary: 'user does not prefer dark mode', confidence: 0.9 },
    );
    expect(incomingWins.winner).toBe('incoming');

    // 相等 → 新胜（06 §5 分支 3）
    const equalWins = decideMerge(
      { summary: 'user prefers dark mode', confidence: 0.5 },
      { summary: 'user does not prefer dark mode', confidence: 0.5 },
    );
    expect(equalWins.winner).toBe('incoming');
  });

  it('分支 none：不相似不冲突', () => {
    const d = decideMerge(
      { summary: 'user prefers dark mode in editor', confidence: 0.8 },
      { summary: ' CI runs nightly database backups', confidence: 0.5 },
    );
    expect(d.branch).toBe('none');
  });

  it('CJK 三分支同律（中英混排可比对——落码定形注）', () => {
    expect(
      decideMerge(
        { summary: '本仓库永远用 pnpm 管理依赖', confidence: 0.8 },
        { summary: '本仓库永远用 pnpm 管理依赖', confidence: 0.5 },
      ).branch,
    ).toBe('exact');
    const fuzzy = decideMerge(
      { summary: '本仓库永远用 pnpm 管理依赖包', confidence: 0.8 },
      { summary: '本仓库永远用 pnpm 管理依赖', confidence: 0.5 },
    );
    expect(fuzzy.branch).toBe('fuzzy');
    const polarity = decideMerge(
      { summary: '用户偏好深色主题界面', confidence: 0.5 },
      { summary: '用户 not 偏好深色主题界面', confidence: 0.9 },
    );
    expect(polarity.branch).toBe('polarity');
  });
});

describe('utilityScore（效用综合分定稿式）', () => {
  it('usage 0 = ×1 基线（新条目不被惩罚）；证据与引用独立计功', () => {
    const base = utilityScore({ confidence: 0.8, evidenceCount: 2, usageCount: 0 });
    const manual = 0.8 * Math.log(3) * 1;
    expect(base).toBeCloseTo(manual, 10);
  });

  it('cite 3 ≈ ×2.4（06 §5 定稿式例值）', () => {
    const once = utilityScore({ confidence: 0.8, evidenceCount: 2, usageCount: 0 });
    const thrice = utilityScore({ confidence: 0.8, evidenceCount: 2, usageCount: 3 });
    expect(thrice / once).toBeCloseTo(2.4, 1);
  });

  it('confidence 单调、evidence 单调（简报排序与溢出选取共用一把尺的前提）', () => {
    expect(utilityScore({ confidence: 0.9, evidenceCount: 1, usageCount: 0 })).toBeGreaterThan(
      utilityScore({ confidence: 0.5, evidenceCount: 1, usageCount: 0 }),
    );
    expect(utilityScore({ confidence: 0.8, evidenceCount: 3, usageCount: 0 })).toBeGreaterThan(
      utilityScore({ confidence: 0.8, evidenceCount: 1, usageCount: 0 }),
    );
  });
});

describe('unionSourceRefs（血缘继承——并集去重、旧在前、帽 50）', () => {
  it('并集去重（sessionId:seq 键）、保序旧前新后', () => {
    const merged = unionSourceRefs(
      [
        { sessionId: 's1', seq: 1 },
        { sessionId: 's1', seq: 2 },
      ],
      [
        { sessionId: 's1', seq: 2 },
        { sessionId: 's2', seq: 5 },
      ],
    );
    expect(merged).toEqual([
      { sessionId: 's1', seq: 1 },
      { sessionId: 's1', seq: 2 },
      { sessionId: 's2', seq: 5 },
    ]);
  });

  it('帽 50 同罩（超出截断——旧 refs 全保活，新 refs 尾部让位）', () => {
    const existing = Array.from({ length: 40 }, (_, i) => ({ sessionId: 'a', seq: i }));
    const incoming = Array.from({ length: 40 }, (_, i) => ({ sessionId: 'b', seq: i }));
    const merged = unionSourceRefs(existing, incoming);
    expect(merged).toHaveLength(50);
    // 旧 40 条全保活（位 0-39），帽内新侧只收前 10 条
    expect(merged[49]).toEqual({ sessionId: 'b', seq: 9 });
    expect(merged[39]).toEqual({ sessionId: 'a', seq: 39 });
  });
});
