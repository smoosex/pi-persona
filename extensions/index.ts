// ============================================================
// pi-persona — 扩展入口
// ============================================================
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { MoodEngine } from "../src/mood-engine.js";
import {
  restorePersistentState,
  persistState,
  flushState,
  syncMoodToPersistent,
} from "../src/persistence.js";
import { loadSoul } from "../src/soul-loader.js";
import { getFooterStatusText, tickAndGetFooterText } from "../src/footer.js";
import { registerPersonaCommands } from "../src/commands.js";
import {
  detectFromBashResult,
  detectFromUserMessage,
  detectRepeatedErrors,
  resetErrorStreak,
  detectLateNight,
} from "../src/triggers.js";
import {
  DEFAULT_EMOTION_CONFIG,
  nearestEmotion,
} from "../src/types.js";
import type { EmotionChange } from "../src/types.js";

let currentEngine: MoodEngine | null = null;
let hooksRegistered = false;
let lastLateNightTrigger = 0;
const LATE_NIGHT_COOLDOWN_MS = 30 * 60 * 1000; // 30 分钟

export default function personaExtension(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const persistent = restorePersistentState();

    if (!hooksRegistered) {
      registerAllHooks(pi);
      registerPersonaCommands(pi, () => currentEngine, (engine) => {
        currentEngine = engine;
      });
      hooksRegistered = true;
    }

    const soulDef = loadSoul();
    if (!soulDef) {
      persistState(pi, persistent);
      if (ctx.hasUI) ctx.ui.setStatus("soul-mood", "");
      currentEngine = null;
      return;
    }

    currentEngine = new MoodEngine(soulDef, persistent, DEFAULT_EMOTION_CONFIG);

    // 从持久化恢复情绪坐标（含时间衰减）
    currentEngine.restoreState(
      persistent.lastAngle,
      persistent.lastIntensity,
      persistent.lastInteraction,
    );

    persistState(pi, persistent);

    if (ctx.hasUI) {
      ctx.ui.setStatus("soul-mood", getFooterStatusText(currentEngine));
    }

  });

  pi.on("session_shutdown", async () => {
    if (currentEngine) {
      syncMoodToPersistent(currentEngine);
      flushState(currentEngine.persistent);
    }
    currentEngine = null;
  });
}

// ==============================================================
// Hooks
// ==============================================================

function registerAllHooks(pi: ExtensionAPI): void {
  pi.on("tool_result", async (event, ctx) => {
    const engine = currentEngine;
    if (!engine || event.toolName !== "bash") return;

    const input = event.input as { command?: string } | undefined;
    const command = input?.command ?? "";
    const details = event.details as { exitCode?: number } | undefined;
    const exitCode = details?.exitCode;
    const isError = event.isError || false;
    const hasFailed = isError || (exitCode !== undefined && exitCode !== 0);

    const repeatEvent = detectRepeatedErrors(command, hasFailed, DEFAULT_EMOTION_CONFIG);
    if (repeatEvent) {
      applyAndNotify(engine, repeatEvent, ctx);
      return;
    }

    const bashEvent = detectFromBashResult(
      exitCode,
      isError,
      command,
      DEFAULT_EMOTION_CONFIG,
    );
    if (bashEvent) applyAndNotify(engine, bashEvent, ctx);
  });

  pi.on("agent_end", async (event, ctx) => {
    const engine = currentEngine;
    if (!engine) return;

    const messages = (event as any).messages ?? [];
    for (const msg of messages) {
      if (msg.role === "user") {
        const content =
          typeof msg.content === "string"
            ? msg.content
            : Array.isArray(msg.content)
              ? (msg.content.find((c: any) => c.type === "text")?.text ?? "")
              : "";
        if (content) {
          const userEvent = detectFromUserMessage(
            content,
            DEFAULT_EMOTION_CONFIG,
            engine.soul.traits.agreeableness,
          );
          if (userEvent) applyAndNotify(engine, userEvent, ctx);
        }
      }
    }

    const lateEvent = detectLateNight(
      DEFAULT_EMOTION_CONFIG,
      engine.soul.traits.extraversion,
    );
    if (lateEvent) {
      const now = Date.now();
      if (now - lastLateNightTrigger >= LATE_NIGHT_COOLDOWN_MS) {
        lastLateNightTrigger = now;
        applyAndNotify(engine, lateEvent, ctx);
      }
    }

    if (ctx.hasUI) ctx.ui.setStatus("soul-mood", tickAndGetFooterText(engine));
    syncMoodToPersistent(engine);
    persistState(pi, engine.persistent);
    resetErrorStreak();
  });

  pi.on("turn_end", async (_event, ctx) => {
    const engine = currentEngine;
    if (!engine) return;
    if (ctx.hasUI) ctx.ui.setStatus("soul-mood", tickAndGetFooterText(engine));
  });

  pi.on("before_agent_start", async (event, _ctx) => {
    const engine = currentEngine;
    if (!engine) return;

    const soulDef = loadSoul();
    if (!soulDef) return;
    engine.soul = soulDef;
    engine.tick();

    const addition = engine.getSystemPromptAddition();
    const currentPrompt = (event as any).systemPrompt ?? "";
    return {
      systemPrompt: currentPrompt + "\n\n---\n\n" + addition + "\n\n---",
    };
  });
}

// ==============================================================
// Helpers
// ==============================================================

function applyAndNotify(
  engine: MoodEngine,
  event: { trigger: string; targetAngle: number; force: number },
  ctx: any,
): void {
  const change: EmotionChange = engine.processEvent(event);
  if (change.notify && ctx.hasUI && change.catchphrase) {
    const emo = nearestEmotion(change.newAngle);
    ctx.ui.notify(
      `${engine.soul.emoji} ${change.catchphrase}`,
      emo === "anger" || emo === "sadness" || emo === "fear" || emo === "disgust"
        ? "warning"
        : "info",
    );
  }
  if (ctx.hasUI) ctx.ui.setStatus("soul-mood", getFooterStatusText(engine));
}
