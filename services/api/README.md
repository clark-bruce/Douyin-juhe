# 业务服务边界

负责身份认证、租户授权、账号元数据、规则、素材、节点配对及查询接口。业务表与文件索引必须带租户归属；服务端必须校验，不能依赖前端过滤。

运行参数由 `DOUYINJUHE_API_HOST`、`DOUYINJUHE_API_PORT`、`DOUYINJUHE_DATA_DIR` 和
`DOUYINJUHE_WEB_ORIGINS` 控制。生产环境不要使用源码目录作为数据目录。

网页上的“下载登录器”由本服务直接提供，地址是 `/downloads/launcher/DouyinJuheLauncher-WebView2-latest.exe`，
更新清单是 `/downloads/launcher/webview2-latest.json`（版本号、SHA-256、下载地址）。
登录器是 Windows 构建产物，不随仓库分发：在 Windows 上执行 `tools\build-launcher.ps1` 生成
`build\launcher\DouyinJuheLauncher.exe` 后，下载链接才会返回文件；未构建时返回 404。
文件位置可用 `DOUYINJUHE_LAUNCHER_FILE` 覆盖，清单中的版本号可用 `DOUYINJUHE_LAUNCHER_VERSION` 覆盖。

Creator Web 私聊文本由服务器使用账号独立上传的 `creator_web` 登录材料执行。服务器只调用抖音资料接口和 Creator 直连 protobuf 接口，不启动浏览器、不加载目标主页，也不读取或回退到 `duoshan_pc_im` 材料。Creator Web 当前仅支持私聊文本，且会话目标必须是 sec_uid；图片、表情及群聊继续明确拒绝。
