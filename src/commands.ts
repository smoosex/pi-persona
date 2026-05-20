// ============================================================
// pi-persona — 命令注册
// ============================================================
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { MoodEngine } from "./mood-engine.js";
import { loadSoul, listAllSouls, invalidateSoulCache } from "./soul-loader.js";
import { persistState, syncMoodToPersistent } from "./persistence.js";
import { getFooterStatusText } from "./footer.js";
import {
  EMOTION_EMOJI,
  EMOTION_LABELS,
} from "./types.js";

export function registerPersonaCommands(
  pi: ExtensionAPI,
  getEngine: () => MoodEngine | null,
): void {
  pi.registerCommand("persona", {
    description: "切换或查看 pi 的灵魂",
    handler: async (args, ctx) => {
      const engine = getEngine();
      if (!engine) {
        ctx.ui.notify("灵魂系统尚未初始化。", "warning");
        return;
      }

      if (!args || args.trim() === "") {
        const currentId = engine.persistent.soulId;
        const all = listAllSouls();
        const lines: string[] = ["", "━━ 可用的灵魂 ━━", ""];
        for (const s of all) {
          const marker = s.id === currentId ? " ← 当前" : "";
          const sourceTag = s.source === "builtin" ? "" : ` [${s.source}]`;
          lines.push(`  ${s.emoji} ${s.name} (${s.id})${sourceTag}${marker}`);
          lines.push(`     ${s.description}`);
          lines.push("");
        }
        lines.push("用法: /persona <id>     切换到指定灵魂");
        lines.push("      /persona random   随机一个灵魂");
        lines.push("      /persona off      关闭灵魂");
        lines.push("      /persona status   查看当前状态");
        lines.push(
          "      /persona reload   重新加载 IDENTIFY.md / SOUL.md",
        );
        lines.push("");
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }

      const arg = args.trim();

      if (arg === "off") {
        engine.persistent.soulId = "";
        ctx.ui.notify("灵魂已关闭。pi 恢复默认模式。", "info");
        if (ctx.hasUI) ctx.ui.setStatus("soul-mood", "");
        syncMoodToPersistent(engine);
        persistState(pi, engine.persistent);
        return;
      }

      if (arg === "status") {
        showEmotionDetail(engine, ctx);
        return;
      }

      if (arg === "random") {
        const all = listAllSouls().filter(
          (s) => s.id !== engine.persistent.soulId,
        );
        const pick = all[Math.floor(Math.random() * all.length)];
        if (pick) switchSoul(pi, engine, pick.id, ctx);
        return;
      }

      if (arg === "reload") {
        invalidateSoulCache();
        const currentSoul = loadSoul(engine.persistent.soulId);
        if (currentSoul) {
          engine.soul = currentSoul;
          ctx.ui.notify(
            `已重新加载。当前灵魂: ${currentSoul.emoji} ${currentSoul.name}`,
            "info",
          );
        } else {
          ctx.ui.notify("当前无激活灵魂。", "info");
        }
        return;
      }

      const target = loadSoul(arg);
      if (!target) {
        ctx.ui.notify(
          `找不到灵魂 "${arg}"。用 /persona 查看可用列表。`,
          "warning",
        );
        return;
      }
      switchSoul(pi, engine, target.id, ctx);
    },
  });
}

// ==============================================================
// Helpers
// ==============================================================

function switchSoul(
  pi: ExtensionAPI,
  engine: MoodEngine,
  soulId: string,
  ctx: any,
): void {
  const target = loadSoul(soulId);
  if (!target) return;

  const oldId = engine.persistent.soulId;
  engine.persistent.soulId = soulId;
  engine.soul = target;
  engine.state.angle = 0;
  engine.state.intensity = 0.15;
  engine.state.history = [];

  syncMoodToPersistent(engine);
  persistState(pi, engine.persistent);

  if (oldId) {
    const oldSoul = loadSoul(oldId);
    ctx.ui.notify(
      `${oldSoul?.emoji ?? ""} ${oldSoul?.name ?? oldId} → ${target.emoji} ${target.name}\n"${target.description}"`,
      "info",
    );
  } else {
    ctx.ui.notify(
      `灵魂已激活: ${target.emoji} ${target.name}\n"${target.description}"`,
      "info",
    );
  }
  if (ctx.hasUI) ctx.ui.setStatus("soul-mood", getFooterStatusText(engine));
}

function showEmotionDetail(engine: MoodEngine, ctx: any): void {
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
