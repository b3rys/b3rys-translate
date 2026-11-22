# Remote data (development checkpoint)

`config/remote-data.json` is the only endpoint configuration. Development uses
`http://127.0.0.1:8766/index.json`; production has no endpoint and uses the bundled
model catalog. No hosting, permissions or store release are configured here.

For a local fixture server:

```sh
python3 -m http.server 8766 --bind 127.0.0.1 --directory tests/fixtures/remote-data
npm run dev
```

The index contains `{ version, models, etym: { base, count } }`. `models` uses the
same schema as `config/models.json`. Word documents live at
`etym/<lowercase-word>.json`; the TypeScript schema and validator are in
`utils/etymology.ts`. The two fixtures copy the design mockup, including its SVG
scenes. They are development examples, not independently fact-checked articles;
linked root documents are not included yet.

The background owns a bounded persistent word cache (200 entries). Requests check
the index after ten minutes; opening settings checks it immediately. A new
version or word base clears cached words. Failed index requests retain the last
snapshot; a cold failure uses bundled models and returns no etymology. Invalid
remote models use the entire bundled catalog. Requests time out after two seconds.
The endpoint is stored with the cache to isolate environments. Redirects and
cross-origin word bases are rejected. JSON is never evaluated as code.

`GET_MODEL_CATALOG` returns `{ catalog }`; `GET_ETYMOLOGY` takes `word` and returns
`{ etymology }` or `{ etymology: null }`. The next UI stage can use the latter;
selection-popup rendering is not implemented in this checkpoint. Each translation
uses one catalog snapshot for model resolution, engine dispatch and usage costs.

```sh
npx vitest run tests/remote-data.test.ts tests/remote-background.test.ts tests/popup-main.test.ts
python3 scripts/check-remote-data-mutants.py
```

The mutant runner copies sources into temporary directories, injects version,
offline-cache and model-validation defects separately, and requires one failing
test for each. It never edits the working source.

This checkpoint is paused pending the new project/repository and server-side saved
word requirements. Do not treat it as a release or a finalized storage contract.
