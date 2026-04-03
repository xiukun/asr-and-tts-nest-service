# Spec: session-memory

## ADDED Requirements

### Requirement: session-memory-storage

系统 SHALL 提供基于 Redis 的会话级对话历史存储能力。

#### Scenario: 读取会话消息

- **WHEN** 调用 `getMessages(sessionId)`
- **THEN** 系统从 Redis 读取 `memory:session:{sessionId}` 的 JSON 数据
- **AND** 使用 LangChain `mapStoredMessagesToChatMessages` 反序列化为 `BaseMessage[]`
- **AND** 如果 key 不存在或解析失败，返回空数组 `[]`

#### Scenario: 追加消息到会话

- **WHEN** 调用 `addMessages(sessionId, messages)`
- **THEN** 系统读取现有 JSON 数组
- **AND** 使用 `mapChatMessagesToStoredMessages` 序列化新消息
- **AND** 追加到数组末尾
- **AND** 写入 Redis 并保留原有 TTL

#### Scenario: 设置会话 TTL

- **WHEN** 调用 `setTTL(sessionId, ttlSeconds)`
- **THEN** 如果 key 已存在，更新其过期时间
- **AND** 如果 key 不存在，创建空数组 `[]` 并设置过期时间（NX 模式）

#### Scenario: 清空会话

- **WHEN** 调用 `clear(sessionId)`
- **THEN** 系统删除 `memory:session:{sessionId}` key

#### Scenario: 查询会话信息

- **WHEN** 调用 `exists(sessionId)` / `getMessageCount(sessionId)` / `getTTL(sessionId)`
- **THEN** 返回对应状态信息，失败时返回安全默认值
