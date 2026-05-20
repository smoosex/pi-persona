// ============================================================
// pi-persona — 灵魂加载器
// 自定义方式: IDENTIFY.md（元数据）+ SOUL.md（散文正文）
// 优先级: 项目 .pi/ > 用户 ~/.pi/agent/ > 内置 6 种
// 只支持一个自定义灵魂
// ============================================================
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import matter from "gray-matter";
import type { SoulDefinition, SoulTraits } from "./types.js";
import { DEFAULT_TRAITS } from "./types.js";
// 内置灵魂
import { cat } from "./souls/cat.js";
import { tsundere } from "./souls/tsundere.js";
import { genki } from "./souls/genki.js";
import { gentleSister } from "./souls/gentle-sister.js";
import { oldCadre } from "./souls/old-cadre.js";
import { salaryman } from "./souls/salaryman.js";

// ==============================================================
// 内置注册表
// ==============================================================

const BUILTIN_SOULS: SoulDefinition[] = [
  cat, tsundere, genki, gentleSister, oldCadre, salaryman,
];

const builtinMap = new Map<string, SoulDefinition>();
for (const s of BUILTIN_SOULS) builtinMap.set(s.id, s);

// ==============================================================
// 文件路径 (pi 始终在项目根目录运行, process.cwd() = 项目根)
// ==============================================================

function userIdentifyFile(): string {
  return path.join(os.homedir(), ".pi", "agent", "IDENTIFY.md");
}
function projectIdentifyFile(): string {
  return path.join(process.cwd(), ".pi", "IDENTIFY.md");
}
function userSoulFile(): string {
  return path.join(os.homedir(), ".pi", "agent", "SOUL.md");
}
function projectSoulFile(): string {
  return path.join(process.cwd(), ".pi", "SOUL.md");
}

// ==============================================================
// 解析 frontmatter（IDENTIFY.md / SOUL.md 共用）
// ==============================================================

const NUMERIC_KEYS = [
  "openness", "conscientiousness", "extraversion", "agreeableness", "neuroticism",
  "formality", "tsundere", "sarcasm",
];

function parseMdFrontmatter(raw: string): Record<string, any> {
  try {
    const parsed = matter(raw);
    const fm: Record<string, any> = parsed.data as Record<string, any>;
    // 数值字段转换
    for (const key of NUMERIC_KEYS) {
      if (typeof fm[key] === "number") continue;
      if (fm[key] !== undefined) {
        const n = parseFloat(fm[key]);
        fm[key] = isNaN(n) ? 0.5 : n;
      }
    }
    return fm;
  } catch {
    return {};
  }
}

/**
 * 读取 .md 文件的正文（跳过 --- frontmatter ---），使用 gray-matter
 */
function readMdBody(filePath: string): string | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return matter(raw).content.trim() || null;
  } catch {
    return null;
  }
}

// ==============================================================
// traits 构建 (DRY)
// ==============================================================

function buildTraits(fm: Record<string, any>): SoulTraits {
  return {
    openness: fm.openness ?? DEFAULT_TRAITS.openness,
    conscientiousness: fm.conscientiousness ?? DEFAULT_TRAITS.conscientiousness,
    extraversion: fm.extraversion ?? DEFAULT_TRAITS.extraversion,
    agreeableness: fm.agreeableness ?? DEFAULT_TRAITS.agreeableness,
    neuroticism: fm.neuroticism ?? DEFAULT_TRAITS.neuroticism,
    formality: fm.formality ?? DEFAULT_TRAITS.formality,
    tsundere: fm.tsundere ?? DEFAULT_TRAITS.tsundere,
    sarcasm: fm.sarcasm ?? DEFAULT_TRAITS.sarcasm,
  };
}

// ==============================================================
// 从 IDENTIFY.md + SOUL.md 构建 SoulDefinition
// ==============================================================

function buildSoulFromFiles(
  identifyPath: string,
  soulPath: string,
  source: "user" | "project",
): SoulDefinition | null {
  try {
    const idRaw = fs.readFileSync(identifyPath, "utf-8");
    const fm = parseMdFrontmatter(idRaw);
    if (!fm.id || !fm.name || !fm.emoji) return null;

    const body = readMdBody(soulPath);
    if (!body) return null;

    return {
      id: fm.id,
      name: fm.name,
      emoji: fm.emoji,
      description: fm.description ?? `${source === "user" ? "用户" : "项目"}自定义灵魂`,
      traits: buildTraits(fm),
      systemPrompt: body,
      source,
    };
  } catch (err) {
    console.warn(`[pi-persona] 加载 SOUL.md 失败 (${source}):`, (err as Error).message);
    return null;
  }
}

/**
 * 回退方案：当 IDENTIFY.md 不存在时，从 SOUL.md frontmatter 读取全部信息
 */
function loadSoulFromSoulMdOnly(
  soulPath: string,
  source: "user" | "project",
): SoulDefinition | null {
  try {
    const raw = fs.readFileSync(soulPath, "utf-8");
    const fm = parseMdFrontmatter(raw);
    if (!fm.id || !fm.name || !fm.emoji) return null;

    const body = readMdBody(soulPath);
    if (!body) return null;

    return {
      id: fm.id,
      name: fm.name,
      emoji: fm.emoji,
      description: fm.description ?? `${source === "user" ? "用户" : "项目"}自定义灵魂`,
      traits: buildTraits(fm),
      systemPrompt: body,
      source,
    };
  } catch (err) {
    console.warn(`[pi-persona] 加载 SOUL.md 失败 (${source}):`, (err as Error).message);
    return null;
  }
}

// ==============================================================
// 缓存与公开 API
// ==============================================================

let cachedCustomSoul: SoulDefinition | null | undefined = undefined;

/** 清除自定义灵魂缓存，/persona reload 时调用 */
export function invalidateSoulCache(): void {
  cachedCustomSoul = undefined;
}

/**
 * 获取当前生效的自定义灵魂（项目 > 用户），结果缓存
 *
 * 优先: IDENTIFY.md + SOUL.md
 * 回退: SOUL.md 自带 frontmatter（兼容旧格式）
 */
function loadCustomSoul(): SoulDefinition | null {
  if (cachedCustomSoul !== undefined) return cachedCustomSoul;

  // 项目: IDENTIFY.md + SOUL.md
  if (fs.existsSync(projectIdentifyFile())) {
    cachedCustomSoul = buildSoulFromFiles(projectIdentifyFile(), projectSoulFile(), "project");
    return cachedCustomSoul;
  }
  // 项目: SOUL.md only (fallback)
  const projOnly = loadSoulFromSoulMdOnly(projectSoulFile(), "project");
  if (projOnly) { cachedCustomSoul = projOnly; return projOnly; }

  // 用户: IDENTIFY.md + SOUL.md
  if (fs.existsSync(userIdentifyFile())) {
    cachedCustomSoul = buildSoulFromFiles(userIdentifyFile(), userSoulFile(), "user");
    return cachedCustomSoul;
  }
  // 用户: SOUL.md only (fallback)
  cachedCustomSoul = loadSoulFromSoulMdOnly(userSoulFile(), "user");
  return cachedCustomSoul;
}

/**
 * 按优先级查找灵魂：自定义 > 内置
 */
export function loadSoul(id: string): SoulDefinition | null {
  const custom = loadCustomSoul();
  if (custom && custom.id === id) return custom;
  return builtinMap.get(id) ?? null;
}

/**
 * 列出所有可用灵魂：内置 6 种 + 自定义（如果有）
 */
export function listAllSouls(): SoulDefinition[] {
  const result = [...BUILTIN_SOULS];
  const custom = loadCustomSoul();
  if (custom) {
    const idx = result.findIndex(s => s.id === custom.id);
    if (idx >= 0) result[idx] = custom;
    else result.push(custom);
  }
  return result;
}
