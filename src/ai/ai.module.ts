import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { ToolModule } from 'src/tool/tool.module';
import { MemoryModule } from 'src/memory/memory.module';

@Module({
  controllers: [AiController],
  imports: [ToolModule, MemoryModule],
  providers: [AiService],
})
export class AiModule {}
