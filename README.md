<p align="center"><img src="docs/assets/hero.png" alt="智能体先锋队：蓝围巾熊猫伙伴一起学习、制作与协作" width="100%"></p>

<h1 align="center">智能体先锋队 · Agent Commons</h1>
<p align="center">让一个问题找到回应，让一次尝试成为作品，让一群人开始共作。</p>
<p align="center"><a href="#快速开始">快速开始</a> · <a href="TODO.md">待办事项</a> · <a href="docs/ARCHITECTURE.md">架构</a> · <a href="CONTRIBUTING.md">参与贡献</a> · <a href="LICENSE">AGPL-3.0</a></p>

Agent Commons 是面向 AI 学习者、创作者与社区组织者的中文社区软件。成员可以分享问题和作品、整理可复用的方法、找搭子、组织共学；社区管理者可以处理邀请、权限、举报和内容治理。

项目将讨论、知识、作品与成员关系放在同一个工作空间里。一个问题可以接着形成解法，解法可以进入文库，作品和贡献又能成为下一次合作的起点。

**当前阶段：开发预览，可自行运行并参与开发。** 公开版本从空数据库开始，不附带真实成员、群聊、聊天统计或脱敏原话。生产部署、真实音视频与部分完整用户流程仍待验收，具体见 [待办事项](TODO.md)。

## 可以做什么

| 你想完成的事 | 对应能力 |
|---|---|
| 找到值得继续讨论的问题 | 热点、话题、讨论、问题库与知识关联 |
| 把经验变成别人能用的材料 | 富文本编辑、文库、作品展示、来源与版本 |
| 找到一起做事的人 | 成员主页、关注、小组、团队、搭子与私信 |
| 组织一次共学 | 活动、日历、讲堂、房间与协作白板 |
| 经营一个有边界的社区 | 邀请、等级与权限、通知、举报、治理与审计 |
| 让参与留下可见的反馈 | 贡献记录、成就、熊猫小窝与轻量互动 |

这些能力包含前后端实现，启用情况由服务端功能开关和权限共同决定。房间音视频需要另行配置 LiveKit；AI 功能需要运营方配置模型服务并明确内容使用范围。计费尚未开放。

## 快速开始

需要 Python 3.11+、Node.js 20+ 与 npm。以下命令从仓库根目录执行，数据库和文件存储都写入新建的 `.local-data/`。

```sh
git clone https://github.com/Alexsun1one/agent-commons.git
cd agent-commons
python3 -m venv .venv
. .venv/bin/activate
pip install -r server/requirements.txt -r requirements-build.txt
npm ci --prefix tools/vendor
python3 tools/build-delivery.py --live --output site
```

初始化本地服务：

```sh
export COMMONS_DATA_DIR="$PWD/.local-data"
export COMMONS_STATIC_DIR="$PWD/site"
export COMMONS_ORIGIN=http://127.0.0.1:8000
export COMMONS_INSECURE_COOKIE=1
cd server
python3 -m app migrate
python3 -m app issue-invite
python3 -m app serve --port 8000
```

打开 **http://127.0.0.1:8000**，使用刚生成的一次性邀请码注册。空白内容列表是新安装的正常状态。HTTP Cookie 配置仅适用于本机开发；上线时需要 HTTPS。

需要管理权限时，在保持上述环境变量的另一个终端进入 `server/`，执行：

```sh
python3 -m app grant-role <你的用户名> admin
```

管理员还须在账号安全设置中开启 TOTP，才能使用受保护的管理操作。已有账号后签发新邀请码需要 `--issuer <管理员用户名>`。通知等后台任务由独立 worker 处理：

```sh
python3 -m app.worker
```

配置项与本机操作见 [开发指南](docs/DEVELOPMENT.md)。生产部署前先核对 [上线待办](TODO.md#上线前必须完成)。

## 为什么这样组织

**内容有来路。** 问题、解法和作品保留来源与版本，让后来的人能判断适用条件，也能补充不同意见。

**权限由服务端判断。** 展示范围、成员能力、举报和审计进入后端模型。前端按钮状态帮助用户理解权限，实际请求仍经过服务端检查。

**本机可以开始。** 原生 JavaScript 前端、FastAPI 和 SQLite 组成模块化单体，便于阅读、调试和小规模自托管。新安装不需要真实社群资料。

**Agent 参与，人来确认。** AI 辅助整理与建议；身份、内容发布、治理裁定及合作承诺仍需相应的人类确认。

## 技术与目录

```text
preview/               前端源码、设计令牌与产品素材
server/app/            身份、会话、权限、对象、审计与事件基础层
server/modules/        内容、知识、社交、治理等业务模块
server/migrations/     数据库迁移
server/tests/          核心与集成测试
server/modules/*/tests 业务模块测试
engine/               热点处理与去标识基础工具
tools/                构建、依赖打包与静态检查
deploy/               Caddy、systemd、备份与恢复工具
docs/                 公开开发文档与部署政策模板
third_party/          第三方依赖许可全文
```

前端采用原生 JavaScript 和 CSS；后端采用 FastAPI、SQLite、模块迁移与 outbox。第三方编辑器、媒体播放器和音视频 SDK 的版本在锁文件中固定。详见 [架构说明](docs/ARCHITECTURE.md)。

## 状态与待办

开发优先级、验收标准与已知缺口集中维护在 **[TODO.md](TODO.md)**。当前优先完成：

- 全新安装、管理员审核与上传流程的浏览器验收。
- 生产域名、HTTPS、用户内容隔离、备份恢复和音视频实机验证。
- 运营主体、内容使用规则、数据保留期限和治理责任的确定。
- 隐私默认值、公开排名与通知规则的产品决策。

验证结果以 [验证记录](docs/VALIDATION.md) 为准。封面为 AI 生成的品牌插画；它展示项目形象，功能状态请查验证记录。

## 参与贡献

欢迎从一个可复现的问题、文档修正或独立的小改动开始。提交前阅读 [贡献指南](CONTRIBUTING.md)，说明改动解决的实际问题和验证方式。涉及安全问题，请按 [安全说明](SECURITY.md) 私下报告。

## 许可证

原创项目代码以 **GNU Affero General Public License v3.0 only（AGPL-3.0-only）** 发布，完整条款见 [LICENSE](LICENSE)。

AGPL 允许商用。分发修改版、或让用户通过网络与修改版交互时，须按许可证要求向相应用户提供对应源码并保留有关声明。网络交互义务见 [GNU AGPL 第 13 条](https://www.gnu.org/licenses/agpl-3.0.html#section13)。

第三方代码保留各自许可证，见 [第三方说明](THIRD_PARTY_NOTICES.md)。项目名称、标识与第三方商标不因此获得商标授权；社区成员上传的内容也不自动适用本仓库的软件许可。
