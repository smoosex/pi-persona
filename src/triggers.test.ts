import assert from "node:assert/strict";
import test from "node:test";

import { detectFromBashResult } from "./triggers.js";
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
