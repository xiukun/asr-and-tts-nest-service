import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AiModule } from './ai/ai.module';
import { ToolModule } from './tool/tool.module';
import { ConfigModule } from '@nestjs/config';
import { SpeechModule } from './speech/speech.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { EventEmitterModule } from '@nestjs/event-emitter';

@Module({
  imports: [AiModule, ConfigModule.forRoot({
    isGlobal: true, envFilePath: '.env'
  }),
  EventEmitterModule.forRoot({
    maxListeners:200
  }),
  ServeStaticModule.forRoot({
    rootPath: join(process.cwd(), 'public'),
  })
  , SpeechModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
