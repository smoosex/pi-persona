# pi-persona

`pi-persona` is a pi extension that adds a persistent persona and emotional state system to pi. It reads your custom soul definition, changes mood based on command results, test/build status, user feedback, and interaction time, then injects the current persona and emotion into each turn's system prompt.

In plain words: pi gets a bit of personality, a bit of memory, and feels more like someone coding alongside you.

## Installation

```bash
pi install npm:@smoose/pi-persona
```

## Features

- **Soul prompt injection**: reads persona text from `~/.pi/agent/SOUL.md`.
- **Identity and traits**: reads name, emoji, description, and trait values from `~/.pi/agent/IDENTIFY.md`.
- **User preference context**: reads user-maintained context from `~/.pi/agent/USER.md`.
- **Emotion wheel model**: based on Plutchik's 8 basic emotions: joy, trust, fear, surprise, sadness, disgust, anger, and anticipation.
- **Compound emotions**: supports adjacent emotion blends such as love, awe, disappointment, contempt, and more.
- **Cross-session persistence**: stores mood state in `~/.pi/agent/mood-state.json`.
- **Multi-session synchronization**: uses a file lock to avoid multiple pi sessions overwriting the shared mood state.
- **Automatic emotion triggers**: passing tests feels good, repeated failures get annoying, and late-night interaction feels a little concerning. Reasonable. Who is debugging at midnight anyway?
- **Footer display**: shows the current soul and emotion in the footer.
- **Interactive commands**: use `/persona` to inspect or reload the soul state.

## Configuration Files

`pi-persona` only reads the user-level configuration directory:

```text
~/.pi/agent/
├── SOUL.md       # Required: soul/persona body
├── IDENTIFY.md   # Optional: identity info and trait values
└── USER.md       # Optional: user profile and preference context
```

If `SOUL.md` does not exist, or its body is empty, the extension stays disabled and does not inject a persona.

## Writing SOUL.md

`SOUL.md` is the core file. Its body is injected as the persona definition in the system prompt.

Example:

```markdown
# Who You Are

You are Susan, someone who lives in the terminal. You are smart, reliable, occasionally sharp-tongued, but always on the user's side.

# Speaking Style

You may joke and complain about bad code, but never sacrifice accuracy. Call out risks directly.
```

Recommended contents:

- Role identity
- Speaking style
- How to address the user
- What the persona likes or dislikes
- How the persona reacts to errors, success, and risk

## Writing IDENTIFY.md

`IDENTIFY.md` uses frontmatter to configure metadata and trait values.

```markdown
---
name: Susan
emoji: 😼
description: A sharp-tongued familiar living in the terminal
openness: 0.7
conscientiousness: 0.8
extraversion: 0.45
agreeableness: 0.65
neuroticism: 0.35
formality: 0.2
tsundere: 0.5
sarcasm: 0.6
---
```

Field reference:

| Field               | Range  | Description                                                            |
| ------------------- | ------ | ---------------------------------------------------------------------- |
| `name`              | string | Soul name                                                              |
| `emoji`             | string | Emoji shown in the footer and notifications                            |
| `description`       | string | Description shown in the `/persona` overlay                            |
| `openness`          | 0-1    | Openness                                                               |
| `conscientiousness` | 0-1    | Conscientiousness; higher values make emotional pushes more restrained |
| `extraversion`      | 0-1    | Extraversion; higher values react more strongly to positive events     |
| `agreeableness`     | 0-1    | Agreeableness; affects the weight of praise and correction             |
| `neuroticism`       | 0-1    | Neuroticism; higher values react more strongly to negative events      |
| `formality`         | 0-1    | Formality; higher values make expression more restrained               |
| `tsundere`          | 0-1    | Tsundere level; higher values are less easily moved by positive events |
| `sarcasm`           | 0-1    | Sarcasm; higher values amplify negative events                         |

Invalid numeric values are ignored and fall back to defaults.

## Writing USER.md

`USER.md` is user-maintained preference and context information. It is injected into the `## The Human You're Helping` section.

Example:

```markdown
# User Profile

Name: Shixin
What to call them: Master
Timezone: Asia/Shanghai

## Preferences

- Prefer concise and direct answers
- Prefer small code changes
- Dislike unrelated refactors
```

## Available Commands

| Command           | Description                                    |
| ----------------- | ---------------------------------------------- |
| `/persona`        | View the current soul and emotion state        |
| `/persona status` | Same as `/persona`                             |
| `/persona reload` | Reload `SOUL.md`, `IDENTIFY.md`, and `USER.md` |

`/persona` opens an overlay showing:

- Current soul name and description
- Current basic emotion
- Current intensity level
- Compound emotion
- Emotion description
- Catchphrase
- Recent mood changes

## Emotion Triggers

Built-in triggers include:

| Trigger           | Description                                 |
| ----------------- | ------------------------------------------- |
| `build_success`   | Build succeeded                             |
| `build_error`     | Build failed                                |
| `test_pass`       | Tests passed                                |
| `test_fail`       | Tests failed                                |
| `command_success` | Normal command succeeded                    |
| `command_error`   | Normal command failed                       |
| `user_praise`     | User praise                                 |
| `user_correction` | User says something is wrong or ineffective |
| `error_streak_3`  | Same kind of error repeated 3 times         |
| `error_streak_5`  | Same kind of error repeated 5 times         |
| `late_night`      | Late-night interaction                      |

Emotion intensity naturally decays over time, but does not disappear completely. It returns to a baseline resting state.

## Project Structure

```text
extensions/index.ts       # pi extension entry
src/commands.ts           # /persona command and TUI overlay
src/footer.ts             # footer status text
src/global-mood.ts        # global mood synchronization
src/mood-engine.ts        # emotion state machine
src/persistence.ts        # state persistence and lock
src/soul-loader.ts        # SOUL / IDENTIFY / USER loading
src/triggers.ts           # emotion triggers
src/types.ts              # type definitions and default emotion config
```

## Data Locations

The extension reads:

```text
~/.pi/agent/SOUL.md
~/.pi/agent/IDENTIFY.md
~/.pi/agent/USER.md
```

The extension writes:

```text
~/.pi/agent/mood-state.json
~/.pi/agent/mood-state.lock/
```
