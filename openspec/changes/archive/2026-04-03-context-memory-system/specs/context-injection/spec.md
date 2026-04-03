# Spec: context-injection

## ADDED Requirements

### Requirement: context-injection-chain

系统 SHALL 将无状态单轮对话链路升级为支持消息历史的多轮对话链路。

#### Scenario: 无状态模式（向后兼容）

- **WHEN** 请求不携带 `sessionId` 参数
- **THEN** 系统使用 `statelessChain`（简单 `PromptTemplate`）
- **AND** 不读取任何历史消息
- **AND** 不保存对话记录

#### Scenario: 有状态模式（多轮对话）

- **WHEN** 请求携带 `sessionId` 参数
- **THEN** 系统调用 `MemoryOrchestrator.composeContext(query, sessionId)` 组装上下文
- **AND** 使用 `memoryChain`（`ChatPromptTemplate + MessagesPlaceholder`）
- **AND** 将历史消息注入 `history` 占位符
- **AND** 对话结束后异步调用 `saveTurn` 保存本轮对话

#### Scenario: 上下文组装顺序

- **WHEN** 调用 `composeContext`
- **THEN** 消息组装顺序为：
  1. 摘要 SystemMessage（如果存在）
  2. Milvus 语义检索结果（如果启用）
  3. 最近原始消息
  4. 当前用户问题（HumanMessage）

#### Scenario: TTS 事件发射

- **WHEN** 请求携带 `ttsSessionId` 参数
- **THEN** Controller 发射 `start` 事件
- **AND** AiService 流式输出过程中持续发射 `chunk` 事件
- **AND** 流结束时发射 `end` 事件
