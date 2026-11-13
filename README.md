<div align="center">
  <p align="center">
    <img width="160" src="./apps/launcher-webview2/assets/logo-256.png" alt="抖音聚合 logo">
  </p>
  <p align="center">
    <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-22.5%2B-brightgreen" alt="Node.js 22.5+"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="AGPL-3.0"></a>
    <img src="https://img.shields.io/badge/launcher-Windows-lightgrey" alt="Launcher: Windows">
    <img src="https://img.shields.io/badge/server-Windows%20%7C%20Linux%20%7C%20Docker-lightgrey" alt="Server: Windows / Linux / Docker">
  </p>

  # 🎶 抖音聚合

  **多租户的抖音账号聚合管理系统：Windows 登录器负责登录，网页端统一收发私信、管理账号与网络出口**
</div>

**⚠️ 声明：本项目是非官方的第三方工具，与字节跳动、抖音没有任何关联。它调用的是平台未公开的网页接口，接口随时可能变化导致功能失效。请只用于你自己拥有或已获授权的账号，严禁用于发布不良信息、违法内容，并自行遵守平台服务条款与所在地法律法规。本项目按 AGPL-3.0「按现状」提供，不附带任何担保，使用后果自负。**

## 🌟 功能特性

- 👤 **多账号接入**
  - 两种登录方式：创作者中心、抖音聊天
  - 登录由 Windows 登录器在本机完成，账号材料加密后保存
  - 每个账号可单独绑定网络出口：直连、自定义代理、本机节点
- 💬 **聚合工作区**
  - 多账号的会话集中在一个网页里查看
  - 文本、图片、表情、卡片消息的发送，私聊与群聊
  - 会话与历史消息同步
- 🤖 **自动化**
  - 规则、回复、任务、模板管理
  - 可选的 AI 模型配置
- 🃏 **卡片**
  - 卡片管理与推广
- 🧾 **租户与计费**
  - 多租户隔离，点数与坑位管理
  - 超级管理员后台，操作有审计记录
- 🌐 **网络与代理**
  - 代理管理与连通性检测
  - 本机节点：由登录器所在的电脑作为账号的出口
- 🔒 **安全**
  - 账号材料用服务端私钥信封加密
  - 后台入口密钥保护管理接口

## 📦 项目组成

| 目录 | 说明 |
| --- | --- |
| `services/api` | 后端：Node.js + SQLite，同时托管网页与 WebSocket |
| `apps/web` | 网页前端：Vue 3 + Element Plus + Vite |
| `apps/launcher-webview2` | Windows 登录器：C# + Edge WebView2 轻量壳，负责登录与读取账号身份 |
| `packages/*` | 前后端共用的契约与 API 客户端 |
| `tools` | 本机一键启动、登录器构建脚本 |
| `deploy` | Linux 服务器一键部署脚本 |

后端模块边界见 [`services/api/src/README.md`](services/api/src/README.md)，登录器说明见 [`apps/launcher-webview2/README.md`](apps/launcher-webview2/README.md)。

## 🛠️ 快速开始

### ⛳ 运行环境

- Node.js **22.5 或更高**
- 登录器只能在 **Windows** 上构建和运行，需要 Python 3.8+ 与系统已安装的 Microsoft Edge WebView2 Runtime
- 后端可以跑在 Windows、Linux 或 Docker 里

### 🚀 本机启动

```bash
git clone <本仓库地址>
cd <仓库目录>
npm start
```

Windows 也可以双击 `start.bat`。首次运行会自动安装依赖、构建网页并启动后端，终端会打印：

```
网页：      http://127.0.0.1:18182/
管理后台：  http://127.0.0.1:18182/#admin-<入口密钥>
```

入口密钥在首次启动时随机生成，保存在数据目录的 `admin-entry.key` 中，之后复用。

### 🔑 首次创建管理员

1. 打开终端打印的「管理后台」完整地址（带 `#admin-` 入口密钥）。
2. 数据库里还没有管理员时，页面会显示「创建超级管理员」表单，填写用户名和密码即可。
3. 创建完成后，该接口会拒绝再次初始化。

仓库不预置任何默认账号或密码。

**入口密钥决定了谁能创建管理员。** 设置了 `DOUYINJUHE_ADMIN_ENTRY` 后，所有 `/api/v1/admin/*` 请求（包括创建管理员）都必须带这个密钥，否则返回 404。没有设置时，这些接口完全开放，**谁先访问谁就成为超级管理员**，而且网页上也打不开后台页（后台页只认 `#admin-<入口密钥>`）。所以部署到服务器时必须设置它，并在服务对外之前自己先完成创建。本机 `npm start` 和 `deploy/install.sh` 会自动生成，Docker 需要手动设置，见下文。

### 🖥️ 构建登录器

登录器是 Windows 程序，二进制不随仓库分发，需要自己构建：

```powershell
pip install pyinstaller cryptography
npm run build:launcher
```

产物在 `build/launcher/DouyinJuheLauncher.exe`。构建脚本会从微软官方 NuGet 下载 WebView2 的三个 DLL（固定版本并校验 SHA-256），用 PyInstaller 打包 `apps/launcher-webview2/native` 下的辅助程序，再用 .NET Framework 自带的 `csc.exe` 编译主程序。

后端的「下载登录器」默认托管这个路径，文件不存在时返回 404。产物放在别处时用 `DOUYINJUHE_LAUNCHER_FILE` 指定。

## ☁️ 部署

### Docker

Docker 不会自动生成入口密钥，**启动前必须先设置**（原因见上一节）：

```bash
cp .env.example .env
# 生成一个随机密钥，并写入 .env 里的 DOUYINJUHE_ADMIN_ENTRY（去掉该行开头的 #）
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
# 取消 docker-compose.yml 里 env_file 一行的注释，然后：
docker compose up -d --build
```

网页与 API 都在 `http://<服务器地址>:18182`，后台地址是 `http://<服务器地址>:18182/#admin-<入口密钥>`，数据保存在 `douyinjuhe-data` 卷里。默认会把 18182 端口发布到所有网卡，对外使用前请改成 `127.0.0.1:18182:18182` 并在前面加 HTTPS 反向代理。

这条路径已在 Docker 26 / Compose v2 上实测：镜像能构建，服务能启动，健康检查、网页托管和管理员创建都正常。

### Debian / Ubuntu（systemd）

```bash
sudo bash deploy/install.sh
```

脚本会安装 Node.js 22、创建专用用户、复制代码到 `/opt/douyinjuhe`、生成配置 `/etc/douyinjuhe/douyinjuhe.env`、注册 systemd 服务并打印访问地址。重复执行即为升级，配置与数据会保留。脚本依赖 `apt`，其他发行版请用 Docker 或手动部署。

脚本默认监听 `0.0.0.0` 且是明文 HTTP。**对外使用前请在前面加 HTTPS 反向代理**（例如 nginx），并把 `DOUYINJUHE_API_HOST` 改为 `127.0.0.1`，同时用 `DOUYINJUHE_WEB_ORIGINS` 写入你的域名。

## ⚙️ 配置

除 `DOUYINJUHE_ADMIN_ENTRY` 外，所有变量都可选，完整说明见 [`.env.example`](.env.example)。常用的有：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DOUYINJUHE_API_PORT` | `18182` | 监听端口 |
| `DOUYINJUHE_API_HOST` | `127.0.0.1` | 监听地址 |
| `DOUYINJUHE_DATA_DIR` | 仓库内 `data/` | 数据库与材料私钥目录，服务器上建议放在仓库外 |
| `DOUYINJUHE_WEB_ORIGINS` | 本机开发地址 | CORS 与 WebSocket 来源白名单，对外部署改成你的域名 |
| `DOUYINJUHE_ADMIN_ENTRY` | 空 | 后台入口密钥，16 到 128 位字母、数字、下划线或连字符。**服务器部署必须设置**：不设置时管理接口无保护，且网页打不开后台页 |
| `DOUYINJUHE_MATERIAL_PRIVATE_KEY_B64` | 自动生成 | 材料私钥，多实例共享账号材料时才需要显式设置 |
| `DOUYINJUHE_MIN_LAUNCHER` | 空 | 最低登录器版本，低于它的登录器会被拒绝 |

## 🧪 开发与测试

```bash
npm run start:api                          # 只启动后端
npm --workspace @douyinjuhe/web run dev    # 前端开发服务器，端口 18181，代理到 18182
npm test                                   # 运行 services/api/tests 下的测试
```

目前的测试覆盖面很窄，主要是创作者发送协议与登录材料封装，**发送、同步等主流程没有自动化测试**，改动这些部分后请在测试账号上手动验证。

## 🗝️ 注意事项

- `services/api/src/business.js` 是认证、租户授权、节点任务、账号与会话路由的主体。
- `services/api/src/creator-direct-send.js` 是创作者账号文本、图片、表情的发送链路；`web-identity-send.js` 目前只用于创作者账号发送卡片；`duoshan-send.js` 是抖音聊天账号的发送链路。
- 抖音聊天与创作者的材料、同步和发送模块相互隔离，一个通道失败时不会回退到另一个通道的 Cookie 或材料。
- 目前消息接收的实现是后端定时 HTTP 轮询拉取；后端自带的 WebSocket 只用来把新消息推给网页前端。
- 登录器检查更新时会读取安装目录下的 `update-key.json`，没有这个文件时更新检查会失败，不影响登录和收发。

## 🔒 安全注意事项

- 数据目录里有数据库和材料私钥（`*.material-private.pem`），私钥丢失后已保存的账号材料无法解密。请定期备份，并且不要提交、不要分享。
- `.gitignore` 已排除 `data/`、`build/`、`.env`、`*.pem`、`*.sqlite`、`*.log`。提交前请再看一眼 `git status`。
- 登录得到的 Cookie 等账号材料经加密保存。每个账号可以绑定网络出口（直连、自定义代理、本机节点），请不要让服务器用与账号绑定不一致的网络直接访问平台。
- 对外提供服务请使用 HTTPS，并限制后台入口的访问范围。

## 📄 许可证

[GNU Affero General Public License v3.0](LICENSE)。如果你修改本项目并以网络服务的形式提供给他人使用，需要按 AGPL-3.0 向这些用户提供修改后的源码。
