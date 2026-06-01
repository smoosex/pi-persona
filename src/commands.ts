// ============================================================
// pi-persona — 命令注册
// ============================================================
import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { MoodEngine } from "./mood-engine.js";
import { invalidateSoulCache, loadSoul } from "./soul-loader.js";
import { restorePersistentState } from "./persistence.js";
import { refreshGlobalMood, setGlobalMood } from "./global-mood.js";
import { getFooterStatusText } from "./footer.js";
import {
  DEFAULT_EMOTION_CONFIG,
  EMOTION_EMOJI,
  EMOTION_LABELS,
} from "./types.js";
import type { Emotion } from "./types.js";

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
        await showEmotionDetail(engine, ctx);
        return;
      }

      const setMatch = /^set(?:\s+(.*))?$/.exec(arg);
      if (setMatch) {
        const engine = getEngine();
        if (!engine) {
          ctx.ui.notify(
            "当前无激活灵魂。请创建 ~/.pi/agent/SOUL.md 后重启会话或执行 /persona reload。",
            "info",
          );
          return;
        }

        const parsed = parseSetEmotionArgs(setMatch[1] ?? "");
        if (!parsed.ok) {
          ctx.ui.notify(parsed.message, "warning");
          return;
        }

        await setGlobalMood(engine, parsed.emotion, parsed.intensity, "manual_set");
        if (ctx.hasUI) ctx.ui.setStatus("soul-mood", getFooterStatusText(engine));
        ctx.ui.notify(
          `已设置情绪: ${EMOTION_EMOJI[parsed.emotion]} ${EMOTION_LABELS[parsed.emotion]} / ${Math.round(parsed.intensity * 100)}%`,
          "info",
        );
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
        "未知用法。可用命令: /persona、/persona status、/persona reload、/persona set <emotion> <intensity>",
        "warning",
      );
    },
  });
}

// ============================================================== 
// Helpers
// ============================================================== 

const EMOTION_ALIASES: Record<string, Emotion> = {
  joy: "joy",
  喜悦: "joy",
  trust: "trust",
  信任: "trust",
  fear: "fear",
  恐惧: "fear",
  surprise: "surprise",
  惊讶: "surprise",
  sadness: "sadness",
  悲伤: "sadness",
  disgust: "disgust",
  厌恶: "disgust",
  anger: "anger",
  愤怒: "anger",
  anticipation: "anticipation",
  期待: "anticipation",
};

const SET_USAGE = "用法: /persona set <emotion> <intensity>，例如 /persona set anger 80";
const AVAILABLE_EMOTIONS = "可用情绪: joy, trust, fear, surprise, sadness, disgust, anger, anticipation（也支持中文标签）";

export type ParseSetEmotionResult =
  | { ok: true; emotion: Emotion; intensity: number }
  | { ok: false; message: string };

export function parseSetEmotionArgs(input: string): ParseSetEmotionResult {
  const parts = input.trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 2) {
    return { ok: false, message: SET_USAGE };
  }

  const emotion = EMOTION_ALIASES[parts[0].toLowerCase()] ?? EMOTION_ALIASES[parts[0]];
  if (!emotion) {
    return { ok: false, message: `未知情绪。${AVAILABLE_EMOTIONS}` };
  }

  const intensity = parseIntensity(parts[1]);
  if (intensity === null) {
    return { ok: false, message: "强度必须是 0-1、0-100 或百分比，例如 0.7、70、70%" };
  }

  return { ok: true, emotion, intensity };
}

function parseIntensity(input: string): number | null {
  const raw = input.trim();
  if (!raw) return null;

  const isPercent = raw.endsWith("%");
  const numericPart = isPercent ? raw.slice(0, -1) : raw;
  if (!/^\d+(?:\.\d+)?$/.test(numericPart)) return null;

  const value = Number(numericPart);
  if (!Number.isFinite(value)) return null;

  if (isPercent) {
    if (value < 0 || value > 100) return null;
    return value / 100;
  }

  if (value >= 0 && value <= 1) return value;
  if (value >= 0 && value <= 100) return value / 100;
  return null;
}

async function showEmotionDetail(engine: MoodEngine, ctx: ExtensionCommandContext): Promise<void> {
  await ctx.ui.custom<void>(
    (_tui, theme, _keybindings, done) => new PersonaOverlay(theme, engine, done),
    {
      overlay: true,
      overlayOptions: { anchor: "center", width: "54%" },
    },
  );
}

// ==============================================================
// PersonaOverlay — 浮窗展示灵魂/情绪状态
// ==============================================================

class PersonaOverlay implements Component {
  private theme: Theme;
  private engine: MoodEngine;
  private done: (result: void) => void;

  constructor(
    theme: Theme,
    engine: MoodEngine,
    done: (result: void) => void,
  ) {
    this.theme = theme;
    this.engine = engine;
    this.done = done;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "return") || matchesKey(data, "enter")) {
      this.done();
    }
  }

  render(width: number): string[] {
    const th = this.theme;
    const w = Math.min(62, width);
    const innerW = w - 2;

    const pad = (s: string, len: number): string => {
      const vis = visibleWidth(s);
      return s + " ".repeat(Math.max(0, len - vis));
    };

    const row = (content: string): string =>
      th.fg("border", "│") + pad(truncateToWidth(content, innerW, "…"), innerW) + th.fg("border", "│");

    const labeledRows = (label: string, text: string, color?: "muted" | "dim"): void => {
      const prefix = ` ${th.fg("accent", label)}  `;
      const textWidth = Math.max(1, innerW - visibleWidth(prefix));
      const wrapped = wrapTextWithAnsi(color ? th.fg(color, text) : text, textWidth);
      if (wrapped.length === 0) {
        lines.push(row(prefix));
        return;
      }
      lines.push(row(`${prefix}${wrapped[0]}`));
      const indent = " ".repeat(visibleWidth(prefix));
      for (const line of wrapped.slice(1, 2)) {
        lines.push(row(`${indent}${line}`));
      }
    };

    const state = this.engine.state;
    const emo = this.engine.getCurrentEmotion();
    const level = this.engine.getCurrentLevel();
    const levelName = this.engine.getLevelName();
    const compound = this.engine.getCompoundLabel();
    const bar = Math.round(state.intensity * 10);

    const lines: string[] = [];

    lines.push(th.fg("border", `╭${"─".repeat(innerW)}╮`));

    const title = `${this.engine.soul.emoji} ${this.engine.soul.name}`;
    lines.push(row(` ${th.bold(th.fg("accent", title))}`));

    const desc = this.engine.soul.description;
    if (desc) {
      lines.push(row(` ${th.fg("dim", desc)}`));
    }

    lines.push(row(""));

    const emotionLabel = `${EMOTION_EMOJI[emo]} ${EMOTION_LABELS[emo]} / L${level} ${levelName}`;
    labeledRows("情绪:", emotionLabel);

    const compLabel = compound ?? "无";
    labeledRows("复合:", compLabel, "muted");

    labeledRows("描述:", this.engine.getEmotionDesc());
    labeledRows("口头禅:", this.engine.getEmotionPhrase(), "muted");

    const angleStr = `${Math.round(state.angle)}°`;
    labeledRows("角度:", angleStr);

    const intensityBar = `${th.fg("accent", "█".repeat(bar))}${th.fg("dim", "░".repeat(10 - bar))}`;
    const intensityPct = `${Math.round(state.intensity * 100)}%`;
    labeledRows("强度:", `${intensityBar} ${intensityPct}`);

    if (state.history.length > 0) {
      lines.push(row(""));
      lines.push(row(` ${th.fg("dim", "── 最近情绪变化 ──")}`));
      for (const snap of state.history.slice(-3).reverse()) {
        const time = new Date(snap.timestamp).toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
        });
        const cmpTag = snap.compound ? ` [${snap.compound}]` : "";
        const entry = `${time} → ${EMOTION_EMOJI[snap.emotion]} ${EMOTION_LABELS[snap.emotion]} / L${snap.level}${cmpTag}`;
        lines.push(row(`  ${entry}`));
        lines.push(row(`          (${th.fg("dim", snap.trigger)})`));
      }
    }

    lines.push(row(""));
    lines.push(row(` ${th.fg("dim", "Esc / Enter 关闭")}`));
    lines.push(th.fg("border", `╰${"─".repeat(innerW)}╯`));

    return lines;
  }

  invalidate(): void {}
  dispose(): void {}
}
