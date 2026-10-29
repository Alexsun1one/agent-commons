# 后端开发

FastAPI + SQLite 模块化单体。先按根目录 [README](../README.md#快速开始) 初始化独立实例。

## 配置

| 变量 | 默认 | 用途 |
|---|---|---|
| `COMMONS_DATA_DIR` | `data` | 其他路径的默认父目录 |
| `COMMONS_DB_PATH` | `$DATA/commons.db` | SQLite 主库 |
| `COMMONS_WITHDRAWAL_LOG` | `$DATA/withdrawals.jsonl` | 只追加的撤回日志（应放在独立盘） |
| `COMMONS_BACKUP_ROOT` | `$DATA/backups` | 迁移前自动备份写到 `$COMMONS_BACKUP_ROOT/pre-migrate/` |
| `COMMONS_STORAGE_DIR` | `$DATA/files` | 文件存储根目录 |
| `COMMONS_SECRET_FILE` | `$DATA/server-secret` | 游标签名密钥；不存在时自动生成（权限 0600） |
| `COMMONS_SITE_DOMAIN` | 空 | 主站域名，得出 `https://<域名>` 作为唯一允许的 Origin |
| `COMMONS_CONTENT_DOMAIN` | 空 | 用户内容域名，`storage.content_url()` 用 |
| `COMMONS_ORIGIN` | `http://127.0.0.1:8000` | 覆盖完整 Origin（本机调试用） |
| `COMMONS_INSECURE_COOKIE` | 空 | 设为 `1` 时 Cookie 去掉 Secure，并把名字从 `__Host-sid` 换成 `commons_sid`；只在本机 http 用 |
| `COMMONS_STATIC_DIR` | 空 | 本机调试时由 FastAPI 顺带提供前端静态文件；线上由 Caddy 提供 |
| `COMMONS_API_PORT` | `8000` | 只给 `python3 -m app serve` 用 |
| `COMMONS_LIVEKIT_API_KEY` | 空 | LiveKit API key；空时站内房间能力关闭 |
| `COMMONS_LIVEKIT_API_SECRET_FILE` | 空 | LiveKit secret 文件路径；内容至少 32 字节，只从文件读取 |
| `COMMONS_LIVEKIT_WS_URL` | `wss://<主站域名>` | LiveKit 客户端 WebSocket 地址 |
| `COMMONS_LIVEKIT_API_URL` | `http://127.0.0.1:7880` | LiveKit 本机 HTTP API 地址 |

## 后台处理与恢复

`python3 -m app.worker` 处理 outbox 和周期任务。备份恢复后，使用 `python3 bin/replay-withdrawals --database PATH --log PATH --fail-on-gap` 重放撤回日志，验证断档会拒绝重放。恢复流程应先在隔离环境演练。

## 测试

在本目录运行 `python3 -m unittest discover -s modules -t .`。核心与历史前端回归位于 `tests/`，当前公开包的执行范围和缺口见 [验证记录](../docs/VALIDATION.md)。
