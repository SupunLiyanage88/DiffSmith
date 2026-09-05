# Changelog

All notable changes to CommitForge will be documented here.

## [Unreleased]

- Rated NVIDIA model catalog (DeepSeek V4 Pro 9.8 through Llama 3.3 70B 8.5); `Configure Provider` now shows a model picker with ratings and the recommendation instead of a free-text field. Default model is now `deepseek-ai/deepseek-v4-pro-0813`.
- Reasoning-dump sanitizer: provider output is now extracted to just the commit message; unparsable output fails with Retry instead of inserting junk.
- Reasoning-model support: `reasoning_content`/`reasoning` fields are now read as fallback when `content` is empty (DeepSeek family); default token budget raised 300 → 1000; failures are logged to the Output channel with the model ID.

## [0.0.1] — 2026-09-06

- Initial release.
- NVIDIA provider (`meta/llama-3.1-8b-instruct`) behind the `AIProvider` interface + `ProviderManager`.
- Staged/unstaged diff handling with per-file truncation and lockfile/generated-file summarization.
- Pre-send secret scanning with Redact / Send anyway / Cancel.
- `CommitForge: Generate Commit Message` (palette + Source Control button) with progress, cancellation, and Retry on failure; writes to SCM input box, never auto-commits.
- `CommitForge: Configure Provider` with `SecretStorage` API key storage and model override.
- `commitforge.*` settings schema + centralized `Settings.ts` loader.
- Edge cases: no repo, empty diff, missing key, truncation notice, empty provider response.
