# Backend invariants

- PostgreSQL owns schedules, approvals, claims and upload sessions; Redis schedules work (`scheduler.ts`). Public pagination must never limit worker queues.
- Validate external input with Zod; use parameterized SQL and `AppError` for expected failures. Reuse schemas/types rather than parallel contracts.
- Publishing: preserve account identity, explicit consent, revision checks, claims and ambiguous-upload handling (`local-publisher.ts`, `native-api.ts`, `browser-bridge.ts`). Unknown outcomes must not become automatic retries.
- Cuts: `withJob` serializes edits/publishing/discard with advisory transaction locks (`cuts.ts`). Upload staging/recovery shares that lock (`cuts-upload-files.ts`). Captions retain source speech and time alignment.
- Cleanup removes application-owned copies after confirmation; preserve originals, unresolved sessions and audit rows (`media-cleanup.ts`). Age alone proves nothing.
- Lists: filter before keyset/LIMIT; retain microsecond timestamps, bigint IDs and independent totals (`pagination.ts`, `dashboard-lists.ts`).
