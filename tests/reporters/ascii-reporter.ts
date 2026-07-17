/**
 * b3rys ASCII Test Reporter — Vitest 4.x
 *
 * 리팩토링 중 테스트 진행 상황을 터미널에서 보기 좋게 표시.
 *
 * Vitest 4.x API:
 *   testCase.result().state → 'passed' | 'failed' | 'skipped' | 'pending'
 *   testCase.diagnostic()?.duration → ms
 *   module.diagnostic().duration → ms
 *   module.moduleId → absolute path
 *   module.children → iterable of TestSuite | TestCase
 */

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const CYAN = '\x1b[36m';
const BG_GREEN = '\x1b[42m';
const BG_RED = '\x1b[41m';
const WHITE = '\x1b[97m';

interface FileResult {
  name: string;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
}

export default class AsciiReporter {
  private totalTests = 0;
  private completedTests = 0;
  private passedTests = 0;
  private failedTests = 0;
  private skippedTests = 0;
  private fileResults: FileResult[] = [];
  private startTime = 0;
  private currentFile = '';
  private errors: { file: string; test: string; error: string }[] = [];

  onInit() {
    this.startTime = Date.now();
    const banner = [
      '',
      `${DIM}╔${'═'.repeat(54)}╗${RESET}`,
      `${DIM}║${RESET}  ${GREEN}${BOLD}b3rys translate${RESET} ${DIM}—${RESET} Test Runner ${DIM}${'·'.repeat(22)}║${RESET}`,
      `${DIM}╚${'═'.repeat(54)}╝${RESET}`,
      '',
    ];
    process.stdout.write(banner.join('\n') + '\n');
  }

  onTestModuleCollected(module: any) {
    const count = this.countTests(module);
    this.totalTests += count;
  }

  onTestModuleStart(module: any) {
    const filepath: string = module.moduleId || '';
    this.currentFile = filepath.replace(/^.*tests\//, 'tests/');
    process.stdout.write(`${DIM}  ┌─${RESET} ${CYAN}${this.currentFile}${RESET}\n`);
  }

  onTestCaseResult(testCase: any) {
    this.completedTests++;

    const result = typeof testCase.result === 'function' ? testCase.result() : testCase.result;
    const state: string = result?.state ?? 'unknown';
    const name: string = testCase.name || 'unknown';

    if (state === 'passed') {
      this.passedTests++;
      process.stdout.write(`${DIM}  │${RESET}  ${GREEN}✓${RESET} ${DIM}${name}${RESET}\n`);
    } else if (state === 'failed') {
      this.failedTests++;
      process.stdout.write(`${DIM}  │${RESET}  ${RED}✗ ${name}${RESET}\n`);
      const errors = result?.errors || [];
      for (const err of errors) {
        const msg = err.message || String(err);
        this.errors.push({ file: this.currentFile, test: name, error: msg.split('\n')[0] });
      }
    } else {
      this.skippedTests++;
      process.stdout.write(`${DIM}  │  ○ ${name}${RESET}\n`);
    }
  }

  onTestModuleEnd(module: any) {
    const filepath: string = (module.moduleId || '').replace(/^.*tests\//, 'tests/');
    const { passed, failed, skipped } = this.collectResults(module);
    const diag = typeof module.diagnostic === 'function' ? module.diagnostic() : null;
    const duration = diag?.duration ?? 0;
    const durationStr = duration < 1 ? '<1' : String(Math.round(duration));

    this.fileResults.push({ name: filepath, passed, failed, skipped, duration });

    const status = failed > 0 ? `${RED}FAIL${RESET}` : `${GREEN}PASS${RESET}`;
    const total = passed + failed + skipped;
    const bar = this.progressBar(this.completedTests, this.totalTests, 30);
    process.stdout.write(
      `${DIM}  └─${RESET} ${status} ${DIM}(${total} tests, ${durationStr}ms)${RESET}\n`,
    );
    process.stdout.write(`\n  ${bar}  ${this.completedTests}/${this.totalTests}\n\n`);
  }

  onTestRunEnd() {
    const elapsed = Date.now() - this.startTime;

    // Error details
    if (this.errors.length > 0) {
      process.stdout.write(`\n${RED}${BOLD}  ✗ FAILURES${RESET}\n`);
      process.stdout.write(`${DIM}  ${'─'.repeat(54)}${RESET}\n`);
      for (const err of this.errors) {
        process.stdout.write(`\n  ${RED}●${RESET} ${err.file}\n`);
        process.stdout.write(`    ${RED}${err.test}${RESET}\n`);
        process.stdout.write(`    ${DIM}${err.error}${RESET}\n`);
      }
      process.stdout.write('\n');
    }

    // Summary table
    process.stdout.write(`${DIM}  ${'═'.repeat(54)}${RESET}\n`);
    process.stdout.write(`  ${BOLD}Results${RESET}\n`);
    process.stdout.write(`${DIM}  ${'─'.repeat(54)}${RESET}\n`);

    const nameW = 38;
    const testW = 7;
    const timeW = 7;
    process.stdout.write(
      `  ${DIM}${'File'.padEnd(nameW)}${'Tests'.padStart(testW)}${'Time'.padStart(timeW)}${RESET}\n`,
    );
    process.stdout.write(`${DIM}  ${'─'.repeat(54)}${RESET}\n`);

    for (const f of this.fileResults) {
      const icon = f.failed > 0 ? `${RED}✗${RESET}` : `${GREEN}✓${RESET}`;
      const shortName = f.name.replace(/\.test\.ts$/, '').replace(/^tests\//, '');
      const testCount = `${f.passed + f.failed + f.skipped}`;
      const durationStr = f.duration < 1 ? '<1ms' : `${Math.round(f.duration)}ms`;
      const failNote = f.failed > 0 ? ` ${RED}(${f.failed} fail)${RESET}` : '';
      process.stdout.write(
        `  ${icon} ${shortName.padEnd(nameW - 2)}${testCount.padStart(testW)}${durationStr.padStart(timeW)}${failNote}\n`,
      );
    }

    process.stdout.write(`${DIM}  ${'─'.repeat(54)}${RESET}\n`);

    // Totals
    const parts = [];
    if (this.passedTests > 0) parts.push(`${GREEN}${BOLD}${this.passedTests} passed${RESET}`);
    if (this.failedTests > 0) parts.push(`${RED}${BOLD}${this.failedTests} failed${RESET}`);
    if (this.skippedTests > 0) parts.push(`${YELLOW}${this.skippedTests} skipped${RESET}`);

    process.stdout.write(
      `\n  ${BOLD}Total:${RESET} ${parts.join(`${DIM} │ ${RESET}`)}  ${DIM}(${elapsed}ms)${RESET}\n`,
    );

    // Final banner
    if (this.failedTests === 0) {
      process.stdout.write(
        `\n  ${BG_GREEN}${WHITE}${BOLD} ALL TESTS PASSED ${RESET} ${GREEN}Safe to refactor ✓${RESET}\n\n`,
      );
    } else {
      process.stdout.write(
        `\n  ${BG_RED}${WHITE}${BOLD} TESTS FAILED ${RESET} ${RED}Fix before continuing ✗${RESET}\n\n`,
      );
    }
  }

  // ── Helpers ──

  private progressBar(current: number, total: number, width: number): string {
    if (total === 0) return `${DIM}[${'░'.repeat(width)}]${RESET}`;
    const pct = Math.min(current / total, 1);
    const filled = Math.round(pct * width);
    const empty = width - filled;
    const color = this.failedTests > 0 ? RED : GREEN;
    const pctStr = `${Math.round(pct * 100)}%`.padStart(4);
    return `${DIM}[${RESET}${color}${'█'.repeat(filled)}${RESET}${DIM}${'░'.repeat(empty)}]${RESET} ${pctStr}`;
  }

  private countTests(module: any): number {
    let count = 0;
    const walk = (node: any) => {
      if (!node) return;
      const children = node.children;
      if (children && typeof children[Symbol.iterator] === 'function') {
        for (const child of children) {
          if (child.type === 'test') count++;
          else walk(child);
        }
      }
    };
    walk(module);
    return count;
  }

  private collectResults(module: any): { passed: number; failed: number; skipped: number } {
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    const walk = (node: any) => {
      if (!node) return;
      const children = node.children;
      if (children && typeof children[Symbol.iterator] === 'function') {
        for (const child of children) {
          if (child.type === 'test') {
            const r = typeof child.result === 'function' ? child.result() : child.result;
            const s = r?.state;
            if (s === 'passed') passed++;
            else if (s === 'failed') failed++;
            else skipped++;
          } else {
            walk(child);
          }
        }
      }
    };
    walk(module);
    return { passed, failed, skipped };
  }
}
