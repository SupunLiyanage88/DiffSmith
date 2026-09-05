import * as vscode from 'vscode';
import { AIProvider, CommitStyle, GenerateOptions } from './AIProvider';

const NVIDIA_API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const SECRET_KEY = 'commitforge.nvidia.apiKey';

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

const CONVENTIONAL_RE =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]*\))?(!)?:\s+\S+/i;

function isMetaLine(line: string): boolean {
  const t = line.trim();
  if (!t) {
    return true;
  }
  if (/^#{1,6}\s/.test(t)) {
    return true; // markdown heading
  }
  if (/^\d+[.)]\s/.test(t)) {
    return true; // numbered reasoning step
  }
  if (/^[-*]\s/.test(t)) {
    return true; // bullet — real messages never start with one
  }
  if (/^>\s?/.test(t)) {
    return true; // quote
  }
  if (/^(here'?s|here is|below is|analyz|analysis|thinking|reasoning|thought|step\s*\d|option\s*\d)/i.test(t)) {
    return true;
  }
  if (/^\*\*.+\*\*:?\s*$/.test(t)) {
    return true; // **Bold heading**
  }
  if (/^(explanation|note|why this|this (message|commit|means)|translation)\b/i.test(t)) {
    return true;
  }
  return false;
}

/**
 * Extract the actual commit message from raw model output.
 * Small instruct models sometimes dump chain-of-thought despite instructions;
 * this finds the message anchor and drops reasoning/commentary around it.
 * Returns '' when no message is found (caller treats it as a retryable failure).
 * Exported for tests.
 */
export function sanitizeCommitMessage(raw: string, style: CommitStyle): string {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, '');
  text = text
    .replace(/^```[\w-]*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trim();
  const lines = text.split('\n');

  let anchor = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) {
      continue;
    }
    if (style === 'conventional') {
      if (CONVENTIONAL_RE.test(t)) {
        anchor = i;
        break;
      }
    } else if (style === 'gitmoji') {
      if (!isMetaLine(t) && /^\p{Extended_Pictographic}/u.test(t)) {
        anchor = i;
        break;
      }
    } else if (!isMetaLine(t)) {
      anchor = i;
      break;
    }
  }
  // gitmoji fallback: accept a non-meta line even without a leading emoji.
  if (anchor === -1 && style === 'gitmoji') {
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t && !isMetaLine(t)) {
        anchor = i;
        break;
      }
    }
  }
  if (anchor === -1) {
    return '';
  }

  const out: string[] = [];
  for (let i = anchor; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (i > anchor) {
      // Stop at trailing commentary after the message body.
      if (/^(explanation|note:|why this|this (message|commit))\b/i.test(trimmed)) {
        break;
      }
      if (/^#{1,6}\s/.test(trimmed) || /^\d+[.)]\s+\*\*/.test(trimmed)) {
        break;
      }
    }
    out.push(lines[i]);
  }
  while (out.length > 0 && !out[out.length - 1].trim()) {
    out.pop();
  }
  return out.join('\n').trim();
}

export interface ChatCompletionData {
  choices?: Array<{
    message?: { content?: string; reasoning_content?: string; reasoning?: string };
  }>;
}

/**
 * Pull a commit message out of a chat-completion payload.
 * Reasoning models (e.g. the DeepSeek family) put their thinking in
 * `reasoning_content` and may leave `content` empty — so content is tried
 * first, then the reasoning fields, and the sanitizer extracts the message.
 * Throws EMPTY_RESPONSE when nothing usable is found. Exported for tests.
 */
export function parseChatResponse(
  data: ChatCompletionData,
  style: CommitStyle,
  model: string
): string {
  const msg = data.choices?.[0]?.message;
  const candidates = [
    msg?.content ?? '',
    msg?.reasoning_content ?? '',
    msg?.reasoning ?? '',
  ];
  for (const raw of candidates) {
    if (!raw.trim()) {
      continue;
    }
    const message = sanitizeCommitMessage(raw, style);
    if (message) {
      return message;
    }
  }
  const err = new Error(
    `The AI provider (${model}) returned an empty response. Retry generation — ` +
      'if it persists, try a different model via "CommitForge: Configure Provider".'
  );
  (err as Error & { code?: string }).code = 'EMPTY_RESPONSE';
  throw err;
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
      title: 'CommitForge: NVIDIA Model',
      placeHolder: currentModel,
      ignoreFocusOut: true,
    });
    if (!picked) {
      return;
    }
    let next: string | undefined;
    if (picked.isCustom) {
      const input = await vscode.window.showInputBox({
        title: 'CommitForge: Custom NVIDIA Model',
        prompt: 'Enter any NVIDIA model ID',
        value: currentModel,
        ignoreFocusOut: true,
      });
      if (input === undefined) {
        return;
      }
      next = input.trim();
      if (next.length === 0) {
        void vscode.window.showWarningMessage('CommitForge: empty model — keeping the current one.');
        return;
      }
    } else {
      next = picked.modelId;
    }
    if (next && next !== currentModel) {
      await updateSetting('model', next);
    }
    void vscode.window.showInformationMessage(
      `CommitForge: NVIDIA provider configured (${getNvidiaModelLabel(next ?? currentModel)}).`
    );
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
      'Your entire response must be ONLY the commit message text. ' +
      'Do NOT show your thinking, reasoning, or analysis. ' +
      'Do NOT use numbered lists, headings, bullet points, or code fences. ' +
      'Do NOT explain the message afterwards. ' +
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
          // Generous headroom: reasoning models spend tokens thinking before answering.
          max_tokens: options.maxTokens ?? 1000,
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
