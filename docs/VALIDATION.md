# 验证记录

2026-10-29，公开源码包本地验证。环境：macOS、Python 3.14.7、Node.js 24.16.0、npm 11.17.0。其他操作系统与版本尚未在本次验证中覆盖。

## 已验证

| 范围 | 命令或方式 | 结果 |
|---|---|---|
| 构建依赖 | `npm ci --prefix tools/vendor --ignore-scripts --no-audit --no-fund` | 安装成功 |
| live 静态构建 | `python3 tools/build-delivery.py --live --output site` | 成功；包含五份部署政策模板；真实数据和演示记录不进入运行包 |
| XSS 静态检查 | `python3 tools/lint-xss.py` | 0 条命中 |
| 设计令牌检查 | `python3 tools/lint-tokens.py --strict` | 0 条命中 |
| 业务模块 | `cd server && python3 -m unittest discover -s modules -t .` | 执行 620 项；初次 619 项通过，1 项因缺少文库示例文件失败 |
| 文库补齐复验 | `python3 -m unittest modules.library.tests.test_library.LibraryTest.test_lib1_javascript_samples_are_mapped_and_imported` | 补齐可公开的合成示例后，该项通过；未声称重新执行整套 620 项 |
| 新库初始化 | 独立临时目录中执行 `python3 -m app migrate` 与 `python3 -m app issue-invite` | 均返回 0；没有使用真实业务库 |
| 文档 | README / 待办写作检查、公开文档相对链接检查 | 通过 |
| 封面 | 查看生成图片并核对标题 | 中文与英文标题正确；原图 1672 × 941 PNG，发布版为像素一致的无损 WebP |

## 2026-11-07 补充：X-GATE 入口、种子数据与开发脚本

| 范围 | 命令或方式 | 结果 |
|---|---|---|
| live 静态构建（含 X-GATE） | `python3 tools/build-delivery.py --live --output <新空目录>` | 成功；X-GATE 单独打包到 `x-gate/`，无内联脚本，示例指纹检查通过 |
| X-GATE 构建与种子数据 | `cd server && python3 -m unittest tests.test_xgate_build tests.test_seed_demo` | 通过 |
| X-GATE 前端 | `node --test preview/x-gate/tests/`；`node --import ./preview/x-gate/tools/register.mjs preview/x-gate/tools/check-all.mjs` | 52 项通过；五座楼高低两档几何与预算检查通过 |
| 业务模块 | `cd server && python3 -m unittest discover -s modules -t .` | 620 项通过 |
| 静态检查 | `lint-xss.py`、`lint-tokens.py --strict`、`check-public.py` | 0 条命中；公开清单检查通过 |
| 本机开发脚本 | `PORT=8734 tools/dev.sh` | 建环境、构建、迁移、签发邀请码并启动；`/api/health` 正常 |
| 浏览器冒烟 | 新库执行 `seed-demo` 后启动服务，在 1440×900 与 390×844 下以访客与虚构管理员分别打开社区首页与 `/x-gate/` 五座楼工作台 | 访客只见 3D 世界与登录提示；登录后各楼显示真实接口数据；无页面脚本错误 |

GitHub 上的 CI 工作流尚未运行；本次未覆盖真实手机、辅助技术与生产 CSP 实机。

## 仍未通过的历史回归

`cd server && python3 -m unittest discover -s tests -t .` 执行 829 项，报告 28 个失败、5 个错误、2 个跳过。补齐公开示例、环境变量文档和撤回重放入口后，对原失败用例定向复验 32 项，剩余 17 个失败、2 个错误（含子测试计数）。

剩余问题涉及未随公共版本发布的旧版源码基线、历史素材副本、法律审阅映射，以及将内部审核文案改成运营方模板后的字面断言。原测试与断言保留，未通过跳过或放宽断言处理。需要把这些回归迁移为独立、可公开的测试夹具，详见 [待办事项](../TODO.md)。

本次没有证明全套测试通过。

## 尚未验证

- 公开源码包的完整浏览器、真实手机与辅助技术流程。
- 注册、TOTP、上传、管理员审核在新浏览器中的完整往返。
- Linux / systemd / Caddy 实装、正式域名、HTTPS、内容域隔离与生产恢复。
- LiveKit 真设备音视频及真实模型服务。
- 支付、结算、退款和分账。

这些事项应完成后再评估对真实用户开放。
