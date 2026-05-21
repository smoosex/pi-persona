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

const COMMAND_SEPARATORS = /&&|\|\||;|\n/;
const BUILD_SCRIPTS = new Set(["build"]);
const TEST_SCRIPTS = new Set(["test"]);
const BUILD_EXECUTABLES = new Set(["tsc", "make"]);
const TEST_EXECUTABLES = new Set(["pytest", "jest", "vitest"]);

function stripInlineComment(command: string): string {
  const commentStart = command.search(/(^|\s)#/);
  return commentStart === -1 ? command : command.slice(0, commentStart).trimEnd();
}

function tokenizeCommand(command: string): string[] {
  return stripInlineComment(command).match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
}

function scriptNameAfterRun(tokens: string[]): string | undefined {
  const runIndex = tokens.indexOf("run");
  if (runIndex === -1) return undefined;

  return tokens.slice(runIndex + 1).find(token => !token.startsWith("-"));
}

function normalizeCommandTokens(tokens: string[]): string[] {
  let index = 0;
  while (/^[A-Za-z_][A-Za-z0-9_]*=.*/.test(tokens[index] ?? "")) index++;

  if (tokens[index] === "env") {
    index++;
    while (tokens[index]?.startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(tokens[index] ?? "")) index++;
  }

  if (tokens[index] === "sudo") {
    index++;
    while (tokens[index]?.startsWith("-")) index++;
  }

  return tokens.slice(index);
}

function isBuildCommandSegment(segment: string): boolean {
  const tokens = normalizeCommandTokens(tokenizeCommand(segment));
  if (tokens.length === 0) return false;

  const [executable, subcommand] = tokens;
  if (BUILD_EXECUTABLES.has(executable)) return true;
  if (executable === "npm") return subcommand === "run" && BUILD_SCRIPTS.has(scriptNameAfterRun(tokens) ?? "");
  if (executable === "bun") return BUILD_SCRIPTS.has(subcommand ?? "") || (subcommand === "run" && BUILD_SCRIPTS.has(scriptNameAfterRun(tokens) ?? ""));
  if (executable === "go" || executable === "cargo" || executable === "gradle") return subcommand === "build";
  if (executable === "mvn") return tokens.some(token => token === "compile" || token === "package" || token === "install");

  return false;
}

function isTestCommandSegment(segment: string): boolean {
  const tokens = normalizeCommandTokens(tokenizeCommand(segment));
  if (tokens.length === 0) return false;

  const [executable, subcommand] = tokens;
  if (TEST_EXECUTABLES.has(executable)) return true;
  if (executable === "npm") return (subcommand === "test") || (subcommand === "run" && TEST_SCRIPTS.has(scriptNameAfterRun(tokens) ?? ""));
  if (executable === "bun") return (subcommand === "test") || (subcommand === "run" && TEST_SCRIPTS.has(scriptNameAfterRun(tokens) ?? ""));
  if (executable === "go" || executable === "cargo" || executable === "gradle") return subcommand === "test";
  if (executable === "mvn") return tokens.includes("test");

  return false;
}

function splitCommandSegments(command: string): string[] {
  return command.split(COMMAND_SEPARATORS).map(segment => segment.trim()).filter(Boolean);
}

function isBuildCommand(command: string): boolean {
  return splitCommandSegments(command).some(isBuildCommandSegment);
}

function isTestCommand(command: string): boolean {
  return splitCommandSegments(command).some(isTestCommandSegment);
}

export function detectFromBashResult(
  exitCode: number | undefined,
  isError: boolean,
  command: string,
  config: EmotionConfig,
): EmotionalEvent | null {
  const t = config.triggers;
  const isBuild = isBuildCommand(command);
  const isTest = isTestCommand(command);
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
