## 为什么

当前 `asr-and-tts-nest-service` 项目的 AI 对话是完全无状态的——每次请求都是独立的一次性问答，LLM 没有任何历史上下文。这意味着用户无法进行多轮对话，无法引用之前提到的信息，也无法获得连贯的交互体验。

通过梳理 `milvus-test` 练习项目中积累的上下文记忆实践经验（包含 6 种记忆策略的完整实现），我们需要将经过验证的最佳方案整合到 NestJS 服务中，构建一个生产级的上下文记忆系统。

## 变更内容

1. **新增会话级记忆管理**：基于 Redis 实现多轮对话历史存储，支持按 sessionId 隔离不同用户的对话上下文
2. **新增记忆裁剪策略**：实现基于消息数量和 token 数量的自动裁剪，防止上下文窗口溢出
3. **新增记忆总结策略**：当历史消息超过阈值时，自动调用 LLM 生成摘要，保留核心信息
4. **新增向量检索记忆（可选增强）**：基于 Milvus 实现语义检索，按需从历史对话中检索最相关的上下文片段
5. **修改 AI 对话链路**：将现有的无状态 `PromptTemplate` 升级为 `ChatPromptTemplate + MessagesPlaceholder`，注入历史消息
6. **新增会话生命周期管理**：支持会话创建、查询、清空、过期自动清理

## 功能 (Capabilities)

### 新增功能

- `session-memory`: 基于 Redis 的会话级对话历史存储与管理，支持多 sessionId 隔离、消息读写、会话生命周期管理
- `memory-truncation`: 自动记忆裁剪策略，支持按消息数量和 token 数量两种模式裁剪历史消息，防止上下文溢出
- `memory-summarization`: 自动记忆总结策略，当历史消息过多时调用 LLM 生成摘要，与最近消息组合注入上下文
- `memory-retrieval`: 基于 Milvus 向量数据库的语义检索记忆，将历史对话向量化存储，按查询语义相似度检索最相关上下文
- `context-injection`: 上下文注入链路改造，将无状态单轮 prompt 升级为支持消息历史的多轮对话链

### 修改功能

<!-- 无现有 spec 需要修改 -->

## 影响

- **代码影响**：
  - `src/ai/ai.service.ts`：重构对话链，从 `PromptTemplate` 升级为 `ChatPromptTemplate + MessagesPlaceholder`
  - `src/ai/ai.controller.ts`：新增 sessionId 参数接收与传递
  - 新增 `src/memory/` 模块：包含 memory service、Redis 存储、Milvus 检索、裁剪/总结策略
  - 新增 `src/session/` 模块：会话生命周期管理

- **依赖影响**：
  - 新增 `@langchain/community`（FileSystemChatMessageHistory 等）
  - 新增 `ioredis` 或 `redis`（Redis 客户端）
  - 新增 `@zilliz/milvus2-sdk-node`（Milvus 向量数据库客户端，已在 docker-compose 中预置）
  - 新增 `js-tiktoken`（token 计数）

- **基础设施**：
  - 启用 docker-compose.yml 中已预置但未使用的 Redis 和 Milvus 服务
  - MySQL 暂不启用（记忆不需要关系型存储）

- **API 变更**：
  - `GET /ai/chat/stream` 新增可选 `sessionId` 查询参数
  - 新增 `POST /memory/session` 创建会话
  - 新增 `DELETE /memory/session/:sessionId` 清空会话历史
  - 新增 `GET /memory/session/:sessionId` 查询会话状态

- **非破坏性变更**：不传 sessionId 时保持现有无状态行为，向后兼容
