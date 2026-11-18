# Browser invariants

- Browser ES modules remain in `public/`; migrated Vue/TypeScript views live in `public/components/`. Vite builds them into ignored `public/build/` assets; run `npm run build:frontend` before isolated UI checks and `npm run dev:frontend` to watch component changes. Keep business rules in existing controllers and domain modules during migration.
- User-visible text stays pt-BR. Keep API names, selectors and event data attributes stable when extracting modules. Vue templates escape interpolated values; do not use `v-html` for dynamic content.
- Escape dynamic HTML/attributes with the existing `esc` helper; preserve URL validation. Mutation requests use the existing API wrapper and origin header.
- Cuts updates are incremental (`cuts-panel.js`): preserve typed forms, the playing video and open editor during polling.
- Phone/source playback share one clock. Apply `cuts-playback.js` mappings across excluded ranges; wait for the decoded selected frame before painting (`cuts-editor.js`). Keep milliseconds and source zero (`cuts-time.js`, `cuts-replay.js`).
- Caption inputs use the phone timeline; API cues remain source-absolute. `cuts-captions.js` projects rows and merges drafts; starts/ends use different sides of a junction. Keep the DOM's caption plan until committing its edits.
- `pagination.js` owns collection cursor histories; counts come from global summaries. Confirmed discard sends `{confirm:true}`; cancellation sends nothing.
- Use isolated UI fixtures in `scripts/check-cuts-ui.mjs` and `scripts/check-pagination-ui.mjs` for these flows.
