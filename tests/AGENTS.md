# Test boundaries

- `*.test.ts`: focused logic; `*.integration.ts`: PostgreSQL/Redis/filesystem boundaries; `browser.browser.ts`: browser automation. UI flows live in `../scripts/check-*.mjs`.
- Integration files set their own database, Redis namespace and temporary media paths before dynamic imports. Preserve isolation; never truncate the user's database or flush shared Redis. Coordinate concurrent runs using the same test database.
- Mock remote publishing. Assert public behavior and persisted outcomes: deduplication, restart recovery, ambiguous uploads, consent, account/revision identity and safe cleanup.
- For media timing, verify decoded frames/audio/caption boundaries; checking only `currentTime` misses stale frames. Use synthetic sources, not network downloads or models.
- Pagination needs tied timestamps/microseconds, large IDs, filters before LIMIT, concurrent inserts and invariant totals. Confirmation tests must prove cancel/missing consent leaves files and records intact.
