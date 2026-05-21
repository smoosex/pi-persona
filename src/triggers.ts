// ============================================================
// pi-persona — 事件触发器
// ============================================================
import type { EmotionalEvent, EmotionConfig } from "./types.js";

export interface RepeatedErrorState {
  consecutiveErrors: number;
  lastErrorCommand: string;
}

export function createRepeatedErrorState(): RepeatedErrorState {
  return { consecutiveErrors: 0, lastErrorCommand: "" };
}

// 构建命令匹配
const BUILD_PATTERN = /npm\s+(run\s+)?build|tsc|go\s+build|cargo\s+build|bun\s+(run\s+)?build|make\b|gradle\s+build|mvn\s+.*?(compile|package|install)/;
// 测试命令匹配
const TEST_PATTERN = /npm\s+(run\s+)?test|pytest|go\s+test|cargo\s+test|jest|bun\s+test|vitest|gradle\s+test|mvn\s+test/;

export function detectFromBashResult(
  exitCode: number | undefined,
  isError: boolean,
  command: string,
  config: EmotionConfig,
): EmotionalEvent | null {
  const t = config.triggers;
  const isBuild = BUILD_PATTERN.test(command);
  const isTest = TEST_PATTERN.test(command);
  // 若工具未回传 exitCode 且未标记 isError，则结果未知：保持沉默，不触发成功/失败情绪。
  const hasSucceeded = exitCode === 0 && !isError;
  const hasFailed = isError || (exitCode !== undefined && exitCode !== 0);

  if (isBuild && hasSucceeded)
    return { trigger: "build_success", ...t.build_success };
  if (isBuild && hasFailed)
    return { trigger: "build_error", ...t.build_error };
  if (isTest && hasSucceeded)
    return { trigger: "test_pass", ...t.test_pass };
  if (isTest && hasFailed)
    return { trigger: "test_fail", ...t.test_fail };
  if (hasSucceeded)
    return { trigger: "command_success", ...t.command_success };
  if (hasFailed)
    return { trigger: "command_error", ...t.command_error };

  return null;
}

export function detectRepeatedErrors(
  command: string,
  isError: boolean,
  config: EmotionConfig,
  state: RepeatedErrorState,
): EmotionalEvent | null {
  const t = config.triggers;

  if (!isError) { resetErrorStreak(state); return null; }

  // 剥离注释 (# 之后)、剥离 flag 参数 (-- 或 - 开头)、空白规范化
  const noComments = command.replace(/#.*$/, "");
  const normalized = noComments.split(/\s+/).filter(w => !w.startsWith("-")).join(" ");
  const simplified = normalized.trim().slice(0, 80);

  if (simplified === state.lastErrorCommand) state.consecutiveErrors++;
  else { state.consecutiveErrors = 1; state.lastErrorCommand = simplified; }

  if (state.consecutiveErrors === 3 && t.error_streak_3)
    return { trigger: "error_streak_3", ...t.error_streak_3 };
  if (state.consecutiveErrors === 5 && t.error_streak_5)
    return { trigger: "error_streak_5", ...t.error_streak_5 };

  return null;
}

export function resetErrorStreak(state: RepeatedErrorState): void {
  state.consecutiveErrors = 0;
  state.lastErrorCommand = "";
}

export function detectFromUserMessage(text: string, config: EmotionConfig, agreeableness: number): EmotionalEvent | null {
  const t = config.triggers;
  const lower = text.toLowerCase();

  if (/谢谢|太棒了|厉害|牛|good job|well done|awesome|great/i.test(lower)) {
    const praiseForce = t.user_praise.force * (0.5 + agreeableness * 0.5);
    return { trigger: "user_praise", ...t.user_praise, force: praiseForce };
  }
  if (/不对|还是错|没用|不行|still wrong|not working|doesn't work/i.test(lower)) {
    const correctionForce = t.user_correction.force * (1 - agreeableness * 0.4);
    return { trigger: "user_correction", ...t.user_correction, force: correctionForce };
  }
  if (lower.includes("thank"))
    return { trigger: "user_praise", ...t.user_praise, force: t.user_praise.force * 0.75 * (0.5 + agreeableness * 0.5) };

  return null;
}

export function detectLateNight(config: EmotionConfig, extraversion: number): EmotionalEvent | null {
  const hour = new Date().getHours();
  if (hour >= 23 || hour < 5) {
    const t = config.triggers.late_night;
    const extraversionFactor = 0.5 + (1 - extraversion) * 1.0;
    return { trigger: "late_night", ...t, force: t.force * extraversionFactor };
  }
  return null;
}
