import * as vscode from 'vscode';
import { ProviderManager } from './providers/ProviderManager';
import { registerGenerateCommit } from './commands/generateCommit';
import { registerConfigureProvider } from './commands/configureProvider';

let repoWarningShown = false;

async function hasGitRepo(): Promise<boolean> {
  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    return false;
  }
  // If the built-in git extension reports repos, trust it.
  try {
    const gitExt = vscode.extensions.getExtension<{ getAPI(version: number): { repositories: unknown[] } }>('vscode.git');
    const api = gitExt?.exports?.getAPI?.(1);
    if (api && Array.isArray(api.repositories) && api.repositories.length > 0) {
      return true;
    }
  } catch {
    // fall through to filesystem check
  }
  // Fallback: check for a .git folder.
  try {
    const gitUri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, '.git');
    await vscode.workspace.fs.stat(gitUri);
    return true;
  } catch {
    return false;
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('Diffly');
  const providerManager = new ProviderManager(context);

  context.subscriptions.push(
    output,
    registerGenerateCommit(context, providerManager, output),
    registerConfigureProvider(context, providerManager)
  );

  // One-time hint when there is no git repo — commands stay registered but
  // generateCommit exits early with a friendly message.
  if (!(await hasGitRepo()) && !repoWarningShown) {
    repoWarningShown = true;
    void vscode.window.showInformationMessage(
      'Diffly: no git repository detected in the open workspace. Open a git repo to generate commit messages.'
    );
  }
}

export function deactivate(): void {
  // No-op: nothing to clean up.
}
