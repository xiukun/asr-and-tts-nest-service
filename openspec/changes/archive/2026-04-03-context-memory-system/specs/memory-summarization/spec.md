# Spec: memory-summarization

## ADDED Requirements

### Requirement: memory-summarization-strategy

系统 SHALL 在对话过长时自动调用 LLM 生成摘要，保留核心语义同时保留最近原始对话。

#### Scenario: 未超阈值不总结

- **WHEN** 裁剪后消息总 token 数 ≤ `MEMORY_SUMMARIZE_THRESHOLD_TOKENS`（默认 6000）
- **THEN** 返回 `{ summary: null, recentMessages: 全部消息 }`

#### Scenario: 超阈值触发总结

- **WHEN** 裁剪后消息总 token 数 > `MEMORY_SUMMARIZE_THRESHOLD_TOKENS`
- **THEN** 系统从后往前提取最近 `MEMORY_KEEP_RECENT_TOKENS`（默认 1000）token 的原始消息
- **AND** 将更早的消息格式化为 "角色: 内容" 文本
- **AND** 调用 LLM 生成摘要
- **AND** 返回 `{ summary: SystemMessage, recentMessages: 最近原始消息 }`

#### Scenario: 总结失败降级

- **WHEN** LLM 调用生成摘要失败
- **THEN** 返回 `{ summary: null, recentMessages: 最近原始消息 }`
- **AND** 记录错误日志，不阻断对话
