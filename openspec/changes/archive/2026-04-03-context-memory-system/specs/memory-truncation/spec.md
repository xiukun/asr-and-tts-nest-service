# Spec: memory-truncation

## ADDED Requirements

### Requirement: memory-truncation-strategy

系统 SHALL 提供基于 token 数量的消息自动裁剪能力，防止上下文窗口溢出。

#### Scenario: 未超限不裁剪

- **WHEN** 历史消息总 token 数 ≤ `MEMORY_MAX_TOKENS`（默认 4000）
- **THEN** 原样返回所有消息，不做任何裁剪

#### Scenario: 超限时自动裁剪

- **WHEN** 历史消息总 token 数 > `MEMORY_MAX_TOKENS`
- **THEN** 系统使用 LangChain `trimMessages` 从后往前保留消息
- **AND** 保留的总 token 数不超过 `MEMORY_MAX_TOKENS`
- **AND** 使用 `js-tiktoken` cl100k_base 编码器精确计算 token

#### Scenario: 裁剪失败降级

- **WHEN** `trimMessages` 执行抛出异常
- **THEN** 系统降级为保留最近一半消息 `messages.slice(-Math.floor(length / 2))`
- **AND** 记录错误日志
