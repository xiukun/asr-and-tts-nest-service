import { EventEmitter2 } from '@nestjs/event-emitter';
import { AiService } from './ai.service';
import { MemoryOrchestrator } from 'src/memory/memory.orchestrator';

async function collect(stream: AsyncGenerator<string>): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

async function* createStream(chunks: string[]) {
  for (const chunk of chunks) {
    yield chunk;
  }
}

describe('AiService', () => {
  it('should append usage payload when response has content', async () => {
    const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;
    const memoryOrchestrator = {
      composeContext: jest.fn(),
      saveTurn: jest.fn(),
    } as unknown as MemoryOrchestrator;

    const service = new AiService(
      {
        invoke: jest.fn(),
        stream: jest.fn(),
      } as any,
      eventEmitter,
      memoryOrchestrator,
    );

    (service as any).statelessChain = {
      stream: jest.fn(() => createStream(['你', '好'])),
    };

    const chunks = await collect(service.streamChain('你好'));
    const usageChunk = chunks[chunks.length - 1];
    const usage = JSON.parse(usageChunk);

    expect(chunks.slice(0, -1)).toEqual(['你', '好']);
    expect(usage._type).toBe('usage');
    expect(Number.isFinite(usage.inputTokens)).toBe(true);
    expect(Number.isFinite(usage.outputTokens)).toBe(true);
  });

  it('should not append usage payload when response is empty', async () => {
    const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;
    const memoryOrchestrator = {
      composeContext: jest.fn(),
      saveTurn: jest.fn(),
    } as unknown as MemoryOrchestrator;

    const service = new AiService(
      {
        invoke: jest.fn(),
        stream: jest.fn(),
      } as any,
      eventEmitter,
      memoryOrchestrator,
    );

    (service as any).statelessChain = {
      stream: jest.fn(() => createStream([])),
    };

    const chunks = await collect(service.streamChain('你好'));
    expect(chunks).toEqual([]);
  });
});
