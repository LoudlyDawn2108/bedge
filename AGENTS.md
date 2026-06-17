# AGENTS.md

## Repo Basics
- Single Vite/Solid app, not a monorepo. Browser entry is `index.html` -> `src/index.tsx` -> `src/App.tsx`.
- Use npm for installs/commands; `package-lock.json` is the only lockfile.
- Vite 7 requires Node `^20.19.0 || >=22.12.0`; older Node versions fail before app code runs.

## Commands
- `npm run dev` starts Vite with an untrusted HTTPS cert from `@vitejs/plugin-basic-ssl` (normally `https://localhost:5173/`; Vite increments the port if 5173 is busy).
- `npm run build` is the main verification gate: it runs `tsc -b && vite build`.
- `npm run preview` serves the production build.
- There are no repo scripts for tests, lint, or standalone typecheck; do not invent them in reports.
- GitHub Pages deploys from `main` with Node 22, `npm ci`, then `npm run build -- --base=/${{ github.event.repository.name }}/`.

## Toolchain Quirks
- `vite.config.ts` uses `vite-plugin-solid` and `@vitejs/plugin-basic-ssl`; the worker build format is ES modules and `build.target` is `esnext`.
- MuPDF needs special Vite handling: `optimizeDeps.exclude` contains `mupdf`, `assetsInclude` includes `**/*.wasm`, and dev-server FS access is widened for MuPDF assets.
- TypeScript is strict and treats unused locals/parameters as errors. The app config aliases `dexie` to `./node_modules/dexie/dist/dexie`; keep that alias intact.
- Solid JSX is preserved by TypeScript (`jsx: "preserve"`, `jsxImportSource: "solid-js"`), and `src/index.tsx` opts into Vite refresh reload at the root.

## Architecture Boundaries
- `src/App.tsx` is the orchestration layer for opening/reopening PDFs, resetting stores, opening `documentSession`, restoring TOC/progress, and persisting reading state. Avoid moving file, library, or persistence lifecycle into leaf components.
- Keep PDF processing behind this path: `App` -> `services/documentSession.ts` -> `pdf/PdfWorkerClient.ts`/`pdf/protocol.ts` -> `pdf/worker/pdf.worker.ts` -> `pdf/worker/mupdfEngine.ts`.
- UI and app services should call `documentSession`; do not import or call MuPDF directly outside the worker boundary.
- `src/services/pdfService.ts` is only a compatibility type re-export; do not treat it as an active PDF service.
- `documentSession` owns document/session tokens, page metrics/text/link caches, in-flight request de-duping, rendering to canvas, and selection cleanup.
- `src/components/PDFViewer.tsx` is more than a canvas component: it owns virtualization/windowing, render epochs, initial reveal, selection UI, links, keyboard scroll, TTS auto-scroll, and layout-driven cache invalidation.

## State And Persistence
- `pdfStore` owns current book, current page/offset, zoom, TOC, loaded pages, sidebar state, and link-history navigation.
- `readingSessionStore` owns sentence caches, playback cursor, column mode, and header/footer margins. Layout or zoom changes can intentionally clear sentence caches.
- IndexedDB uses Dexie DB name `pdfest`. `Book` records store progress, layout settings, file handles, and thumbnails; PDF blobs are legacy data removed by `removeLegacyPdfBlobs()`.
- Reopening stored PDFs must re-check File System Access API permissions and tolerate missing/stale handles; file input is the fallback when `showOpenFilePicker` is unavailable.
- Internal PDF-link browser history is session-scoped in `pdfHistory`; do not replace it with plain `window.history` calls from components.

## TTS / Reading Model
- TTS uses `@andresaya/edge-tts`; the default voice is `en-US-AndrewMultilingualNeural`.
- `ttsService` caches synthesized MP3 object URLs by document/layout/voice/request, capped at 8 entries and 12 MiB.
- `App` sets the TTS layout cache key from column mode, header/footer margins, and zoom; changing any of those can invalidate audio and sentence caches.
- `sentenceBuilder` filters header/footer by margins, supports two-column ordering, dehyphenates same-block line breaks, and uses sentence IDs shaped as `${pageNum}:${sentenceIndex}`.
- Internal page numbers are 0-based. Keep text, highlight, and `currentPageOffsetY` geometry in page coordinates and transform for display; zoom should not become the source of truth for the reading model.
- Continuation sentences can span page boundaries; playback may preload/splice the next page's first sentence instead of treating page ends as hard sentence ends.

## Verification Notes
- For code changes, run `npm run build` unless the change is documentation-only.
- For PDF/TTS behavior changes, manually smoke-test opening a PDF, TOC jumps, scrolling, zoom, playback controls, sentence highlighting, auto-scroll, and reopen/resume behavior.
