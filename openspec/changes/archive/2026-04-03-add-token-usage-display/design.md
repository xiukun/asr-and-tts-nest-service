## 上下文

当前 `public/tts.html` 前端通过 SSE 接收 AI 流式回复，但回复完成后只显示"AI 回复完成"和时间戳。后端 `AiService.streamChain` 在 finally 块中已经收集了完整的 `fullResponse`，但从未计算或返回 token 用量。

项目已安装 `js-tiktoken`，用于记忆系统的 TruncationStrategy 和 SummarizationStrategy 中的 token 计数，可直接复用。

## 目标 / 非目标

**目标：**

- 每次 AI 回复完成后，在消息气泡的 meta 区域显示输入 token 和输出 token 数量
- 通过 SSE 事件流传递用量数据，不改变现有 API 契约
- 前端向后兼容，忽略未知事件类型

**非目标：**

- 不做 token 用量统计面板或历史记录
- 不做 token 费用计算（只显示 token 数，不乘以单价）
- 不修改后端计费逻辑

## 决策

**1. 通过 SSE 事件传递用量，而非新增 API 端点**

复用现有的 SSE 连接，在流结束时发送 `type: "usage"` 事件。不新增 REST 端点，因为用量数据天然在流结束时产生。

**2. 使用 js-tiktoken cl100k_base 编码器**

复用记忆系统已有的 `getEncoding('cl100k_base')`，与 LLM 实际 token 计算一致。输入 token = 发送给 LLM 的完整 prompt（包括 system + history + query），输出 token = AI 回复的文本。

**3. 在 AiController 层发射 usage 事件，而非 AiService**

AiService 的 streamChain 通过 yield 返回文本 chunk，不直接发射事件（TTS 事件由 Controller 和 AiService 共同发射）。usage 事件包含结构化数据 `{ inputTokens, outputTokens }`，在 Controller 的 SSE map 管道中附加到流末尾更合适。

**4. 前端在 meta 区域追加显示，不创建新 DOM 结构**

在现有的 `.meta` div 中追加 token 信息，格式：`"AI 回复完成 14:32:10 · 输入: 1234 · 输出: 567"`。不创建独立的用量组件，保持 UI 简洁。

## 风险 / 权衡

**[风险] token 计算增加每次请求的 CPU 开销** → 缓解：cl100k_base 编码是纯 JS 计算，1000 tokens 约 1-2ms，可忽略
**[风险] 输入 token 数与实际 LLM 调用有微小差异** → 缓解：使用相同的编码器和格式（role: content），差异在 1-2% 以内，足够展示用途
**[权衡] 不计算 Milvus 检索结果的 token** → 当前检索结果已包含在 messages 中，会被计入输入 token
