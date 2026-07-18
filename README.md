# 方寸工具箱同步感知 - EdgeOne Makers

这是方寸工具箱同步感知的腾讯 EdgeOne Makers 免费版部署方案。推荐使用 Cloud Functions + Blob 的强一致组合：

- Cloud Functions 负责处理带签名的 HTTP 请求。
- Blob 用来保存短期事件索引和事件对象。
- 插件默认使用自适应 HTTP 轮询。
- 在 EdgeOne 免费版下，不把常驻 WebSocket 作为默认方案。

## 部署

1. 创建一个 EdgeOne Makers 项目。
2. 启用 Blob 存储，并创建名为 `fangcun-sync-aware` 的存储。
3. 配置环境变量：

```text
SYNC_AWARE_SECRET=replace-with-a-long-random-secret
BLOB_STORE_NAME=fangcun-sync-aware
RETENTION_MS=259200000
MAX_EVENTS_PER_CHANNEL=500
```

4. 使用 EdgeOne CLI 部署这个目录，或者把它接入 Git 仓库。
5. 将 Cloud Function 路由映射到 `/sync/v1/*`。

然后把你的部署域名填到方寸工具箱里，例如：

```text
https://your-project.edgeone.app
```

## 免费版策略

插件默认配置对 EdgeOne Makers 的免费资源比较友好：

- 前台轮询：10-15 秒。
- 空闲轮询：30-60 秒。
- 不使用 KV 作为主存储，因为 KV 在各节点之间最终一致。
- 默认不启用常驻 WebSocket，因为 Cloud Function 的时长和内存时长额度都要考虑。

## 协议

- `POST /sync/v1/events`
- `GET /sync/v1/events?since=<cursor>&limit=50`
- `GET /sync/v1/health`

所有请求都由插件进行 HMAC 签名。中继只保存事件元数据，不接触 S3/WebDAV 凭据，也不接触笔记数据。
