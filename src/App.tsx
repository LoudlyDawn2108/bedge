import { Show, createSignal, createEffect, onCleanup, onMount } from 'solid-js';
import type { Component } from 'solid-js';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { PDFViewer } from './components/PDFViewer';
import { LibraryModal } from './components/LibraryModal';
import { documentSession } from './services/documentSession';
import { ttsService } from './services/ttsService';
import { pdfStore } from './stores/pdfStore';
import { readingSession } from './stores/readingSessionStore';
import { playbackController } from './controllers/playbackController';
import { addBook, deleteBook, getBookByPath, updateBook, getAllBooks, removeLegacyPdfBlobs, type Book, type StoredPDFFileHandle } from './services/db';
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

const App: Component = () => {
  const [showLibrary, setShowLibrary] = createSignal(false);
  let fileInputRef: HTMLInputElement | undefined;

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
    try {
      playbackController.stop();
      await documentSession.open(source);
      pdfStore.setTotalPages(documentSession.numPages);
      pdfStore.setCurrentViewportPosition(0, 0);
      pdfStore.clearNavigation();
      pdfStore.clearLoadedPages();
      readingSession.resetDocumentState();

      documentSession.onPageTextReady = (pageNum, words, dims) => {
        readingSession.addPageSentences(pageNum, words, dims.height, dims.width, pdfStore.zoomLevel());
      };

      const toc = await documentSession.getTOC();
      pdfStore.setTOC(toc);

      let book = await getBookByPath(bookMeta.path);
      if (!book) {
        const id = await addBook({
          path: bookMeta.path,
          title: bookMeta.title,
          totalPages: documentSession.numPages,
          lastPage: 0,
          lastPageOffsetY: 0,
          lastSentence: 0,
          zoomLevel: 2.5,
          headerMargin: 50,
          footerMargin: 60,
          columnMode: 1,
          lastOpened: Date.now(),
          fileHandle: bookMeta.fileHandle,
        });
        book = await getAllBooks().then(books => books.find(b => b.id === id));
      } else {
        const updates: Partial<Book> = { lastOpened: Date.now() };
        if (bookMeta.fileHandle) {
          updates.fileHandle = bookMeta.fileHandle;
        }
        await updateBook(book.id!, updates);
        book = { ...book, ...updates };
      }

      if (book) {
        pdfStore.setCurrentBook(book);
        pdfStore.setZoomLevel(book.zoomLevel);
        readingSession.setHeaderMargin(book.headerMargin);
        readingSession.setFooterMargin(book.footerMargin);
        readingSession.setColumnMode(book.columnMode);

        const maxPage = Math.max(0, documentSession.numPages - 1);
        const restoredPage = Math.max(0, Math.min(book.lastPage, maxPage));
        const restoredOffsetY = Math.max(0, book.lastPageOffsetY ?? 0);
        const restoredSentence = Math.max(0, book.lastSentence);

        readingSession.goToSentence(restoredPage, restoredSentence);
        pdfStore.goToPage(restoredPage, restoredOffsetY);
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
      const permission = await book.fileHandle.queryPermission?.({ mode: 'read' });
      if (permission !== 'granted') {
        const requestedPermission = await book.fileHandle.requestPermission?.({ mode: 'read' });
        if (requestedPermission !== 'granted') {
          alert('Permission to reopen this PDF was not granted. The library entry was kept.');
          return;
        }
      }

      const file = await book.fileHandle.getFile();
      await openBook(file, { path: book.path, title: book.title, fileHandle: book.fileHandle });
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

  function handleTOCSelect(pageNum: number, y?: number) {
    pdfStore.goToPage(pageNum, y);
  }

  let persistTimer: number | undefined;

  onMount(() => {
    void removeLegacyPdfBlobs().catch(error => {
      console.error('Failed to remove legacy PDF blobs:', error);
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
          <PDFViewer />
        </Show>
      </div>
    </div>
  );
};

export default App;
