const assert = require('node:assert/strict');
const { test, beforeEach, afterEach } = require('node:test');
const Module = require('node:module');

let settings;
let inputResult;
let pickResult;
let command;
const vscode = {
  ConfigurationTarget: { Global: 1 },
  workspace: {
    getConfiguration: () => ({
      get: (key, fallback) => settings[key] ?? fallback,
      update: async (key, value) => { settings[key] = value; },
    }),
  },
  window: {
    showInputBox: async () => inputResult,
    showQuickPick: async () => pickResult,
    showInformationMessage: async () => {},
    showWarningMessage: async () => {},
  },
  commands: {
    registerCommand: (_id, handler) => { command = handler; return { dispose() {} }; },
  },
};
const originalLoad = Module._load;
Module._load = function (id, ...args) {
  return id === 'vscode' ? vscode : originalLoad.call(this, id, ...args);
};
const { NvidiaProvider } = require('../out/providers/NvidiaProvider');
const { OpenRouterProvider } = require('../out/providers/OpenRouterProvider');
const { getSettings } = require('../out/config/Settings');
const { registerConfigureProvider } = require('../out/commands/configureProvider');
// Provider configure() lazily imports Settings, whose vscode dependency is cached.
Module._load = originalLoad;

const originalFetch = global.fetch;
const options = { commitStyle: 'conventional', changedFiles: ['app.ts'] };
const diff = '-const enabled = false;\n+const enabled = true;';
const context = {
  secrets: {
    get: async () => ' test-key ',
    store: async () => {},
  },
};
const success = (content = 'fix: enable the feature') => ({
  choices: [{ finish_reason: 'stop', message: { content } }],
});
function respond(data, status = 200) {
  return new Response(JSON.stringify(data), { status });
}
beforeEach(() => {
  settings = {};
  inputResult = undefined;
  pickResult = undefined;
});
afterEach(() => { global.fetch = originalFetch; });

test('NVIDIA default requests a final answer without spending the budget on thinking', async () => {
  global.fetch = async (url, init) => {
    assert.equal(url, 'https://integrate.api.nvidia.com/v1/chat/completions');
    assert.equal(init.headers.Authorization, 'Bearer test-key');
    assert.equal(init.headers.Accept, 'application/json');
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'deepseek-ai/deepseek-v4-pro-0813');
    assert.equal(body.stream, false);
    assert.equal(body.messages[1].content.includes(diff), true);
    assert.equal('extra_body' in body, false);
    // Reproduce the reported failure when the thinking control is missing.
    return respond(body.chat_template_kwargs?.thinking === false
      ? success()
      : { choices: [{ finish_reason: 'length', message: { content: null, reasoning_content: 'Analyzing the changes...' } }] });
  };
  assert.equal(await new NvidiaProvider(context).generateCommitMessage(diff, options), 'fix: enable the feature');
});

test('DeepSeek Flash and Nemotron use their respective thinking controls', async () => {
  for (const [model, expected] of [
    ['deepseek-ai/deepseek-v4-flash-0731', { thinking: false }],
    ['nvidia/nemotron-3.5-lightning-30b-a3b', { enable_thinking: false }],
  ]) {
    global.fetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.deepEqual(body.chat_template_kwargs, expected);
      assert.equal(body.max_tokens, 1024);
      return respond(success());
    };
    assert.equal(await new NvidiaProvider(context).generateCommitMessage(diff, { ...options, model }), 'fix: enable the feature');
  }
});

test('other NVIDIA models get reasoning headroom without unsupported thinking switches', async () => {
  for (const maxTokens of [undefined, 2048]) {
    global.fetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(body.model, 'minimaxai/minimax-m3');
      assert.equal(body.max_tokens, maxTokens ?? 8192);
      assert.equal('chat_template_kwargs' in body, false);
      return respond(success());
    };
    await new NvidiaProvider(context).generateCommitMessage(diff, { ...options, model: 'minimaxai/minimax-m3', maxTokens });
  }
});

test('NVIDIA never returns unfinished output or reasoning as the commit message', async () => {
  for (const commitStyle of ['conventional', 'simple', 'gitmoji', 'custom']) {
    global.fetch = async () => respond({ choices: [{ message: { content: null, reasoning_content: 'fix: draft subject', reasoning: 'Thinking about the changes' } }] });
    await assert.rejects(new NvidiaProvider(context).generateCommitMessage(diff, { ...options, commitStyle }), { code: 'EMPTY_RESPONSE' });
  }
  global.fetch = async () => respond({ choices: [{ finish_reason: 'length', message: { content: 'fix: incomplete' } }] });
  await assert.rejects(new NvidiaProvider(context).generateCommitMessage(diff, options), { code: 'OUTPUT_LIMIT' });
});

test('NVIDIA preserves API errors and explains unavailable models', async () => {
  for (const [status, code] of [[401, 'UNAUTHORIZED'], [429, 'RATE_LIMITED'], [404, 'MODEL_UNAVAILABLE'], [500, 'API_ERROR']]) {
    global.fetch = async () => respond({ error: { message: 'request failed' } }, status);
    await assert.rejects(new NvidiaProvider(context).generateCommitMessage(diff, options), { code });
  }
  global.fetch = async () => respond({ error: { message: 'routing failed' } });
  await assert.rejects(new NvidiaProvider(context).generateCommitMessage(diff, options), /routing failed/);
});

test('NVIDIA checks blank keys before calling the API and reports timeouts', async () => {
  global.fetch = async () => { assert.fail('must not send a request with an empty key'); };
  await assert.rejects(new NvidiaProvider({ secrets: { get: async () => '  ' } }).generateCommitMessage(diff, options), { code: 'NOT_CONFIGURED' });
  global.fetch = async () => { throw new DOMException('aborted', 'AbortError'); };
  await assert.rejects(new NvidiaProvider(context).generateCommitMessage(diff, options), { code: 'TIMEOUT', message: /120s/ });
});

test('OpenRouter still generates using its own default and request format', async () => {
  settings.provider = 'openrouter';
  global.fetch = async (url, init) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'openrouter/free');
    assert.equal(body.max_tokens, 1000);
    assert.equal('chat_template_kwargs' in body, false);
    return respond(success());
  };
  assert.equal(await new OpenRouterProvider(context).generateCommitMessage(diff, { ...options, model: getSettings().model }), 'fix: enable the feature');
});

test('switching providers clears incompatible model even when key setup is cancelled', async () => {
  for (const [from, model, provider] of [
    ['openrouter', 'openrouter/free', new NvidiaProvider(context)],
    ['nvidia', NvidiaProvider.defaultModel(), new OpenRouterProvider(context)],
  ]) {
    settings = { provider: from, model };
    pickResult = { provider };
    registerConfigureProvider(context, { listProviders: () => [provider] });
    await command();
    assert.equal(settings.provider, provider.id);
    assert.equal(settings.model, '');
  }
});

test('cancelling selection or configuring the same provider preserves a custom model', async () => {
  const provider = new NvidiaProvider(context);
  settings = { provider: 'nvidia', model: 'custom/model' };
  registerConfigureProvider(context, { listProviders: () => [provider] });
  await command();
  assert.equal(settings.model, 'custom/model');
  pickResult = { provider };
  await command();
  assert.equal(settings.model, 'custom/model');
});
