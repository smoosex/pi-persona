// ============================================================
// pi-persona — 扩展入口
// ============================================================
import type {
  AgentEndEvent,
  BeforeAgentStartEvent,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
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
  createRepeatedErrorState,
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
import type { EmotionChange, EmotionalEvent } from "../src/types.js";
import type { RepeatedErrorState } from "../src/triggers.js";

interface PersonaRuntimeState {
  engine: MoodEngine | null;
  lastLateNightTrigger: number;
  repeatedErrors: RepeatedErrorState;
}

const LATE_NIGHT_COOLDOWN_MS = 30 * 60 * 1000; // 30 分钟

export default function personaExtension(pi: ExtensionAPI) {
  const state: PersonaRuntimeState = {
    engine: null,
    lastLateNightTrigger: 0,
    repeatedErrors: createRepeatedErrorState(),
  };

  registerAllHooks(pi, state);
  registerPersonaCommands(pi, () => state.engine, (engine) => {
    state.engine = engine;
  });

  pi.on("session_start", async (_event, ctx) => {
    const persistent = restorePersistentState();

    const soulDef = loadSoul();
    if (!soulDef) {
      if (ctx.hasUI) ctx.ui.setStatus("soul-mood", "");
      state.engine = null;
      resetRuntimeState(state);
      return;
    }

    state.engine = new MoodEngine(soulDef, persistent, DEFAULT_EMOTION_CONFIG);
    resetRuntimeState(state);

    // 从持久化恢复情绪坐标（含时间衰减）
    state.engine.restoreState(
      persistent.lastAngle,
      persistent.lastIntensity,
      persistent.lastInteraction,
    );

    // restoreState() 会在内存中执行时间衰减；写回前必须先同步，
    // 避免把未衰减的 lastAngle / lastIntensity 搭配新的时间戳持久化。
    syncMoodToPersistent(state.engine);
    persistState(pi, state.engine.persistent);

    if (ctx.hasUI) {
      ctx.ui.setStatus("soul-mood", getFooterStatusText(state.engine));
    }

  });

  pi.on("session_shutdown", async () => {
    if (state.engine) {
      state.engine.tick();
      syncMoodToPersistent(state.engine);
      flushState(state.engine.persistent);
    }
    state.engine = null;
    resetRuntimeState(state);
  });
}

// ==============================================================
// Hooks
// ==============================================================

function registerAllHooks(pi: ExtensionAPI, state: PersonaRuntimeState): void {
  pi.on("tool_result", async (event, ctx) => {
    const engine = state.engine;
    if (!engine || event.toolName !== "bash") return;

    const input = event.input as { command?: string } | undefined;
    const command = input?.command ?? "";
    const details = event.details as { exitCode?: number } | undefined;
    const exitCode = details?.exitCode;
    const isError = event.isError || false;
    const hasFailed = isError || (exitCode !== undefined && exitCode !== 0);

    const repeatEvent = detectRepeatedErrors(command, hasFailed, DEFAULT_EMOTION_CONFIG, state.repeatedErrors);
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
    const engine = state.engine;
    if (!engine) return;

    let sawUserMessage = false;
    let lastUserEvent: EmotionalEvent | null = null;

    for (const msg of event.messages) {
      if (msg.role === "user") {
        sawUserMessage = true;
        const content = extractUserText(msg.content);
        if (content) {
          const userEvent = detectFromUserMessage(
            content,
            DEFAULT_EMOTION_CONFIG,
            engine.soul.traits.agreeableness,
          );
          if (userEvent) lastUserEvent = userEvent;
        }
      }
    }

    // 同一轮可能包含 steering / follow-up 等多条 user message。
    // 用户反馈情绪只应用最后一个有效事件，避免多句表扬或纠正连续叠加强度。
    if (lastUserEvent) applyAndNotify(engine, lastUserEvent, ctx);

    // late_night 表示“用户深夜还在互动”，不是“agent 深夜结束了一轮”。
    // 只在本轮真的包含用户消息时触发，避免 retry / follow-up / 工具续跑空转时污染情绪。
    if (sawUserMessage) {
      const lateEvent = detectLateNight(
        DEFAULT_EMOTION_CONFIG,
        engine.soul.traits.extraversion,
      );
      if (lateEvent) {
        const now = Date.now();
        if (now - state.lastLateNightTrigger >= LATE_NIGHT_COOLDOWN_MS) {
          state.lastLateNightTrigger = now;
          applyAndNotify(engine, lateEvent, ctx);
        }
      }
    }

    engine.tick();
    if (ctx.hasUI) ctx.ui.setStatus("soul-mood", getFooterStatusText(engine));
    syncMoodToPersistent(engine);
    persistState(pi, engine.persistent);
    resetErrorStreak(state.repeatedErrors);
  });

  pi.on("turn_end", async (_event, ctx) => {
    const engine = state.engine;
    if (!engine) return;
    if (ctx.hasUI) ctx.ui.setStatus("soul-mood", tickAndGetFooterText(engine));
  });

  pi.on("before_agent_start", async (event: BeforeAgentStartEvent, _ctx) => {
    const engine = state.engine;
    if (!engine) return;

    const soulDef = loadSoul();
    if (!soulDef) return;
    engine.soul = soulDef;
    engine.tick();

    const addition = engine.getSystemPromptAddition();
    return {
      systemPrompt: event.systemPrompt + "\n\n---\n\n" + addition + "\n\n---",
    };
  });
}

// ==============================================================
// Helpers
// ==============================================================

function resetRuntimeState(state: PersonaRuntimeState): void {
  state.lastLateNightTrigger = 0;
  resetErrorStreak(state.repeatedErrors);
}

function extractUserText(content: Extract<AgentEndEvent["messages"][number], { role: "user" }>["content"]): string {
  if (typeof content === "string") return content;

  return content.find((part) => part.type === "text")?.text ?? "";
}

function applyAndNotify(
  engine: MoodEngine,
  event: EmotionalEvent,
  ctx: ExtensionContext,
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
