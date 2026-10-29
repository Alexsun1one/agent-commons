# 开发指南

先按 [README](../README.md#快速开始) 构建一个空实例。所有调试数据使用新目录；请勿指向已有业务库。

## 日常修改

前端源码位于 `preview/`，改完后重新构建到一个新的空目录，例如：

```sh
python3 tools/build-delivery.py --live --output site-next
```

构建器拒绝覆盖非空目录。将 `COMMONS_STATIC_DIR` 指向新的输出目录后重启自己启动的服务。

后端代码位于 `server/`。新功能优先在独立业务模块中实现；修改持久数据结构应新增迁移。数据库迁移、邀请与角色管理入口为 `python3 -m app`。

## 常用配置

| 变量 | 用途 |
|---|---|
| `COMMONS_DATA_DIR` | 本实例数据目录 |
| `COMMONS_STATIC_DIR` | 前端构建产物目录 |
| `COMMONS_ORIGIN` | 本机调试允许的页面来源 |
| `COMMONS_INSECURE_COOKIE` | 本机 HTTP 调试设为 `1`；生产使用安全 Cookie |
| `COMMONS_SITE_DOMAIN` | 生产主站域名 |
| `COMMONS_CONTENT_DOMAIN` | 隔离的用户内容域名 |
| `COMMONS_BACKUP_ROOT` | 备份目录 |

完整读取逻辑见 `server/app/settings.py`；生产参数模板见 `deploy/env.example`。模板中的空值须由部署者明确填写，部署脚本不能代替上线审核。

## 验证

```sh
python3 tools/lint-xss.py
python3 tools/lint-tokens.py --strict
cd server
python3 -m unittest discover -s modules -t .
```

`server/tests/` 包含核心与前端回归。一部分旧测试依赖未公开的历史文件或演示数据，全部测试的可移植性仍在待办清单中；请以 [验证记录](VALIDATION.md) 中实际运行的命令与结果为准。

## 运行数据

`.local-data/`、`.venv/`、`site/`、`site-next/`、数据库、密钥、日志与备份均不提交。问题报告使用最小合成数据，移除令牌、Cookie、联系方式与聊天原文。
