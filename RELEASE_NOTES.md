# CommitLoom v0.1.0 — AI commit messages for VS Code

First public release of CommitLoom — generate git commit messages with AI, in one click from Source Control.

## Providers

- **NVIDIA** — rated model picker (DeepSeek V4 Pro 9.8 recommended)
- **OpenRouter** — curated catalog defaulting to the Free Models Router, any `provider/model` ID supported
- Each provider keeps its own API key in VS Code SecretStorage — never in settings

## Highlights

- One-click generate button in the Source Control title bar + Command Palette
- Message auto-fills the commit box — never auto-commits, you always review
- Secret scanning before anything leaves your machine (redact / send anyway / cancel)
- Conventional, simple, gitmoji, or custom styles
- Per-file diff truncation with omitted-file reporting
- Reasoning-model support, retry on failure, failure details in the Output channel

## Install

1. Download `commitloom-0.1.0.vsix` below
2. VS Code → Extensions (`Ctrl+Shift+X`) → `…` → Install from VSIX
3. `Ctrl+Shift+P` → CommitLoom: Configure Provider → paste your NVIDIA key (build.nvidia.com) or OpenRouter key (openrouter.ai/keys)

Full changelog: [CHANGELOG.md](https://github.com/SupunLiyanage88/CommitForge/blob/main/CHANGELOG.md)
