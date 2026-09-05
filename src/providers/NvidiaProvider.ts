import * as vscode from 'vscode';
import { AIProvider, GenerateOptions } from './AIProvider';

const NVIDIA_API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const SECRET_KEY = 'commitforge.nvidia.apiKey';
const DEFAULT_MODEL = 'meta/llama-3.1-8b-instruct';

function styleInstructions(style: GenerateOptions['commitStyle'], custom?: string): string {
  switch (style) {
    case 'conventional':
      return 'Use Conventional Commits format (<type>[optional scope]: <description>). Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert. Keep the subject line under 72 chars. Add a body only if the change needs explanation.';
    case 'simple':
      return 'Write a short, plain single-line summary under 72 characters. No prefixes or emojis.';
    case 'gitmoji':
      return 'Start the message with a single appropriate gitmoji emoji followed by a concise summary under 72 chars.';
    case 'custom':
      return custom && custom.trim().length > 0
        ? `Follow these custom instructions: ${custom}`
        : 'Write a concise commit message under 72 characters.';
  }
}

export class NvidiaProvider implements AIProvider {
  readonly id = 'nvidia';
  readonly displayName = 'NVIDIA';

  constructor(private readonly context: vscode.ExtensionContext) {}

  private async getApiKey(): Promise<string | undefined> {
    return this.context.secrets.get(SECRET_KEY);
  }

  async isConfigured(): Promise<boolean> {
    const key = await this.getApiKey();
    return !!key && key.trim().length > 0;
  }

  /** Provider-specific setup: API key via SecretStorage + optional model override. */
  async configure(context: vscode.ExtensionContext): Promise<void> {
    const { getSettings, updateSetting } = await import('../config/Settings');
    const existing = await context.secrets.get(SECRET_KEY);
    const key = await vscode.window.showInputBox({
      title: 'CommitForge: NVIDIA API Key',
      prompt: 'Enter your NVIDIA API key (stored securely in SecretStorage, never in settings.json). Get one at https://build.nvidia.com',
      password: true,
      ignoreFocusOut: true,
      value: existing ?? '',
    });
    if (key === undefined) {
      return; // cancelled
    }
    if (key.trim().length === 0) {
      void vscode.window.showWarningMessage('CommitForge: empty key — NVIDIA provider is not configured.');
      return;
    }
    await context.secrets.store(SECRET_KEY, key.trim());

    const currentModel = getSettings().model;
    const model = await vscode.window.showInputBox({
      title: 'CommitForge: Model Override (optional)',
      prompt: `NVIDIA model (default: ${DEFAULT_MODEL})`,
      value: currentModel ?? DEFAULT_MODEL,
      ignoreFocusOut: true,
    });
    if (model !== undefined && model.trim().length > 0 && model !== currentModel) {
      await updateSetting('model', model.trim());
    }
    void vscode.window.showInformationMessage('CommitForge: NVIDIA provider configured.');
  }

  async generateCommitMessage(diff: string, options: GenerateOptions): Promise<string> {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      const err = new Error('NVIDIA API key is not set. Run "CommitForge: Configure Provider" to set it.');
      (err as Error & { code?: string }).code = 'NOT_CONFIGURED';
      throw err;
    }

    const model = options.model || DEFAULT_MODEL;
    const systemPrompt =
      'You are an expert at writing git commit messages. ' +
      'Generate ONLY the commit message, no explanations, no code fences, no extra commentary. ' +
      styleInstructions(options.commitStyle, options.customInstructions);

    const userPrompt =
      `Changed files:\n${options.changedFiles.join('\n')}\n\n` +
      `Diff:\n${diff}\n\n` +
      (options.customInstructions && options.commitStyle !== 'custom'
        ? `Additional instructions: ${options.customInstructions}\n\n`
        : '') +
      'Commit message:';

    const controller = new AbortController();
    const timeoutMs = 60_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(NVIDIA_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: options.maxTokens ?? 300,
        }),
        signal: controller.signal,
      });

      if (res.status === 401) {
        const err = new Error('Invalid NVIDIA API key (401). Check your key via "CommitForge: Configure Provider".');
        (err as Error & { code?: string }).code = 'UNAUTHORIZED';
        throw err;
      }
      if (res.status === 429) {
        const err = new Error('NVIDIA API rate limit exceeded (429). Wait a moment and retry.');
        (err as Error & { code?: string }).code = 'RATE_LIMITED';
        throw err;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new Error(`NVIDIA API request failed (${res.status}): ${text.slice(0, 300)}`);
        (err as Error & { code?: string }).code = 'API_ERROR';
        throw err;
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content?.trim() ?? '';
      if (!content) {
        const err = new Error('Provider returned an empty or malformed response.');
        (err as Error & { code?: string }).code = 'EMPTY_RESPONSE';
        throw err;
      }
      // Strip accidental code fences
      return content.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        const err = new Error('Request timed out after 60s.');
        (err as Error & { code?: string }).code = 'TIMEOUT';
        throw err;
      }
      throw e;
    } finally {
      clearTimeout(timeout);
    }
  }

  static defaultModel(): string {
    return DEFAULT_MODEL;
  }
}
