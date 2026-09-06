# CommitLoom v0.1.1 — NVIDIA generation fixes

This patch release fixes NVIDIA empty-response issues and improves provider switching. OpenRouter is the recommended option for the most reliable commit-message generation experience.

## What's changed

- Disable thinking for NVIDIA's DeepSeek V4 and Nemotron Lightning models so they can produce a finished commit message within the output budget.
- Give other NVIDIA models more output tokens and allow NVIDIA requests up to 120 seconds to finish.
- Reject unfinished answers and reasoning-only output, with clearer guidance when generation fails.
- Remove unavailable NVIDIA models from the picker and explain unavailable-model errors.
- Reset the shared model setting when switching providers, so cancelling setup still leaves the new provider's default in place.
- Add nine automated provider regression tests, including OpenRouter generation checks.

## Install or update

1. Download `commitloom-0.1.1.vsix` from this release.
2. In VS Code, open Extensions (`Ctrl+Shift+X`) → `…` → **Install from VSIX…** and select the file.
3. Reload VS Code if prompted.
4. Run **CommitLoom: Configure Provider** to choose OpenRouter (recommended) or NVIDIA and select a model. Existing API keys remain in VS Code SecretStorage.

## Coming soon

Local Ollama model support is planned for a future release. It is not included in 0.1.1.

Full changelog: [CHANGELOG.md](https://github.com/SupunLiyanage88/CommitLoom/blob/main/CHANGELOG.md)
