/**
 * AI 服务 — 流式对话处理核心
 *
 * 职责：
 * 1. 提供两条处理链：无状态链（单次问答）和记忆链（多轮对话）
 * 2. 流式输出 AI 回复（SSE 事件流）
 * 3. 实时发射 TTS 事件，驱动语音合成
 * 4. 对话结束后异步保存记忆
 *
 * 架构设计：
 * ┌─────────────────────────────────────────────┐
 * │  Stateless Chain:  prompt → model → parser  │  ← 无记忆，单次问答
 * │  Memory Chain:     history + query → model  │  ← 有记忆，多轮对话
 * └─────────────────────────────────────────────┘
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from '@langchain/core/prompts';
import type { Runnable } from '@langchain/core/runnables';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { CHAT_MODEL } from 'src/constant';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AI_TTS_STREAM_EVENT,
  AiTtsStreamEvent,
} from 'src/common/stream-events';
import { MemoryOrchestrator } from 'src/memory/memory.orchestrator';
import { BaseMessage } from '@langchain/core/messages';
import { getEncoding } from 'js-tiktoken';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  /** 无状态处理链：单次问答，不依赖历史 */
  private readonly statelessChain: Runnable;
  /** 记忆处理链：支持多轮对话，接收历史消息 */
  private readonly memoryChain: Runnable;

  constructor(
    @Inject(CHAT_MODEL) private readonly model: ChatOpenAI,
    private readonly eventEmitter: EventEmitter2,
    private readonly memoryOrchestrator: MemoryOrchestrator,
  ) {
    // 无状态链：简单 prompt → 模型 → 字符串解析
    const prompt = ChatPromptTemplate.fromTemplate(
      '请回答以下问题：\n\n{query}',
    );
    this.statelessChain = prompt
      .pipe(this.model)
      .pipe(new StringOutputParser());

    // 记忆链：system prompt + 历史消息占位符 + 当前问题
    const memoryPrompt = ChatPromptTemplate.fromMessages([
      ['system', '你是一个全能AI助手，能够进行多轮对话并记住上下文。'],
      new MessagesPlaceholder('history'),
      ['human', '{query}'],
    ]);
    this.memoryChain = memoryPrompt
      .pipe(this.model)
      .pipe(new StringOutputParser());
  }

  /**
   * 流式处理链 — 核心方法
   * 根据是否有 sessionId 决定使用无状态链还是记忆链
   * 同时实时发射 TTS 事件，驱动语音合成服务
   *
   * @param query 用户问题
   * @param ttsSessionId TTS 会话 ID（用于语音合成）
   * @param sessionId AI 对话会话 ID（用于多轮记忆）
   * @returns 异步生成器，逐块输出 AI 回复
   */
  async *streamChain(
    query: string,
    ttsSessionId?: string,
    sessionId?: string,
  ): AsyncGenerator<string> {
    let fullResponse = '';
    let usagePromptText = '';

    try {
      let stream: AsyncIterable<string>;

      // 分支1: 有 sessionId → 使用记忆链（多轮对话）
      if (sessionId) {
        // 从 MemoryOrchestrator 获取完整上下文（历史 + 摘要 + 检索）
        const messages = await this.memoryOrchestrator.composeContext(
          query,
          sessionId,
        );
        // 提取历史消息（排除最后一条当前问题）
        const historyMessages = messages.slice(0, -1);
        usagePromptText = this.buildMemoryPromptText(historyMessages, query);
        stream = await this.memoryChain.stream({
          history: historyMessages,
          query,
        });
      } else {
        // 分支2: 无 sessionId → 使用无状态链（单次问答）
        usagePromptText = `请回答以下问题：\n\n${query}`;
        stream = await this.statelessChain.stream({ query });
      }

      // 流式遍历 AI 回复的每一块
      for await (const chunk of stream) {
        fullResponse += chunk;
        // 实时发射 TTS 事件，驱动语音合成
        if (ttsSessionId) {
          const event: AiTtsStreamEvent = {
            type: 'chunk',
            sessionId: ttsSessionId,
            chunk,
          };
          this.eventEmitter.emit(AI_TTS_STREAM_EVENT, event);
        }
        yield chunk;
      }

      const usagePayload = this.buildUsagePayload(usagePromptText, fullResponse);
      if (usagePayload) {
        yield usagePayload;
      }
    } finally {
      // 对话结束后异步保存记忆（不阻塞响应）
      if (sessionId && fullResponse) {
        this.memoryOrchestrator
          .saveTurn(sessionId, query, fullResponse)
          .catch((err) => {
            this.logger.error(`Failed to save turn: ${err.message}`);
          });
      }

      // 发射 TTS 结束事件，通知语音合成服务 AI 回复已完成
      if (ttsSessionId) {
        const endEvent: AiTtsStreamEvent = {
          type: 'end',
          sessionId: ttsSessionId,
        };
        this.eventEmitter.emit(AI_TTS_STREAM_EVENT, endEvent);
      }
    }
  }

  private buildUsagePayload(promptText: string, responseText: string): string {
    if (!responseText) {
      return '';
    }

    try {
      const enc = getEncoding('cl100k_base');
      const inputTokens = enc.encode(promptText || '').length;
      const outputTokens = enc.encode(responseText).length;

      return JSON.stringify({
        _type: 'usage',
        inputTokens,
        outputTokens,
      });
    } catch (err) {
      this.logger.error(`Failed to calculate token usage: ${err.message}`);
      return '';
    }
  }

  private buildMemoryPromptText(messages: BaseMessage[], query: string): string {
    const promptLines = ['system: 你是一个全能AI助手，能够进行多轮对话并记住上下文。'];

    for (const message of messages) {
      const role = message.type;
      if (!role) {
        continue;
      }
      const content =
        typeof message.content === 'string'
          ? message.content
          : JSON.stringify(message.content);
      promptLines.push(`${role}: ${content}`);
    }

    promptLines.push(`human: ${query}`);
    return promptLines.join('\n');
  }
}
