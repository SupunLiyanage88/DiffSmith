import * as vscode from 'vscode';
import { AIProvider } from './AIProvider';
import { NvidiaProvider } from './NvidiaProvider';
import { getSettings } from '../config/Settings';

export class ProviderNotConfiguredError extends Error {
  constructor(providerId: string) {
    super(
      `AI provider "${providerId}" is not configured (missing API key or unreachable endpoint). Run "CommitForge: Configure Provider" to fix this.`
    );
    this.name = 'ProviderNotConfiguredError';
    (this as Error & { code?: string }).code = 'NOT_CONFIGURED';
  }
}

export class ProviderManager {
  private providers: Map<string, AIProvider>;

  constructor(context: vscode.ExtensionContext) {
    this.providers = new Map<string, AIProvider>([
      ['nvidia', new NvidiaProvider(context)],
      // Future providers (openai, gemini, ollama, claude) register here.
    ]);
  }

  getActiveProvider(): AIProvider {
    const { provider } = getSettings();
    const active = this.providers.get(provider);
    if (!active) {
      throw new Error(
        `Unknown AI provider "${provider}". Supported: ${[...this.providers.keys()].join(', ')}.`
      );
    }
    return active;
  }

  async getConfiguredProvider(): Promise<AIProvider> {
    const active = this.getActiveProvider();
    if (!(await active.isConfigured())) {
      throw new ProviderNotConfiguredError(active.id);
    }
    return active;
  }

  listProviders(): AIProvider[] {
    return [...this.providers.values()];
  }
}
