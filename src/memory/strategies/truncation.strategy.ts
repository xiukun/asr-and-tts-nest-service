/**
 * 裁剪策略 — 基于 Token 数量的消息截断
 *
 * 核心思路：
 * LLM 的上下文窗口有限，当历史消息过多时会超出模型的处理能力。
 * 此策略通过计算历史消息的 token 总量，如果超过设定的上限（默认 4000），
 * 就自动截断旧消息，只保留最近的消息。
 *
 * 为什么按 token 数而不是按消息条数？
 * 因为一条消息可能只有 5 个字（"好的"），也可能有 500 个字。
 * 按条数裁剪不精确，按 token 数才能准确控制上下文大小。
 *
 * 工作流程：
 * 1. 计算所有历史消息的 token 总数
 * 2. 如果未超限，原样返回
 * 3. 如果超限，调用 LangChain 的 trimMessages 从后往前保留，直到 token 数在限制内
 * 4. 如果 trimMessages 失败，降级为保留一半消息
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BaseMessage } from '@langchain/core/messages';
import { trimMessages } from '@langchain/core/messages';
import { getEncoding } from 'js-tiktoken';

@Injectable()
export class TruncationStrategy {
  private readonly logger = new Logger(TruncationStrategy.name);
  /** 上下文最大 token 数，超出则触发裁剪 */
  private maxTokens: number;
  /** 保留最近消息的 token 上限（降级策略使用） */
  private keepRecentTokens: number;

  constructor(private readonly configService: ConfigService) {
    // 从环境变量读取，默认最大 4000 tokens
    this.maxTokens = this.configService.get('MEMORY_MAX_TOKENS', 4000);
    this.keepRecentTokens = this.configService.get(
      'MEMORY_KEEP_RECENT_TOKENS',
      1000,
    );
  }

  /**
   * 对消息列表进行裁剪
   * @param messages 原始消息列表
   * @returns 裁剪后的消息列表（只保留最近的，token 数不超过 maxTokens）
   */
  async truncate(messages: BaseMessage[]): Promise<BaseMessage[]> {
    if (messages.length === 0) return [];

    // 第1步：计算当前总 token 数
    const totalTokens = await this.countTokens(messages);

    // 第2步：未超限，直接返回，不做任何裁剪
    if (totalTokens <= this.maxTokens) {
      return messages;
    }

    this.logger.debug(
      `裁剪触发: 当前 ${totalTokens} tokens 超过上限 ${this.maxTokens}`,
    );

    // 第3步：使用 LangChain 的 trimMessages 进行精确裁剪
    try {
      const enc = getEncoding('cl100k_base');
      return await trimMessages(messages, {
        maxTokens: this.maxTokens,
        // 使用自定义 token 计数器，确保计算方式一致
        tokenCounter: async (msgs: BaseMessage[]) => {
          return this.countTokensWithEncoder(msgs, enc);
        },
        // strategy: 'last' 表示从后往前保留（保留最近的消息）
        strategy: 'last',
      });
    } catch (err) {
      // 第4步：裁剪失败时的降级策略 — 保留一半消息
      this.logger.error(`裁剪失败，降级为保留最近一半消息: ${err.message}`);
      return messages.slice(-Math.max(1, Math.floor(messages.length / 2)));
    }
  }

  /**
   * 计算消息列表的总 token 数
   * 使用 cl100k_base 编码（适用于 GPT-4 / GPT-3.5 等模型）
   */
  private async countTokens(messages: BaseMessage[]): Promise<number> {
    const enc = getEncoding('cl100k_base');
    const total = this.countTokensWithEncoder(messages, enc);
    return total;
  }

  /**
   * 使用指定的编码器计算 token 数
   * 每条消息按 "角色: 内容" 的格式编码，更接近 LLM 实际的 token 计算方式
   */
  private countTokensWithEncoder(
    messages: BaseMessage[],
    enc: ReturnType<typeof getEncoding>,
  ): number {
    let total = 0;
    for (const msg of messages) {
      // 处理结构化内容（如包含工具调用等）
      const content =
        typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content);
      const role = msg._getType() || '';
      // 按 "role: content" 格式编码，模拟 LLM 的 prompt 格式
      total += enc.encode(role + ': ' + content).length;
    }
    return total;
  }
}
