# Tasks: add-token-usage-display

## 1. 后端：token 计算与 SSE 事件

- [x] 1.1 在 `src/ai/ai.service.ts` 的 `streamChain` finally 块中，使用 `js-tiktoken` 计算输入 token（prompt 文本）和输出 token（fullResponse）
- [x] 1.2 在 `src/ai/ai.service.ts` 的 `streamChain` 中，将 `{ inputTokens, outputTokens }` 作为最后一个 yield 返回，格式为 JSON 字符串 `{"_type":"usage","inputTokens":N,"outputTokens":M}`
- [x] 1.3 在 `src/ai/ai.controller.ts` 的 SSE map 管道中，检测 `_type: "usage"` 消息，将其转为标准 SSE usage 事件（`{ event: 'usage', data: ... }`）
- [x] 2.1 在 `public/tts.html` 的 `streamAiReply` 函数中，为 EventSource 添加 `addEventListener('usage', ...)` 监听器，解析 inputTokens 和 outputTokens
- [x] 2.2 在 `public/tts.html` 收到 usage 事件时，更新当前 AI 回复的 meta 元素，追加显示 "输入: N · 输出: M"
