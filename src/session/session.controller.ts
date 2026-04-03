/**
 * 会话控制器 — 会话管理 API 端点
 *
 * 端点：
 * POST   /memory/session          创建新会话
 * GET    /memory/session/:id      获取会话信息（消息数、TTL 等）
 * DELETE /memory/session/:id      清空会话（Redis + Milvus）
 */
import { Controller, Post, Get, Delete, Param, Body } from '@nestjs/common';
import { SessionService } from './session.service';

@Controller('memory/session')
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  /** 创建新会话 — 可自定义 sessionId 或自动生成 UUID */
  @Post()
  async createSession(@Body() body?: { sessionId?: string }) {
    return this.sessionService.createSession(body?.sessionId);
  }

  /** 获取会话信息 — 消息数量、TTL 剩余等 */
  @Get(':sessionId')
  async getSessionInfo(@Param('sessionId') sessionId: string) {
    return this.sessionService.getSessionInfo(sessionId);
  }

  /** 清空会话 — 删除 Redis 和 Milvus 中的所有数据 */
  @Delete(':sessionId')
  async clearSession(@Param('sessionId') sessionId: string) {
    const success = await this.sessionService.clearSession(sessionId);
    return { success };
  }
}
