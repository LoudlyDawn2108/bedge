import { Show, batch, createSignal, createEffect, onCleanup, onMount } from 'solid-js';
import type { Component } from 'solid-js';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { PDFViewer } from './components/PDFViewer';
import { LibraryModal } from './components/LibraryModal';
import { documentSession } from './services/documentSession';
import { pdfHistory } from './services/pdfHistory';
import { ttsService } from './services/ttsService';
import { pdfStore } from './stores/pdfStore';
import { DEFAULT_COLUMN_MODE, DEFAULT_FOOTER_MARGIN, DEFAULT_HEADER_MARGIN, readingSession } from './stores/readingSessionStore';
import { playbackController } from './controllers/playbackController';
import { addBook, deleteBook, getBookByPath, updateBook, getAllBooks, getMostRecentlyOpenedBook, removeLegacyPdfBlobs, type Book, type StoredPDFFileHandle } from './services/db';
import './App.css';

interface PDFOpenFilePickerOptions {
  multiple?: boolean;
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
  excludeAcceptAllOption?: boolean;
}

interface WindowWithPDFFilePicker extends Window {
  showOpenFilePicker?: (options?: PDFOpenFilePickerOptions) => Promise<StoredPDFFileHandle[]>;
}

const pdfPickerOptions: PDFOpenFilePickerOptions = {
  multiple: false,
  types: [
    {
      description: 'PDF files',
      accept: { 'application/pdf': ['.pdf'] },
    },
  ],
};

function getBookTitle(fileName: string): string {
  return fileName.replace(/\.pdf$/i, '');
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotFoundError';
}

interface BookTtsLayoutSettings {
  headerMargin: number;
  footerMargin: number;
  columnMode: number;
}

function getBookTtsLayoutSettings(book: Book): BookTtsLayoutSettings {
  return {
    headerMargin: book.headerMargin ?? DEFAULT_HEADER_MARGIN,
    footerMargin: book.footerMargin ?? DEFAULT_FOOTER_MARGIN,
    columnMode: book.columnMode ?? DEFAULT_COLUMN_MODE,
  };
}

function hasMissingBookTtsLayoutSettings(book: Book): boolean {
  return book.headerMargin == null || book.footerMargin == null || book.columnMode == null;
}

interface ReopenStoredBookOptions {
  requestPermission: boolean;
  canOpen?: () => boolean;
}

const App: Component = () => {
  const [showLibrary, setShowLibrary] = createSignal(false);
  let fileInputRef: HTMLInputElement | undefined;
  let openBookGeneration = 0;

  async function openFileDialog() {
    const openFilePicker = (window as WindowWithPDFFilePicker).showOpenFilePicker;
    if (openFilePicker) {
      try {
        const [fileHandle] = await openFilePicker.call(window, pdfPickerOptions);
        if (!fileHandle) return;

        const file = await fileHandle.getFile();
        await openBook(file, {
          path: file.name,
          title: getBookTitle(file.name),
          fileHandle,
        });
      } catch (error) {
        if (isAbortError(error)) return;
        console.error('Failed to open PDF from file picker:', error);
        alert('Failed to open PDF: ' + (error as Error).message);
      }
      return;
    }

    fileInputRef?.click();
  }

  async function openBook(source: File | Blob, bookMeta: { path: string; title: string; fileHandle?: StoredPDFFileHandle }) {
    openBookGeneration += 1;
    const generation = openBookGeneration;

    try {
      playbackController.stop();
      await saveProgressNow();

      batch(() => {
        pdfStore.setTotalPages(0);
        pdfStore.setCurrentBook(null);
        pdfStore.clearNavigation();
        pdfStore.clearLinkHistory();
        pdfStore.clearLoadedPages();
        pdfStore.setTOC([]);
        readingSession.resetDocumentState();
      });

      await documentSession.open(source);
      if (generation !== openBookGeneration) return;

      documentSession.onPageTextReady = (pageNum, words, dims) => {
        readingSession.addPageSentences(pageNum, words, dims.height, dims.width, pdfStore.zoomLevel());
      };

      const toc = await documentSession.getTOC();
      if (generation !== openBookGeneration) return;

      let book = await getBookByPath(bookMeta.path);
      if (generation !== openBookGeneration) return;

      if (!book) {
        const id = await addBook({
          path: bookMeta.path,
          title: bookMeta.title,
          totalPages: documentSession.numPages,
          lastPage: 0,
          lastPageOffsetY: 0,
          lastSentence: 0,
          zoomLevel: 2.5,
          headerMargin: DEFAULT_HEADER_MARGIN,
          footerMargin: DEFAULT_FOOTER_MARGIN,
          columnMode: DEFAULT_COLUMN_MODE,
          lastOpened: Date.now(),
          fileHandle: bookMeta.fileHandle,
        });
        if (generation !== openBookGeneration) return;
        book = await getAllBooks().then(books => books.find(b => b.id === id));
      } else {
        const updates: Partial<Book> = { lastOpened: Date.now() };
        if (bookMeta.fileHandle) {
          updates.fileHandle = bookMeta.fileHandle;
        }
        await updateBook(book.id!, updates);
        if (generation !== openBookGeneration) return;
        book = { ...book, ...updates };
      }

      if (book) {
        const ttsLayoutSettings = getBookTtsLayoutSettings(book);
        const restoredBook = { ...book, ...ttsLayoutSettings };
        const maxPage = Math.max(0, documentSession.numPages - 1);
        const restoredPage = Math.max(0, Math.min(book.lastPage, maxPage));
        const restoredOffsetY = Math.max(0, book.lastPageOffsetY ?? 0);
        const restoredSentence = Math.max(0, book.lastSentence);

        batch(() => {
          pdfStore.setCurrentBook(restoredBook);
          pdfStore.setZoomLevel(book.zoomLevel);
          readingSession.setHeaderMargin(ttsLayoutSettings.headerMargin);
          readingSession.setFooterMargin(ttsLayoutSettings.footerMargin);
          readingSession.setColumnMode(ttsLayoutSettings.columnMode);
          pdfStore.setTOC(toc);
          readingSession.goToSentence(restoredPage, restoredSentence);
          pdfStore.goToPage(restoredPage, restoredOffsetY);
          pdfStore.startLinkHistory(restoredPage, restoredOffsetY);
          pdfStore.setTotalPages(documentSession.numPages);
        });

        if (book.id !== undefined && hasMissingBookTtsLayoutSettings(book)) {
          void updateBook(book.id, ttsLayoutSettings).catch(error => {
            console.error('Failed to backfill TTS layout settings:', error);
          });
        }
      }

    } catch (err) {
      console.error('Failed to load PDF:', err);
      alert('Failed to load PDF: ' + (err as Error).message);
    }
  }

  async function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    await openBook(file, { path: file.name, title: getBookTitle(file.name) });
    input.value = '';
  }

  async function handleLibrarySelect(book: Book) {
    setShowLibrary(false);
    if (!book.fileHandle) {
      if (book.id !== undefined) await deleteBook(book.id);
      alert('This library entry has no saved file permission. Please reopen the PDF from disk. The stale entry was removed.');
      return;
    }

    try {
      const reopened = await reopenStoredBook(book, { requestPermission: true });
      if (!reopened) {
        alert('Permission to reopen this PDF was not granted. The library entry was kept.');
      }
    } catch (error) {
      if (isMissingFileError(error) && book.id !== undefined) {
        await deleteBook(book.id);
        alert('This PDF could not be found anymore, so it was removed from the library.');
        return;
      }

      console.error('Failed to reopen PDF from library:', error);
      alert('Failed to reopen PDF: ' + (error as Error).message);
    }
  }

  async function reopenStoredBook(book: Book, options: ReopenStoredBookOptions): Promise<boolean> {
    if (!book.fileHandle) return false;

    const permission = await book.fileHandle.queryPermission?.({ mode: 'read' });
    if (permission !== 'granted') {
      if (!options.requestPermission) return false;

      const requestedPermission = await book.fileHandle.requestPermission?.({ mode: 'read' });
      if (requestedPermission !== 'granted') return false;
    }

    const file = await book.fileHandle.getFile();
    if (options.canOpen && !options.canOpen()) return false;

    await openBook(file, { path: book.path, title: book.title, fileHandle: book.fileHandle });
    return true;
  }

  async function autoReopenLastBook(): Promise<void> {
    if (pdfStore.currentBook()) return;

    const book = await getMostRecentlyOpenedBook();
    if (!book?.fileHandle) return;
    const startupGeneration = openBookGeneration;

    try {
      if (pdfStore.currentBook()) return;
      const reopened = await reopenStoredBook(book, {
        requestPermission: false,
        canOpen: () => !pdfStore.currentBook() && openBookGeneration === startupGeneration,
      });
      if (!reopened) {
        console.info('Last PDF was not auto-reopened because read permission is not currently granted.');
      }
    } catch (error) {
      console.warn('Failed to auto-reopen last PDF:', error);
    }
  }

  function handleTOCSelect(pageNum: number, y?: number) {
    pdfStore.goToPage(pageNum, y);
  }

  let persistTimer: number | undefined;

  onMount(() => {
    pdfHistory.setManualScrollRestoration();

    const handlePopState = (event: PopStateEvent) => {
      const book = pdfStore.currentBook();
      if (!book) return;

      const state = pdfHistory.readPopState(event.state, pdfStore.totalPages());
      if (!state) return;

      const location = pdfHistory.applyPopState(state);
      pdfStore.navigateToPageFromHistory(location.pageNum, location.y);
    };

    window.addEventListener('popstate', handlePopState);

    void removeLegacyPdfBlobs().catch(error => {
      console.error('Failed to remove legacy PDF blobs:', error);
    });

    void autoReopenLastBook();

    onCleanup(() => {
      window.removeEventListener('popstate', handlePopState);
      pdfHistory.restoreScrollRestoration();
    });
  });

  async function saveProgressNow(): Promise<void> {
    const book = pdfStore.currentBook();
    if (!book?.id) return;

    const c = readingSession.cursor();
    const currentPage = pdfStore.currentPage();
    const persistedSentence = c.pageNum === currentPage ? c.sentenceIndex : 0;

    await updateBook(book.id, {
      lastPage: currentPage,
      lastPageOffsetY: pdfStore.currentPageOffsetY(),
      lastSentence: persistedSentence,
      zoomLevel: pdfStore.zoomLevel(),
      headerMargin: readingSession.headerMargin(),
      footerMargin: readingSession.footerMargin(),
      columnMode: readingSession.columnMode(),
    });
  }

  let ttsLayoutPersistInFlight = false;
  let ttsLayoutPersistQueued = false;

  function queueTtsLayoutSave(): void {
    const book = pdfStore.currentBook();
    if (!book?.id) return;

    ttsLayoutPersistQueued = true;
    if (ttsLayoutPersistInFlight) return;

    ttsLayoutPersistInFlight = true;
    void flushTtsLayoutSave();
  }

  async function flushTtsLayoutSave(): Promise<void> {
    try {
      while (ttsLayoutPersistQueued) {
        ttsLayoutPersistQueued = false;
        const book = pdfStore.currentBook();
        if (!book?.id) continue;

        await updateBook(book.id, {
          headerMargin: readingSession.headerMargin(),
          footerMargin: readingSession.footerMargin(),
          columnMode: readingSession.columnMode(),
        });
      }
    } catch (error) {
      console.error('Failed to save TTS layout settings:', error);
    } finally {
      ttsLayoutPersistInFlight = false;
      if (ttsLayoutPersistQueued) queueTtsLayoutSave();
    }
  }

  createEffect(() => {
    const book = pdfStore.currentBook();
    const zoom = pdfStore.zoomLevel();
    const headerMargin = readingSession.headerMargin();
    const footerMargin = readingSession.footerMargin();
    const columnMode = readingSession.columnMode();

    if (!book) {
      ttsService.clear();
      return;
    }

    ttsService.setContext({
      documentKey: String(book.id ?? book.path),
      layoutKey: `${columnMode}|${headerMargin}|${footerMargin}|${zoom}`,
    });
  });

  createEffect(() => {
    readingSession.cursor();
    pdfStore.currentPage();
    pdfStore.currentPageOffsetY();
    pdfStore.zoomLevel();
    readingSession.headerMargin();
    readingSession.footerMargin();
    readingSession.columnMode();

    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = window.setTimeout(async () => {
      await saveProgressNow();
    }, 2000);
  });

  createEffect(() => {
    pdfStore.currentBook();
    readingSession.headerMargin();
    readingSession.footerMargin();
    readingSession.columnMode();

    queueTtsLayoutSave();
  });

  createEffect(() => {
    const flushProgress = () => {
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = undefined;
      }
      void saveProgressNow();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushProgress();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', flushProgress);
    window.addEventListener('beforeunload', flushProgress);

    onCleanup(() => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', flushProgress);
      window.removeEventListener('beforeunload', flushProgress);
    });
  });

  return (
    <div class="app" style={{
      display: 'flex',
      'flex-direction': 'column',
      height: '100vh',
      background: '#1e1e1e'
    }}>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />

      <Show when={showLibrary()}>
        <LibraryModal onSelect={handleLibrarySelect} onClose={() => setShowLibrary(false)} />
      </Show>

      <Toolbar
        onOpenFile={openFileDialog}
        onOpenLibrary={() => setShowLibrary(true)}
        onPlay={() => playbackController.toggle()}
        onPrev={() => playbackController.prev()}
        onNext={() => playbackController.next()}
      />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar onSelectItem={handleTOCSelect} />

        <Show
          when={pdfStore.totalPages() > 0}
          fallback={
            <div style={{
              flex: 1,
              display: 'flex',
              'flex-direction': 'column',
              'justify-content': 'center',
              'align-items': 'center',
              color: '#888',
              gap: '20px'
            }}>
              <div style={{ 'font-size': '48px' }}>📄</div>
              <div>Open a PDF to start reading</div>
              <button onClick={openFileDialog} style={{
                padding: '12px 24px',
                'font-size': '16px',
                background: '#4CAF50',
                color: 'white',
                border: 'none',
                'border-radius': '8px',
                cursor: 'pointer'
              }}>
                Open PDF
              </button>
            </div>
          }
        >
          <PDFViewer shortcutsEnabled={!showLibrary()} />
        </Show>
      </div>
    </div>
  );
};

export default App;
