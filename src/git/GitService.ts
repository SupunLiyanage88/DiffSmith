import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface DiffResult {
  diff: string;
  changedFiles: string[];
  truncated: boolean;
  omittedFiles: string[];
  source: 'staged' | 'unstaged';
}

export type UnstagedChoice = 'unstaged' | 'stage-all' | 'cancel';

const GENERATED_FILE_PATTERNS: RegExp[] = [
  /(^|\/)package-lock\.json$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)bun\.lockb$/,
  /(^|\/)Cargo\.lock$/,
  /(^|\/)Gemfile\.lock$/,
  /(^|\/)poetry\.lock$/,
  /\.min\.js$/,
  /\.min\.css$/,
  /\.bundle\.js$/,
  /\.map$/,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)out\//,
];

function isGeneratedFile(filePath: string): boolean {
  return GENERATED_FILE_PATTERNS.some((re) => re.test(filePath));
}

function splitDiffByFile(diff: string): Map<string, string> {
  const perFile = new Map<string, string>();
  const lines = diff.split('\n');
  let currentFile: string | null = null;
  let currentChunk: string[] = [];

  const flush = () => {
    if (currentFile) {
      perFile.set(currentFile, currentChunk.join('\n'));
    }
  };

  for (const line of lines) {
    const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (m) {
      flush();
      currentFile = m[2];
      currentChunk = [line];
    } else if (currentFile) {
      currentChunk.push(line);
    }
  }
  flush();
  return perFile;
}

function countLines(text: string): number {
  if (!text) {
    return 0;
  }
  return text.split('\n').length;
}

/** Pure, unit-testable truncation. Exported for tests. */
export function truncateDiff(
  diff: string,
  maxChars: number
): { diff: string; truncated: boolean; omittedFiles: string[] } {
  if (diff.length <= maxChars) {
    // Still summarize generated files even when under the limit? Spec says
    // "Always keep lockfiles ... summarized-only, never in full, regardless of size".
    const perFile = splitDiffByFile(diff);
    let needsSummarize = false;
    for (const [file, chunk] of perFile) {
      if (isGeneratedFile(file) && chunk.length > 0) {
        needsSummarize = true;
        break;
      }
    }
    if (!needsSummarize) {
      return { diff, truncated: false, omittedFiles: [] };
    }
    // Fall through to per-file handling below.
  }

  const perFile = splitDiffByFile(diff);
  if (perFile.size === 0) {
    // Not a per-file diff (or empty) — hard truncate as last resort.
    return {
      diff: diff.slice(0, maxChars) + '\n[... diff truncated ...]',
      truncated: true,
      omittedFiles: [],
    };
  }

  interface Entry {
    file: string;
    chunk: string;
    generated: boolean;
  }
  const entries: Entry[] = [...perFile.entries()].map(([file, chunk]) => ({
    file,
    chunk,
    generated: isGeneratedFile(file),
  }));

  // Generated files are always summarized, never full.
  const summarized = new Map<string, string>();
  const omittedFiles: string[] = [];
  for (const e of entries) {
    if (e.generated) {
      summarized.set(e.file, `[diff omitted for generated/lockfile: ${e.file}, ${countLines(e.chunk)} lines changed]`);
      omittedFiles.push(e.file);
    } else {
      summarized.set(e.file, e.chunk);
    }
  }

  const joinAll = (): string =>
    [...summarized.entries()].map(([file, text]) => text).join('\n');

  // Sort non-generated files by size descending, drop/summarize largest first.
  const bySizeDesc = entries
    .filter((e) => !e.generated)
    .sort((a, b) => b.chunk.length - a.chunk.length);

  let current = joinAll();
  let truncated = omittedFiles.length > 0;
  for (const e of bySizeDesc) {
    if (current.length <= maxChars) {
      break;
    }
    summarized.set(
      e.file,
      `[diff omitted, ${countLines(e.chunk)} lines changed in ${e.file}]`
    );
    if (!omittedFiles.includes(e.file)) {
      omittedFiles.push(e.file);
    }
    truncated = true;
    current = joinAll();
  }

  // Even after summarizing everything, still too big (many files) — drop entirely.
  if (current.length > maxChars) {
    // Drop smallest-value: keep files in original order, drop from largest summarized?
    // Simplest: rebuild keeping files until budget exhausted.
    const kept: string[] = [];
    let budget = maxChars;
    const dropped: string[] = [];
    for (const [file, text] of summarized) {
      if (text.length + 1 <= budget) {
        kept.push(text);
        budget -= text.length + 1;
      } else {
        dropped.push(file);
      }
    }
    for (const f of dropped) {
      if (!omittedFiles.includes(f)) {
        omittedFiles.push(f);
      }
    }
    current = kept.join('\n') + '\n[... diff truncated: some files dropped entirely ...]';
    truncated = true;
  }

  return { diff: current, truncated, omittedFiles };
}

async function getGitCwd(): Promise<string | undefined> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder?.uri.fsPath;
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 20 * 1024 * 1024 });
  return stdout;
}

export async function getChangedFiles(cwd: string, staged: boolean): Promise<string[]> {
  const args = staged
    ? ['diff', '--cached', '--name-only']
    : ['diff', '--name-only'];
  const out = await runGit(args, cwd);
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

export class GitService {
  async getDiff(maxChars: number): Promise<DiffResult | null> {
    const cwd = await getGitCwd();
    if (!cwd) {
      return null;
    }

    let stagedDiff = '';
    try {
      stagedDiff = await runGit(['diff', '--cached'], cwd);
    } catch {
      // Not a git repo or git missing
      return null;
    }

    if (stagedDiff.trim().length > 0) {
      const changedFiles = await getChangedFiles(cwd, true);
      const { diff, truncated, omittedFiles } = truncateDiff(stagedDiff, maxChars);
      return { diff, changedFiles, truncated, omittedFiles, source: 'staged' };
    }

    // Nothing staged — check unstaged, prompt (don't silently fall back).
    let unstagedNameOnly = '';
    try {
      unstagedNameOnly = await runGit(['diff', '--name-only'], cwd);
    } catch {
      return null;
    }
    if (unstagedNameOnly.trim().length === 0) {
      return null; // empty diff
    }

    const choice = await vscode.window.showWarningMessage(
      'No staged changes. Generate from unstaged changes instead?',
      'Yes',
      'Stage all',
      'Cancel'
    );

    if (choice === 'Stage all') {
      await runGit(['add', '-A'], cwd);
      const newStaged = await runGit(['diff', '--cached'], cwd);
      const changedFiles = await getChangedFiles(cwd, true);
      const { diff, truncated, omittedFiles } = truncateDiff(newStaged, maxChars);
      return { diff, changedFiles, truncated, omittedFiles, source: 'staged' };
    }
    if (choice === 'Yes') {
      const unstagedDiff = await runGit(['diff'], cwd);
      const changedFiles = unstagedNameOnly.split('\n').map((s) => s.trim()).filter(Boolean);
      const { diff, truncated, omittedFiles } = truncateDiff(unstagedDiff, maxChars);
      return { diff, changedFiles, truncated, omittedFiles, source: 'unstaged' };
    }
    return null;
  }

  /** Non-interactive variant for tests/scripts. */
  async getStagedDiff(cwd: string, maxChars: number): Promise<DiffResult | null> {
    let stagedDiff = '';
    try {
      stagedDiff = await runGit(['diff', '--cached'], cwd);
    } catch {
      return null;
    }
    if (stagedDiff.trim().length === 0) {
      return null;
    }
    const changedFiles = await getChangedFiles(cwd, true);
    const { diff, truncated, omittedFiles } = truncateDiff(stagedDiff, maxChars);
    return { diff, changedFiles, truncated, omittedFiles, source: 'staged' };
  }
}
