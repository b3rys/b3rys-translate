# Weekly health check

`npm run healthcheck` runs the current catalog from `utils/models.ts` through
its production translation engines, then runs these existing automated checks:

- `tests/acceptance/youtube-subtitles.test.ts`: subtitle fixture parsing and cue merging.
- `tests/youtube-mode-sync.test.ts`: subtitle mode synchronization.
- `tests/youtube-intercept-cache.test.ts`: intercepted subtitle response/cache behavior.
- `tests/selection-popup.test.ts`: drag selection translation popup behavior.

These are headless regression checks. They do not establish that live YouTube,
Chrome installation, or real pointer selection works in a running browser.

## Run

Use Node 22 or later. From the repository, install dependencies with `npm ci`
and generate WXT configuration with `npx wxt prepare`. Then run:

```sh
npm run healthcheck
npm run healthcheck -- --config /absolute/path/to/private-config.json
```

Default key inputs are `GEMINI_API_KEY`, `OPENAI_API_KEY`, and
`ANTHROPIC_API_KEY_B3RYS`. Empty variables are reported as `skip: key_absent`.
Upstage is skipped unless an explicit key file is configured. The script does
not search shell profiles, browser storage or credential stores.

An optional JSON config can supply `keyFiles` mapped by engine name (`gemini`,
`openai`, `anthropic`, `upstage`), with absolute paths to plaintext key files.
An explicit file overrides the environment. Missing/empty configured files fail.
Keep configuration under ignored `.healthcheck/` or outside the repository.
`scripts/healthcheck.example.json` contains no credentials.

Each model receives one short English sentence with output capped at 64 tokens.
The probe makes at most one network request per model, without retries. It uses
the production request builder/parser, intercepting only token limits, timeouts
and retryable errors. It checks for nonempty Korean output and returned thinking
blocks, including blocks discarded by the production parser. Reasoning usage
counters alone do not indicate returned thinking. This is a smoke test, not a
translation quality evaluation. Network timeout is 30 seconds per model; the
headless suite timeout is 120 seconds. Request parsing/token-limit setup errors
are reported as `probe_setup_failed` before any provider request is made.
With a 64-token limit, `invalid_translation` with empty/truncated output can
suggest reasoning consumed the output budget; this is a diagnostic clue, not
proof of thinking. Upstage has no default key variable and is skipped for lack
of a key unless a key file is explicitly configured.

## Results and notification

The default log is `.healthcheck/results.jsonl`. Override `logFile` with an
absolute path for scheduled operation. Each record contains a one-line summary,
per-model status/latency, test counts, failing assertion names, and notification
status. Credentials, provider response bodies, raw errors, and subprocess output
are never logged. Timestamps in the machine-readable log are UTC.

`PASS` means all configured checks passed. `PARTIAL` means at least one model was
skipped; this must not be interpreted as full model availability. Both exit 0
and send no notification. `FAIL` exits 1 and invokes `notifyCommand` once if
configured. Configuration/log/runner errors exit 2 and write a generic message
to stderr; the scheduler/operator must monitor those exits too.

`notifyCommand` is an argv array executed without a shell. The adapter receives
only the summary and failures on stdin. Example private config fragment:

```json
{
  "notifyCommand": [
    "bash",
    "/absolute/repo/scripts/healthcheck-notify-team.sh",
    "/absolute/team/skills/b3os-team-inbox/scripts/send.sh",
    "lisa",
    "translate-weekly-health"
  ]
}
```

The team adapter requires the team's normal member identity environment/cwd.
A notification failure is logged as `failed` and exits 1. A failure without an
adapter is recorded as `not_configured`; configure an adapter before scheduling.
To verify the failure path without API cost, configure one key file to an
intentionally nonexistent path and the notification adapter, then run once.
This must show `FAIL`, `key_file_unreadable`, and `notification=sent`.
Remove the invalid path after the test. Unit tests also verify that PASS/SKIP
never calls the adapter and provider error text cannot leak key values.

## Weekly scheduling (not registered)

Register only after operational confirmation. Use the b3os durable scheduler,
with a fixed id such as `sched_translate_weekly_health`, a weekly cron expression
(e.g. `0 9 * * 1`, Monday 09:00 Asia/Seoul), and holiday policy `run`.
The day/time is an example and requires confirmation.

Use the scheduler's inbox payload to wake the owner to execute the command in
this repository with the private config path. This needs no new exec allowlist
entry. The wake text must instruct the owner to remain silent on PASS/PARTIAL
and report runner errors, test failures, or notification failures. A direct exec
job requires a separately reviewed ops wrapper/allowlist entry. Do not create a
launchd job or OS cron entry. No schedule registration is performed by this PR.

Rollback: stop any subsequently registered schedule, then revert the PR commit.
