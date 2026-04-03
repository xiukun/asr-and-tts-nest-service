/**
 * Redis 会话存储 — 短期记忆持久化
 *
 * 职责：
 * 1. 将 LangChain 消息序列化存入 Redis（JSON 格式）
 * 2. 读取时反序列化为 BaseMessage 对象
 * 3. 维护会话 TTL，自动清理过期会话
 *
 * 存储格式：
 * Key: memory:session:{sessionId}
 * Value: JSON 数组，存储 LangChain 格式化的消息列表
 *
 * 设计要点：
 * - 使用 LangChain 内置的 mapChatMessagesToStoredMessages / mapStoredMessagesToChatMessages
 *   保证消息类型（Human/AI/System）在存取时正确转换
 * - setJsonKeepingTTL 方法在更新数据时保留原有 TTL，避免意外过期
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  BaseMessage,
  mapChatMessagesToStoredMessages,
  mapStoredMessagesToChatMessages,
} from '@langchain/core/messages';
import Redis from 'ioredis';

@Injectable()
export class RedisSessionStore {
  private readonly logger = new Logger(RedisSessionStore.name);
  /** Redis key 前缀，用于隔离会话数据 */
  private keyPrefix = 'memory:session:';

  constructor(private readonly redis: Redis) {}

  /** 根据 sessionId 生成完整的 Redis key */
  private getKey(sessionId: string): string {
    return `${this.keyPrefix}${sessionId}`;
  }

  /**
   * 设置 JSON 数据并保留原有 TTL
   * 关键：先查当前 key 的剩余 TTL，写入时重新设置，避免覆盖后丢失过期时间
   */
  private async setJsonKeepingTTL(key: string, value: unknown): Promise<void> {
    const serialized = JSON.stringify(value);

    // 获取当前 key 的剩余过期时间
    const ttl = await this.redis.ttl(key);
    if (ttl > 0) {
      // 有 TTL → 写入时重新设置相同的过期时间
      await this.redis.set(key, serialized, 'EX', ttl);
      return;
    }

    // 无 TTL → 直接写入
    await this.redis.set(key, serialized);
  }

  /**
   * 获取会话的所有消息
   * @param sessionId 会话 ID
   * @returns 反序列化后的消息列表，失败返回空数组
   */
  async getMessages(sessionId: string): Promise<BaseMessage[]> {
    try {
      const raw = await this.redis.get(this.getKey(sessionId));
      if (!raw) return [];
      const stored = JSON.parse(raw);
      return mapStoredMessagesToChatMessages(stored);
    } catch (err) {
      this.logger.error(
        `Failed to get messages for session ${sessionId}: ${err.message}`,
      );
      return [];
    }
  }

  /**
   * 追加单条消息到会话
   * 读取现有数据 → 追加新消息 → 写回（保留 TTL）
   */
  async addMessage(sessionId: string, message: BaseMessage): Promise<void> {
    try {
      const key = this.getKey(sessionId);
      const raw = await this.redis.get(key);
      const stored: any[] = raw ? JSON.parse(raw) : [];
      const newMessages = await mapChatMessagesToStoredMessages([message]);
      stored.push(...newMessages);
      await this.setJsonKeepingTTL(key, stored);
    } catch (err) {
      this.logger.error(
        `Failed to add message for session ${sessionId}: ${err.message}`,
      );
    }
  }

  /**
   * 批量追加消息到会话
   * 与 addMessage 类似，但一次性写入多条
   */
  async addMessages(sessionId: string, messages: BaseMessage[]): Promise<void> {
    try {
      const key = this.getKey(sessionId);
      const raw = await this.redis.get(key);
      const stored: any[] = raw ? JSON.parse(raw) : [];
      const newMessages = await mapChatMessagesToStoredMessages(messages);
      stored.push(...newMessages);
      await this.setJsonKeepingTTL(key, stored);
    } catch (err) {
      this.logger.error(
        `Failed to add messages for session ${sessionId}: ${err.message}`,
      );
    }
  }

  /**
   * 覆盖设置会话的消息（替换而非追加）
   * 用于总结策略等场景，需要替换整个消息列表
   */
  async setMessages(sessionId: string, messages: BaseMessage[]): Promise<void> {
    try {
      const key = this.getKey(sessionId);
      const stored = await mapChatMessagesToStoredMessages(messages);
      await this.setJsonKeepingTTL(key, stored);
    } catch (err) {
      this.logger.error(
        `Failed to set messages for session ${sessionId}: ${err.message}`,
      );
    }
  }

  /** 清空会话数据 */
  async clear(sessionId: string): Promise<void> {
    try {
      await this.redis.del(this.getKey(sessionId));
    } catch (err) {
      this.logger.error(`Failed to clear session ${sessionId}: ${err.message}`);
    }
  }

  /**
   * 设置会话过期时间
   * 如果 key 不存在（result === 0），则创建一个空数组并设置 TTL
   */
  async setTTL(sessionId: string, ttlSeconds: number): Promise<void> {
    try {
      const ttl = Number(ttlSeconds);
      if (!Number.isFinite(ttl) || ttl <= 0) return;

      const key = this.getKey(sessionId);
      const result = await this.redis.expire(key, ttl);
      // key 不存在时，创建一个空数组并设置 TTL（NX = 仅当 key 不存在时设置）
      if (result === 0) {
        await this.redis.set(key, '[]', 'EX', ttl, 'NX');
      }
    } catch (err) {
      this.logger.error(
        `Failed to set TTL for session ${sessionId}: ${err.message}`,
      );
    }
  }

  /** 获取会话剩余 TTL（秒），-1 表示无过期时间，-2 表示 key 不存在 */
  async getTTL(sessionId: string): Promise<number> {
    try {
      return await this.redis.ttl(this.getKey(sessionId));
    } catch {
      return -1;
    }
  }

  /** 检查会话是否存在 */
  async exists(sessionId: string): Promise<boolean> {
    try {
      const result = await this.redis.exists(this.getKey(sessionId));
      return result === 1;
    } catch {
      return false;
    }
  }

  /** 获取会话的消息数量 */
  async getMessageCount(sessionId: string): Promise<number> {
    try {
      const raw = await this.redis.get(this.getKey(sessionId));
      if (!raw) return 0;
      const stored = JSON.parse(raw);
      return Array.isArray(stored) ? stored.length : 0;
    } catch {
      return 0;
    }
  }
}
