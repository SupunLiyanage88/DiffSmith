export interface SecretScanResult {
  hasSecrets: boolean;
  findings: SecretFinding[];
  /** Files (from changedFiles or diff headers) that look secret-bearing. */
  suspiciousFiles: string[];
}

export interface SecretFinding {
  pattern: string;
  file?: string;
  line?: number;
}

const SECRET_PATTERNS: { name: string; regex: RegExp }[] = [
  { name: 'AWS access key', regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'AWS secret key assignment', regex: /aws_secret_access_key\s*[:=]\s*['"]?[A-Za-z0-9/+=]{16,}['"]?/gi },
  // Note: backtick is excluded from values so documented examples like
  // `API_KEY=` in READMEs don't flag (real keys never contain backticks).
  { name: 'Generic API key/secret/token', regex: /\b(API_KEY|APIKEY|API_SECRET|SECRET|TOKEN|ACCESS_TOKEN)\b\s*[:=]\s*['"]?[^'"\s`]{8,}['"]?/gi },
  { name: 'Private key header', regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g },
  { name: 'GitHub token', regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: 'Slack token', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'Google API key', regex: /\bAIza[0-9A-Za-z_-]{20,}\b/g },
  { name: 'Heroku API key', regex: /\bHEROKU_API_KEY\s*[:=]\s*['"]?[0-9a-f-]{20,}['"]?/gi },
];

const SUSPICIOUS_FILE_PATTERNS: RegExp[] = [
  /(^|\/)\.env(\..+)?$/,
  /(^|\/)\.env\.local$/,
  /(^|\/)secrets?\.(json|ya?ml|toml|ini)$/i,
  /(^|\/)credentials?\.(json|ya?ml)$/i,
  /(^|\/)id_rsa$/,
  /(^|\/).*\.pem$/,
  /(^|\/).*\.key$/,
];

function diffLineNumbers(diff: string): Map<number, string> {
  const map = new Map<number, string>();
  diff.split('\n').forEach((line, idx) => map.set(idx + 1, line));
  return map;
}

export function scanDiff(diff: string, changedFiles: string[] = []): SecretScanResult {
  const findings: SecretFinding[] = [];
  const lines = diffLineNumbers(diff);

  for (const { name, regex } of SECRET_PATTERNS) {
    // Reset lastIndex for global regexes reused across lines
    for (const [lineNo, line] of lines) {
      // Skip diff headers (+++ / --- / diff --git) to reduce noise? No — still scan, but attribute file.
      regex.lastIndex = 0;
      if (regex.test(line)) {
        findings.push({ pattern: name, line: lineNo });
      }
    }
  }

  const suspiciousFiles = changedFiles.filter((f) =>
    SUSPICIOUS_FILE_PATTERNS.some((re) => re.test(f))
  );

  // Also detect .env-style content: lines like KEY=VALUE inside added diff lines
  const envLike = /^\+\s*[A-Z_]{3,}\s*=\s*.+/;
  for (const [lineNo, line] of lines) {
    if (envLike.test(line) && !findings.some((f) => f.line === lineNo)) {
      // Only flag if the file context suggests env/config; otherwise it's just code.
      // We flag conservatively and let suspiciousFiles carry the .env signal.
      if (suspiciousFiles.length > 0) {
        findings.push({ pattern: '.env-style assignment', line: lineNo });
        break;
      }
    }
  }

  return {
    hasSecrets: findings.length > 0 || suspiciousFiles.length > 0,
    findings,
    suspiciousFiles,
  };
}

/** Replace matched secret values with [REDACTED], preserving line structure. */
export function redactDiff(diff: string): string {
  let redacted = diff;
  const valuePatterns: RegExp[] = [
    // AKIA... keys
    /\bAKIA[0-9A-Z]{16}\b/g,
    // -----BEGIN PRIVATE KEY----- blocks: redact following base64 lines (heuristic: redact header line value)
    // Assignments: KEY=secretvalue -> KEY=[REDACTED]
    /(\b(?:API_KEY|APIKEY|API_SECRET|SECRET|TOKEN|ACCESS_TOKEN|aws_secret_access_key|HEROKU_API_KEY)\b\s*[:=]\s*['"]?)([^'"\s`]+)(['"]?)/gi,
    /\b(gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{20,})\b/g,
  ];
  redacted = redacted.replace(valuePatterns[0], '[REDACTED]');
  redacted = redacted.replace(
    valuePatterns[1],
    (_m, prefix: string, _val: string, suffix: string) => `${prefix}[REDACTED]${suffix}`
  );
  redacted = redacted.replace(valuePatterns[2], '[REDACTED]');
  // Redact base64-ish long lines immediately after a private key header
  const lines = redacted.split('\n');
  let inKeyBlock = false;
  for (let i = 0; i < lines.length; i++) {
    if (/-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/.test(lines[i])) {
      inKeyBlock = true;
      continue;
    }
    if (inKeyBlock) {
      if (/-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/.test(lines[i])) {
        inKeyBlock = false;
        continue;
      }
      if (lines[i].startsWith('+') || /^[A-Za-z0-9+/=]{16,}$/.test(lines[i].trim())) {
        const prefix = lines[i].startsWith('+') ? '+' : '';
        lines[i] = `${prefix}[REDACTED]`;
      }
    }
  }
  return lines.join('\n');
}
