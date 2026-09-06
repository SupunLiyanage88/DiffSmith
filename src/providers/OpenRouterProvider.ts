import * as vscode from 'vscode';
import { AIProvider, GenerateOptions } from './AIProvider';
import {
  apiError,
  buildSystemPrompt,
  buildUserPrompt,
  ChatCompletionData,
  parseChatResponse,
} from './chatUtils';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const SECRET_KEY = 'diffly.openrouter.apiKey';
const APP_URL = 'https://github.com/SupunLiyanage88/CommitForge';
const APP_TITLE = 'Diffly';

export interface OpenRouterModelOption {
  id: string;
  label: string;
  detail?: string;
}

/** Curated model catalog, best-first. The first entry is the recommended default. */
export const OPENROUTER_MODELS: OpenRouterModelOption[] = [
  { id: 'openrouter/free', label: 'Free Models Router', detail: 'Free, auto-routed across free models' },
  { id: 'deepseek/deepseek-v4-pro', label: 'DeepSeek V4 Pro', detail: 'Best value for code' },
  { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash', detail: 'Cheapest, very fast' },
  { id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4', detail: 'Strong reasoning, premium price' },
  { id: 'google/gemini-3.5-flash', label: 'Gemini 3.5 Flash', detail: 'Cheap and capable' },
  { id: 'openai/gpt-4o', label: 'GPT-4o', detail: 'Reliable all-rounder' },
  { id: 'minimax/minimax-m3', label: 'MiniMax M3', detail: 'Multimodal' },
  { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B Instruct', detail: 'Strong open weights' },
];

const DEFAULT_MODEL = OPENROUTER_MODELS[0].id;

export function getOpenRouterModelLabel(id: string): string {
  return OPENROUTER_MODELS.find((m) => m.id === id)?.label ?? id;
}

export class OpenRouterProvider implements AIProvider {
  readonly id = 'openrouter';
  readonly displayName = 'OpenRouter';

  constructor(private readonly context: vscode.ExtensionContext) {}

  private async getApiKey(): Promise<string | undefined> {
    return this.context.secrets.get(SECRET_KEY);
  }

  async isConfigured(): Promise<boolean> {
    const key = await this.getApiKey();
    return !!key && key.trim().length > 0;
  }

  /** Provider-specific setup: API key via SecretStorage + model picker. */
  async configure(context: vscode.ExtensionContext): Promise<void> {
    const { getSettings, updateSetting } = await import('../config/Settings');
    const existing = await context.secrets.get(SECRET_KEY);
    const key = await vscode.window.showInputBox({
      title: 'Diffly: OpenRouter API Key',
      prompt: 'Enter your OpenRouter API key (stored securely in SecretStorage, never in settings.json). Get one at https://openrouter.ai/keys',
      password: true,
      ignoreFocusOut: true,
      value: existing ?? '',
    });
    if (key === undefined) {
      return; // cancelled
    }
    if (key.trim().length === 0) {
      void vscode.window.showWarningMessage('Diffly: empty key — OpenRouter provider is not configured.');
      return;
    }
    await context.secrets.store(SECRET_KEY, key.trim());

    const currentModel = getSettings().model || DEFAULT_MODEL;
    interface ModelPick extends vscode.QuickPickItem {
      modelId?: string;
      isCustom?: boolean;
    }
    const picks: ModelPick[] = OPENROUTER_MODELS.map((m, i) => ({
      label: `${m.id === currentModel ? '$(check) ' : ''}${m.label}${i === 0 ? ' $(star) Recommended' : ''}`,
      description: m.detail,
      detail: m.id,
      modelId: m.id,
    }));
    picks.push({
      label: '$(edit) Custom model ID…',
      description: 'Enter any OpenRouter model ID manually (see openrouter.ai/models)',
      isCustom: true,
    });
    const picked = await vscode.window.showQuickPick(picks, {
      title: 'Diffly: OpenRouter Model',
      placeHolder: currentModel,
      ignoreFocusOut: true,
    });
    if (!picked) {
      return;
    }
    let next: string | undefined;
    if (picked.isCustom) {
      const input = await vscode.window.showInputBox({
        title: 'Diffly: Custom OpenRouter Model',
        prompt: 'Enter any OpenRouter model ID (provider/model-name)',
        value: currentModel,
        ignoreFocusOut: true,
      });
      if (input === undefined) {
        return;
      }
      next = input.trim();
      if (next.length === 0) {
        void vscode.window.showWarningMessage('Diffly: empty model — keeping the current one.');
        return;
      }
    } else {
      next = picked.modelId;
    }
    if (next && next !== currentModel) {
      await updateSetting('model', next);
    }
    void vscode.window.showInformationMessage(
      `Diffly: OpenRouter provider configured (${getOpenRouterModelLabel(next ?? currentModel)}).`
    );
  }

  async generateCommitMessage(diff: string, options: GenerateOptions): Promise<string> {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      throw apiError(
        'OpenRouter API key is not set. Run "Diffly: Configure Provider" to set it.',
        'NOT_CONFIGURED'
      );
    }

    const model = options.model || DEFAULT_MODEL;
    const controller = new AbortController();
    const timeoutMs = 60_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': APP_URL,
          'X-Title': APP_TITLE,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: buildSystemPrompt(options.commitStyle, options.customInstructions) },
            {
              role: 'user',
              content: buildUserPrompt(
                options.changedFiles,
                diff,
                options.commitStyle,
                options.customInstructions
              ),
            },
          ],
          temperature: 0.3,
          // Generous headroom: reasoning models spend tokens thinking before answering.
          max_tokens: options.maxTokens ?? 1000,
        }),
        signal: controller.signal,
      });

      if (res.status === 401) {
        throw apiError(
          'Invalid OpenRouter API key (401). Check your key via "Diffly: Configure Provider".',
          'UNAUTHORIZED'
        );
      }
      if (res.status === 402) {
        throw apiError(
          'OpenRouter credits exhausted (402). Top up at https://openrouter.ai/credits, or switch to a free model.',
          'INSUFFICIENT_CREDITS'
        );
      }
      if (res.status === 429) {
        throw apiError(
          'OpenRouter rate limit exceeded (429). Wait a moment and retry.',
          'RATE_LIMITED'
        );
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw apiError(
          `OpenRouter API request failed (${res.status}): ${text.slice(0, 300)}`,
          'API_ERROR'
        );
      }

      const data = (await res.json()) as ChatCompletionData;
      return parseChatResponse(data, options.commitStyle, model);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw apiError('Request timed out after 60s.', 'TIMEOUT');
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
