import * as vscode from 'vscode';
import { GitService } from '../git/GitService';
import { scanDiff, redactDiff } from '../security/SecretScanner';
import { ProviderManager, ProviderNotConfiguredError } from '../providers/ProviderManager';
import { getSettings } from '../config/Settings';
import { writeMessageToScmInputBox } from '../ui/CommitMessagePanel';

function humanizeError(e: unknown): string {
  if (e instanceof ProviderNotConfiguredError) {
    return e.message;
  }
  if (e instanceof Error) {
    const code = (e as Error & { code?: string }).code;
    if (code === 'NOT_CONFIGURED' || code === 'UNAUTHORIZED') {
      return e.message;
    }
    if (code === 'RATE_LIMITED') {
      return e.message;
    }
    if (code === 'TIMEOUT') {
      return 'Request timed out. Check your network connection and retry.';
    }
    if (code === 'EMPTY_RESPONSE') {
      return 'The AI provider returned an empty response. Retry generation.';
    }
    if (/ENOTFOUND|ECONNREFUSED|Failed to fetch|fetch failed|network/i.test(e.message)) {
      return `Network error: ${e.message}`;
    }
    return e.message;
  }
  return String(e);
}

export function registerGenerateCommit(
  context: vscode.ExtensionContext,
  providerManager: ProviderManager,
  output: vscode.OutputChannel
): vscode.Disposable {
  return vscode.commands.registerCommand('diffly.generateCommit', async () => {
    const settings = getSettings();
    const git = new GitService();

    // 0. No git repo / no workspace → friendly message, no API call.
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
      void vscode.window.showInformationMessage(
        'Diffly: open a folder with a git repository first.'
      );
      return;
    }

    let diffResult: Awaited<ReturnType<GitService['getDiff']>>;
    try {
      diffResult = await git.getDiff(settings.maxDiffSize);
    } catch (e) {
      const retry = await vscode.window.showErrorMessage(
        `Diffly: could not read git diff. ${humanizeError(e)}`,
        'Retry'
      );
      if (retry === 'Retry') {
        void vscode.commands.executeCommand('diffly.generateCommit');
      }
      return;
    }

    if (!diffResult) {
      void vscode.window.showInformationMessage(
        'Diffly: no changes found (nothing staged or unstaged). Stage or edit files first — no API call was made.'
      );
      return;
    }

    if (diffResult.truncated) {
      const omitted = diffResult.omittedFiles.length > 0 ? `: ${diffResult.omittedFiles.join(', ')}` : '';
      void vscode.window.showWarningMessage(
        `Diffly: diff exceeded ${settings.maxDiffSize} chars and was truncated${omitted}.`
      );
    }

    // 1. Secret scan before any network call.
    let diffToSend = diffResult.diff;
    const scan = scanDiff(diffResult.diff, diffResult.changedFiles);
    if (scan.hasSecrets) {
      const files = scan.suspiciousFiles.length > 0 ? scan.suspiciousFiles.join(', ') : 'the diff';
      const detail =
        scan.findings.length > 0
          ? ` (${scan.findings.map((f) => f.pattern).join(', ')})`
          : '';
      const choice = await vscode.window.showWarningMessage(
        `Possible secrets detected in: ${files}${detail}. Continue anyway?`,
        'Redact and continue',
        'Send anyway',
        'Cancel'
      );
      if (choice === 'Redact and continue') {
        diffToSend = redactDiff(diffToSend);
        output.appendLine('[Diffly] Secrets redacted before sending.');
      } else if (choice === 'Send anyway') {
        // proceed with original diff
      } else {
        return; // Cancel or dismissed
      }
    }

    // 2. Provider must be configured — prompt to configure instead of failing silently.
    try {
      await providerManager.getConfiguredProvider();
    } catch (e) {
      if (e instanceof ProviderNotConfiguredError) {
        const action = await vscode.window.showErrorMessage(
          'Diffly: API key is not set.',
          'Configure now'
        );
        if (action === 'Configure now') {
          void vscode.commands.executeCommand('diffly.configureProvider');
        }
        return;
      }
      throw e;
    }
    const provider = providerManager.getActiveProvider();

    // 3. Generate with progress + cancellation + retry.
    const generate = async (
      progress: vscode.Progress<{ message?: string }>,
      token: vscode.CancellationToken
    ): Promise<string | null> => {
      progress.report({ message: `Generating with ${provider.displayName}...` });
      const cancelled = new Promise<null>((resolve) =>
        token.onCancellationRequested(() => resolve(null))
      );
      const work = provider.generateCommitMessage(diffToSend, {
        commitStyle: settings.commitStyle,
        changedFiles: diffResult!.changedFiles,
        model: settings.model,
        customInstructions: settings.customInstructions,
      });
      const result = await Promise.race([work, cancelled]);
      return result;
    };

    let message: string | null = null;
    try {
      message = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Diffly: generating commit message',
          cancellable: true,
        },
        generate
      );
    } catch (e) {
      const cause = humanizeError(e);
      output.appendLine(`[Diffly] Generation failed (${provider.id}/${settings.model}): ${cause}`);
      const action = await vscode.window.showErrorMessage(
        `Diffly: generation failed — ${cause}`,
        'Retry',
        'Configure Provider'
      );
      if (action === 'Retry') {
        void vscode.commands.executeCommand('diffly.generateCommit');
      } else if (action === 'Configure Provider') {
        void vscode.commands.executeCommand('diffly.configureProvider');
      }
      return;
    }

    if (message === null || message === undefined) {
      // Cancelled via progress notification.
      return;
    }
    if (message.trim().length === 0) {
      const action = await vscode.window.showErrorMessage(
        'Diffly: provider returned an empty message.',
        'Retry'
      );
      if (action === 'Retry') {
        void vscode.commands.executeCommand('diffly.generateCommit');
      }
      return;
    }

    output.appendLine(`[Diffly] Generated (${provider.id}): ${message}`);
    // Write straight into the SCM commit box — never auto-commit.
    const written = await writeMessageToScmInputBox(message);
    if (!written) {
      await vscode.env.clipboard.writeText(message);
      void vscode.window.showInformationMessage(
        'Diffly: SCM input box unavailable — message copied to clipboard.'
      );
      return;
    }
    const action = await vscode.window.showInformationMessage(
      'Diffly: message written to the commit box — review before committing.',
      'Regenerate'
    );
    if (action === 'Regenerate') {
      void vscode.commands.executeCommand('diffly.generateCommit');
    }
  });
}
