import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { TtsRelayService } from './speech/tts-relay.service';
import {WebSocketServer} from 'ws';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const ttsRelayService = app.get(TtsRelayService);
  const server = app.getHttpServer();
  const ttsWss = new WebSocketServer({
    server,path:'/speech/tts/ws'
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
