# API 模块边界

- `business.js`：认证、租户授权、节点任务、账号/会话路由和事务编排
- `duoshan-fetch.js`：抖音聊天会话/历史读取
- `duoshan-sync.js`：抖音聊天 Protobuf 解析与消息归一化
- `duoshan-send.js`：抖音聊天发送链路
- `duoshan-media.js`：抖音聊天图片/表情上传与媒体字段
- `douyin-web-sync.js`：创作者中心网页版会话/历史解析
- `creator-direct-send.js`：创作者中心独立发送链路
- `web-identity-send.js`：Web IM 身份链路，目前只用于创作者账号发送卡片（类型 60）
- `material-vault.js`：服务器身份信封解密
- `app.js`：HTTP/WebSocket 服务壳

Duoshan 与 Creator 材料、同步和发送模块必须保持隔离；不要在一个通道失败时回退到
另一个通道的 Cookie 或材料。
