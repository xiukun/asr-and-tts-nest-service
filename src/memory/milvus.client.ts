/**
 * Milvus 客户端提供者 — 向量数据库连接管理
 *
 * 职责：
 * 1. 管理 Milvus 连接生命周期（OnModuleInit 连接 + 健康检查）
 * 2. 自动创建 Collection（如果不存在），定义字段结构和向量索引
 * 3. 提供 isReady() 接口，供检索策略判断是否可用
 *
 * Collection 结构：
 * - id: Int64 主键，自增
 * - sessionId: VarChar(128) 会话标识
 * - content: VarChar(65535) 对话内容
 * - vector: FloatVector(1536) 文本向量
 * - timestamp: Int64 时间戳
 *
 * 索引：IVF_FLAT + COSINE 相似度
 *
 * 配置项：
 * - ENABLE_MILVUS_RETRIEVAL: 是否启用，默认 false
 * - MILVUS_HOST: Milvus 主机地址，默认 localhost
 * - MILVUS_PORT: Milvus 端口，默认 19530
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MilvusClient } from '@zilliz/milvus2-sdk-node';

/** 集合名称 — 存储对话历史 */
const COLLECTION_NAME = 'conversation_history';
/** 向量维度 — 与 Embedding 模型输出维度一致 */
const VECTOR_DIM = 1536;

@Injectable()
export class MilvusClientProvider implements OnModuleInit {
  private readonly logger = new Logger(MilvusClientProvider.name);
  private client: MilvusClient | null = null;
  private initialized = false;

  constructor(private readonly configService: ConfigService) {}

  /** 模块初始化时连接 Milvus 并创建 Collection */
  async onModuleInit() {
    const enabled =
      this.configService.get('ENABLE_MILVUS_RETRIEVAL', 'false') === 'true';
    if (!enabled) {
      this.logger.log('Milvus retrieval disabled via ENABLE_MILVUS_RETRIEVAL');
      return;
    }

    const host = this.configService.get('MILVUS_HOST', 'localhost');
    const port = this.configService.get('MILVUS_PORT', '19530');
    const address = `${host}:${port}`;

    try {
      this.client = new MilvusClient({ address });
      await this.client.checkHealth();
      this.logger.log(`Milvus connected to ${address}`);

      // 确保 Collection 存在（自动创建）
      await this.ensureCollection();
      this.initialized = true;
    } catch (err) {
      this.logger.warn(
        `Milvus connection failed: ${err.message}. Retrieval will be disabled.`,
      );
      this.client = null;
    }
  }

  /**
   * 确保 Collection 存在
   * 如果不存在则创建，定义字段结构和向量索引
   */
  private async ensureCollection() {
    if (!this.client) return;

    const { value: hasCollection } = await this.client.hasCollection({
      collection_name: COLLECTION_NAME,
    });

    if (!hasCollection) {
      this.logger.log(`Creating collection: ${COLLECTION_NAME}`);
      await this.client.createCollection({
        collection_name: COLLECTION_NAME,
        description: 'Conversation history for semantic retrieval',
        fields: [
          {
            name: 'id',
            data_type: 'Int64',
            is_primary_key: true,
            autoID: true, // 自增主键
          },
          {
            name: 'sessionId',
            data_type: 'VarChar',
            max_length: 128,
          },
          {
            name: 'content',
            data_type: 'VarChar',
            max_length: 65535,
          },
          {
            name: 'vector',
            data_type: 'FloatVector',
            dim: VECTOR_DIM,
          },
          {
            name: 'timestamp',
            data_type: 'Int64',
          },
        ],
        index_params: [
          {
            field_name: 'vector',
            index_name: 'vector_idx',
            index_type: 'IVF_FLAT', // 倒排文件索引，适合中等规模数据
            metric_type: 'COSINE', // 余弦相似度
            params: { nlist: 128 }, // 聚类中心数
          },
        ],
      });
      this.logger.log(
        `Collection ${COLLECTION_NAME} created with IVF_FLAT index`,
      );
    }

    // 加载 Collection 到内存，使其可搜索
    await this.client.loadCollectionSync({ collection_name: COLLECTION_NAME });
    this.logger.log(`Collection ${COLLECTION_NAME} loaded`);
  }

  /** 获取 Milvus 客户端实例 */
  getClient(): MilvusClient | null {
    return this.client;
  }

  /** 检查 Milvus 是否就绪可用 */
  isReady(): boolean {
    return this.initialized && this.client !== null;
  }

  /** 获取 Collection 名称 */
  getCollectionName(): string {
    return COLLECTION_NAME;
  }
}
