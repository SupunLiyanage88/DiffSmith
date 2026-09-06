import * as vscode from 'vscode';
import { AIProvider, GenerateOptions } from './AIProvider';
import { buildSystemPrompt, buildUserPrompt, parseChatResponse } from './chatUtils';

const NVIDIA_API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const SECRET_KEY = 'diffly.nvidia.apiKey';

export interface NvidiaModelOption {
  id: string;
  label: string;
  /** Commit-message suitability rating (10-point scale). Absent = unrated. */
  rating?: number;
}

/** Rated model catalog, sorted best-first. The first entry is the recommended default. */
export const NVIDIA_MODELS: NvidiaModelOption[] = [
  { id: 'deepseek-ai/deepseek-v4-pro-0813', label: 'DeepSeek V4 Pro', rating: 9.8 },
  { id: 'deepseek-ai/deepseek-v4-flash-0731', label: 'DeepSeek V4 Flash', rating: 9.5 },
  { id: 'nvidia/nemotron-3.5-lightning-30b-a3b', label: 'Nemotron 3.5 Lightning 30B', rating: 9.2 },
  { id: 'z-ai/glm-5.2', label: 'GLM-5.2', rating: 9.0 },
  { id: 'minimaxai/minimax-m3', label: 'MiniMax M3', rating: 8.8 },
  { id: 'meta/llama-3.3-70b-instruct', label: 'Llama 3.3 70B Instruct', rating: 8.5 },
  { id: 'meta/llama-3.1-8b-instruct', label: 'Llama 3.1 8B Instruct (previous default)' },
];

const DEFAULT_MODEL = NVIDIA_MODELS[0].id;

export function getNvidiaModelLabel(id: string): string {
  return NVIDIA_MODELS.find((m) => m.id === id)?.label ?? id;
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
      title: 'Diffly: NVIDIA API Key',
      prompt: 'Enter your NVIDIA API key (stored securely in SecretStorage, never in settings.json). Get one at https://build.nvidia.com',
      password: true,
      ignoreFocusOut: true,
      value: existing ?? '',
    });
    if (key === undefined) {
      return; // cancelled
    }
    if (key.trim().length === 0) {
      void vscode.window.showWarningMessage('Diffly: empty key — NVIDIA provider is not configured.');
      return;
    }
    await context.secrets.store(SECRET_KEY, key.trim());

    const currentModel = getSettings().model || DEFAULT_MODEL;
    interface ModelPick extends vscode.QuickPickItem {
      modelId?: string;
      isCustom?: boolean;
    }
    const picks: ModelPick[] = NVIDIA_MODELS.map((m, i) => ({
      label: `${m.id === currentModel ? '$(check) ' : ''}${m.label}${i === 0 ? ' $(star) Recommended' : ''}`,
      description: m.rating !== undefined ? `${m.rating.toFixed(1)}/10` : 'unrated',
      detail: m.id,
      modelId: m.id,
    }));
    picks.push({
      label: '$(edit) Custom model ID…',
      description: 'Enter any NVIDIA model ID manually',
      isCustom: true,
    });
    const picked = await vscode.window.showQuickPick(picks, {
      title: 'Diffly: NVIDIA Model',
      placeHolder: currentModel,
      ignoreFocusOut: true,
    });
    if (!picked) {
      return;
    }
    let next: string | undefined;
    if (picked.isCustom) {
      const input = await vscode.window.showInputBox({
        title: 'Diffly: Custom NVIDIA Model',
        prompt: 'Enter any NVIDIA model ID',
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
      `Diffly: NVIDIA provider configured (${getNvidiaModelLabel(next ?? currentModel)}).`
    );
  }

  async generateCommitMessage(diff: string, options: GenerateOptions): Promise<string> {
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      const err = new Error('NVIDIA API key is not set. Run "Diffly: Configure Provider" to set it.');
      (err as Error & { code?: string }).code = 'NOT_CONFIGURED';
      throw err;
    }

    const model = options.model || DEFAULT_MODEL;
    const systemPrompt = buildSystemPrompt(options.commitStyle, options.customInstructions);
    const userPrompt = buildUserPrompt(
      options.changedFiles,
      diff,
      options.commitStyle,
      options.customInstructions
    );

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
          // Generous headroom: reasoning models spend tokens thinking before answering.
          max_tokens: options.maxTokens ?? 1000,
        }),
        signal: controller.signal,
      });

      if (res.status === 401) {
        const err = new Error('Invalid NVIDIA API key (401). Check your key via "Diffly: Configure Provider".');
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
        choices?: Array<{
          message?: { content?: string; reasoning_content?: string; reasoning?: string };
        }>;
      };
      return parseChatResponse(data, options.commitStyle, model);
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
