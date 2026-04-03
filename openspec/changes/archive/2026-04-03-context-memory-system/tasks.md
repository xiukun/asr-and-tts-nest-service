# Tasks: context-memory-system

## 1. 基础设施：常量与依赖

- [x] 1.1 在 `src/constant/index.ts` 中新增 `REDIS_CLIENT` 和 `MILVUS_CLIENT` Symbol
- [x] 1.2 安装依赖：`ioredis`、`@zilliz/milvus2-sdk-node`、`js-tiktoken`

## 2. Redis 存储层

- [x] 2.1 创建 `src/memory/redis.client.ts` — RedisClientProvider，管理连接生命周期（OnModuleInit/OnModuleDestroy），懒连接 + 重试策略
- [x] 2.2 创建 `src/memory/redis-session.store.ts` — RedisSessionStore，提供 getMessages/addMessages/setMessages/clear/setTTL/getTTL/exists/getMessageCount 方法
- [x] 2.3 在 MemoryModule 中注册 RedisClientProvider → REDIS_CLIENT → RedisSessionStore 的依赖注入链

## 3. Milvus 向量数据库层

- [x] 3.1 创建 `src/memory/milvus.client.ts` — MilvusClientProvider，OnModuleInit 连接 + 健康检查 + 自动创建 Collection（id/sessionId/content/vector/timestamp，IVF_FLAT 索引）
- [x] 3.2 在 MemoryModule 中注册 MilvusClientProvider → MILVUS_CLIENT 的依赖注入链

## 4. 记忆策略层

- [x] 4.1 创建 `src/memory/strategies/truncation.strategy.ts` — TruncationStrategy，基于 token 数量的消息裁剪，使用 LangChain trimMessages，降级策略保留一半消息
- [x] 4.2 创建 `src/memory/strategies/summarization.strategy.ts` — SummarizationStrategy，超阈值时调用 LLM 生成摘要，保留最近原始消息
- [x] 4.3 创建 `src/memory/strategies/retrieval.strategy.ts` — RetrievalStrategy，Milvus 向量语义检索，支持 retrieve/saveConversation/deleteSessionConversations

## 5. 记忆编排层

- [x] 5.1 创建 `src/memory/memory.orchestrator.ts` — MemoryOrchestrator，实现 composeContext（读取→裁剪→总结→检索→组装）和 saveTurn（双写 Redis + Milvus）
- [x] 5.2 创建 `src/memory/memory.module.ts` — MemoryModule，注册所有 Provider 并导出核心服务

## 6. AI 对话链路改造

- [x] 6.1 修改 `src/ai/ai.service.ts`：新增 statelessChain 和 memoryChain 双链设计，注入 MemoryOrchestrator
- [x] 6.2 修改 `src/ai/ai.service.ts`：重构 streamChain 方法，根据 sessionId 决定使用哪条链，流式输出时发射 TTS chunk 事件，finally 块异步 saveTurn
- [x] 6.3 修改 `src/ai/ai.controller.ts`：chatStream 新增 sessionId 查询参数，发射 TTS start 事件
- [x] 6.4 修改 `src/ai/ai.module.ts`：imports 新增 MemoryModule

## 7. 会话管理模块

- [x] 7.1 创建 `src/session/session.service.ts` — SessionService，提供 createSession/getSessionInfo/clearSession
- [x] 7.2 创建 `src/session/session.controller.ts` — SessionController，POST/GET/DELETE /memory/session 端点
- [x] 7.3 创建 `src/session/session.module.ts` — SessionModule，imports MemoryModule

## 8. 应用模块集成

- [x] 8.1 修改 `src/app.module.ts`：imports 新增 SessionModule
