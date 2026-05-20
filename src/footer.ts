// ============================================================
// pi-persona — Footer 心情显示
// ============================================================
import type { MoodEngine } from "./mood-engine.js";

export function getFooterStatusText(engine: MoodEngine): string {
  const data = engine.getFooterData();
  return `󰊠 ${data.soulName}·${data.emotionLabel}`;
}

export function tickAndGetFooterText(engine: MoodEngine): string {
  engine.tick();
  return getFooterStatusText(engine);
}
