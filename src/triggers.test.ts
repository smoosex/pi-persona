import assert from "node:assert/strict";
import test from "node:test";

import {
  createRepeatedErrorState,
  detectExplicitUserFeedback,
  detectFromBashResult,
  detectFromUserMessage,
  detectImplicitAcceptance,
  detectLateNight,
  detectRepeatedErrors,
  resetErrorStreak,
} from "./triggers.js";
import { DEFAULT_EMOTION_CONFIG } from "./types.js";

function triggerFor(command: string): string | null {
  return detectFromBashResult(0, false, command, DEFAULT_EMOTION_CONFIG)?.trigger ?? null;
}

test("detects build commands only at command boundaries", () => {
  for (const command of [
    "tsc",
    "npm run build",
    "bun build",
    "bun run build",
    "go build ./...",
    "cargo build",
    "make",
    "gradle build",
    "mvn -q package",
    "cd app && npm run build",
  ]) {
    assert.equal(triggerFor(command), "build_success", command);
  }
});

test("does not classify incidental build-like words as build commands", () => {
  for (const command of [
    "echo tsc",
    "grep tsc README.md",
    "npm run build-docs",
    "echo npm run build",
    "printf 'go build'",
  ]) {
    assert.equal(triggerFor(command), "command_success", command);
  }
});

test("detects test commands only at command boundaries", () => {
  for (const command of [
    "npm test",
    "npm run test",
    "bun test",
    "go test ./...",
    "cargo test",
    "pytest tests",
    "jest --runInBand",
    "vitest run",
    "gradle test",
    "mvn test",
  ]) {
    assert.equal(triggerFor(command), "test_pass", command);
  }
});

test("does not classify incidental test-like words as test commands", () => {
  for (const command of [
    "echo jest",
    "grep vitest README.md",
    "npm run test-docs",
    "echo npm test",
    "printf 'pytest tests'",
  ]) {
    assert.equal(triggerFor(command), "command_success", command);
  }
});

test("detectFromBashResult distinguishes failures and unknown results", () => {
  assert.equal(
    detectFromBashResult(1, false, "npm run build", DEFAULT_EMOTION_CONFIG)?.trigger,
    "build_error",
  );
  assert.equal(
    detectFromBashResult(1, false, "bun test", DEFAULT_EMOTION_CONFIG)?.trigger,
    "test_fail",
  );
  assert.equal(
    detectFromBashResult(1, false, "ls nope", DEFAULT_EMOTION_CONFIG)?.trigger,
    "command_error",
  );
  assert.equal(detectFromBashResult(undefined, false, "ls", DEFAULT_EMOTION_CONFIG), null);
});

test("detectRepeatedErrors tracks repeated simplified commands", () => {
  const state = createRepeatedErrorState();

  assert.equal(detectRepeatedErrors("tsc --pretty # comment", true, DEFAULT_EMOTION_CONFIG, state), null);
  assert.equal(detectRepeatedErrors("tsc --noEmit", true, DEFAULT_EMOTION_CONFIG, state), null);
  assert.equal(
    detectRepeatedErrors("tsc --watch", true, DEFAULT_EMOTION_CONFIG, state)?.trigger,
    "error_streak_3",
  );
  assert.equal(detectRepeatedErrors("eslint .", false, DEFAULT_EMOTION_CONFIG, state), null);
  assert.deepEqual(state, { consecutiveErrors: 0, lastErrorCommand: "" });
});

test("detectRepeatedErrors emits fifth-error event", () => {
  const state = createRepeatedErrorState();

  for (let i = 0; i < 4; i++) {
    detectRepeatedErrors("bun test", true, DEFAULT_EMOTION_CONFIG, state);
  }

  assert.equal(
    detectRepeatedErrors("bun test", true, DEFAULT_EMOTION_CONFIG, state)?.trigger,
    "error_streak_5",
  );
});

test("resetErrorStreak clears repeated error state", () => {
  const state = { consecutiveErrors: 2, lastErrorCommand: "bun test" };

  resetErrorStreak(state);

  assert.deepEqual(state, { consecutiveErrors: 0, lastErrorCommand: "" });
});

test("detectFromUserMessage recognizes praise and correction", () => {
  const praise = detectFromUserMessage("good job, 谢谢", DEFAULT_EMOTION_CONFIG, 1);
  const correction = detectFromUserMessage("still wrong", DEFAULT_EMOTION_CONFIG, 0.25);
  const thanks = detectFromUserMessage("thank you", DEFAULT_EMOTION_CONFIG, 0.5);

  assert.equal(praise?.trigger, "user_praise");
  assert.equal(praise?.force, DEFAULT_EMOTION_CONFIG.triggers.user_praise.force);
  assert.equal(correction?.trigger, "user_correction");
  assert.ok(correction.force < DEFAULT_EMOTION_CONFIG.triggers.user_correction.force);
  assert.equal(thanks?.trigger, "user_praise");
  assert.equal(detectFromUserMessage("plain message", DEFAULT_EMOTION_CONFIG, 0.5), null);
});

test("detectExplicitUserFeedback only recognizes explicit praise or correction", () => {
  assert.equal(
    detectExplicitUserFeedback("next, change the footer", DEFAULT_EMOTION_CONFIG, 0.5),
    null,
  );
  assert.equal(
    detectExplicitUserFeedback("还是错，重来", DEFAULT_EMOTION_CONFIG, 0.5)?.trigger,
    "user_correction",
  );
});

test("detectImplicitAcceptance emits a gentle positive event", () => {
  const event = detectImplicitAcceptance(DEFAULT_EMOTION_CONFIG, 0.5);

  assert.equal(event.trigger, "implicit_acceptance");
  assert.equal(event.valence, "positive");
  assert.ok(event.force < DEFAULT_EMOTION_CONFIG.triggers.user_praise.force);
});

test("detectLateNight returns either late-night event or null based on current hour", () => {
  const result = detectLateNight(DEFAULT_EMOTION_CONFIG, 0);
  const hour = new Date().getHours();

  if (hour >= 23 || hour < 5) {
    assert.equal(result?.trigger, "late_night");
  } else {
    assert.equal(result, null);
  }
});
