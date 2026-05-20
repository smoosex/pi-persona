// ============================================================
// pi-persona — 事件触发器
// ============================================================
import type { EmotionalEvent, EmotionConfig } from "./types.js";

let consecutiveErrors = 0;
let lastErrorCommand = "";

// 构建命令匹配
const BUILD_PATTERN = /npm\s+(run\s+)?build|tsc|go\s+build|cargo\s+build|bun\s+(run\s+)?build|make\b|gradle\s+build|mvn\s+.*?(compile|package|install)/;
// 测试命令匹配
const TEST_PATTERN = /npm\s+(run\s+)?test|pytest|go\s+test|cargo\s+test|jest|bun\s+test|vitest|gradle\s+test|mvn\s+test/;

/** 判断命令是否失败: exitCode 明确非零 */
function isFailure(exitCode: number | undefined): boolean {
  return exitCode !== undefined && exitCode !== 0;
}

export function detectFromBashResult(
  exitCode: number | undefined,
  isError: boolean,
  command: string,
  config: EmotionConfig,
): EmotionalEvent | null {
  const t = config.triggers;

  if (BUILD_PATTERN.test(command) && exitCode === 0)
    return { trigger: "build_success", targetAngle: t.build_success.targetAngle, force: t.build_success.force };
  if (BUILD_PATTERN.test(command) && isFailure(exitCode))
    return { trigger: "build_error", targetAngle: t.build_error.targetAngle, force: t.build_error.force };
  if (TEST_PATTERN.test(command) && exitCode === 0)
    return { trigger: "test_pass", targetAngle: t.test_pass.targetAngle, force: t.test_pass.force };
  if (TEST_PATTERN.test(command) && isFailure(exitCode))
    return { trigger: "test_fail", targetAngle: t.test_fail.targetAngle, force: t.test_fail.force };
  if (exitCode === 0 && !isError)
    return { trigger: "command_success", targetAngle: t.command_success.targetAngle, force: t.command_success.force };
  if (isFailure(exitCode))
    return { trigger: "command_error", targetAngle: t.command_error.targetAngle, force: t.command_error.force };

  return null;
}

export function detectRepeatedErrors(command: string, isError: boolean, config: EmotionConfig): EmotionalEvent | null {
  const t = config.triggers;

  if (!isError) { consecutiveErrors = 0; lastErrorCommand = ""; return null; }

  // 剥离注释 (# 之后)、剥离 flag 参数 (-- 或 - 开头)、空白规范化
  const noComments = command.replace(/#.*$/, "");
  const normalized = noComments.split(/\s+/).filter(w => !w.startsWith("-")).join(" ");
  const simplified = normalized.trim().slice(0, 80);

  if (simplified === lastErrorCommand) consecutiveErrors++;
  else { consecutiveErrors = 1; lastErrorCommand = simplified; }

  if (consecutiveErrors === 3 && t.error_streak_3)
    return { trigger: "error_streak_3", targetAngle: t.error_streak_3.targetAngle, force: t.error_streak_3.force };
  if (consecutiveErrors === 5 && t.error_streak_5)
    return { trigger: "error_streak_5", targetAngle: t.error_streak_5.targetAngle, force: t.error_streak_5.force };

  return null;
}

export function resetErrorStreak(): void { consecutiveErrors = 0; lastErrorCommand = ""; }

export function detectFromUserMessage(text: string, config: EmotionConfig, agreeableness: number): EmotionalEvent | null {
  const t = config.triggers;
  const lower = text.toLowerCase();

  if (/谢谢|太棒了|厉害|牛|good job|well done|awesome|great/i.test(lower)) {
    const praiseForce = t.user_praise.force * (0.5 + agreeableness * 0.5);
    return { trigger: "user_praise", targetAngle: t.user_praise.targetAngle, force: praiseForce };
  }
  if (/不对|还是错|没用|不行|still wrong|not working|doesn't work/i.test(lower)) {
    const correctionForce = t.user_correction.force * (1 - agreeableness * 0.4);
    return { trigger: "user_correction", targetAngle: t.user_correction.targetAngle, force: correctionForce };
  }
  if (lower.includes("thank"))
    return { trigger: "user_praise", targetAngle: t.user_praise.targetAngle, force: t.user_praise.force * 0.75 * (0.5 + agreeableness * 0.5) };

  return null;
}

export function detectLateNight(config: EmotionConfig, extraversion: number): EmotionalEvent | null {
  const hour = new Date().getHours();
  if (hour >= 23 || hour < 5) {
    const t = config.triggers.late_night;
    const extraversionFactor = 0.5 + (1 - extraversion) * 1.0;
    return { trigger: "late_night", targetAngle: t.targetAngle, force: t.force * extraversionFactor };
  }
  return null;
}
