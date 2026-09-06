import * as vscode from 'vscode';
import { ProviderManager } from '../providers/ProviderManager';
import { updateSetting } from '../config/Settings';

export function registerConfigureProvider(
  context: vscode.ExtensionContext,
  providerManager: ProviderManager
): vscode.Disposable {
  return vscode.commands.registerCommand('diffly.configureProvider', async () => {
    const providers = providerManager.listProviders();
    const picked = await vscode.window.showQuickPick(
      providers.map((p) => ({ label: p.displayName, description: p.id, provider: p })),
      { title: 'Diffly: Select AI Provider', ignoreFocusOut: true }
    );
    if (!picked) {
      return;
    }

    // Persist provider selection (provider enum grows one entry per new provider class).
    await updateSetting('provider', picked.provider.id);

    // Provider-specific setup lives on the provider itself — this command
    // never hardcodes provider details.
    if (picked.provider.configure) {
      await picked.provider.configure(context);
    } else {
      void vscode.window.showInformationMessage(
        `Diffly: provider "${picked.provider.id}" selected.`
      );
    }
  });
}
