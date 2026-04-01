import { Inject, Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';
import type { Runnable } from '@langchain/core/runnables';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { CHAT_MODEL } from 'src/constant';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AI_TTS_STREAM_EVENT, AiTtsStreamEvent } from 'src/common/stream-events';

@Injectable()
export class AiService {
    private readonly chain: Runnable;

    constructor(
        @Inject(CHAT_MODEL) model: ChatOpenAI,
        private readonly eventEmitter: EventEmitter2
    ) {
        const prompt = PromptTemplate.fromTemplate('请回答以下问题：\n\n{query}');
        this.chain = prompt.pipe(model).pipe(new StringOutputParser());
    }

    async *streamChain(query: string,ttsSessionId?:string): AsyncGenerator<string> {
        const stream = await this.chain.stream({ query });
        try {
            for await (const chunk of stream) {
                if(ttsSessionId) {
                    const event: AiTtsStreamEvent ={
                        type: 'chunk',
                        sessionId: ttsSessionId,
                        chunk
                    };
                    this.eventEmitter.emit(AI_TTS_STREAM_EVENT,event);
                }
                yield chunk;
            }
        } finally {
            // 确保发射 'end' 事件，通知 TTS 服务 AI 回复已完成
            if(ttsSessionId) {
                const endEvent: AiTtsStreamEvent = {
                    type: 'end',
                    sessionId: ttsSessionId
                };
                this.eventEmitter.emit(AI_TTS_STREAM_EVENT, endEvent);
            }
        }
    }
}
