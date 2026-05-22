# PDF TTS Architecture Redesign Plan

## Objective

Redesign the current PDF processing and interactive TTS highlighting architecture so the app remains correct at the sentence-highlighting level while becoming more performant, more maintainable, and smoother during scrolling, zooming, navigation, and playback.

## Current State Summary

The current implementation is centered on a small set of files:

- `src/App.tsx`
- `src/components/PDFViewer.tsx`
- `src/services/pdfService.ts`
- `src/services/ttsService.ts`
- `src/stores/pdfStore.ts`
- `src/stores/ttsStore.ts`
- `src/services/db.ts`

Confirmed issues from the exploration phase:

1. `PDFViewer` currently owns too many responsibilities. It raster-renders pages, extracts text, builds sentence state, computes highlights, and auto-scrolls playback.
2. `pdfService.getTextContent(pageNum, scale)` returns zoom-scaled word geometry, so zoom changes invalidate the reading model and force text/sentence rebuilds.
3. `App.tsx` playback snapshots the sentence array once before looping, so lazily loaded later pages are not safely incorporated into playback.
4. `ttsStore` stores a single global sentence array and resorts it after each page extraction.
5. Highlight ownership is too tightly coupled to the viewer and current rendering timing.
6. Persistence fields exist in Dexie for `lastPage`, `lastSentence`, `pdfBlob`, and view settings, but resume/reopen is only partially wired.
7. The project currently has no automated tests beyond build/typecheck, so each phase must end in a buildable and manually verifiable state.

## Target Architecture

Split the app into three main layers:

1. `DocumentSession`
   - Owns the opened PDF document lifecycle.
   - Owns page metadata, TOC, page dimensions, raw page text extraction, and raster caching.
   - Exposes stable APIs for document queries.

2. `ReadingSession`
   - Owns reading settings and reading state.
   - Owns sentence derivation, per-page sentence caches, stable sentence identity, cursor state, and playback state.
   - Does not own MuPDF document handles or canvas rendering.

3. Thin UI Projection Layer
   - `PDFViewer` becomes a projection surface for visible pages, bitmap rendering, highlight rendering, and navigation behavior.
   - `App` and/or a playback controller become orchestration only.
   - UI layers request data from sessions instead of constructing document or reading state themselves.

## Global Invariants

These rules apply to every phase and must remain true unless a phase explicitly replaces them with a safer equivalent:

1. Internal `pageNum` stays 0-based.
2. Text and highlight geometry must be stored in page coordinates, not zoom-scaled screen coordinates.
3. Zoom changes may invalidate raster output, but must not invalidate the underlying text model.
4. The viewer must not be the long-term owner of sentence derivation or playback state mutation.
5. Playback must resolve the current sentence dynamically instead of iterating a stale snapshot.
6. Highlight geometry and spoken text normalization must remain separable so dehyphenation does not destroy highlight placement fidelity.
7. Existing user-visible behavior should be preserved unless a task explicitly improves a confirmed bug.

## Non-Goals

These items are intentionally out of scope for the main execution unless the plan reaches the explicit escalation phase:

- Word-level timing alignment or karaoke-style highlighting.
- Replacing MuPDF with another PDF engine.
- Major visual redesign of the app shell.
- Large library-management feature work unrelated to reading architecture.
- Background worker migration before stable session boundaries exist.

## Constraints

1. Do not use type suppression (`as any`, `@ts-ignore`, `@ts-expect-error`).
2. Do not revert unrelated user changes.
3. Keep diffs incremental and buildable at the end of each phase.
4. Prefer compatibility-preserving refactors before removals.
5. Reuse existing modules and naming where practical to reduce migration risk.
6. Use existing Dexie schema fields if they are sufficient; only change schema if phase work proves current fields cannot support reliable resume behavior.

## Phase Format

Every phase below contains:

- Goal
- Files
- Tasks
- Dependencies
- Validation
- Exit Criteria

Task granularity rules:

- Each task should touch one responsibility and usually 1 to 3 files.
- Each task should leave the project in a buildable state.
- Do not combine interface extraction, caller migration, and dead-code deletion in a single risky task unless the scope is truly trivial.

---

## [x] Phase 1: Stabilize Geometry and Sentence Identity

### Goal

Decouple the reading model from zoom by moving extracted word geometry into page space and centralizing sentence-building logic into a reusable, non-viewer-owned path.

### Files

- `src/services/pdfService.ts`
- `src/stores/ttsStore.ts`
- `src/components/PDFViewer.tsx`
- `src/App.tsx`
- `src/services/ttsService.ts`
- `src/services/db.ts`
- New: `src/services/sentenceBuilder.ts`
- New optional types file if needed: `src/services/readingTypes.ts`

### Tasks

[x] 1. Define stable reading-model types.
   - Introduce explicit types for page-space words and per-page sentences.
   - Include stable sentence identity using a page-local index or stable ID format such as `${pageNum}:${sentenceIndex}`.
   - Ensure spoken text and highlight geometry remain separately representable.

[x] 2. Refactor sentence derivation into a pure helper module.
   - Move sentence grouping logic out of `ttsStore.ts` into `src/services/sentenceBuilder.ts`.
   - Preserve existing punctuation splitting, block-aware splitting, header/footer filtering, and two-column handling.
   - Preserve current behavior unless a small correctness bug is clearly fixed and documented.

[x] 3. Normalize text extraction to page coordinates.
   - Update `pdfService.getTextContent(...)` so returned geometry is not multiplied by zoom.
   - Keep page bounds available so the viewer can transform page-space geometry into view-space later.
   - Preserve current MuPDF extraction fallbacks and dehyphenation/highlight fidelity.

[x] 4. Update highlight rendering to transform page-space geometry for display.
   - Adjust `PDFViewer` highlight calculations so overlay rendering derives from page-space words/sentences and the current zoom transform.
   - Remove assumptions that sentence geometry was pre-scaled.

[x] 5. Fix playback's stale-snapshot risk with minimal safe changes.
   - Update playback flow so it does not depend on a one-time snapshotted `sentences` array length.
   - Resolve current sentence dynamically each iteration while preserving current UX.

[x] 6. Keep the existing store structure buildable while preparing for later phase extraction.
   - `ttsStore` may still temporarily hold sentence state in this phase, but sentence building should no longer be embedded in the store itself.

### Dependencies

- None. This is the foundation phase.

### Validation

[x] 1. Run `npm run build`. (Zero new errors introduced; 5 pre-existing errors in db.ts/App.tsx/Sidebar.tsx remain unchanged.)
[ ] 2. Manual smoke check (requires browser runtime):
   - Open a PDF.
   - Scroll several pages.
   - Zoom in and out.
   - Verify highlight boxes still align with the spoken/current sentence.
   - Verify TOC navigation still lands on the correct page.
   - Verify playback still advances sentence by sentence.

### Exit Criteria

- Word/sentence geometry is stored in page coordinates.
- Zoom no longer requires rebuilding sentence geometry due solely to coordinate scaling.
- Sentence derivation is reusable outside the viewer/store.
- The build passes and baseline reader behavior remains intact.

---

## [x] Phase 2: Introduce DocumentSession Boundary

### Goal

Create a document-owned session layer that centralizes PDF document lifecycle, metadata, page queries, render requests, and text extraction/caching so the viewer stops owning extraction logic.

### Files

- `src/services/pdfService.ts`
- `src/components/PDFViewer.tsx`
- `src/App.tsx`
- `src/stores/pdfStore.ts`
- New: `src/services/documentSession.ts`
- New optional helper file(s): `src/services/documentCache.ts`, `src/services/documentSessionTypes.ts`

### Tasks

[x] 1. Define `DocumentSession` API.
   - Introduce an interface/class that owns open/close semantics, document metadata, TOC, page dimensions, page text retrieval, and raster rendering.
   - Shape methods so callers do not need to know whether data is fresh, cached, or pending.

[x] 2. Move document metadata ownership behind the session.
   - Centralize total page count, TOC loading, and page dimension queries.
   - Prefer true page metadata over guessed viewer heights where practical.

[x] 3. Add document-level caching.
   - Add cache structures for document metadata, raw page text, and raster requests/results.
   - Cache in-flight promises to prevent duplicate work during rapid scroll or playback requests.

[x] 4. Update `PDFViewer` to request document data rather than construct it.
   - Remove direct sentence-building mutations from `renderPage()`.
   - Restrict `PDFViewer` to requesting raster and display data from the session and updating viewport-related UI state.

[x] 5. Update `App` and store wiring to use the session boundary.
   - File-open flow should initialize the document session and then hydrate stores/UI from its outputs.
   - Keep the public behavior stable during migration.

[x] 6. Reduce `pdfStore` to view/navigation concerns only.
   - Keep current page, zoom, sidebar state, and navigation targets in the store.
   - Avoid duplicating document-derived content in multiple places once the session owns it.

### Dependencies

- Phase 1 complete.

### Validation

[x] 1. Run `npm run build`.
[ ] 2. Manual smoke check (requires browser runtime):
   - Open a PDF and confirm page count and TOC still load.
   - Scroll up/down through multiple pages.
   - Confirm page render requests do not duplicate visible work unnecessarily.
   - Confirm highlight data still appears for pages that have text.

### Exit Criteria

- `PDFViewer` no longer directly extracts text and inserts sentences into reading state.
- Document concerns have a single boundary.
- Repeated scroll or zoom requests dedupe work through the session.
- The app remains buildable and behaviorally stable.

---

## [x] Phase 3: Introduce ReadingSession Boundary and Playback Controller

### Goal

Move reading-state ownership out of `App` and out of the viewer by introducing a session/store boundary for reading settings, sentence caches, cursor state, playback state, and sentence lookup.

### Files

- `src/App.tsx`
- `src/stores/ttsStore.ts`
- `src/components/PDFViewer.tsx`
- `src/components/Toolbar.tsx`
- `src/stores/pdfStore.ts`
- `src/services/ttsService.ts`
- `src/services/sentenceBuilder.ts`
- New: `src/stores/readingSessionStore.ts`
- New: `src/controllers/playbackController.ts`

### Tasks

[x] 1. Define reading-session ownership.
   - Introduce a reading-session store for reading settings, stable cursor state, playback state, and page/sentence lookup.
   - Decide whether `ttsStore` is replaced outright or converted into a thin settings adapter during migration.

[x] 2. Move sentence caches to page-local ownership.
   - Replace the single global re-sorted sentence array with page-local caches or a page-addressable sentence index.
   - Preserve ordered sentence access for playback and page navigation.

[x] 3. Replace `currentSentenceIdx` as the primary source of truth.
   - Use stable cursor state such as `{ pageNum, sentenceIndex }` or a stable sentence ID.
   - Provide helper methods for resolving current sentence, next sentence, previous sentence, first sentence on a page, and fallback behavior for empty pages.

[x] 4. Extract playback orchestration into a controller.
   - Move the looping behavior out of `App.tsx` into `src/controllers/playbackController.ts`.
   - Playback should request the next sentence dynamically each iteration, not from a stale precomputed snapshot.
   - Preserve current stop/next/prev behavior while improving correctness.

[x] 5. Move auto-scroll decision ownership out of sentence mutation paths.
   - `PDFViewer` may still perform the actual scroll action, but the trigger should be based on stable reading-session cursor changes rather than viewer-owned sentence construction side effects.

[x] 6. Update toolbar/app integration.
   - Toolbar controls should act on the playback controller/reading session rather than on ad hoc app-local loop logic.

### Dependencies

- Phase 2 complete.

### Validation

[x] 1. Run `npm run build`.
[ ] 2. Manual smoke check (requires browser runtime):
   - Play from the current visible page.
   - Use next and previous during playback and while paused.
   - Scroll while playing and verify auto-scroll does not fight user interaction.
   - Jump through TOC entries during paused and active playback.
   - Confirm late-loaded pages can still participate in continued playback.

### Exit Criteria

- `App.tsx` no longer owns the primary playback loop.
- Viewer and app do not depend on a global re-sorted sentence array as the main reading model.
- Playback remains correct across lazy loading, page changes, and zoom changes.
- Cursor state is page-local or sentence-ID-based and stable enough for persistence.

---

## [x] Phase 4: Wire Persistence and Resume Correctly

### Goal

Use the existing Dexie layer to persist reading state and restore it safely, without introducing noisy writes or fragile assumptions.

### Files

- `src/services/db.ts`
- `src/App.tsx`
- `src/stores/pdfStore.ts`
- `src/stores/readingSessionStore.ts`
- `src/controllers/playbackController.ts`
- Optional touched file(s): `src/services/documentSession.ts`, `src/stores/ttsStore.ts`

### Tasks

[x] 1. Define persisted reading position semantics.
   - Reuse `lastPage` and `lastSentence` if possible.
   - Persist enough information to restore a stable reading target after reopen.
   - If the saved sentence cannot be restored exactly, define and implement fallback order:
     1. exact sentence on saved page
     2. first sentence on saved page
     3. page top

[x] 2. Persist current view and reading settings.
   - Keep `zoomLevel`, `headerMargin`, `footerMargin`, and `columnMode` aligned with actual session/store state.
   - Avoid excessive write frequency with debouncing or equivalent bounded update behavior.

[x] 3. Restore from DB during open/reopen flow.
   - When opening a known book, restore persisted settings and reading location after the document session is ready.
   - Keep behavior safe when cached blobs/settings exist but sentence data must be recomputed.

[x] 4. Connect `pdfBlob`/reopen behavior where appropriate.
   - If the repo intends local library reopen without requiring file re-selection, wire the stored blob path safely.
   - If full blob reopen is not ready in this phase, document the partial implementation clearly in code comments or phase notes and keep the schema aligned.

### Dependencies

- Phase 3 complete.

### Validation

[x] 1. Run `npm run build`.
[ ] 2. Manual smoke check (requires browser runtime):
   - Open a PDF, navigate to a later page, start/stop playback, close/reopen the same book path.
   - Verify view settings restore.
   - Verify reading resumes near the previous place using the fallback rules if needed.
   - Confirm DB writes do not occur on every tiny scroll tick.

### Exit Criteria

- Reading position and key view settings persist and restore correctly.
- Resume logic is robust when the exact old sentence is unavailable.
- The implementation remains incremental and buildable.

---

## [x] Phase 5: Thin the Viewer and Remove Transitional Coupling

### Goal

Finish the architecture split by removing leftover transitional logic from `PDFViewer`, `App`, and old store pathways so responsibilities are clean and maintainable.

### Files

- `src/components/PDFViewer.tsx`
- `src/App.tsx`
- `src/stores/ttsStore.ts`
- `src/stores/readingSessionStore.ts`
- `src/services/documentSession.ts`
- `src/controllers/playbackController.ts`
- Any obsolete helper/types files introduced during the migration

### Tasks

[x] 1. Remove viewer-owned reading mutations that remain from earlier phases.
   - `PDFViewer` should only project document state, viewport state, and highlights.
   - Sentence creation, cursor advancement, and playback rules should not live there.

[x] 2. Remove obsolete app-local playback logic.
   - `App` should orchestrate session lifecycle and wiring, not maintain sentence-loop internals.

[x] 3. Remove duplicated or transitional store logic.
   - If `ttsStore` still exists as a compatibility layer, either reduce it to a clear limited responsibility or remove it cleanly.
   - Delete obsolete helpers only after all callers are migrated.

[x] 4. Tighten overlay/highlight ownership.
   - Highlight rendering should consume stable reading/document state rather than inferred transient viewer state.

[x] 5. Simplify page rendering flow.
   - Ensure render requests, highlight requests, and navigation no longer cross-mutate each other through legacy pathways.

### Dependencies

- Phase 4 complete.

### Validation

[x] 1. Run `npm run build`.
[ ] 2. Final manual smoke checklist (requires browser runtime):
   - Open PDF.
   - Scroll continuously.
   - Zoom repeatedly.
   - Jump with TOC.
   - Play, stop, previous, next.
   - Observe highlight stability across page changes.
   - Confirm auto-scroll behavior remains smooth and does not fight manual scrolling.
   - Reopen and resume reading.

### Exit Criteria

- Viewer responsibilities are limited to projection/navigation behavior.
- Playback and reading state have clear ownership.
- Transitional coupling paths are removed.
- The refactor is complete without breaking baseline reader functionality.

---

## [ ] Phase 6: Escalation-Only Performance Follow-Up

**ASSESSMENT (post Phase 5): Trigger conditions cannot be confirmed without browser runtime. Phase 6 deferred pending manual validation. Session boundaries (DocumentSession, ReadingSession) are now stable enough for future worker migration if needed.**

### Goal

Only if the architecture remains too heavy after Phases 1 through 5, introduce deeper performance work such as workerization and stronger virtualization while keeping the new session contracts unchanged.

### Trigger Conditions

Do not start this phase unless one or more of the following remain true after Phase 5 validation:

1. Large PDFs still visibly freeze the UI during render/extraction.
2. Mounted page surfaces still make scrolling unacceptably heavy.
3. Raster memory growth is still problematic.
4. Session boundaries are stable enough that deeper performance changes can be made without reopening earlier architecture decisions.

### Files

- `src/services/documentSession.ts`
- `src/components/PDFViewer.tsx`
- `src/stores/pdfStore.ts`
- New worker-related file(s) if needed

### Tasks

[ ] 1. Move `DocumentSession` implementation behind a worker boundary.
   - Keep the session API stable for callers.
   - The worker should own the long-lived document handle and short-lived page work.

[ ] 2. Add stronger bounded caching and/or page virtualization.
   - Keep visible pages and small nearby buffers mounted or cached.
   - Evict far-away raster content using clear policies.

[ ] 3. Revalidate highlight and playback correctness under asynchronous worker responses.
   - Ensure stale async results do not override newer navigation or zoom state.

### Dependencies

- Phase 5 complete and trigger conditions met.

### Validation

[ ] 1. Run `npm run build`.
[ ] 2. Repeat final smoke checklist on larger PDFs.
[ ] 3. Confirm no playback/highlight regressions caused by worker timing.

### Exit Criteria

- Heavy documents feel smoother without regressing correctness.
- Workerization remains an implementation detail behind the stable session interfaces.

---

## Verification Standards for Every Phase

At the end of every phase:

1. Run `npm run build`.
2. Record any pre-existing issues separately from newly introduced issues.
3. Do not leave unused partial migrations in an ambiguous state.
4. If a phase introduces new files or abstractions, ensure all intended callers are updated or clearly queued for the immediately following phase.

## Manual Regression Checklist

Use this same checklist repeatedly through the plan:

1. Open a PDF.
2. Confirm the TOC loads.
3. Scroll to multiple pages.
4. Zoom in and out repeatedly.
5. Start playback from the current visible page.
6. Use previous and next while paused and while playing.
7. Observe sentence highlighting for current sentence alignment.
8. Confirm auto-scroll does not fight manual scrolling.
9. Jump via TOC during paused playback and active playback.
10. Reopen and verify resume behavior if persistence is active in that phase.

## Implementation Notes for Heracles

1. Preserve working behavior at the end of each phase. Do not defer all correctness to the last phase.
2. Prefer additive migration first, cleanup second.
3. If replacing a store/service path, migrate callers before deleting compatibility logic.
4. When persistence and cursor semantics conflict, prefer stable resume behavior over preserving an old fragile internal index.
5. If a phase reveals a safer split than anticipated, adapt within the phase goal but keep the target architecture and invariants intact.
6. Do not create commits unless explicitly requested by the user.

## Success Definition

This plan is complete when the app has:

1. A document-owned session boundary for PDF lifecycle and caching.
2. A reading-owned session boundary for sentence state, cursor state, and playback state.
3. A viewer that projects state rather than constructing the reading model.
4. Playback that remains correct as pages load lazily.
5. Highlighting that remains correct across zoom changes because geometry is page-space.
6. Working persistence/resume behavior that does not depend on a fragile global sentence array.
7. A final build that passes and manual regression behavior that matches or improves on the current app.
