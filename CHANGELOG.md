# Changelog

All notable changes to CommitForge will be documented here.

## [0.0.1] — 2026-09-06

- Initial release.
- NVIDIA provider (`meta/llama-3.1-8b-instruct`) behind the `AIProvider` interface + `ProviderManager`.
- Staged/unstaged diff handling with per-file truncation and lockfile/generated-file summarization.
- Pre-send secret scanning with Redact / Send anyway / Cancel.
- `CommitForge: Generate Commit Message` (palette + Source Control button) with progress, cancellation, and Retry on failure; writes to SCM input box, never auto-commits.
- `CommitForge: Configure Provider` with `SecretStorage` API key storage and model override.
- `commitforge.*` settings schema + centralized `Settings.ts` loader.
- Edge cases: no repo, empty diff, missing key, truncation notice, empty provider response.
