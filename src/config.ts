// ============================================================
// pi-persona — 配置加载
// ============================================================
import type { SoulConfig } from "./types.js";
import { DEFAULT_SOUL_CONFIG } from "./types.js";

/**
 * 从 settings.json 加载 soul 配置，合并默认值。
 */
export function loadSoulConfig(raw?: Partial<SoulConfig>): SoulConfig {
  return { ...DEFAULT_SOUL_CONFIG, ...raw };
}
