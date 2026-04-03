/**
 * AI 控制器 — 处理流式对话请求
 *
 * 端点：GET /ai/chat/stream?query=xxx&ttsSessionId=xxx&sessionId=xxx
 *
 * 职责：
 * 1. 接收用户问题（query）、TTS 会话 ID、AI 会话 ID
 * 2. 发射 TTS 开始事件，触发语音合成服务
 * 3. 调用 AiService 流式处理链，将 AI 回复转为 SSE 事件流返回前端
 *
 * 参数说明：
 * - query: 用户问题（必填）
 * - ttsSessionId: TTS 语音合成会话 ID（可选，传入则触发语音合成）
 * - sessionId: AI 对话会话 ID（可选，传入则启用多轮记忆）
 */
import { Controller, Query, Sse } from '@nestjs/common';
import { from, map, Observable } from 'rxjs';
import { AiService } from './ai.service';
import {
  AI_TTS_STREAM_EVENT,
  AiTtsStreamEvent,
} from 'src/common/stream-events';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Controller('ai')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * 流式对话端点 — SSE 事件流
   * 前端通过 EventSource 连接，实时接收 AI 回复
   */
  @Sse('chat/stream')
  chatStream(
    @Query('query') query: string,
    @Query('ttsSessionId') ttsSessionId?: string,
    @Query('sessionId') sessionId?: string,
  ): Observable<{ data: string }> {
    const ttsSid = ttsSessionId?.trim();
    // 如果传入了 TTS 会话 ID，发射开始事件，通知 TTS 服务准备合成
    if (ttsSid) {
      const startEvent: AiTtsStreamEvent = {
        type: 'start',
        sessionId: ttsSid,
        query,
      };
      this.eventEmitter.emit(AI_TTS_STREAM_EVENT, startEvent);
    }

    // 将 AsyncGenerator 转为 Observable，逐块返回给前端
    return from(
      this.aiService.streamChain(query, ttsSid, sessionId?.trim()),
    ).pipe(map((chunk) => ({ data: chunk })));
  }
}
