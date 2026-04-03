/**
 * 记忆模块 — 多轮对话记忆系统的 NestJS 模块封装
 *
 * 职责：
 * 1. 注册所有记忆相关的 Provider（Redis、Milvus、三种策略、编排器）
 * 2. 管理依赖注入关系，确保各组件正确获取所需依赖
 * 3. 导出核心服务，供外部模块（如 AiModule、SessionModule）使用
 *
 * 依赖关系：
 * RedisClientProvider → REDIS_CLIENT → RedisSessionStore
 * MilvusClientProvider → MILVUS_CLIENT → RetrievalStrategy
 * ConfigService + CHAT_MODEL → SummarizationStrategy
 * 所有策略 + RedisSessionStore → MemoryOrchestrator
 */
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { REDIS_CLIENT, MILVUS_CLIENT, CHAT_MODEL } from 'src/constant';
import { ToolModule } from 'src/tool/tool.module';
import { RedisClientProvider } from './redis.client';
import { MilvusClientProvider } from './milvus.client';
import { RedisSessionStore } from './redis-session.store';
import { TruncationStrategy } from './strategies/truncation.strategy';
import { SummarizationStrategy } from './strategies/summarization.strategy';
import { RetrievalStrategy } from './strategies/retrieval.strategy';
import { MemoryOrchestrator } from './memory.orchestrator';

@Module({
  imports: [ConfigModule, ToolModule],
  providers: [
    // Redis 客户端提供者
    RedisClientProvider,
    {
      provide: REDIS_CLIENT,
      useFactory: (provider: RedisClientProvider) => provider.getClient(),
      inject: [RedisClientProvider],
    },
    // Milvus 客户端提供者
    MilvusClientProvider,
    {
      provide: MILVUS_CLIENT,
      useFactory: (provider: MilvusClientProvider) => provider.getClient(),
      inject: [MilvusClientProvider],
    },
    // Redis 会话存储
    {
      provide: RedisSessionStore,
      useFactory: (redis: any) => new RedisSessionStore(redis),
      inject: [REDIS_CLIENT],
    },
    // 裁剪策略 — 按 token 数量截断消息
    TruncationStrategy,
    // 总结策略 — 超阈值时调用 LLM 生成摘要
    {
      provide: SummarizationStrategy,
      useFactory: (configService: ConfigService, model: any) =>
        new SummarizationStrategy(configService, model),
      inject: [ConfigService, CHAT_MODEL],
    },
    // 检索策略 — Milvus 向量语义检索
    RetrievalStrategy,
    // 记忆编排器 — 核心调度中心
    MemoryOrchestrator,
  ],
  exports: [
    RedisSessionStore,
    TruncationStrategy,
    SummarizationStrategy,
    RetrievalStrategy,
    MemoryOrchestrator,
  ],
})
export class MemoryModule {}
