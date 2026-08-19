# Agent Note: Models settings image-input toggle

Status: implemented

English | [中文](2026-08-17-models-settings-image-input-toggle.zh.md)

## Problem

Host admission for user images reads each model's declared `inputModalities` and refuses a prompt when `'image'` is absent. For pi-ai routes that declaration is the profile entry's `input` (else catalog, else route `defaultInput`, defaulting to text-only). The Models settings card edited id, name, and capacities only, so a vision gateway configured through the UI still admitted as text-only and surface copy told users to switch models they had already selected.

## Decision

The pi-ai `ModelListEditor` advanced disclosure includes a **Supports images** checkbox. Checking it writes `input: [text, image]` on that model entry; clearing it removes `input` so the route's `defaultInput` answers again. The page does not probe the endpoint. Official DeepSeek catalog rows stay without this control: `llm-deepseek` hard-codes text-only modalities for its chat-completions wire path, and declaring vision there would admit attachments that adapter cannot serialize.

## Alternatives considered

**Provider-level `defaultInput` control only.** One checkbox would mark every model on a mixed text/vision gateway as vision-capable; per-model `input` matches the adapter's existing override path and avoids widening text-only siblings.

**DeepSeek catalog toggle that flips metadata only.** Would green-light composer admission while the DeepSeek serializer still rejects image blocks mid-turn; refused until that adapter gains image serialization.

**Infer vision from model id heuristics.** Opaque ids and gateway aliases make false positives and false negatives both likely; an explicit claim is the same contract the host already reads.

## Consequences

Custom and customized pi-ai models can admit image prompts after a settings save and model (re)selection. Route-level `defaultInput` and other non-curated profile fields remain `settings.yaml`-only. Package tests pin the create-card write of `input: [text, image]` and the clear path that omits the field.
