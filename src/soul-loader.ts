// ============================================================
// pi-persona — 灵魂加载器
// 自定义方式: ~/.pi/agent/IDENTIFY.md（元数据）+ ~/.pi/agent/SOUL.md（散文正文）
// 只读取用户级 ~/.pi/agent/；如果该位置没有 SOUL.md，则不加载/注入灵魂
// ============================================================
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import matter from "gray-matter";
import type { SoulDefinition, SoulTraits } from "./types.js";
import { DEFAULT_TRAITS } from "./types.js";

export type SoulWarningSink = (message: string) => void;

export interface LoadSoulOptions {
  onWarning?: SoulWarningSink;
}

type FileStamp =
  | { exists: true; mtimeMs: number; size: number }
  | { exists: false };

interface SoulCacheStamp {
  soul: FileStamp;
  identify: FileStamp;
}

// ==============================================================
// 文件路径
// ==============================================================

function userIdentifyFile(): string {
  return path.join(os.homedir(), ".pi", "agent", "IDENTIFY.md");
}

function userSoulFile(): string {
  return path.join(os.homedir(), ".pi", "agent", "SOUL.md");
}

function getFileStamp(filePath: string): FileStamp {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return { exists: false };

    return {
      exists: true,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    };
  } catch {
    return { exists: false };
  }
}

function getSoulCacheStamp(): SoulCacheStamp {
  return {
    soul: getFileStamp(userSoulFile()),
    identify: getFileStamp(userIdentifyFile()),
  };
}

function sameFileStamp(a: FileStamp, b: FileStamp): boolean {
  if (a.exists !== b.exists) return false;
  if (!a.exists || !b.exists) return true;

  return a.mtimeMs === b.mtimeMs && a.size === b.size;
}

function sameSoulCacheStamp(a: SoulCacheStamp | undefined, b: SoulCacheStamp): boolean {
  if (!a) return false;

  return sameFileStamp(a.soul, b.soul) && sameFileStamp(a.identify, b.identify);
}

// ==============================================================
// 解析 frontmatter（IDENTIFY.md / SOUL.md 共用）
// ==============================================================

const NUMERIC_KEYS = [
  "openness", "conscientiousness", "extraversion", "agreeableness", "neuroticism",
  "formality", "tsundere", "sarcasm",
];

function parseMdFrontmatter(raw: string, onWarning?: SoulWarningSink): Record<string, any> {
  try {
    const parsed = matter(raw);
    const fm: Record<string, any> = parsed.data as Record<string, any>;
    // 数值字段转换。非法值不再静默变成 0.5，而是提示并交给 DEFAULT_TRAITS。
    for (const key of NUMERIC_KEYS) {
      const value = fm[key];
      if (value === undefined) continue;

      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n) || n < 0 || n > 1) {
        onWarning?.(
          `[pi-persona] IDENTIFY.md 字段 ${key} 必须是 0 到 1 之间的数字，当前值 ${JSON.stringify(value)} 无效，已使用默认值。`,
        );
        delete fm[key];
        continue;
      }

      fm[key] = n;
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
// 从用户级 IDENTIFY.md + SOUL.md 构建 SoulDefinition
// ============================================================== 

function buildSoul(metadata: Record<string, any>, systemPrompt: string): SoulDefinition {
  return {
    name: metadata.name ?? "Soul",
    emoji: metadata.emoji ?? "󰊠",
    description: metadata.description ?? "用户自定义灵魂",
    traits: buildTraits(metadata),
    systemPrompt,
  };
}

// ==============================================================
// 缓存与公开 API
// ==============================================================

let cachedSoul: SoulDefinition | null | undefined = undefined;
let cachedWarnings: string[] = [];
let cachedStamp: SoulCacheStamp | undefined = undefined;

/** 清除灵魂缓存，/persona reload 时调用 */
export function invalidateSoulCache(): void {
  cachedSoul = undefined;
  cachedWarnings = [];
  cachedStamp = undefined;
}

/**
 * 加载当前唯一灵魂。
 *
 * 只读取 ~/.pi/agent/SOUL.md：
 * - 如果 SOUL.md 不存在或正文为空，不加载任何灵魂
 * - 如果 IDENTIFY.md 存在，使用 IDENTIFY.md frontmatter 作为元数据
 * - 如果 IDENTIFY.md 不存在，使用默认元数据
 *
 * IDENTIFY.md 中的 id 字段会被忽略；当前实现不再需要唯一 id。
 */
export function loadSoul(options: LoadSoulOptions = {}): SoulDefinition | null {
  const currentStamp = getSoulCacheStamp();

  if (cachedSoul !== undefined && sameSoulCacheStamp(cachedStamp, currentStamp)) {
    for (const warning of cachedWarnings) options.onWarning?.(warning);
    return cachedSoul;
  }

  const warnings: string[] = [];
  const onWarning = (message: string) => {
    warnings.push(message);
    options.onWarning?.(message);
  };

  const soulPath = userSoulFile();
  const systemPrompt = readMdBody(soulPath);
  if (!systemPrompt) {
    cachedWarnings = warnings;
    cachedSoul = null;
    cachedStamp = currentStamp;
    return null;
  }

  let metadata: Record<string, any> = {};
  try {
    const identifyRaw = fs.readFileSync(userIdentifyFile(), "utf-8");
    metadata = parseMdFrontmatter(identifyRaw, onWarning);
  } catch {
    metadata = {};
  }

  cachedWarnings = warnings;
  cachedSoul = buildSoul(metadata, systemPrompt);
  cachedStamp = currentStamp;
  return cachedSoul;
}
