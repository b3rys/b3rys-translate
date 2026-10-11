#!/usr/bin/env python3
"""Run catalog regressions with deliberate defects in an isolated temporary copy."""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
mutants = [
    ("accept-negative-price", "utils/model-catalog.ts", "value >= 0", "value >= -1", 1),
    ("accept-two-defaults", "utils/model-catalog.ts", "defaultCount !== 1", "defaultCount === 0", 1),
    ("enable-haiku-thinking", "utils/engines/anthropic.ts", "thinking: { type: 'disabled' }", "thinking: { type: 'adaptive' }", 2),
    ("omit-gemini-thinking-cost", "utils/engines/gemini.ts", "(data.usageMetadata.thoughtsTokenCount ?? 0)", "0", 1),
    ("retain-retired-selection", "utils/models.ts", "return model?.engine === engine ? model.id : catalog.defaultModelIds[engine];", "return savedModel ?? catalog.defaultModelIds[engine];", 1),
    ("send-solar-reasoning", "utils/engines/upstage.ts", "temperature: TEMPERATURE,", "temperature: TEMPERATURE, reasoning_effort: 'high',", 1),
]
with tempfile.TemporaryDirectory(prefix="model-catalog-mutants-") as tmp:
    work = Path(tmp)
    for folder in ("utils", "config", "tests", "entrypoints", ".wxt"):
        shutil.copytree(root / folder, work / folder)
    for name in ("package.json", "tsconfig.json", "vitest.config.ts"):
        shutil.copy2(root / name, work / name)
    (work / "node_modules").symlink_to((root / "node_modules").resolve(), target_is_directory=True)

    def run(label, should_fail):
        report = work / "result.json"
        result = subprocess.run([
            str(work / "node_modules/.bin/vitest"), "run", "tests/model-catalog-loader.test.ts", "tests/model-refresh.test.ts",
            "--reporter=json", "--outputFile", str(report),
        ], cwd=work, capture_output=True, text=True)
        if not report.exists():
            raise RuntimeError(result.stdout + result.stderr)
        data = json.loads(report.read_text())
        failures = data["numFailedTests"]
        print(f"{label}: exit={result.returncode} passed={data['numPassedTests']} failed={failures}")
        if should_fail:
            assert result.returncode != 0 and failures > 0, f"UNPROVEN mutant: {label}"
        else:
            assert result.returncode == 0 and failures == 0, "baseline failed"
        report.unlink()

    run("baseline", False)
    for name, relative, before, after, occurrences in mutants:
        path = work / relative
        original = path.read_text()
        assert original.count(before) == occurrences, f"mutation target mismatch: {name}"
        try:
            path.write_text(original.replace(before, after))
            assert after in path.read_text(), f"mutation not applied: {name}"
            run(name, True)
        finally:
            path.write_text(original)
            assert path.read_text() == (root / relative).read_text(), "restore mismatch"
    run("restored", False)
