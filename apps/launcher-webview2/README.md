# 抖音聚合登录器

Windows 原生壳，使用系统已安装的 Microsoft Edge WebView2 Runtime，不自带浏览器内核。

构建（需 Windows、Python 3.8+，以及 `pip install pyinstaller cryptography`）：

```
npm run build:launcher
```

产物在 `build/launcher/DouyinJuheLauncher.exe`。默认连接 `http://127.0.0.1:18182`，请先在本机启动后端。

登录器检查更新时，会读取安装目录下的 `update-key.json`（`{"modulus":"<RSA 公钥模数 base64>"}`）。未放置该文件时，更新检查会失败，不影响登录和收发。
