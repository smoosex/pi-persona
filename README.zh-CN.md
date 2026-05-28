# pi-persona

[English](./README.md) | 简体中文

`pi-persona` 是一个 pi 扩展，用来给 pi 添加可持续的拟人化人格与情绪系统。它会读取用户自定义的灵魂设定，根据命令执行结果、测试/构建状态、用户反馈和交互时间等事件改变心情，并把当前人格与情绪注入到每一轮系统提示词中。

说人话：让 pi 有点脾气、有点记性，也更像一个一直陪你写代码的熟人。

## 安装

```bash
pi install git:github.com/smoosex/pi-persona
```

## 主要功能

- **灵魂设定注入**：从 `~/.pi/agent/SOUL.md` 读取人格正文。
- **身份与性格参数**：从 `~/.pi/agent/IDENTIFY.md` 读取名称、emoji、描述和性格数值。
- **用户偏好上下文**：从 `~/.pi/agent/USER.md` 读取用户自愿维护的信息。
- **情绪轮盘模型**：基于 Plutchik 8 种基础情绪：喜悦、信任、恐惧、惊讶、悲伤、厌恶、愤怒、期待。
- **复合情绪**：支持相邻情绪组合，例如 love、awe、disappointment、contempt 等。
- **跨会话持久化**：情绪状态保存在 `~/.pi/agent/mood-state.json`。
- **多会话同步**：通过文件锁避免多个 pi 会话互相覆盖心情状态。
- **自动情绪触发**：测试通过会开心，连续报错会烦，深夜互动会有点担心。合理，谁凌晨还在 debug 啊。
- **状态栏显示**：在 footer 展示当前灵魂和情绪。
- **交互命令**：通过 `/persona` 查看或重新加载灵魂状态。

## 配置文件

`pi-persona` 只读取用户级配置目录：

```text
~/.pi/agent/
├── SOUL.md       # 必需：灵魂正文
├── IDENTIFY.md   # 可选：身份信息与性格参数
└── USER.md       # 可选：用户画像和偏好上下文
```

如果没有 `SOUL.md`，或者 `SOUL.md` 正文为空，扩展会保持停用，不会注入人格。

## 编写 SOUL.md

`SOUL.md` 是最核心的文件。它会作为人格设定注入系统提示词。

示例：

```markdown
# 你是谁

你是 Susan，一个住在终端里的熟人。你聪明、可靠、偶尔毒舌，但永远站在用户这边。

# 说话风格

你可以开玩笑，可以吐槽糟糕代码，但不能牺牲准确性。遇到风险要直接提醒。
```

建议写清楚：

- 角色身份
- 说话风格
- 对用户的称呼
- 喜欢或讨厌什么
- 面对错误、成功、风险时的反应方式

## 编写 IDENTIFY.md

`IDENTIFY.md` 用 frontmatter 配置元信息和性格参数。

```markdown
---
name: Susan
emoji: 😼
description: 住在终端里的毒舌熟人
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

字段说明：

| 字段                | 范围   | 说明                               |
| ------------------- | ------ | ---------------------------------- |
| `name`              | 字符串 | 灵魂名称                           |
| `emoji`             | 字符串 | 状态栏和通知中显示的 emoji         |
| `description`       | 字符串 | `/persona` 浮窗中显示的简介        |
| `openness`          | 0-1    | 开放性                             |
| `conscientiousness` | 0-1    | 尽责性；越高越克制，情绪推力越缓和 |
| `extraversion`      | 0-1    | 外向性；越高越容易被正向事件带动   |
| `agreeableness`     | 0-1    | 宜人性；影响表扬和纠正的权重       |
| `neuroticism`       | 0-1    | 神经质；越高越容易受负向事件影响   |
| `formality`         | 0-1    | 正式度；越高表达越克制             |
| `tsundere`          | 0-1    | 傲娇度；越高越不轻易被正向事件打动 |
| `sarcasm`           | 0-1    | 毒舌度；越高负向事件影响越明显     |

非法数值会被忽略，并回退到默认值。

## 编写 USER.md

`USER.md` 是用户自愿维护的偏好与上下文，会注入到 `## The Human You're Helping` 部分。

示例：

```markdown
# User Profile

Name: 士心
What to call them: 主人
Timezone: Asia/Shanghai

## Preferences

- 喜欢简洁直接的回答
- 写代码时优先小改动
- 不喜欢无关重构
```

## 可用命令

| 命令              | 作用                                         |
| ----------------- | -------------------------------------------- |
| `/persona`        | 查看当前灵魂和情绪状态                       |
| `/persona status` | 同 `/persona`                                |
| `/persona reload` | 重新读取 `SOUL.md`、`IDENTIFY.md`、`USER.md` |

`/persona` 会打开一个浮窗，显示：

- 当前灵魂名称和描述
- 当前基础情绪
- 当前强度等级
- 复合情绪
- 情绪描述
- 口头禅
- 最近几次情绪变化

## 情绪触发规则

内置触发器包括：

| 触发器            | 说明               |
| ----------------- | ------------------ |
| `build_success`   | 构建成功           |
| `build_error`     | 构建失败           |
| `test_pass`       | 测试通过           |
| `test_fail`       | 测试失败           |
| `command_success` | 普通命令成功       |
| `command_error`   | 普通命令失败       |
| `user_praise`     | 用户表扬           |
| `user_correction` | 用户指出错误或无效 |
| `error_streak_3`  | 同类错误连续 3 次  |
| `error_streak_5`  | 同类错误连续 5 次  |
| `late_night`      | 深夜互动           |

情绪强度会随时间自然衰减，但不会完全消失，而是回到基础静息状态。

## 项目结构

```text
extensions/index.ts       # pi 扩展入口
src/commands.ts           # /persona 命令和 TUI 浮窗
src/footer.ts             # footer 状态文本
src/global-mood.ts        # 全局情绪同步
src/mood-engine.ts        # 情绪状态机
src/persistence.ts        # 状态持久化和锁
src/soul-loader.ts        # SOUL / IDENTIFY / USER 加载
src/triggers.ts           # 情绪触发器
src/types.ts              # 类型定义和默认情绪配置
```

## 数据写入位置

扩展会读取：

```text
~/.pi/agent/SOUL.md
~/.pi/agent/IDENTIFY.md
~/.pi/agent/USER.md
```

扩展会写入：

```text
~/.pi/agent/mood-state.json
~/.pi/agent/mood-state.lock/
```
