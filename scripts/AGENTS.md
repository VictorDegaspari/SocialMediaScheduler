# Script boundaries

- Use `./scripts/node-local.sh <script-or-node-args>` for Node 22+ and local environment loading. Do not assume the shell's default Node is supported.
- `test-integration.sh` creates isolated test databases and mounts local source into Docker. `test-ui.sh` runs browser checks and manages its named QA fixtures; it touches the running service.
- `check-cuts-ui.mjs` and `check-pagination-ui.mjs` serve local assets with fake APIs. Other `check-*-ui.mjs`/`check-browser-panel.mjs` may use the running server for assets; inspect request interception before execution.
- Keep tests finite and clean up temporary servers, browsers, files and QA records. Use meaningful status/output with nonzero exit on failure.
- Operational scripts can queue work or open account sessions. Preserve their action semantics during refactoring. Diagnostics must not print environment secrets, OAuth credentials or upload-session URLs.
