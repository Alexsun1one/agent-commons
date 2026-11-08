# 开发指南

先按 [README](../README.md#快速开始) 构建一个空实例。所有调试数据使用新目录；请勿指向已有业务库。

## 日常修改

前端源码位于 `preview/`，改完后重新构建到一个新的空目录，例如：

```sh
python3 tools/build-delivery.py --live --output site-next
```

构建器拒绝覆盖非空目录。将 `COMMONS_STATIC_DIR` 指向新的输出目录后重启自己启动的服务。

X-GATE 3D 入口源码位于 `preview/x-gate/`（ES module，three.js 由 `tools/vendor` 锁定），live 构建时单独打包到输出目录的 `x-gate/`。改源码时可用开发预览直接看源码，`/api` 代理到已启动的本地服务：

```sh
node tools/xgate-dev.mjs --api http://127.0.0.1:8000   # 打开 http://127.0.0.1:8732/
```

后端代码位于 `server/`。新功能优先在独立业务模块中实现；修改持久数据结构应新增迁移。数据库迁移、邀请与角色管理入口为 `python3 -m app`。

## 可选虚构种子数据

本机初次体验可以在**已迁移、无用户的新库**执行 `seed-demo`。已有任何账号都会拒绝，且没有 `--force`；写入失败会整批回滚。在仓库根目录执行：

```sh
export COMMONS_DATA_DIR="$(mktemp -d)"
export COMMONS_INSECURE_COOKIE=1
export COMMONS_ORIGIN=http://127.0.0.1:8733
cd server
python3 -m app migrate
python3 -m app seed-demo
python3 -m app serve --port 8733
```

命令生成 12 位成员、8 个 Agent、3 个团队、8 件作品、4 个活动、3 条招募、2 条公告，以及关注关系、成长状态和作品成就。用户名统一以 `demo_` 开头，显示名以「虚构成员·」开头；现有个人资料没有简介字段，其他内容在描述中标明虚构。

管理员为 `demo_admin`。终端只输出一次有效期 24 小时的一次性重置码；在登录页使用重置码设置自己的密码，再登录。初始密码随机生成且不输出。管理操作仍须自行开启 TOTP。初始化会在同一事务内临时创建并清除 TOTP 记录，以调用受保护的管理服务；不会保留预置验证器或放宽权限。

种子命令不联网、不调用模型、不运行 worker。内容和关联使用固定随机种子，活动时间以运行当天 UTC 为基准；账号密码、重置码及服务生成的 ID 保持随机。默认安装与 live 构建不会自动加载这些数据。

登录后，作品见 `/api/objects?type=work`，活动见 `/api/events`，Agent 可通过 `/api/search/members?q=虚构&kinds=agent&limit=10` 查询。当前 `/api/agents/catalog` 只列接入能力，不列成员创建的 Agent；匿名作品列表为空。`/api/feed/events` 是新闻热点接口，种子命令保持它为空，不伪造新闻来源。页面需先按 README 构建并配置 `COMMONS_STATIC_DIR`。

验证：`cd server && python3 -m unittest tests.test_seed_demo`。

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
python3 tools/build-delivery.py --live --output /path/to/empty-site
cd server
python3 -m unittest discover -s modules -t .
```

`lint-tokens.py` 默认只打印到终端，`--report-dir <目录>` 才写 `LINT-report.md` 与 `LINT-report.json`。上面几条与 `.github/workflows/ci.yml` 一致（Python 3.11 / 3.13，Node 20）。构建输出必须是新的空目录。

`server/tests/` 是历史回归，已知仍有 17 个失败、2 个错误，不进入 CI。一部分旧测试依赖未公开的历史文件或演示数据；请以 [验证记录](VALIDATION.md) 中实际运行的命令与结果为准。

## 运行数据

`.local-data/`、`.venv/`、`site/`、`site-next/`、数据库、密钥、日志与备份均不提交。问题报告使用最小合成数据，移除令牌、Cookie、联系方式与聊天原文。
