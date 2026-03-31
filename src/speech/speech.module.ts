import { Module } from '@nestjs/common';
import { SpeechService } from './speech.service';
import { SpeechController } from './speech.controller';
import * as tencentcloud from 'tencentcloud-sdk-nodejs';
import { ASR_CLIENT } from 'src/constant';
import { ConfigService } from '@nestjs/config';
const AsrClient = tencentcloud.asr.v20190614.Client;
@Module({
  providers: [SpeechService,
    {
      provide: ASR_CLIENT,
      useFactory: (configService: ConfigService) => {
        return new AsrClient({
          credential: {
            secretId: configService.get('TENCENT_CLOUD_SECRET_ID'),
            secretKey: configService.get('TENCENT_CLOUD_SECRET_KEY')
          },
          region: 'ap-shanghai',
          profile: {
            httpProfile: {
              reqMethod: 'POST',
              reqTimeout: 30,
            }
          }
        })
      },
      inject: [ConfigService]
    }
  ],
  controllers: [SpeechController]
})

export class SpeechModule { }
