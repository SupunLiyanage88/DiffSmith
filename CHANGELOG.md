# Changelog

All notable changes to CommitLoom will be documented here.

## [0.1.0] — 2026-09-05

First public release under the CommitLoom name.

- Two providers: NVIDIA (rated model picker, DeepSeek V4 Pro 9.8 by default) and OpenRouter (curated catalog defaulting to the Free Models Router, custom IDs supported) — each with its own API key in SecretStorage and its own model picker. Handles 402 (credits exhausted) and routing-error payloads.
- Shared `chatUtils.ts`: prompt builders, reasoning-dump sanitizer, and response parser reused by all providers.
- Reasoning-model support: `reasoning_content`/`reasoning` fields read as fallback when `content` is empty; token budget 300 → 1000; failures logged to the Output channel with the model ID.
- Auto-fill: generated messages go straight into the SCM commit box (no picker, never auto-commits); a notification offers Regenerate. Custom toolbar icon with light/dark variants.
- Secret scanner with Redact / Send anyway / Cancel; documented examples no longer false-positive.
- Per-file diff truncation with omitted-file reporting; default `maxDiffSize` 15000 → 30000.
- Commit styles: conventional, simple, gitmoji, custom (+ custom instructions).

## [0.0.1] — 2026-09-06

- Initial release.
- NVIDIA provider (`meta/llama-3.1-8b-instruct`) behind the `AIProvider` interface + `ProviderManager`.
- Staged/unstaged diff handling with per-file truncation and lockfile/generated-file summarization.
- Pre-send secret scanning with Redact / Send anyway / Cancel.
- `CommitLoom: Generate Commit Message` (palette + Source Control button) with progress, cancellation, and Retry on failure; writes to SCM input box, never auto-commits.
- `CommitLoom: Configure Provider` with `SecretStorage` API key storage and model override.
- `commitloom.*` settings schema + centralized `Settings.ts` loader.
- Edge cases: no repo, empty diff, missing key, truncation notice, empty provider response.
