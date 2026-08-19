# DeepSeek Web RPA

在 DeepSeek Harness 的 Web UI 里调用工具，用真实浏览器打开 [chat.deepseek.com](https://chat.deepseek.com/)，发送消息，再把网站回复写回当前会话。

## 数据流

```text
你们的 Web UI (http://127.0.0.1:3080)
  → agent 决定调用 deepseek_web_chat
  → Playwright 打开 chat.deepseek.com
  → 输入并发送
  → 等待网页回复
  → 工具结果回到同一会话卡片
  → 模型把回复总结/转述给用户
```

第一次运行会弹出 Chromium。如果网站要求登录，在该窗口里登录一次即可；登录态保存在 `.browser-profile/`。

## 启动

```sh
node --import tsx/esm apps/cli/src/bin.ts web --patch ./plugins/deepseek-web-rpa/cordis.yml --port 3080
```

然后在 Web UI 里说：

> 用网页 RPA 去 chat.deepseek.com 问：你好，请用一句话介绍你自己。把网站的回复发回这里。
