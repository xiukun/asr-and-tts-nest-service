/**
 * 检索策略 — 基于 Milvus 向量数据库的语义检索
 *
 * 核心思路：
 * 裁剪和总结都只能处理"最近"的对话。有些重要信息可能在很久以前聊过，
 * 已经被裁剪掉了。此策略将所有历史对话向量化存入 Milvus，
 * 当用户提出新问题时，按语义相似度检索最相关的历史片段。
 *
 * 工作流程：
 * 【检索时】
 * 1. 将用户当前问题向量化（变成一串 1536 维的数字）
 * 2. 在 Milvus 中用余弦相似度搜索最相似的向量
 * 3. 返回 top-k（默认 3 条）最相关的历史对话
 *
 * 【保存时】
 * 1. 将本轮对话（query + response）组合向量化
 * 2. 存入 Milvus，附带 sessionId 和内容文本
 * 3. flush 落盘，确保数据持久化
 *
 * 【删除时】
 * 1. 按 sessionId 过滤，删除该会话的所有向量记录
 *
 * 比喻：
 * 就像一个智能笔记本，不是按时间顺序翻，而是按关键词搜索。
 * 你问"我们之前讨论过那个方案吗？"，它能找到所有相关的历史讨论。
 *
 * 开关控制：
 * 通过 ENABLE_MILVUS_RETRIEVAL 环境变量控制，默认关闭。
 * 不开启时所有操作直接返回，不影响正常对话。
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HumanMessage } from '@langchain/core/messages';
import { OpenAIEmbeddingModelId, OpenAIEmbeddings } from '@langchain/openai';
import { MilvusClientProvider } from '../milvus.client';

@Injectable()
export class RetrievalStrategy {
  private readonly logger = new Logger(RetrievalStrategy.name);
  /** 每次检索返回的最相关条目数量 */
  private topK: number;
  /** 文本向量化模型，复用配置避免重复创建 */
  private embeddings: OpenAIEmbeddings;

  constructor(
    private readonly configService: ConfigService,
    private readonly milvusProvider: MilvusClientProvider,
  ) {
    // 从环境变量读取，默认返回 top 3 条最相关的历史
    this.topK = this.configService.get('MEMORY_MILVUS_TOP_K', 3);
    // 初始化向量化模型，优先使用独立的 embedding 配置，未配置时回退到 OPENAI_*
    const embeddingBaseUrl = this.configService.get(
      'EMBEDDING_BASE_URL',
      this.configService.get('OPENAI_BASE_URL'),
    );
    const embeddingApiKey = this.configService.get(
      'EMBEDDING_API_KEY',
      this.configService.get('OPENAI_API_KEY'),
    );
    this.embeddings = new OpenAIEmbeddings({
      modelName: this.configService.get(
        'EMBEDDING_MODEL_NAME',
        'tongyi-embedding-vision-flash-2026-03-06',
      ) as OpenAIEmbeddingModelId,
      configuration: {
        baseURL: embeddingBaseUrl,
      },
      apiKey: embeddingApiKey,
    });
  }

  /**
   * 语义检索：根据当前问题，从 Milvus 中找出最相关的历史对话
   * @param query 用户当前的问题
   * @param sessionId 会话 ID（可选），用于过滤只检索当前会话的历史
   * @returns 检索到的历史对话列表，格式化为 HumanMessage
   */
  async retrieve(query: string, sessionId?: string): Promise<HumanMessage[]> {
    // Milvus 未就绪时直接返回空，不阻断对话
    if (!this.milvusProvider.isReady()) {
      return [];
    }

    try {
      const client = this.milvusProvider.getClient();
      if (!client) return [];

      const collectionName = this.milvusProvider.getCollectionName();

      // 第1步：将用户问题向量化
      const queryVector = await this.embeddings.embedQuery(query);

      // 第2步：按 sessionId 过滤（可选），只检索当前会话的历史
      const filter = sessionId ? `sessionId == "${sessionId}"` : undefined;

      // 第3步：在 Milvus 中执行向量相似度搜索
      const results = await client.search({
        collection_name: collectionName,
        data: [queryVector],
        limit: this.topK,
        output_fields: ['content', 'sessionId', 'timestamp'],
        filter,
      });

      if (!results.results || results.results.length === 0) {
        return [];
      }

      // 第4步：将检索结果格式化为 HumanMessage，附带相似度分数
      const retrievedMessages: HumanMessage[] = [];
      for (const result of results.results) {
        const content = result.content as string;
        const score = result.score as number;
        if (content) {
          retrievedMessages.push(
            new HumanMessage(
              `[历史对话] 相似度: ${score.toFixed(3)}\n内容: ${content}`,
            ),
          );
        }
      }

      return retrievedMessages;
    } catch (err) {
      // 检索失败时返回空，不阻断对话
      this.logger.error(`Milvus 检索失败: ${err.message}`);
      return [];
    }
  }

  /**
   * 保存本轮对话到 Milvus
   * 将 query 和 response 组合向量化后存入数据库，供后续检索使用
   *
   * @param sessionId 会话 ID
   * @param query 用户问题
   * @param response AI 回复
   */
  async saveConversation(
    sessionId: string,
    query: string,
    response: string,
  ): Promise<void> {
    // Milvus 未就绪时跳过
    if (!this.milvusProvider.isReady()) {
      return;
    }

    try {
      const client = this.milvusProvider.getClient();
      if (!client) return;

      const collectionName = this.milvusProvider.getCollectionName();

      // 将整轮对话组合为文本，然后向量化
      const vector = await this.embeddings.embedQuery(`${query}\n${response}`);

      // 插入数据：包含 sessionId、原始内容、向量、时间戳
      await client.insert({
        collection_name: collectionName,
        data: [
          {
            sessionId,
            content: `用户: ${query}\nAI: ${response}`,
            vector,
            timestamp: Date.now(),
          },
        ],
      });

      // flush 确保数据落盘
      await client.flushSync({ collection_names: [collectionName] });
    } catch (err) {
      // 保存失败不影响当前对话，只记录日志
      this.logger.error(`保存对话到 Milvus 失败: ${err.message}`);
    }
  }

  /**
   * 删除指定会话的所有向量记录
   * 在清空会话时调用，确保 Redis 和 Milvus 的数据一致
   *
   * @param sessionId 要删除的会话 ID
   */
  async deleteSessionConversations(sessionId: string): Promise<void> {
    // Milvus 未就绪时跳过
    if (!this.milvusProvider.isReady()) {
      return;
    }

    try {
      const client = this.milvusProvider.getClient();
      if (!client) return;

      const collectionName = this.milvusProvider.getCollectionName();

      // 按 sessionId 过滤并删除
      await client.delete({
        collection_name: collectionName,
        filter: `sessionId == "${sessionId}"`,
      });
    } catch (err) {
      // 删除失败只记录日志，不阻断操作
      this.logger.error(`从 Milvus 删除会话记录失败: ${err.message}`);
    }
  }
}
