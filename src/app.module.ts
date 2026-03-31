import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AiModule } from './ai/ai.module';
import { ToolModule } from './tool/tool.module';
import { ConfigModule } from '@nestjs/config';
import { SpeechModule } from './speech/speech.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

@Module({
  imports: [AiModule, ConfigModule.forRoot({
    isGlobal: true, envFilePath: '.env'
  }),
  ServeStaticModule.forRoot({
    rootPath: join(__dirname, '..', 'client'),
  })
  , SpeechModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
