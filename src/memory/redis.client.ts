/**
 * Redis 客户端提供者 — 连接管理
 *
 * 职责：
 * 1. 管理 Redis 连接生命周期（OnModuleInit 连接，OnModuleDestroy 断开）
 * 2. 提供懒连接和重试策略，避免启动时阻塞
 * 3. 健康检查接口，供其他模块判断 Redis 是否可用
 *
 * 配置项：
 * - REDIS_HOST: Redis 主机地址，默认 localhost
 * - REDIS_PORT: Redis 端口，默认 6379
 */
import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisClientProvider implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisClientProvider.name);
  private client: Redis;
  private readonly host: string;
  private readonly port: number;

  constructor(private readonly configService: ConfigService) {
    this.host = this.configService.get('REDIS_HOST', 'localhost');
    const portFromConfig = this.configService.get('REDIS_PORT', 6379);
    const port = Number(portFromConfig);
    this.port = Number.isFinite(port) && port > 0 ? port : 6379;

    // 创建 Redis 客户端实例，使用懒连接模式
    this.client = new Redis({
      host: this.host,
      port: this.port,
      lazyConnect: true, // 不自动连接，等待手动调用 connect()
      retryStrategy: (times) => Math.min(times * 50, 2000), // 重试策略：指数退避，最大 2 秒
      maxRetriesPerRequest: 3, // 单个请求最多重试 3 次
    });

    // 监听连接事件
    this.client.on('connect', () =>
      this.logger.log(`Redis connected to ${this.host}:${this.port}`),
    );
    this.client.on('error', (err) =>
      this.logger.error(`Redis error: ${err.message}`),
    );
    this.client.on('ready', () => this.logger.log('Redis ready'));
  }

  /** 模块初始化时建立连接 */
  async onModuleInit() {
    try {
      await this.client.connect();
    } catch (err) {
      this.logger.warn(
        `Redis connection failed: ${err.message}. Memory features will be disabled.`,
      );
    }
  }

  /** 模块销毁时优雅关闭连接 */
  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
    }
  }

  /** 获取 Redis 客户端实例 */
  getClient(): Redis {
    return this.client;
  }

  /** 检查 Redis 是否可用（PING/PONG） */
  async isAvailable(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }
}
