# Spec: memory-retrieval

## ADDED Requirements

### Requirement: memory-retrieval-strategy

系统 SHALL 提供基于 Milvus 向量数据库的语义检索能力，按查询语义相似度检索最相关的历史对话。

#### Scenario: 语义检索历史

- **WHEN** 调用 `retrieve(query, sessionId)`
- **THEN** 系统将 query 通过 OpenAI Embedding 模型向量化为 1536 维
- **AND** 在 Milvus 中执行余弦相似度搜索
- **AND** 按 `sessionId` 过滤（如果提供）
- **AND** 返回 top-k（默认 3）最相关的历史对话，格式化为 `HumanMessage`
- **AND** 每条消息附带相似度分数

#### Scenario: 保存对话到向量库

- **WHEN** 调用 `saveConversation(sessionId, query, response)`
- **THEN** 系统将 "用户: query\nAI: response" 组合文本向量化
- **AND** 插入 Milvus collection，包含 sessionId、content、vector、timestamp
- **AND** 执行 flush 确保数据落盘

#### Scenario: 删除会话向量记录

- **WHEN** 调用 `deleteSessionConversations(sessionId)`
- **THEN** 系统按 `sessionId == "{sessionId}"` 过滤并删除对应向量记录

#### Scenario: Milvus 未就绪

- **WHEN** `ENABLE_MILVUS_RETRIEVAL` 为 `false` 或连接失败
- **THEN** 所有检索/保存/删除操作直接返回空或跳过
- **AND** 不阻断正常对话流程
