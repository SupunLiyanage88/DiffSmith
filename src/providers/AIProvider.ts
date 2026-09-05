export type CommitStyle = 'conventional' | 'simple' | 'gitmoji' | 'custom';

export interface GenerateOptions {
  commitStyle: CommitStyle;
  changedFiles: string[];
  model?: string;
  maxTokens?: number;
  customInstructions?: string;
}

export interface AIProvider {
  readonly id: string;
  readonly displayName: string;
  isConfigured(): Promise<boolean>;
  generateCommitMessage(diff: string, options: GenerateOptions): Promise<string>;
  /** Optional provider-specific setup (API key prompts, endpoint checks). */
  configure?(context: import('vscode').ExtensionContext): Promise<void>;
}
