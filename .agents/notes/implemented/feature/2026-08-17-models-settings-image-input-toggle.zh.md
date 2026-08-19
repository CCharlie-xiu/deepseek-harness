# Agent Note: Models settings image-input toggle

Status: implemented

[English](2026-08-17-models-settings-image-input-toggle.md) | 中文

## Problem

宿主在接纳用户图片时读取每个模型声明的 `inputModalities`，缺少 `'image'` 即拒绝该条 prompt。对 pi-ai 路由而言，该声明来自 profile 条目的 `input`（否则是 catalog，再否则是路由的 `defaultInput`，默认纯文本）。Models 设置卡片原先只能编辑 id、名称与容量，因此经 UI 配好的视觉网关仍会被判成纯文本，界面文案却要求用户切换他们已经选中的模型。

## Decision

pi-ai 的 `ModelListEditor` 高级展开区提供 **支持图片** 勾选框。勾选后在该模型条目写入 `input: [text, image]`；取消勾选则移除 `input`，改由路由的 `defaultInput` 作答。页面不探测端点。官方 DeepSeek 目录行不提供该控件：`llm-deepseek` 为其 chat-completions 线路写死纯文本模态，若在此声明视觉能力，会让宿主接受该适配器无法序列化的附件。

## Alternatives considered

**只做提供方级的 `defaultInput` 控件。** 单个勾选会把混合文本／视觉网关上的每个模型都标成具备视觉能力；按模型的 `input` 与适配器既有覆盖路径一致，也不会误扩同路由下的纯文本模型。

**仅为 DeepSeek 目录加只改元数据的开关。** 会放行输入框接纳，而 DeepSeek 序列化仍在回合中拒绝图片块；在该适配器具备图片序列化之前不做。

**按模型 id 启发式推断视觉能力。** 不透明 id 与网关别名都会导致误判；显式声明才是宿主已经读取的同一份契约。

## Consequences

自定义或已定制的 pi-ai 模型在设置保存并（重新）选择模型后即可接纳带图消息。路由级 `defaultInput` 及其他非精选 profile 字段仍只在 `settings.yaml` 中编辑。包测试钉住创建卡片写入 `input: [text, image]`，以及清除后省略该字段的路径。
