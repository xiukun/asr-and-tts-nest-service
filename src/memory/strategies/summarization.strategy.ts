/**
 * 总结策略 — 基于 LLM 的对话摘要
 *
 * 核心思路：
 * 单纯裁剪旧消息会丢失重要信息。此策略在对话过长时，
 * 调用 LLM 对早期对话生成摘要，保留核心语义，
 * 同时保留最近的原始对话（细节不能丢）。
 *
 * 工作流程：
 * 1. 计算历史消息的 token 总数
 * 2. 如果未超阈值（默认 6000），不做任何处理
 * 3. 如果超限：
 *    a. 从后往前提取最近的原始消息（默认保留 1000 tokens）
 *    b. 把更早的消息发给 LLM，让它生成摘要
 *    c. 摘要作为 SystemMessage 注入，告诉 AI "之前聊过这些"
 * 4. 最终返回：[摘要 SystemMessage] + [最近的原始消息]
 *
 * 比喻：
 * 就像开会做会议纪要。你不会记住每句话，但会记一份摘要。
 * 下次开会前先看一眼摘要，再接着聊。
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BaseMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';
import { getEncoding } from 'js-tiktoken';

@Injectable()
export class SummarizationStrategy {
  private readonly logger = new Logger(SummarizationStrategy.name);
  /** 触发总结的 token 阈值，超过此值则调用 LLM 生成摘要 */
  private summarizeThresholdTokens: number;
  /** 保留最近原始消息的 token 上限（这些消息不做摘要，原样保留） */
  private keepRecentTokens: number;

  constructor(
    private readonly configService: ConfigService,
    /** 复用对话的同一个 LLM 模型来生成摘要 */
    private readonly model: ChatOpenAI,
  ) {
    // 从环境变量读取，默认超过 6000 tokens 时触发总结
    this.summarizeThresholdTokens = this.configService.get(
      'MEMORY_SUMMARIZE_THRESHOLD_TOKENS',
      6000,
    );
    // 默认保留最近 1000 tokens 的原始对话
    this.keepRecentTokens = this.configService.get(
      'MEMORY_KEEP_RECENT_TOKENS',
      1000,
    );
  }

  /**
   * 判断是否需要总结，需要则生成摘要
   * @param messages 裁剪后的消息列表
   * @returns summary: 摘要消息（SystemMessage），recentMessages: 保留的最近原始消息
   */
  async summarizeIfNeeded(messages: BaseMessage[]): Promise<{
    summary: SystemMessage | null;
    recentMessages: BaseMessage[];
  }> {
    // 空消息列表，无需处理
    if (messages.length === 0) {
      return { summary: null, recentMessages: [] };
    }

    // 第1步：计算总 token 数
    const totalTokens = this.countTokens(messages);

    // 第2步：未超阈值，原样返回所有消息
    if (totalTokens <= this.summarizeThresholdTokens) {
      return { summary: null, recentMessages: messages };
    }

    this.logger.debug(
      `总结触发: 当前 ${totalTokens} tokens 超过阈值 ${this.summarizeThresholdTokens}`,
    );

    // 第3步：从后往前提取最近的原始消息（保留细节）
    const recentMessages = this.extractRecentMessagesWithinTokens(
      messages,
      this.keepRecentTokens,
    );

    // 第4步：确定需要被总结的早期消息
    const messagesToSummarize = messages.slice(
      0,
      messages.length - recentMessages.length,
    );

    // 如果没有需要总结的消息，直接返回最近消息
    if (messagesToSummarize.length === 0) {
      return { summary: null, recentMessages };
    }

    // 第5步：调用 LLM 生成摘要
    try {
      const summaryText = await this.generateSummary(messagesToSummarize);
      // 将摘要包装为 SystemMessage，LLM 天然理解 system 角色的含义
      const summaryMsg = new SystemMessage(
        `以下是之前对话的摘要：\n${summaryText}`,
      );
      return { summary: summaryMsg, recentMessages };
    } catch (err) {
      // 总结失败时降级为只返回最近消息，不阻断对话
      this.logger.error(`总结失败，仅返回最近消息: ${err.message}`);
      return { summary: null, recentMessages };
    }
  }

  /**
   * 调用 LLM 生成对话摘要
   * 将消息格式化为 "角色: 内容" 的文本，然后让 LLM 总结
   */
  private async generateSummary(messages: BaseMessage[]): Promise<string> {
    // 将消息数组格式化为可读的对话文本
    const conversationText = messages
      .map((msg) => {
        const role = msg.type === 'human' ? '用户' : 'AI';
        const content =
          typeof msg.content === 'string'
            ? msg.content
            : JSON.stringify(msg.content);
        return `${role}: ${content}`;
      })
      .join('\n');

    // 总结 prompt：要求 LLM 保留重要信息
    const prompt = PromptTemplate.fromTemplate(
      '请总结以下对话的核心内容，保留重要信息作为对话的核心主题：\n\n{conversationText}\n\n总结：',
    );

    const chain = prompt.pipe(this.model);
    const result = await chain.invoke({ conversationText });
    return typeof result.content === 'string'
      ? result.content
      : JSON.stringify(result.content);
  }

  /**
   * 计算消息列表的 token 总数
   * 使用 cl100k_base 编码（适用于 GPT-4 / GPT-3.5 等模型）
   */
  private countTokens(messages: BaseMessage[]): number {
    const enc = getEncoding('cl100k_base');
    let total = 0;
    for (const msg of messages) {
      const content =
        typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content);
      const role = msg.type || '';
      total += enc.encode(role + ': ' + content).length;
    }
    return total;
  }

  /**
   * 从后往前提取消息，直到 token 数达到上限
   * 这确保最近的对话细节被完整保留
   *
   * @param messages 消息列表
   * @param maxTokens 最近消息的 token 上限
   * @returns 从后往前累积的消息列表（保持原始顺序）
   */
  private extractRecentMessagesWithinTokens(
    messages: BaseMessage[],
    maxTokens: number,
  ): BaseMessage[] {
    const enc = getEncoding('cl100k_base');
    const recent: BaseMessage[] = [];
    let recentTokens = 0;

    // 从最后一条消息开始，往前遍历
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const content =
        typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content);
      const role = msg._getType() || '';
      const msgTokens = enc.encode(role + ': ' + content).length;

      // 如果加上这条消息不超过上限，就保留
      if (recentTokens + msgTokens <= maxTokens) {
        // unshift 保证最终数组的顺序是正确的（从旧到新）
        recent.unshift(msg);
        recentTokens += msgTokens;
      } else {
        // 超出上限，停止
        break;
      }
    }

    return recent;
  }
}
