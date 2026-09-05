# CommitForge

AI-powered git commit message generation for VS Code. Currently supports **NVIDIA** (`meta/llama-3.1-8b-instruct` by default), designed from day one to support more providers without rewrites.

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

## Set the NVIDIA API key

1. Open the Command Palette → **CommitForge: Configure Provider**.
2. Select **NVIDIA**, paste your API key (get one at https://build.nvidia.com).
3. Optionally override the model (default: `meta/llama-3.1-8b-instruct`).

The key is stored via VS Code `SecretStorage` — never in `settings.json`.

## Usage

- Stage changes, then run **CommitForge: Generate Commit Message** from the Command Palette, or click the CommitForge button in the Source Control title bar.
- If nothing is staged you'll be asked: generate from unstaged changes, stage all, or cancel.
- Diffs are scanned for secrets first (see below).
- Pick **Use Message** to write into the SCM input box (never auto-commits), **Regenerate**, or **Cancel**.

## Settings

| Setting | Default | Description |
|---|---|---|
| `commitforge.provider` | `"nvidia"` | AI provider used to generate commit messages. |
| `commitforge.model` | `"meta/llama-3.1-8b-instruct"` | Model ID for the active provider. |
| `commitforge.commitStyle` | `"conventional"` | `conventional` \| `simple` \| `gitmoji` \| `custom`. |
| `commitforge.maxDiffSize` | `15000` | Max diff chars before per-file truncation (largest files summarized first; lockfiles/generated files always summarized). |
| `commitforge.customInstructions` | `""` | Extra prompt guidance (required content when style is `custom`). |

## Secret scanning

Before any diff leaves your machine, CommitForge scans for AWS keys, `API_KEY=`/`SECRET=`/`TOKEN=` assignments, private key headers, known token formats, and `.env`-style files. On a hit you choose **Redact and continue** (values → `[REDACTED]`), **Send anyway**, or **Cancel**.

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
3. Add the id to the `commitforge.provider` enum in `package.json` — one line. Nothing else changes: commands and `extension.ts` only talk to `AIProvider`/`ProviderManager`, and NVIDIA specifics live only in `NvidiaProvider.ts` + the settings schema.

## Development

- `npm run compile` — typecheck + build to `out/`
- `npm run watch` — incremental build
- Test per phase: `F5` → Extension Host → run `CommitForge: Configure Provider`, stage a change, run `CommitForge: Generate Commit Message`.
