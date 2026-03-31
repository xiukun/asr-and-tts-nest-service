import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';

@Injectable()
export class LlmService {
  @Inject(ConfigService)
  private readonly configService: ConfigService;

  getModel() {
    return new ChatOpenAI({
      model: this.configService.get('MODEL_NAME'),
          temperature: 0.5,
          apiKey: this.configService.get('OPENAI_API_KEY'),
          configuration: {
            baseURL: this.configService.get('OPENAI_BASE_URL')
          },
          timeout: 180000, // 3分钟超时（支持模型调用工具）
          maxRetries: 2, // 重试2次
    });
  }
}

