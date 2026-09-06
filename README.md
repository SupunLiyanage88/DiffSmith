<p align="center">
  <img src="images/Diffly_logo.png" width="512" alt="Diffly logo">
</p>

# Diffly

AI-powered git commit message generation for VS Code. Supports **NVIDIA** (DeepSeek V4 Pro by default, rated model picker included) and **OpenRouter** (400+ models through one key), designed from day one to support more providers without rewrites.

## Install

1. Clone/copy this folder, then:
   ```sh
   npm install
   npm run compile
   ```
2. Press `F5` in VS Code to launch the Extension Development Host, or package with `vsce`:
   ```sh
   npm install -g @vscode/vsce
   vsce package
   ```
3. Replace `your-publisher-id` in `package.json` with your publisher id before publishing.

## Set up a provider (NVIDIA / OpenRouter)

1. Open the Command Palette → **Diffly: Configure Provider**.
2. Select **NVIDIA** (key from https://build.nvidia.com) or **OpenRouter** (key from https://openrouter.ai/keys). Each provider keeps its own API key.
3. Pick a model from the list (NVIDIA shows suitability ratings with a recommended pick; OpenRouter shows a curated best-first list) or enter a custom model ID.

The keys are stored via VS Code `SecretStorage` — never in `settings.json`. Note: `diffly.model` is shared, so switching providers via Configure Provider also updates the model to one valid for that provider. If you flip `diffly.provider` by hand, re-run Configure Provider to pick a matching model.

## Usage

- Stage changes, then press the Diffly button <img src="images/Diffly_logo.png" width="18" alt="Diffly generate icon"> in the Source Control title bar (top-right of the Source Control view, next to the `…` menu) — or run **Diffly: Generate Commit Message** from the Command Palette (`Ctrl+Shift+P`).
- If nothing is staged you'll be asked: generate from unstaged changes, stage all, or cancel.
- Diffs are scanned for secrets first (see below).
- The message is written straight into the Source Control commit box (never auto-committed) — review it and commit when ready. A notification offers **Regenerate** if you want another try.

## Settings

| Setting | Default | Description |
|---|---|---|
| `diffly.provider` | `"nvidia"` | AI provider used to generate commit messages. |
| `diffly.model` | `"deepseek-ai/deepseek-v4-pro-0813"` | Model ID for the active provider. Change via Configure Provider (rated picker: DeepSeek V4 Pro 9.8 down to Llama 3.3 70B 8.5). |
| `diffly.commitStyle` | `"conventional"` | `conventional` \| `simple` \| `gitmoji` \| `custom`. |
| `diffly.maxDiffSize` | `30000` | Max diff chars before per-file truncation (largest files summarized first; lockfiles/generated files always summarized). |
| `diffly.customInstructions` | `""` | Extra prompt guidance (required content when style is `custom`). |

## Secret scanning

Before any diff leaves your machine, Diffly scans for AWS keys, `API_KEY=`/`SECRET=`/`TOKEN=` assignments, private key headers, known token formats, and `.env`-style files. On a hit you choose **Redact and continue** (values → `[REDACTED]`), **Send anyway**, or **Cancel**.

## Adding providers (OpenAI, Gemini, Ollama, Claude…)

1. Create `src/providers/<Name>Provider.ts` implementing the `AIProvider` interface in `src/providers/AIProvider.ts`:
   ```ts
   export interface AIProvider {
     readonly id: string;
     readonly displayName: string;
     isConfigured(): Promise<boolean>; // works keyless too (e.g. ping a local Ollama endpoint)
     generateCommitMessage(diff: string, options: GenerateOptions): Promise<string>;
   }
   ```
2. Register it in `ProviderManager`'s constructor map.
3. Add the id to the `diffly.provider` enum in `package.json` — one line. Nothing else changes: commands and `extension.ts` only talk to `AIProvider`/`ProviderManager`, and provider specifics live only in the provider class + the settings schema. (OpenRouter was added exactly this way — see `src/providers/OpenRouterProvider.ts`. Shared prompt/parse/sanitize helpers live in `src/providers/chatUtils.ts`.)

## Development

- `npm run compile` — typecheck + build to `out/`
- `npm run watch` — incremental build
- Test per phase: `F5` → Extension Host → run `Diffly: Configure Provider`, stage a change, run `Diffly: Generate Commit Message`.
