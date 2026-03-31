import { Module } from '@nestjs/common';
import { LlmService } from './llm.service';
import { CHAT_MODEL } from 'src/constant';

@Module({
    providers: [
        LlmService,
        {
            provide: CHAT_MODEL,
            useFactory: (llmService: LlmService) => llmService.getModel(),
            inject: [LlmService],
        }
    ],
    exports:[CHAT_MODEL]
})
export class ToolModule { } 
