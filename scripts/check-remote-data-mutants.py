#!/usr/bin/env python3
"""Prove remote-data checks detect regressions in an isolated temporary copy."""
import pathlib
import shutil
import subprocess
import tempfile

root = pathlib.Path(__file__).resolve().parents[1]
source = (root / 'utils/remote-data.ts').read_text()
mutants = [
    ('version', 'snapshot.index.version !== index.version', 'false',
     'loads cards lazily and replaces cached words on a new version'),
    ('offline-cache', 'if (Object.hasOwn(snapshot.words, word)) return structuredClone(snapshot.words[word]);',
     'if (Object.hasOwn(snapshot.words, word)) return null;',
     'falls back to persisted data on server failure and to bundle on a cold start'),
    ('models-validation', 'return catalog.diagnostics.length ? bundled : catalog;',
     'return catalog;', 'rejects invalid remote models wholly and returns bundled models'),
]
for name, before, after, test in mutants:
    if source.count(before) != 1:
        raise SystemExit(f'FAIL {name}: source anchor is not unique')
    with tempfile.TemporaryDirectory(prefix='tolk-mutant-') as temp:
        target = pathlib.Path(temp)
        for directory in ['utils', 'config', 'tests']:
            shutil.copytree(root / directory, target / directory)
        for filename in ['package.json', 'vitest.config.ts']:
            shutil.copy2(root / filename, target / filename)
        (target / 'node_modules').symlink_to((root / 'node_modules').resolve())
        (target / 'utils/remote-data.ts').write_text(source.replace(before, after))
        result = subprocess.run([str(root / 'node_modules/.bin/vitest'), 'run',
            'tests/remote-data.test.ts', '-t', test, '--reporter=json'],
            cwd=target, capture_output=True, text=True, timeout=30)
        import json
        try:
            report = json.loads(result.stdout)
        except json.JSONDecodeError:
            raise SystemExit(f'FAIL {name}: runner did not produce a test report\n{result.stderr}')
        if result.returncode == 0 or report.get('numFailedTests') != 1:
            raise SystemExit(f'FAIL {name}: expected exactly one failing check\n{result.stdout}')
        print(f'PASS {name}: injected defect caught (1 failed test)')
if (root / 'utils/remote-data.ts').read_text() != source:
    raise SystemExit('FAIL source changed during mutant run')
print('PASS original source unchanged')
