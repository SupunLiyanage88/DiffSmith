import * as vscode from 'vscode';
import { CommitStyle } from '../providers/AIProvider';

export interface CommitForgeSettings {
  provider: string;
  model: string;
  commitStyle: CommitStyle;
  maxDiffSize: number;
  customInstructions: string;
}

const VALID_STYLES: CommitStyle[] = ['conventional', 'simple', 'gitmoji', 'custom'];

export function getSettings(): CommitForgeSettings {
  const cfg = vscode.workspace.getConfiguration('commitforge');
  const rawStyle = cfg.get<string>('commitStyle', 'conventional');
  const commitStyle: CommitStyle = VALID_STYLES.includes(rawStyle as CommitStyle)
    ? (rawStyle as CommitStyle)
    : 'conventional';
  return {
    provider: cfg.get<string>('provider', 'nvidia'),
    model: cfg.get<string>('model', 'deepseek-ai/deepseek-v4-pro-0813'),
    commitStyle,
    maxDiffSize: cfg.get<number>('maxDiffSize', 15000),
    customInstructions: cfg.get<string>('customInstructions', ''),
  };
}

export async function updateSetting(
  key: 'provider' | 'model' | 'commitStyle' | 'maxDiffSize' | 'customInstructions',
  value: string | number,
  target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global
): Promise<void> {
  await vscode.workspace.getConfiguration('commitforge').update(key, value, target);
}
