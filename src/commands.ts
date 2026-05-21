// ============================================================
// pi-persona — 命令注册
// ============================================================
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { MoodEngine } from "./mood-engine.js";
import { invalidateSoulCache, loadSoul } from "./soul-loader.js";
import { restorePersistentState } from "./persistence.js";
import { refreshGlobalMood } from "./global-mood.js";
import { getFooterStatusText } from "./footer.js";
import {
  DEFAULT_EMOTION_CONFIG,
  EMOTION_EMOJI,
  EMOTION_LABELS,
} from "./types.js";

export function registerPersonaCommands(
  pi: ExtensionAPI,
  getEngine: () => MoodEngine | null,
  setEngine: (engine: MoodEngine | null) => void,
): void {
  pi.registerCommand("persona", {
    description: "查看或重新加载 pi 的灵魂状态",
    handler: async (args, ctx) => {
      const arg = args?.trim() ?? "";

      if (!arg || arg === "status") {
        const engine = getEngine();
        if (!engine) {
          ctx.ui.notify(
            "当前无激活灵魂。请创建 ~/.pi/agent/SOUL.md 后重启会话或执行 /persona reload。",
            "info",
          );
          return;
        }
        await refreshGlobalMood(engine, false);
        showEmotionDetail(engine, ctx);
        return;
      }

      if (arg === "reload") {
        invalidateSoulCache();
        const soul = loadSoul({
          onWarning: (message) => {
            if (ctx.hasUI) ctx.ui.notify(message, "warning");
          },
        });
        const engine = getEngine();
        if (!soul) {
          setEngine(null);
          if (ctx.hasUI) ctx.ui.setStatus("soul-mood", "");
          ctx.ui.notify("未找到可加载的 ~/.pi/agent/SOUL.md，灵魂已停用。", "warning");
          return;
        }
        if (!engine) {
          const persistent = restorePersistentState();
          const newEngine = new MoodEngine(soul, persistent, DEFAULT_EMOTION_CONFIG);
          newEngine.restoreState(
            persistent.lastAngle,
            persistent.lastIntensity,
            persistent.lastInteraction,
          );
          await refreshGlobalMood(newEngine, true);
          setEngine(newEngine);
          if (ctx.hasUI) ctx.ui.setStatus("soul-mood", getFooterStatusText(newEngine));
          ctx.ui.notify(`已激活灵魂: ${soul.emoji} ${soul.name}`, "info");
          return;
        }

        engine.soul = soul;
        await refreshGlobalMood(engine, true);
        if (ctx.hasUI) ctx.ui.setStatus("soul-mood", getFooterStatusText(engine));
        ctx.ui.notify(`已重新加载灵魂: ${soul.emoji} ${soul.name}`, "info");
        return;
      }

      ctx.ui.notify(
        "未知用法。可用命令: /persona、/persona status、/persona reload",
        "warning",
      );
    },
  });
}

// ============================================================== 
// Helpers
// ============================================================== 

function showEmotionDetail(engine: MoodEngine, ctx: ExtensionCommandContext): void {
  const state = engine.state;
  const emo = engine.getCurrentEmotion();
  const level = engine.getCurrentLevel();
  const levelName = engine.getLevelName();
  const compound = engine.getCompoundLabel();
  const lines: string[] = [
    "",
    "━━ 当前状态 ━━",
    "",
    `  灵魂: ${engine.soul.emoji} ${engine.soul.name}`,
    `  简介: ${engine.soul.description}`,
    "",
    `  情绪: ${EMOTION_EMOJI[emo]} ${EMOTION_LABELS[emo]} / L${level} ${levelName}`,
    `  复合: ${compound ?? "无"}`,
    `  描述: ${engine.getEmotionDesc()}`,
    `  口头禅: ${engine.getEmotionPhrase()}`,
    `  角度: ${Math.round(state.angle)}°`,
    `  强度: ${"█".repeat(Math.round(state.intensity * 10))}${"░".repeat(10 - Math.round(state.intensity * 10))} ${Math.round(state.intensity * 100)}%`,
    "",
  ];
  if (state.history.length > 0) {
    lines.push("  最近情绪变化:");
    for (const snap of state.history.slice(-5).reverse()) {
      const time = new Date(snap.timestamp).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const cmpTag = snap.compound ? ` [${snap.compound}]` : "";
      lines.push(
        `    ${time} → ${EMOTION_EMOJI[snap.emotion]} ${EMOTION_LABELS[snap.emotion]} / L${snap.level}${cmpTag} (${snap.trigger})`,
      );
    }
    lines.push("");
  }
  ctx.ui.notify(lines.join("\n"), "info");
}
