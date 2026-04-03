## 为什么

当前 AI 对话界面（`public/tts.html`）在每次回复完成后只显示时间和"AI 回复完成"状态，用户无法看到本次对话消耗了多少 token。对于使用按量计费 LLM 的服务来说，token 用量是用户关心的核心指标 —— 尤其是在开启多轮记忆后，历史消息、摘要、检索结果都会增加输入 token 消耗，用户需要透明地了解每次对话的成本。

## 变更内容

1. **后端新增 token 计算**：在 AI 回复完成后，计算输入 token（消息上下文）和输出 token（AI 回复内容），通过 SSE 事件流发送用量信息
2. **前端新增用量显示**：在每条 AI 回复的 meta 区域显示输入/输出 token 数量，格式如 "输入: 1234 · 输出: 567"

## 功能 (Capabilities)

### 新增功能

- `token-usage-reporting`: AI 回复完成后通过 SSE 事件流发送 token 用量信息，前端在消息气泡中展示

### 修改功能

<!-- 无现有 spec 需要修改 -->

## 影响

- **代码影响**：
  - `src/ai/ai.service.ts`：streamChain 方法在 finally 块中计算 token 用量并发射 usage 事件
  - `src/common/stream-events.ts`：新增 usage 类型的 AiTtsStreamEvent
  - `public/tts.html`：SSE onmessage 处理 usage 事件，在消息 meta 区域渲染 token 用量
- **依赖影响**：复用已有的 `js-tiktoken` 进行 token 计数，无新增依赖
- **API 变更**：SSE 事件流新增 `type: "usage"` 事件，包含 `{ inputTokens, outputTokens }` 字段
- **非破坏性变更**：前端忽略未知类型事件，旧版 SSE 客户端不受影响
