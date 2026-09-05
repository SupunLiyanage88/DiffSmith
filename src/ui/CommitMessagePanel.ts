import * as vscode from 'vscode';

interface GitAPI {
  repositories: { inputBox: { value: string } }[];
}

/**
 * Write the message straight into the Source Control commit box.
 * Never commits — the user reviews and commits manually.
 * Returns false when no git repo input box is available.
 */
export async function writeMessageToScmInputBox(message: string): Promise<boolean> {
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
