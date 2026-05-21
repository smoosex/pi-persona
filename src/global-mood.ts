// ============================================================
// pi-persona — 全局共享心情状态
// ============================================================
import { MoodEngine } from "./mood-engine.js";
import { readPersistentStateLocked, syncMoodToPersistent, updatePersistentState } from "./persistence.js";
import type { EmotionalEvent, EmotionChange, PersistentState } from "./types.js";

function restoreEngineFromPersistent(engine: MoodEngine): void {
  engine.restoreState(
    engine.persistent.lastAngle,
    engine.persistent.lastIntensity,
    engine.persistent.lastInteraction,
  );
  syncMoodToPersistent(engine);
}

function replaceEnginePersistent(engine: MoodEngine, persistent: PersistentState): void {
  engine.persistent.lastInteraction = persistent.lastInteraction;
  engine.persistent.lastAngle = persistent.lastAngle;
  engine.persistent.lastIntensity = persistent.lastIntensity;
}

export async function refreshGlobalMood(engine: MoodEngine, persist: boolean): Promise<void> {
  try {
    if (persist) {
      const next = await updatePersistentState((persistent) => {
        replaceEnginePersistent(engine, persistent);
        restoreEngineFromPersistent(engine);
        return engine.persistent;
      });
      replaceEnginePersistent(engine, next);
      return;
    }

    const next = await readPersistentStateLocked();
    replaceEnginePersistent(engine, next);
    restoreEngineFromPersistent(engine);
  } catch (err) {
    console.error("[pi-persona] 刷新全局心情失败:", err);
    if (persist) {
      engine.tick();
      syncMoodToPersistent(engine);
    }
  }
}

export async function applyGlobalMoodEvent(
  engine: MoodEngine,
  event: EmotionalEvent,
): Promise<EmotionChange> {
  let change: EmotionChange | null = null;

  try {
    const next = await updatePersistentState((persistent) => {
      replaceEnginePersistent(engine, persistent);
      restoreEngineFromPersistent(engine);
      change = engine.processEvent(event);
      syncMoodToPersistent(engine);
      return engine.persistent;
    });

    replaceEnginePersistent(engine, next);
  } catch (err) {
    console.error("[pi-persona] 应用全局心情事件失败，已降级为本地更新:", err);
    change = engine.processEvent(event);
    syncMoodToPersistent(engine);
  }

  if (!change) {
    throw new Error("Global mood event did not produce a change");
  }
  return change;
}
