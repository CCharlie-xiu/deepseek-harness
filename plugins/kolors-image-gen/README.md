# Kolors Image Generation

通过 SiliconFlow 的 `Kwai-Kolors/Kolors` 生图（文生图 / 图生图），并在 Web UI 里用 [AIcss Image Generation](https://www.aicss.dev/components/image-generation) 风格展示生成中 / 完成后的卡片。

API：[`POST /images/generations`](https://api-docs.siliconflow.cn/docs/api/images-generations-post)（`image` 字段即图生图参考图）。

## 准备

1. 在 [SiliconFlow](https://siliconflow.cn) 拿到 API Key
2. 设置环境变量：

```sh
set SILICONFLOW_API_KEY=sk-...
```

或写入 `$DSH_HOME/.credentials.yaml`（引用名 `SILICONFLOW_API_KEY`）。

## 启动

插件已通过 profile patch 挂载。重启：

```sh
node --import tsx/esm apps/cli/src/bin.ts web --port 3080
```

## 用法

### 文生图

> 帮我生一张竖屏 9:16 的图：海边灯塔，月光，海鸥

### 图生图

任选一种参考源：

1. **聊天附件（推荐）**：上传/粘贴图片后说「改成水墨画 / 图生图」
   - 模型应传 `use_last_user_image: true`
   - **即使模型忘了传，插件也会自动用本轮用户消息里的图做图生图**
2. **URL**：`image` 传 `https://...`
3. **本地路径**：`image` 传磁盘路径（也可用上次生成结果，如 `%USERPROFILE%\.dsh\generated-images\*.png`）

插件按 [官方推荐尺寸](https://api-docs.siliconflow.cn/docs/api/images-generations-post) 纠偏：

| 需求 | 发给 API 的 `image_size` |
|------|------|
| 9:16 / 竖屏 | `720x1280` |
| 3:4 | `960x1280` |
| 1:1 | `1024x1024` |
| 1:2 | `720x1440` |

`960x540` 不在官方表里（还是 16:9），会被覆盖。

生成中显示 shimmer 画布，完成后显示图片。
