/**
 * 记忆编排器 — 多轮对话记忆系统的核心调度中心
 *
 * 职责：
 * 1. composeContext: 组合上下文 — 从 Redis 读取历史 → 裁剪 → 总结 → 检索 → 组装
 * 2. saveTurn: 保存对话轮次 — 写入 Redis + 可选写入 Milvus
 * 3. clearSession: 清空会话 — 清理 Redis + Milvus
 * 4. getSessionInfo: 获取会话信息 — 存在性、消息数、TTL 剩余
 *
 * 工作流程（composeContext）：
 * ┌─────────────────────────────────────────────────┐
 * │ 1. 从 Redis 读取历史消息                          │
 * │ 2. TruncationStrategy → 按 token 裁剪超限旧消息    │
 * │ 3. SummarizationStrategy → 超阈值则 LLM 生成摘要   │
 * │ 4. RetrievalStrategy → Milvus 语义检索相关历史     │
 * │ 5. 组装: [摘要] + [检索结果] + [最近消息] + [当前问题] │
 * └─────────────────────────────────────────────────┘
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BaseMessage, HumanMessage, AIMessage } from '@langchain/core/messages';
import { RedisSessionStore } from './redis-session.store';
import { TruncationStrategy } from './strategies/truncation.strategy';
import { SummarizationStrategy } from './strategies/summarization.strategy';
import { RetrievalStrategy } from './strategies/retrieval.strategy';

/** 组合后的对话上下文接口 */
export interface ComposedContext {
  messages: BaseMessage[];
  summary: BaseMessage | null;
}

/** 对话轮次记录接口 */
export interface TurnRecord {
  query: string;
  response: string;
}

@Injectable()
export class MemoryOrchestrator {
  private readonly logger = new Logger(MemoryOrchestrator.name);
  /** 会话过期时间（秒），默认 24 小时 */
  private sessionTTL: number;
  /** 是否启用 Milvus 向量检索 */
  private milvusEnabled: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly redisStore: RedisSessionStore,
    private readonly truncation: TruncationStrategy,
    private readonly summarization: SummarizationStrategy,
    private readonly retrieval: RetrievalStrategy,
  ) {
    const ttlFromConfig = this.configService.get('MEMORY_SESSION_TTL', 86400);
    const ttl = Number(ttlFromConfig);
    this.sessionTTL = Number.isFinite(ttl) && ttl > 0 ? ttl : 86400;
    this.milvusEnabled =
      this.configService.get('ENABLE_MILVUS_RETRIEVAL', 'false') === 'true';
  }

  /**
   * 组合对话上下文 — 核心方法
   * 将历史记忆、检索结果、当前问题组装成 LLM 可理解的完整上下文
   * @param query 用户当前问题
   * @param sessionId 会话 ID
   * @returns 组装后的消息列表，可直接传给 LLM
   */
  async composeContext(
    query: string,
    sessionId: string,
  ): Promise<BaseMessage[]> {
    const messages: BaseMessage[] = [];

    // 步骤1: 从 Redis 读取该会话的历史消息
    const history = await this.redisStore.getMessages(sessionId);

    // 步骤2: 按 token 裁剪超限的旧消息（防止超出 LLM 上下文窗口）
    const truncated = await this.truncation.truncate(history);

    // 步骤3: 如果 token 仍超阈值，调用 LLM 生成摘要
    const { summary, recentMessages } =
      await this.summarization.summarizeIfNeeded(truncated);

    // 步骤4: 将摘要（如果有）放在最前面
    if (summary) {
      messages.push(summary);
    }

    // 步骤5: Milvus 语义检索 — 找出与当前问题最相关的历史对话
    if (this.milvusEnabled) {
      try {
        const retrieved = await this.retrieval.retrieve(query, sessionId);
        messages.push(...retrieved);
      } catch (err) {
        this.logger.warn(`Milvus retrieval skipped: ${err.message}`);
      }
    }

    // 步骤6: 追加最近原始消息（保留细节）
    messages.push(...recentMessages);

    // 步骤7: 追加当前用户问题
    messages.push(new HumanMessage(query));

    return messages;
  }

  /**
   * 保存一轮对话 — 异步非阻塞调用
   * 同时写入 Redis（短期记忆）和 Milvus（长期记忆，可选）
   * @param sessionId 会话 ID
   * @param query 用户问题
   * @param response AI 回复
   */
  async saveTurn(
    sessionId: string,
    query: string,
    response: string,
  ): Promise<void> {
    // 写入 Redis：保存 HumanMessage + AIMessage
    await this.redisStore.addMessages(sessionId, [
      new HumanMessage(query),
      new AIMessage(response),
    ]);

    // 刷新会话 TTL，确保活跃会话不过期
    await this.redisStore.setTTL(sessionId, this.sessionTTL);

    // 可选：写入 Milvus 向量化（长期记忆）
    if (this.milvusEnabled) {
      await this.retrieval
        .saveConversation(sessionId, query, response)
        .catch((err) => {
          this.logger.warn(`Failed to save turn to Milvus: ${err.message}`);
        });
    }
  }

  /**
   * 清空会话 — 同时清理 Redis 和 Milvus
   * @param sessionId 要清空的会话 ID
   */
  async clearSession(sessionId: string): Promise<void> {
    await this.redisStore.clear(sessionId);

    if (this.milvusEnabled) {
      await this.retrieval
        .deleteSessionConversations(sessionId)
        .catch((err) => {
          this.logger.warn(
            `Failed to delete session from Milvus: ${err.message}`,
          );
        });
    }
  }

  /**
   * 获取会话信息 — 用于调试和监控
   * @param sessionId 会话 ID
   * @returns 包含存在性、消息数、TTL 剩余的对象
   */
  async getSessionInfo(sessionId: string): Promise<{
    exists: boolean;
    messageCount: number;
    ttlRemaining: number;
  }> {
    const exists = await this.redisStore.exists(sessionId);
    const messageCount = await this.redisStore.getMessageCount(sessionId);
    const ttlRemaining = await this.redisStore.getTTL(sessionId);

    return { exists, messageCount, ttlRemaining };
  }
}
