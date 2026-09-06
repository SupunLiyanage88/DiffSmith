# Contributing to CommitLoom

## Build from source

```sh
npm install
npm run compile   # typecheck + build to out/
npm run watch     # incremental build
```

Press `F5` in VS Code to launch the Extension Development Host, or package with `vsce`:

```sh
npm install -g @vscode/vsce
vsce package
```

## Adding a provider (OpenAI, Gemini, Ollama, Claude…)

1. Create `src/providers/<Name>Provider.ts` implementing the `AIProvider` interface in `src/providers/AIProvider.ts`:

   ```ts
   export interface AIProvider {
     readonly id: string;
     readonly displayName: string;
     isConfigured(): Promise<boolean>; // works keyless too (e.g. ping a local Ollama endpoint)
     generateCommitMessage(diff: string, options: GenerateOptions): Promise<string>;
     configure?(context: vscode.ExtensionContext): Promise<void>; // optional setup (keys, model picker)
   }
   ```

2. Register it in `ProviderManager`'s constructor map.
3. Add the id to the `commitloom.provider` enum in `package.json` — one line. Nothing else changes: commands and `extension.ts` only talk to `AIProvider`/`ProviderManager`, and provider specifics live only in the provider class + the settings schema. (OpenRouter was added exactly this way — see `src/providers/OpenRouterProvider.ts`. Shared prompt/parse/sanitize helpers live in `src/providers/chatUtils.ts`.)

## Testing changes

Run `npm test` to compile and run provider regression tests with mocked API responses (no API keys required).

`F5` → Extension Host → run `CommitLoom: Configure Provider`, stage a change, run `CommitLoom: Generate Commit Message`.

## Architecture notes

- `config/Settings.ts` is the only place that reads `vscode.workspace.getConfiguration` — use `getSettings()` / `updateSetting()` everywhere else.
- `git/GitService.ts` shells out to `git` (`diff --cached`, prompts for unstaged) with per-file truncation; lockfiles/generated files are always summarized.
- `security/SecretScanner.ts` runs before any network call: `scanDiff()` detects, `redactDiff()` redacts.
- `generateCommit` never writes a blank message and never auto-commits — failures surface as Retry-able error messages, never raw stack traces.
