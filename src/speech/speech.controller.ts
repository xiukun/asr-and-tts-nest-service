import {
    BadRequestException,
    Controller,
    Post,
    UploadedFile,
    UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SpeechService } from './speech.service';

// 语音识别控制器，处理音频上传和识别请求
@Controller('speech')
export class SpeechController { 
    constructor(private readonly speechService: SpeechService) {}

    /**
     * 语音识别接口 - 将上传的音频文件转换为文本
     * @route POST /speech/asr
     * @description 接收 multipart/form-data 格式的音频文件，调用腾讯云 ASR 服务进行语音识别
     * 
     * @param file 上传的音频文件（通过 'audio' 字段）
     * @returns 识别出的文本内容
     * @throws BadRequestException 如果未上传音频文件或文件为空
     */
    @Post('asr')
    @UseInterceptors(FileInterceptor('audio')) // 拦截 multipart/form-data 请求，提取 'audio' 字段， 然后通过 @UploadedFile 取出来作为参数传入 handler
    async recognize(@UploadedFile() file?: {
        buffer: Buffer;          // 音频文件的二进制数据
        originalname: string;    // 原始文件名
        mimetype: string;        // 文件 MIME 类型
        size: number;            // 文件大小（字节）
    }) {
        // 验证文件是否存在且包含有效数据
        if(!file?.buffer?.length) {
            throw new BadRequestException(`请通过 FormData 的 audio 字段上传音频文件`)
        }
        
        // 调用语音识别服务，将音频转换为文本
        const text = await this.speechService.recognizeBySentence(file);
        
        // 返回识别结果
        return { text };
    }
}
