import * as vscode from 'vscode';

async function writeToScmInputBox(message: string): Promise<boolean> {
  // Preferred: built-in git extension API.
  try {
    const gitExt = vscode.extensions.getExtension<{ getAPI(version: number): GitAPI }>('vscode.git');
    const api = gitExt?.exports?.getAPI?.(1);
    const repo = api?.repositories?.[0];
    if (repo) {
      repo.inputBox.value = message;
      return true;
    }
  } catch {
    // fall through
  }
  return false;
}

interface GitAPI {
  repositories: { inputBox: { value: string } }[];
}

/**
 * Show the generated message with Use / Regenerate / Cancel.
 * "Use Message" writes to the SCM input box — it never auto-commits.
 */
export async function showCommitMessage(
  message: string,
  onRegenerate: () => void | Promise<void>
): Promise<void> {
  interface ActionItem extends vscode.QuickPickItem {
    id: 'use' | 'regenerate' | 'cancel';
  }
  const items: ActionItem[] = [
    { id: 'use', label: '$(check) Use Message', description: 'Write to SCM input box (no auto-commit)', detail: message },
    { id: 'regenerate', label: '$(refresh) Regenerate', description: 'Generate a new message from the same diff' },
    { id: 'cancel', label: '$(x) Cancel', description: 'Discard this message' },
  ];
  const selected = await vscode.window.showQuickPick(items, {
    title: 'CommitForge: Generated Commit Message',
    placeHolder: message,
    ignoreFocusOut: true,
  });
  if (!selected || selected.id === 'cancel') {
    return;
  }
  if (selected.id === 'regenerate') {
    await onRegenerate();
    return;
  }
  const ok = await writeToScmInputBox(message);
  if (!ok) {
    await vscode.env.clipboard.writeText(message);
    void vscode.window.showInformationMessage(
      'CommitForge: SCM input box unavailable — message copied to clipboard.'
    );
  }
}
