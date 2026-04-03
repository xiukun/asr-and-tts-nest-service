/**
 * 会话服务 — 会话生命周期管理
 *
 * 职责：
 * 1. 创建会话 — 生成 sessionId 并设置 TTL
 * 2. 查询会话信息 — 存在性、消息数、TTL 剩余
 * 3. 清空会话 — 清理 Redis 和 Milvus 中的所有数据
 */
import { Injectable } from '@nestjs/common';
import { MemoryOrchestrator } from '../memory/memory.orchestrator';
import { RedisSessionStore } from '../memory/redis-session.store';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

/** 会话信息接口 */
export interface SessionInfo {
  sessionId: string;
  exists: boolean;
  messageCount: number;
  ttlRemaining: number;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly orchestrator: MemoryOrchestrator,
    private readonly redisStore: RedisSessionStore,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 创建新会话
   * @param sessionId 可选的自定义 sessionId，不传则自动生成 UUID
   * @returns 包含 sessionId、创建时间、TTL 的对象
   */
  async createSession(
    sessionId?: string,
  ): Promise<{ sessionId: string; createdAt: string; ttl: number }> {
    const id = sessionId || randomUUID();
    const ttlFromConfig = this.configService.get('MEMORY_SESSION_TTL', 86400);
    const ttl = Number(ttlFromConfig);
    const normalizedTtl = Number.isFinite(ttl) && ttl > 0 ? ttl : 86400;

    // 设置会话 TTL（如果 key 不存在会创建空数组）
    await this.redisStore.setTTL(id, normalizedTtl);
    return {
      sessionId: id,
      createdAt: new Date().toISOString(),
      ttl: normalizedTtl,
    };
  }

  /**
   * 获取会话信息
   * @param sessionId 会话 ID
   * @returns 包含存在性、消息数、TTL 剩余的会话信息
   */
  async getSessionInfo(sessionId: string): Promise<SessionInfo> {
    const info = await this.orchestrator.getSessionInfo(sessionId);
    return {
      sessionId,
      ...info,
    };
  }

  /**
   * 清空会话 — 同时清理 Redis 和 Milvus
   * @param sessionId 要清空的会话 ID
   * @returns 始终返回 true
   */
  async clearSession(sessionId: string): Promise<boolean> {
    await this.orchestrator.clearSession(sessionId);
    return true;
  }
}
