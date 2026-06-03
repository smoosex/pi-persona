import assert from "node:assert/strict";
import test from "node:test";

import { MoodEngine } from "./mood-engine.js";
import { DEFAULT_EMOTION_CONFIG, type PersistentState, type SoulDefinition } from "./types.js";
import { parseSetEmotionArgs } from "./commands.js";

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

test("tick keeps intensity fixed when emotion updates are disabled", () => {
  const engine = createEngine();
  engine.persistent.emotionUpdatesEnabled = false;
  const lastInteraction = Date.now() - 60_000;

  engine.restoreState(45, 0.9, lastInteraction);
  engine.tick(lastInteraction + 1_000);

  assert.equal(engine.state.angle, 45);
  assert.equal(engine.state.intensity, 0.9);
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

test("setEmotion directly sets emotion angle and intensity", () => {
  const engine = createEngine();

  engine.setEmotion("anger", 0.8, "manual_set");

  assert.equal(engine.state.angle, 270);
  assert.equal(engine.state.intensity, 0.8);
  assert.equal(engine.getCurrentEmotion(), "anger");
});

test("setEmotion clamps intensity", () => {
  const engine = createEngine();

  engine.setEmotion("joy", -1, "manual_set");
  assert.equal(engine.state.intensity, 0);

  engine.setEmotion("joy", 2, "manual_set");
  assert.equal(engine.state.intensity, 1);
});

test("setEmotion records history snapshot", () => {
  const engine = createEngine();

  engine.setEmotion("sadness", 0.35, "manual_set");

  const snapshot = engine.state.history.at(-1);
  assert.ok(snapshot);
  assert.equal(snapshot.emotion, "sadness");
  assert.equal(snapshot.angle, 180);
  assert.equal(snapshot.intensity, 0.35);
  assert.equal(snapshot.trigger, "manual_set");
});

test("negative correction from joy avoids the trust-side route", () => {
  const engine = createEngine();
  engine.setEmotion("joy", 1, "manual_set");

  engine.processEvent({
    trigger: "user_correction",
    ...DEFAULT_EMOTION_CONFIG.triggers.user_correction,
  });

  assert.equal(engine.getCurrentEmotion(), "anger");
});

test("repeated negative corrections move joy toward sadness through negative emotions", () => {
  const engine = createEngine();
  engine.setEmotion("joy", 1, "manual_set");

  const emotions = [];
  for (let i = 0; i < 3; i++) {
    engine.processEvent({
      trigger: "user_correction",
      ...DEFAULT_EMOTION_CONFIG.triggers.user_correction,
    });
    emotions.push(engine.getCurrentEmotion());
  }

  assert.deepEqual(emotions, ["anger", "disgust", "sadness"]);
});

test("parseSetEmotionArgs accepts english, chinese, percentage, and decimal intensity", () => {
  assert.deepEqual(parseSetEmotionArgs("anger 80"), {
    ok: true,
    emotion: "anger",
    intensity: 0.8,
  });
  assert.deepEqual(parseSetEmotionArgs("joy 0.6"), {
    ok: true,
    emotion: "joy",
    intensity: 0.6,
  });
  assert.deepEqual(parseSetEmotionArgs("喜悦 70%"), {
    ok: true,
    emotion: "joy",
    intensity: 0.7,
  });
});

test("parseSetEmotionArgs rejects invalid input", () => {
  assert.equal(parseSetEmotionArgs("nope 80").ok, false);
  assert.equal(parseSetEmotionArgs("joy 120").ok, false);
  assert.equal(parseSetEmotionArgs("joy").ok, false);
});
