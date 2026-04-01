import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID } from 'node:crypto';
import { OnEvent } from '@nestjs/event-emitter';
import { AI_TTS_STREAM_EVENT, type AiTtsStreamEvent } from '../common/stream-events';
import WebSocket from 'ws';
import { ses } from 'tencentcloud-sdk-nodejs';

// 客户端会话类型：管理客户端与腾讯云 TTS 之间的连接状态
type ClientSession = {
    // 唯一会话标识符
    sessionId: string;
    // 客户端 WebSocket 连接
    clientWs: WebSocket;
    // 腾讯云 TTS WebSocket 连接（可选，按需创建）
    tencentWs?: WebSocket;
    // 腾讯云连接是否就绪（收到 ready 信号）
    ready: boolean;
    // 待处理的文本块队列（腾讯云未就绪时暂存）
    pendingChunks: string[];
    // 会话是否已关闭
    closed: boolean;
}

@Injectable()
export class TtsRelayService implements OnModuleDestroy {
    private readonly logger = new Logger(TtsRelayService.name);
    // 存储所有活跃的客户端会话
    private readonly sessions = new Map<string, ClientSession>();
    // 腾讯云 API 凭证
    private readonly secretId: string;
    private readonly secretKey: string;
    // 腾讯云应用 ID
    private readonly appId: number;
    // TTS 音色类型（默认 101001）
    private readonly voiceType: number;

    constructor(@Inject(ConfigService) configService: ConfigService) {
        this.secretId = configService.get<string>('TENCENT_CLOUD_SECRET_ID') ?? '';
        this.secretKey = configService.get<string>('TENCENT_CLOUD_SECRET_KEY') ?? '';
        this.appId = Number(configService.get<string>('TENCENT_CLOUD_APP_ID') ?? 0);
        this.voiceType = Number(configService.get<string>('TENCENT_CLOUD_SECRET_ID') ?? 101001);
    }

    // 模块销毁时关闭所有会话
    onModuleDestroy() {
        for (const session of this.sessions.values()) {
            this.closeSession(session.sessionId, 'module destroy')
        }
    }

    /**
     * 注册新的客户端连接
     * @param clientWs 客户端 WebSocket 连接
     * @param wantedSessionId 可选的指定会话 ID
     * @returns 创建的会话 ID
     */
    registerClient(clientWs: WebSocket, wantedSessionId?: string): string {
        const sessionId = wantedSessionId?.trim() || randomUUID();
        const existing = this.sessions.get(sessionId);
        // 如果会话已存在，先关闭旧连接
        if (existing) {
            this.closeSession(sessionId, "client reconnected'")
        }
        // 创建新会话
        this.sessions.set(sessionId, {
            sessionId,
            clientWs,
            ready: false,
            pendingChunks: [],
            closed: false
        });
        // 通知客户端会话 ID
        this.sendClientJson(clientWs, { type: 'session', sessionId });
        this.logger.log(`TTS session created: ${sessionId}`)
        return sessionId;
    }

    /**
     * 注销客户端连接（客户端断开时调用）
     */
    unregisterClient(sessionId: string): void {
        this.closeSession(sessionId, "client disconnected")
    }

    /**
     * 处理 AI 流式事件（文字转语音的入口）
     * 监听 AI 回复的文本流，实时转发到腾讯云 TTS 生成音频
     */
    @OnEvent(AI_TTS_STREAM_EVENT)
    handleAiStreamEvent(event: AiTtsStreamEvent): void {
        const session = this.sessions.get(event.sessionId)
        if (!session) return;

        switch (event.type) {
            // AI 开始回复
            case 'start': {
                // 确保腾讯云连接已建立
                this.ensureTencentConnection(session);
                // 通知客户端 TTS 已开始
                this.sendClientJson(session.clientWs, {
                    type: 'tts_started',
                    sessionId: session.sessionId,
                    query: event.query
                });
                break;
            }
            // AI 回复的文本块
            case 'chunk': {
                const chunk = event.chunk?.trim();
                if (!chunk) return;
                // 如果腾讯云连接未就绪，暂存到队列
                if (!session.ready || !session.tencentWs || session.tencentWs.readyState !== WebSocket.OPEN) {
                    session.pendingChunks.push(chunk);
                    return;
                }
                // 发送文本块到腾讯云进行语音合成
                this.sendTencentChunk(session, chunk);
                break;
            }
            // AI 回复结束
            case 'end': {
                // 发送所有待处理的文本块
                this.flushPendingChunks(session);
                // 通知腾讯云 TTS 任务完成
                if (session.tencentWs && session.tencentWs.readyState === WebSocket.OPEN) {
                    session.tencentWs.send(
                        JSON.stringify({
                            session_id: session.sessionId,
                            action: 'ACTION_COMPLETE',
                        }),
                    );
                }
                break;
            }
            // AI 流错误
            case 'error': {
                this.sendClientJson(session.clientWs, {
                    type: 'tts_error',
                    message: event.error,
                });
                this.closeSession(session.sessionId, 'ai stream error');
                break;
            }
        }
    }

    /**
     * 确保腾讯云 TTS WebSocket 连接已建立
     * 如果连接不存在或已关闭，则创建新连接
     */
    private ensureTencentConnection(session: ClientSession): void {
        // 如果连接已存在且未关闭，直接返回
        if (session.tencentWs && session.tencentWs.readyState <= WebSocket.OPEN) {
            return;
        }
        // 检查凭证是否完整
        if (!this.secretId || !this.secretKey || !this.appId) {
            this.sendClientJson(session.clientWs, {
                type: 'tts_error',
                message: 'TTS 凭证缺失，请检查 SECRET_ID/SECRET_KEY/APP_ID',
            });
            return;
        }

        // 构建腾讯云 TTS WebSocket URL（包含签名）
        const url = this.buildTencentTtsWsUrl(session.sessionId);
        const tencentWs = new WebSocket(url);
        session.tencentWs = tencentWs;
        session.ready = false;

        // 连接打开
        tencentWs.on('open', () => {
            this.logger.log(`Tencent TTS ws opened: ${session.sessionId}`);
        });

        // 接收腾讯云的消息
        tencentWs.on('message', (data, isBinary) => {
            if (session.closed) return;
            // 二进制数据：音频流，直接转发给客户端
            if (isBinary) {
                if (session.clientWs.readyState === WebSocket.OPEN) {
                    session.clientWs.send(data, { binary: true });
                }
                return;
            }

            // JSON 消息：控制信号
            const raw = data.toString();
            let msg: Record<string, unknown> | undefined;
            try {
                msg = JSON.parse(raw) as Record<string, unknown>;
            } catch {
                return;
            }

            // ready 信号：腾讯云已准备好接收文本
            if (Number(msg.ready) === 1) {
                session.ready = true;
                // 发送所有待处理的文本块
                this.flushPendingChunks(session);
            }

            // 错误信号
            if (Number(msg.code) && Number(msg.code) !== 0) {
                this.sendClientJson(session.clientWs, {
                    type: 'tts_error',
                    message: String(msg.message ?? 'Tencent TTS error'),
                    code: Number(msg.code),
                });
                this.closeSession(session.sessionId, 'tencent error');
                return;
            }

            // final 信号：TTS 完成
            if (Number(msg.final) === 1) {
                this.sendClientJson(session.clientWs, { type: 'tts_final' });
            }
        });

        // 错误处理
        tencentWs.on('error', (error) => {
            this.sendClientJson(session.clientWs, {
                type: 'tts_error',
                message: `Tencent ws error: ${error.message}`,
            });
        });

        // 连接关闭
        tencentWs.on('close', () => {
            session.tencentWs = undefined;
            session.ready = false;
        });
    }

    /**
     * 发送所有待处理的文本块（腾讯云连接就绪后调用）
     */
    private flushPendingChunks(session: ClientSession): void {
        if (!session.ready || !session.tencentWs || session.tencentWs.readyState !== WebSocket.OPEN) {
            return;
        }
        while (session.pendingChunks.length > 0) {
            const chunk = session.pendingChunks.shift();
            if (!chunk) continue;
            this.sendTencentChunk(session, chunk);
        }
    }

    /**
     * 发送单个文本块到腾讯云进行语音合成
     */
    private sendTencentChunk(session: ClientSession, text: string): void {
        if (!session.tencentWs || session.tencentWs.readyState !== WebSocket.OPEN) {
            session.pendingChunks.push(text);
            return;
        }

        session.tencentWs.send(
            JSON.stringify({
                session_id: session.sessionId,
                message_id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                action: 'ACTION_SYNTHESIS',  // 语音合成动作
                data: text,
            }),
        );
    }

    /**
     * 关闭会话，清理所有连接
     */
    private closeSession(sessionId: string, reason: string): void {
        const session = this.sessions.get(sessionId);
        if (!session) return;
        session.closed = true;

        // 关闭腾讯云连接
        if (session.tencentWs && session.tencentWs.readyState < WebSocket.CLOSING) {
            session.tencentWs.close();
        }
        // 关闭客户端连接
        if (session.clientWs.readyState < WebSocket.CLOSING) {
            this.sendClientJson(session.clientWs, { type: 'tts_closed', reason });
            session.clientWs.close();
        }
        this.sessions.delete(sessionId);
        this.logger.log(`TTS session closed: ${sessionId}, reason: ${reason}`);
    }

    /**
     * 向客户端发送 JSON 消息
     */
    private sendClientJson(clientWs: WebSocket, payload: Record<string, unknown>): void {
        if (clientWs.readyState !== WebSocket.OPEN) return;
        clientWs.send(JSON.stringify(payload));
    }
    
    /**
     * 构建腾讯云 TTS WebSocket URL（包含签名认证）
     * 使用 HMAC-SHA1 签名确保请求安全
     */
    private buildTencentTtsWsUrl(sessionId: string): string {
        const now = Math.floor(Date.now() / 1000);
        // 构建签名参数字典
        const params: Record<string, string | number> = {
            Action: 'TextToStreamAudioWSv2',
            AppId: this.appId,
            Codec: 'mp3',           // 音频编码格式
            Expired: now + 3600,    // 过期时间（1小时）
            SampleRate: 16000,      // 采样率
            SecretId: this.secretId,
            SessionId: sessionId,
            Speed: 0,               // 语速
            Timestamp: now,
            VoiceType: this.voiceType,  // 音色
            Volume: 5,              // 音量
        };

        // 构建待签名字符串：参数按字母排序后拼接
        const signStr = Object.keys(params)
            .sort()
            .map((k) => `${k}=${params[k]}`)
            .join('&');
        // 原始签名串：GET + 域名 + 路径 + 参数
        const rawStr = `GETtts.cloud.tencent.com/stream_wsv2?${signStr}`;
        // HMAC-SHA1 签名
        const signature = createHmac('sha1', this.secretKey).update(rawStr).digest('base64');
        // 构建最终 URL
        const searchParams = new URLSearchParams({
            ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
            Signature: signature,
        });

        return `wss://tts.cloud.tencent.com/stream_wsv2?${searchParams.toString()}`;
    }
}
