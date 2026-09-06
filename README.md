<p align="center">
  <img src="images/CommitLoom_logo.png" width="512" alt="CommitLoom logo">
</p>

# CommitLoom

Generate meaningful git commit messages with AI — in one click, right from Source Control. Supports **NVIDIA** and **OpenRouter**, with secret scanning built in.

**Recommended: OpenRouter** for the most reliable commit-message generation experience in CommitLoom.

## Features

- ✨ One-click generation from the Source Control title bar or Command Palette
- 🤖 Two providers: NVIDIA (rated model picker) and OpenRouter (400+ models, free tier available)
- 📝 Conventional, simple, gitmoji, or fully custom commit styles
- 🔒 Diffs are scanned for secrets **before** anything leaves your machine
- ✍️ Messages auto-fill the commit box — never auto-committed, you always review first

## Install

**From the VS Code Marketplace** (once published): open the Extensions view (`Ctrl+Shift+X`), search **CommitLoom**, click Install.

**From a `.vsix` file**: Extensions view → `…` menu → **Install from VSIX…** → pick `commitloom-0.1.0.vsix`. Or from a terminal:

```sh
code --install-extension commitloom-0.1.0.vsix
```

## Get an API key

You need **one** key — either NVIDIA or OpenRouter. Keys are stored in VS Code SecretStorage, never in `settings.json`.

### OpenRouter (recommended, free tier available)

1. Go to [openrouter.ai](https://openrouter.ai) and sign up / sign in.
2. Open the **Keys** page: [openrouter.ai/keys](https://openrouter.ai/keys).
3. Click **Create Key**, name it (e.g. `CommitLoom`), and copy it — it's shown only once.
4. Back in VS Code: `Ctrl+Shift+P` → **CommitLoom: Configure Provider** → **OpenRouter** → paste the key.
5. Pick a model (default: Free Models Router — no credits needed) or enter any `provider/model` ID from [openrouter.ai/models](https://openrouter.ai/models).
6. Optional: paid models need credits — top up at [openrouter.ai/credits](https://openrouter.ai/credits).

### NVIDIA (free to start)

1. Go to [build.nvidia.com](https://build.nvidia.com) and sign in (or create a free NVIDIA account).
2. Open your profile menu → **API Keys** (or visit `build.nvidia.com` → keys section).
3. Click **Generate Key**, give it a name, and copy it — it's shown only once.
4. Back in VS Code: `Ctrl+Shift+P` → **CommitLoom: Configure Provider** → **NVIDIA** → paste the key.
5. Pick a model (recommended: DeepSeek V4 Pro) or enter a custom model ID.

## How it works

1. **Stage your changes** in Source Control (`git add`, or stage in the UI).
2. Press the CommitLoom button <img src="images/icon_v2.png" width="18" alt="CommitLoom generate icon"> in the Source Control title bar (top-right of the Source Control view) — or run **CommitLoom: Generate Commit Message** from the Command Palette.
3. If nothing is staged, CommitLoom asks: generate from unstaged changes, stage everything, or cancel.
4. Your diff is **scanned for secrets first**. If anything looks like a key or token, you choose: **Redact and continue**, **Send anyway**, or **Cancel**.
5. The AI writes your commit message and drops it **straight into the commit box**. Review it, tweak if you like, then commit yourself. A notification offers **Regenerate** for another try.

Large diffs are truncated per file (largest first, lockfiles always summarized) and you'll be told which files were summarized.

## Settings

| Setting | Default | Description |
|---|---|---|
| `commitloom.provider` | `"nvidia"` | AI provider: `nvidia` or `openrouter`. Switch via Configure Provider. |
| `commitloom.model` | (provider default) | Model ID. Change via Configure Provider (rated/catalog picker or custom ID). |
| `commitloom.commitStyle` | `"conventional"` | `conventional` \| `simple` \| `gitmoji` \| `custom`. |
| `commitloom.maxDiffSize` | `30000` | Max diff characters before per-file truncation kicks in. |
| `commitloom.customInstructions` | `""` | Extra prompt guidance (used as the style when `commitStyle` is `custom`). |

> `commitloom.model` is shared between providers. Leave it empty to use the provider default. Switching providers via **Configure Provider** resets it before model selection, so cancelling setup still leaves a valid default.

### NVIDIA troubleshooting

If NVIDIA returns an empty message, choose **DeepSeek V4 Pro** or **Nemotron 3.5 Lightning** via **Configure Provider**. CommitLoom disables thinking for these models so the output budget goes to the commit message. Other NVIDIA models receive a larger output budget, and NVIDIA requests can take up to 120 seconds. If a saved model is no longer available, select a current model from the picker.

## Privacy & security

- Diffs are sent to the selected AI provider **only** to generate the message — nothing else.
- Secret scanning runs locally before any network call.
- API keys live in VS Code SecretStorage, never in settings files or the repo.

## Future work

**Local Ollama model support is coming soon.** This planned integration will let you generate commit messages using models running on your own machine. Ollama support is not available in the current release.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for build instructions and the provider architecture.
