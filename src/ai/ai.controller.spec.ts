import { toArray } from 'rxjs/operators';
import { lastValueFrom } from 'rxjs';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

async function* createStream(chunks: string[]) {
  for (const chunk of chunks) {
    yield chunk;
  }
}

describe('AiController', () => {
  it('should convert usage payload chunk to usage SSE event', async () => {
    const aiService = {
      streamChain: jest.fn(() =>
        createStream([
          'first-chunk',
          JSON.stringify({
            _type: 'usage',
            inputTokens: 123,
            outputTokens: 456,
          }),
        ]),
      ),
    } as unknown as AiService;

    const eventEmitter = {
      emit: jest.fn(),
    } as unknown as EventEmitter2;

    const controller = new AiController(aiService, eventEmitter);

    const result = await lastValueFrom(
      controller.chatStream('hello').pipe(toArray()),
    );

    expect(result).toEqual([
      { data: 'first-chunk' },
      {
        event: 'usage',
        data: JSON.stringify({
          inputTokens: 123,
          outputTokens: 456,
        }),
      },
    ]);
  });
});
