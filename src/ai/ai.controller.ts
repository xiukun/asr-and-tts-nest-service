import { Controller, Query, Sse } from '@nestjs/common';
import { from, map, Observable } from 'rxjs';
import { AiService } from './ai.service';
import { AI_TTS_STREAM_EVENT, AiTtsStreamEvent } from 'src/common/stream-events';
import { EventEmitter2 } from '@nestjs/event-emitter';
@Controller('ai')
export class AiController {
    constructor(private readonly aiService: AiService, private readonly eventEmitter: EventEmitter2) {

    }
    @Sse('chat/stream')
    chatStream(
        @Query('query') query: string,
        @Query('ttsSessionId') ttsSessionId?: string,
    ): Observable<{ data: string }> {
        const sessionId = ttsSessionId?.trim();
        if (sessionId) {
            const startEvent: AiTtsStreamEvent = { type: 'start', sessionId, query };
            this.eventEmitter.emit(AI_TTS_STREAM_EVENT, startEvent);
        }

        return from(this.aiService.streamChain(query, sessionId)).pipe(
            map((chunk) => ({ data: chunk })),
        );
    }
}