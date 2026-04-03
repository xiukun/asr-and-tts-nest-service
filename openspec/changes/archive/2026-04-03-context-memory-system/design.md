# 设计：上下文记忆系统

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                      AiController                            │
│  GET /ai/chat/stream?query=&sessionId=&ttsSessionId=         │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                       AiService                              │
│  ┌─────────────────┐    ┌──────────────────────────────┐    │
│  │ statelessChain  │    │        memoryChain           │    │
│  │ (无状态单轮)     │    │ (有状态多轮 + MessagesPlace) │    │
│  └─────────────────┘    └──────────┬───────────────────┘    │
└────────────────────────────────────┼────────────────────────┘
                                     │
                    ┌────────────────▼────────────────┐
                    │     MemoryOrchestrator           │
                    │  composeContext() / saveTurn()   │
                    └────┬──────┬──────┬──────┬────────┘
                         │      │      │      │
              ┌──────────▼┐ ┌───▼────┐ │ ┌───▼──────────┐
              │  Redis    │ │Truncate│ │ │  Retrieval   │
              │ Session   │ │Strategy│ │ │  (Milvus)    │
              │  Store    │ └────────┘ │ └──────────────┘
              └───────────┘            │
                                       │
                          ┌────────────▼────────────┐
                          │    Summarization        │
                          │     Strategy            │
                          │  (LLM 生成摘要)          │
                          └─────────────────────────┘
```

## 数据流

### 读取上下文 (composeContext)

```
1. RedisSessionStore.getMessages(sessionId)
   → 读取 JSON 序列化的历史消息列表

2. TruncationStrategy.truncate(history)
   → 计算总 token 数
   → 超过 MEMORY_MAX_TOKENS (默认 4000) 则裁剪旧消息

3. SummarizationStrategy.summarizeIfNeeded(truncated)
   → 计算总 token 数
   → 超过 MEMORY_SUMMARIZE_THRESHOLD_TOKENS (默认 6000) 则：
     a. 保留最近 MEMORY_KEEP_RECENT_TOKENS (默认 1000) 的原始消息
     b. 将更早的消息发给 LLM 生成摘要
     c. 返回 { summary: SystemMessage, recentMessages }

4. RetrievalStrategy.retrieve(query, sessionId) [可选]
   → 将 query 向量化为 1536 维
   → Milvus 余弦相似度搜索 top-k (默认 3)
   → 返回格式化的历史对话 HumanMessage

5. 组装最终消息列表:
   [摘要 SystemMessage] + [检索结果] + [最近原始消息] + [当前 HumanMessage]
```

### 保存对话 (saveTurn)

```
1. RedisSessionStore.addMessages(sessionId, [HumanMessage, AIMessage])
   → 追加到 JSON 数组，保留原有 TTL

2. RedisSessionStore.setTTL(sessionId, MEMORY_SESSION_TTL)
   → 刷新会话过期时间（默认 86400 秒 = 24 小时）

3. RetrievalStrategy.saveConversation(sessionId, query, response) [可选]
   → 组合 "用户: query\nAI: response" 向量化
   → 插入 Milvus collection
   → flush 落盘
```

## 模块依赖

```
MemoryModule
├── imports: ConfigModule, ToolModule
├── providers:
│   ├── RedisClientProvider → REDIS_CLIENT (Symbol)
│   ├── MilvusClientProvider → MILVUS_CLIENT (Symbol)
│   ├── RedisSessionStore (inject: REDIS_CLIENT)
│   ├── TruncationStrategy
│   ├── SummarizationStrategy (inject: ConfigService, CHAT_MODEL)
│   ├── RetrievalStrategy
│   └── MemoryOrchestrator
└── exports: RedisSessionStore, TruncationStrategy,
             SummarizationStrategy, RetrievalStrategy, MemoryOrchestrator

SessionModule
├── imports: MemoryModule
├── controllers: SessionController
├── providers: SessionService
└── exports: SessionService

AiModule
├── imports: ToolModule, MemoryModule
├── controllers: AiController
└── providers: AiService (inject: MemoryOrchestrator)
```

## 关键设计决策

1. **双链设计**：statelessChain（无状态）和 memoryChain（有记忆）分离，不传 sessionId 时保持向后兼容
2. **异步保存**：saveTurn 在 finally 块中异步执行，不阻塞 SSE 响应
3. **降级策略**：所有外部依赖（Redis/Milvus/LLM 总结）失败都有 try-catch，不阻断核心对话
4. **Token 精确控制**：使用 js-tiktoken cl100k_base 编码器，与 LLM 实际 token 计算一致
5. **Milvus 可选**：通过 ENABLE_MILVUS_RETRIEVAL 环境变量控制，默认关闭

## 环境变量

| 变量                                | 默认值      | 说明                          |
| ----------------------------------- | ----------- | ----------------------------- |
| `REDIS_HOST`                        | `localhost` | Redis 主机                    |
| `REDIS_PORT`                        | `6379`      | Redis 端口                    |
| `MILVUS_HOST`                       | `localhost` | Milvus 主机                   |
| `MILVUS_PORT`                       | `19530`     | Milvus 端口                   |
| `ENABLE_MILVUS_RETRIEVAL`           | `false`     | 是否启用向量检索              |
| `MEMORY_SESSION_TTL`                | `86400`     | 会话过期时间（秒）            |
| `MEMORY_MAX_TOKENS`                 | `4000`      | 裁剪触发阈值                  |
| `MEMORY_SUMMARIZE_THRESHOLD_TOKENS` | `6000`      | 总结触发阈值                  |
| `MEMORY_KEEP_RECENT_TOKENS`         | `1000`      | 保留最近原始消息的 token 上限 |
| `MEMORY_MILVUS_TOP_K`               | `3`         | 向量检索返回条数              |
