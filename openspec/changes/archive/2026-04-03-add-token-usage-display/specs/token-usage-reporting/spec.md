## 新增需求

### 需求:token-usage-reporting

系统必须在每次 AI 回复完成后，通过 SSE 事件流发送 token 用量信息，包含输入 token 数和输出 token 数。

#### 场景:成功发送用量事件

- **当** AI 回复流式输出完成
- **那么** 系统计算输入 token（完整 prompt 文本）和输出 token（AI 回复全文）
- **那么** 系统通过 SSE 发送 `type: "usage"` 事件，数据为 JSON：`{"inputTokens": N, "outputTokens": M}`

#### 场景:无回复时不发送用量

- **当** AI 回复为空字符串（无任何 chunk 输出）
- **那么** 系统不发送 usage 事件

#### 场景:token 计算失败不阻断响应

- **当** token 编码器初始化或计算过程抛出异常
- **那么** 系统记录错误日志
- **那么** 系统不发送 usage 事件，不阻断 SSE 流

### 需求:token-usage-display

前端必须在每条 AI 回复的消息 meta 区域显示 token 用量信息。

#### 场景:显示用量信息

- **当** 前端收到 `type: "usage"` 的 SSE 事件
- **那么** 前端在当前 AI 回复气泡的 meta 区域追加显示 "输入: N · 输出: M"

#### 场景:未收到用量事件不影响显示

- **当** SSE 流结束但未收到 usage 事件（如旧版后端或计算失败）
- **那么** 前端正常显示"AI 回复完成"和时间戳
- **那么** 不显示 token 用量信息
