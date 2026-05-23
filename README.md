# bedge

bedge is a local-first PDF reader built with Solid, Vite, MuPDF, Dexie, and Edge TTS. It focuses on long-form reading: reopen books from disk, keep your place, navigate outlines and links, select text, and listen to PDFs sentence by sentence.

## What is interesting here

- **Local PDF library**: open PDFs from disk, save them in a browser library, and continue from the last page. On browsers with the File System Access API, bedge stores file handles so it can reopen files without storing the PDF blob in IndexedDB.
- **Persistent reading state**: saves page, scroll offset, sentence cursor, zoom level, header/footer margins, and one-column or two-column reading mode.
- **MuPDF in a Web Worker**: rendering, outlines, links, text extraction, and text selection happen off the main thread through a typed worker boundary.
- **Continuous canvas viewer**: pages render in a vertical scroll surface with viewport windowing so large PDFs do not need every page mounted at once.
- **Table of contents and PDF links**: reads nested PDF outlines, jumps to page destinations, supports internal PDF links with browser back/forward history, and opens safe external links separately.
- **Text selection and copy**: drag-select text over rendered pages and copy through the normal clipboard flow.
- **Sentence-level text to speech**: extracts PDF text into sentence units, filters header/footer regions, supports two-column ordering, highlights the active sentence, auto-scrolls during playback, and prefetches nearby audio.
- **Neural voice playback**: uses Microsoft Edge neural TTS through `@andresaya/edge-tts`, with `en-US-AndrewMultilingualNeural` as the default voice and a small object-URL audio cache for smoother playback.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `W` | Scroll up |
| `S` | Scroll down |
| `A` | Previous sentence |
| `D` | Next sentence |
| `Space` | Play or pause TTS |

## How it works

The app entry is `index.html` -> `src/index.tsx` -> `src/App.tsx`. `App` owns the book-opening lifecycle: stop playback, save progress, reset stores, open the PDF session, restore outline/progress/layout state, and persist changes as you read.

PDF processing is kept behind a worker-backed session layer:

```text
App
  -> services/documentSession.ts
  -> pdf/PdfWorkerClient.ts + pdf/protocol.ts
  -> pdf/worker/pdf.worker.ts
  -> pdf/worker/mupdfEngine.ts
```

`documentSession` is the main app-facing PDF facade. It owns document/session tokens, page metric/text/link caches, in-flight request deduping, canvas rendering, selection state, and text preloading. Direct MuPDF usage stays inside `mupdfEngine.ts`.

State is split by responsibility:

- `src/stores/pdfStore.ts` tracks the current book, current page and offset, zoom, TOC/sidebar state, loaded pages, and internal-link history state.
- `src/stores/readingSessionStore.ts` tracks sentence caches, playback cursor, playing state, column mode, and header/footer margins.
- `src/services/db.ts` stores book records and settings in the Dexie IndexedDB database named `pdfest`. That legacy database key is kept so existing saved books and progress continue to open after the app rename.

## Browser APIs used

- File System Access API for reopenable local PDF handles, with file input fallback.
- IndexedDB through Dexie for the local library and reading state.
- Web Workers for MuPDF operations.
- Canvas/ImageBitmap for rendering PDF pages.
- Clipboard copy events for selected text.
- History API for internal PDF link navigation.
- HTML audio and object URLs for synthesized speech playback.

## Tech stack

- Solid 1.9
- Vite 7
- TypeScript 5.9
- MuPDF WASM
- Dexie
- `@vitejs/plugin-basic-ssl`

## Requirements

- Node `^20.19.0` or `>=22.12.0` for Vite 7.
- npm. This repo uses `package-lock.json` as its only lockfile.

## Setup

```bash
npm install
npm run dev
```

The dev server uses an untrusted local HTTPS certificate from `@vitejs/plugin-basic-ssl`. Open the HTTPS URL Vite prints, usually:

```text
https://localhost:5173/
```

If port 5173 is busy, Vite will print the next available HTTPS URL.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the Vite dev server with local HTTPS. |
| `npm run build` | Runs `tsc -b` and creates the production Vite build in `dist/`. |
| `npm run preview` | Serves the production build locally. |

`npm run build` is the main verification command for this project. There are currently no separate test or lint scripts.

## Vite and MuPDF notes

MuPDF needs a few Vite-specific settings in `vite.config.ts`: ES module workers, `esnext` build target, `mupdf` excluded from dependency optimization, WASM assets included, and dev-server file-system access widened for MuPDF assets.
