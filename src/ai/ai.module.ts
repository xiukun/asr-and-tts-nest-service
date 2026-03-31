import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { CHAT_MODEL } from 'src/constant';
import { ToolModule } from 'src/tool/tool.module';

@Module({
  controllers: [AiController],
  imports:[ToolModule],
  providers: [AiService]
})
export class AiModule {

}
