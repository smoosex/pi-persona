import assert from "node:assert/strict";
import test from "node:test";

import { MoodEngine } from "./mood-engine.js";
import { DEFAULT_EMOTION_CONFIG, type PersistentState, type SoulDefinition } from "./types.js";

function createPersistentState(): PersistentState {
  return {
    version: 2,
    lastInteraction: Date.now(),
    lastAngle: 0,
    lastIntensity: 0.15,
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

test("tick preserves emotion angle", () => {
  const engine = createEngine();
  const lastInteraction = Date.now();

  engine.restoreState(45, 0.06, lastInteraction);
  engine.tick(lastInteraction + 1_000);

  assert.equal(engine.state.angle, 45);
});

test("tick gradually restores intensity from below baseline", () => {
  const engine = createEngine();
  const lastInteraction = Date.now();

  engine.restoreState(45, 0.06, lastInteraction);
  const before = engine.state.intensity;
  engine.tick(lastInteraction + 1_000);

  assert.ok(engine.state.intensity > before);
  assert.ok(engine.state.intensity < 0.15);
});

test("tick gradually decays intensity from above baseline", () => {
  const engine = createEngine();
  const lastInteraction = Date.now();

  engine.restoreState(270, 0.8, lastInteraction);
  const before = engine.state.intensity;
  engine.tick(lastInteraction + 1_000);

  assert.ok(engine.state.intensity < before);
  assert.ok(engine.state.intensity > 0.15);
  assert.equal(engine.state.angle, 270);
});
