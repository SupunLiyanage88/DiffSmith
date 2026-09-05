import { CommitStyle, GenerateOptions } from './AIProvider';

/**
 * Shared chat-completion helpers used by every OpenAI-style provider
 * (NVIDIA, OpenRouter, and future ones). Provider-specific code
 * (endpoints, keys, catalogs) stays in the provider classes.
 */

export function styleInstructions(style: GenerateOptions['commitStyle'], custom?: string): string {
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

export function buildSystemPrompt(style: GenerateOptions['commitStyle'], custom?: string): string {
  return (
    'You are an expert at writing git commit messages. ' +
    'Your entire response must be ONLY the commit message text. ' +
    'Do NOT show your thinking, reasoning, or analysis. ' +
    'Do NOT use numbered lists, headings, bullet points, or code fences. ' +
    'Do NOT explain the message afterwards. ' +
    styleInstructions(style, custom)
  );
}

export function buildUserPrompt(
  changedFiles: string[],
  diff: string,
  commitStyle: GenerateOptions['commitStyle'],
  customInstructions?: string
): string {
  return (
    `Changed files:\n${changedFiles.join('\n')}\n\n` +
    `Diff:\n${diff}\n\n` +
    (customInstructions && commitStyle !== 'custom'
      ? `Additional instructions: ${customInstructions}\n\n`
      : '') +
    'Commit message:'
  );
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
  /** Some gateways (e.g. OpenRouter routing failures) return a top-level error with HTTP 200. */
  error?: { message?: string; code?: number | string };
}

/** Throwable API error with a machine-readable code. Exported for tests. */
export function apiError(message: string, code: string): Error {
  const err = new Error(message);
  (err as Error & { code?: string }).code = code;
  return err;
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
  if (data.error) {
    throw apiError(
      `The AI provider (${model}) returned an error: ${data.error.message ?? 'unknown error'}`,
      'API_ERROR'
    );
  }
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
  throw apiError(
    `The AI provider (${model}) returned an empty response. Retry generation — ` +
      'if it persists, try a different model via "CommitForge: Configure Provider".',
    'EMPTY_RESPONSE'
  );
}
