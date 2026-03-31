import { Controller, Query, Sse } from '@nestjs/common';
import { from, map, Observable } from'rxjs';
import { AiService } from'./ai.service';
@Controller('ai')
export class AiController {
    constructor(private readonly aiService:AiService){
        
    }
    @Sse('chat/stream')
    chatStream(@Query('query') query:string):Observable<{data:string}> {
        return from(this.aiService.streamChain(query)).pipe(map((chunk)=>({data:chunk})))
    }
}