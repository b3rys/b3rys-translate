import process from 'node:process';
import { readFile, mkdir, appendFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const suites = [
  'tests/acceptance/youtube-subtitles.test.ts',
  'tests/youtube-mode-sync.test.ts',
  'tests/youtube-intercept-cache.test.ts',
  'tests/selection-popup.test.ts',
];

// Only returned blocks/content count here. Usage counters alone do not prove
// that private reasoning was returned to the user.
export function hasThinking(value) {
  if (typeof value === 'string') return /<\/?(?:think|thinking|analysis)\b/i.test(value);
  if (!value || typeof value !== 'object') return false;
  if (['thinking', 'redacted_thinking', 'reasoning', 'analysis'].includes(value.type)) return true;
  if (value.thought === true) return true;
  return Object.entries(value).some(([key, item]) =>
    /^(thinking|reasoning_content|reasoning|analysis)$/.test(key)
      ? Boolean(item && (typeof item !== 'string' || item.trim()))
      : hasThinking(item),
  );
}

export const keyVariables = {
  gemini: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY_B3RYS',
};

export async function probe(
  model,
  keyFile,
  getEngine,
  request = globalThis.fetch,
  environment = process.env,
) {
  const result = { name: `model:${model.id}`, status: 'skip', latencyMs: null, thinking: null };
  let key = environment[keyVariables[model.engine]]?.trim();
  if (!keyFile && !key) return { ...result, detail: 'key_absent' };
  try {
    if (keyFile) key = (await readFile(keyFile, 'utf8')).trim();
    if (!key) return { ...result, status: 'fail', detail: 'key_file_empty' };
  } catch {
    return { ...result, status: 'fail', detail: 'key_file_unreadable' };
  }
  const started = performance.now();
  const original = globalThis.fetch;
  let calls = 0;
  let thinking = false;
  let httpStatus;
  globalThis.fetch = async (url, options) => {
    // Keep the production request builder/parser, but cap the health probe at
    // one paid request per model even when the engine retries internally.
    if (++calls > 1) throw new Error('healthcheck_request_limit');
    const body = JSON.parse(options.body);
    if (model.engine === 'gemini') body.generationConfig.maxOutputTokens = 64;
    else if (model.engine === 'openai') body.max_completion_tokens = 64;
    else body.max_tokens = 64;
    try {
      const response = await request(url, {
        ...options,
        body: JSON.stringify(body),
        signal: globalThis.AbortSignal.timeout(30000),
      });
      httpStatus = response.status;
      thinking = hasThinking(await response.clone().json());
      // The production engine retries 429/5xx. A probe records the original
      // status and supplies a terminal error so there is no retry or backoff.
      if (!response.ok)
        return new globalThis.Response('{"error":{"message":"healthcheck_http_error"}}', {
          status: 400,
        });
      return response;
    } catch {
      return new globalThis.Response('{"error":{"message":"healthcheck_request_failed"}}', {
        status: 400,
      });
    }
  };
  try {
    const response = await getEngine(model.engine).translate(
      key,
      [{ id: 'health', text: 'The sky is blue.' }],
      'page',
      undefined,
      { sourceLang: 'en', targetLang: 'ko' },
      model.id,
    );
    const text = response.translations.find((item) => item.id === 'health')?.translatedText ?? '';
    thinking ||= hasThinking(text);
    const valid = httpStatus >= 200 && httpStatus < 300 && /[가-힣]/.test(text);
    return {
      ...result,
      status: valid && !thinking ? 'pass' : 'fail',
      thinking,
      latencyMs: Math.round(performance.now() - started),
      detail: thinking ? 'thinking_block_returned' : valid ? 'translated' : 'invalid_translation',
    };
  } catch {
    // Provider errors may echo credentials or request bodies. Never persist them.
    return {
      ...result,
      status: 'fail',
      thinking,
      latencyMs: Math.round(performance.now() - started),
      detail: httpStatus
        ? `provider_http_${httpStatus}_or_invalid_response`
        : 'request_failed_or_timeout',
    };
  } finally {
    globalThis.fetch = original;
    key = undefined;
  }
}

export async function runSuites(directory = root) {
  const temp = await mkdtemp(join(tmpdir(), 'translate-health-'));
  const output = join(temp, 'tests.json');
  const started = performance.now();
  try {
    const run = spawnSync(
      process.execPath,
      [
        join(root, 'node_modules/vitest/vitest.mjs'),
        'run',
        ...suites,
        '--reporter=json',
        `--outputFile=${output}`,
      ],
      { cwd: directory, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 },
    );
    let report;
    try {
      report = JSON.parse(await readFile(output, 'utf8'));
    } catch {
      /* reported below */
    }
    const assertions = report?.testResults?.flatMap((file) => file.assertionResults ?? []) ?? [];
    const failed = assertions.filter((test) => test.status === 'failed');
    const complete = suites.every((suite) =>
      report?.testResults?.some(
        (file) =>
          file.name.endsWith(suite) &&
          file.status === 'passed' &&
          file.assertionResults?.length > 0 &&
          file.assertionResults.every((test) => test.status === 'passed'),
      ),
    );
    return {
      name: 'youtube-and-selection',
      status: run.status === 0 && complete ? 'pass' : 'fail',
      latencyMs: Math.round(performance.now() - started),
      detail: `passed=${report?.numPassedTests ?? 0} failed=${report?.numFailedTests ?? 0} skipped=${report?.numPendingTests ?? 0}`,
      // Assertion names identify the failed behavior without printing captured
      // stdout, error messages, snapshots, response bodies or environment data.
      failures: failed.map((test) => test.fullName),
    };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

export function summarize(results) {
  const count = (status) => results.filter((item) => item.status === status).length;
  return `translate-health ${count('fail') ? 'FAIL' : count('skip') ? 'PARTIAL' : 'PASS'} pass=${count('pass')} fail=${count('fail')} skip=${count('skip')}`;
}

export function notify(results, config, sender = spawnSync) {
  if (!results.some((item) => item.status === 'fail')) return 'not_needed';
  if (!config.notifyCommand) return 'not_configured';
  if (
    !Array.isArray(config.notifyCommand) ||
    !config.notifyCommand.length ||
    !config.notifyCommand.every((arg) => typeof arg === 'string')
  )
    return 'failed';
  const message = [
    summarize(results),
    ...results
      .filter((item) => item.status === 'fail')
      .map(
        (item) =>
          `${item.name}: ${item.detail}${item.failures?.length ? ` (${item.failures.join('; ')})` : ''}`,
      ),
  ].join('\n');
  // argv only, no shell; adapter reads a safe summary from stdin.
  const sent = sender(config.notifyCommand[0], config.notifyCommand.slice(1), {
    input: message,
    encoding: 'utf8',
    timeout: 15000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return sent.status === 0 && !sent.error ? 'sent' : 'failed';
}

export async function main(args = process.argv.slice(2)) {
  let config = {};
  try {
    if (args.length && !(args.length === 2 && args[0] === '--config')) throw new Error();
    if (args.length) config = JSON.parse(await readFile(resolve(args[1]), 'utf8'));
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error();
  } catch {
    process.stderr.write('translate-health FAIL config_unreadable_or_invalid\n');
    return 2;
  }
  const results = [];
  let server;
  try {
    server = await createServer({
      root,
      configFile: false,
      logLevel: 'silent',
      server: { middlewareMode: true, watch: null },
      appType: 'custom',
    });
    const { MODEL_CATALOG } = await server.ssrLoadModule('/utils/models.ts');
    const { getEngine } = await server.ssrLoadModule('/utils/engines/index.ts');
    for (const model of MODEL_CATALOG) {
      const result = await probe(model, config.keyFiles?.[model.engine], getEngine);
      results.push(result);
    }
  } catch {
    results.push({
      name: 'model-catalog',
      status: 'fail',
      detail: 'catalog_or_engine_load_failed',
    });
  } finally {
    await server?.close();
  }
  results.push(await runSuites());
  const notification = notify(results, config);
  const record = {
    at: new Date().toISOString(),
    summary: summarize(results),
    results,
    notification,
  };
  const line = JSON.stringify(record);
  try {
    const log = resolve(config.logFile ?? join(root, '.healthcheck/results.jsonl'));
    await mkdir(dirname(log), { recursive: true, mode: 0o700 });
    await appendFile(log, `${line}\n`, { mode: 0o600 });
  } catch {
    process.stderr.write('translate-health FAIL log_write_failed\n');
    return 2;
  }
  process.stdout.write(`${record.summary} notification=${notification}\n`);
  for (const result of results) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
  return results.some((item) => item.status === 'fail') || notification === 'failed' ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      process.stderr.write('translate-health FAIL runner_error\n');
      process.exitCode = 2;
    });
}
