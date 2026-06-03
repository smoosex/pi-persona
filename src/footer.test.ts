import assert from "node:assert/strict";
import test from "node:test";

import { getFooterStatusText, tickAndGetFooterText } from "./footer.js";
import { MoodEngine } from "./mood-engine.js";
import { DEFAULT_EMOTION_CONFIG, type PersistentState, type SoulDefinition } from "./types.js";

function createPersistentState(): PersistentState {
  return {
    version: 2,
    lastInteraction: Date.now(),
    lastAngle: 0,
    lastIntensity: 0.15,
    emotionUpdatesEnabled: true,
    nextHistorySequence: 1,
    history: [],
  };
}

function createSoul(): SoulDefinition {
  return {
    name: "Test Soul",
    emoji: "✨",
    description: "Test soul",
    traits: {
      openness: 0.5,
      conscientiousness: 0.5,
      extraversion: 0.5,
      agreeableness: 0.5,
      neuroticism: 0.5,
      formality: 0.5,
      tsundere: 0,
      sarcasm: 0,
    },
    systemPrompt: "You are Test Soul.",
  };
}

function createEngine(): MoodEngine {
  return new MoodEngine(createSoul(), createPersistentState(), DEFAULT_EMOTION_CONFIG);
}

test("getFooterStatusText renders soul name and current emotion label", () => {
  const engine = createEngine();
  engine.setEmotion("anger", 0.8, "manual_set");

  assert.equal(getFooterStatusText(engine), "󰊠 Test Soul·愤怒");
});

test("tickAndGetFooterText ticks engine before rendering footer", () => {
  const engine = createEngine();
  const lastInteraction = Date.now();
  engine.restoreState(0, 0.9, lastInteraction);

  const before = engine.state.intensity;
  const footer = tickAndGetFooterText(engine);

  assert.equal(footer, "󰊠 Test Soul·喜悦");
  assert.ok(engine.state.intensity <= before);
});
