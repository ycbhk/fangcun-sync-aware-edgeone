# Fangcun Sync Awareness - EdgeOne Makers

This deploys the relay on Tencent EdgeOne Makers free resources. The recommended shape is Cloud Functions + Blob strong consistency:

- Cloud Functions handle signed HTTP requests.
- Blob stores a short event index and event objects.
- The plugin uses adaptive HTTP polling.
- Persistent WebSocket is intentionally not the default on EdgeOne free tier.

## Deploy

1. Create an EdgeOne Makers project.
2. Enable Blob storage and create a store named `fangcun-sync-aware`.
3. Configure environment variables:

```text
SYNC_AWARE_SECRET=replace-with-a-long-random-secret
BLOB_STORE_NAME=fangcun-sync-aware
RETENTION_MS=259200000
MAX_EVENTS_PER_CHANNEL=500
```

4. Deploy this directory with EdgeOne CLI or connect it to a Git repository.
5. Map the Cloud Function route to `/sync/v1/*`.

Use your deployed domain as the endpoint in Fangcun Toolbox, for example:

```text
https://your-project.edgeone.app
```

## Free-tier Strategy

The plugin default is friendly to EdgeOne Makers free resources:

- Foreground polling: 10-15 seconds.
- Idle polling: 30-60 seconds.
- No KV primary store, because KV is eventually consistent across nodes.
- No persistent WebSocket by default, because Cloud Function duration and memory-duration quotas matter.

## Protocol

- `POST /sync/v1/events`
- `GET /sync/v1/events?since=<cursor>&limit=50`
- `GET /sync/v1/health`

All requests are HMAC-signed by the plugin. The relay only stores event metadata and never sees S3/WebDAV credentials or note data.
