import { Inject, Injectable } from '@nestjs/common';
import { ASR_CLIENT } from 'src/constant';
import type * as tencentcloud from 'tencentcloud-sdk-nodejs';

// 上传音频文件的类型定义
type UploadedAudio = {
  // 音频文件的二进制数据
  buffer: Buffer;
  // 原始文件名
  originalname: string;
  // 文件的 MIME 类型（如 'audio/ogg'）
  mimetype: string;
  // 文件大小（字节）
  size: number;
};

// ASR 客户端类型：腾讯云 ASR v20190614 版本的 Client 实例类型
type AsrClient = InstanceType<typeof tencentcloud.asr.v20190614.Client>;

@Injectable()
export class SpeechService {
    constructor(
        // 注入腾讯云 ASR 客户端实例
        @Inject(ASR_CLIENT) private readonly asrClient: AsrClient
    ) {}

    /**
     * 通过句子识别音频文件中的语音内容
     * 使用腾讯云的 SentenceRecognition API 进行语音识别
     * @param file 上传的音频文件
     * @returns 识别出的文本内容
     */
    async recognizeBySentence(file: UploadedAudio): Promise<string> {
        // 将音频文件的 Buffer 转换为 Base64 编码字符串
        const audioBase64 = file.buffer.toString('base64');

        // 调用腾讯云 ASR 的句子识别接口
        const result = await this.asrClient.SentenceRecognition({
            // 引擎模型：16k_zh 表示 16kHz 采样率的中文普通话模型
            EngSerViceType: '16k_zh',
            // 数据来源：1 表示音频数据以 Base64 编码形式上传
            SourceType: 1,
            // 音频数据的 Base64 编码
            Data: audioBase64,
            // 音频数据的长度（字节）
            DataLen: file.buffer.length,
            // 音频格式：ogg-opus 编码格式
            VoiceFormat: 'ogg-opus'
        });

        // 返回识别结果，如果结果为空则返回空字符串
        return result.Result ?? '';
    }
}
