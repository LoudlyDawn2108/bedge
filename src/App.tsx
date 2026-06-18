import { Show, batch, createSignal, createEffect, onCleanup, onMount } from 'solid-js';
import type { Component } from 'solid-js';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { PDFViewer } from './components/PDFViewer';
import { LibraryModal } from './components/LibraryModal';
import { MobileReaderChrome } from './components/MobileReaderChrome';
import { documentSession } from './services/documentSession';
import { pdfHistory } from './services/pdfHistory';
import { ttsService } from './services/ttsService';
import { pdfStore } from './stores/pdfStore';
import { DEFAULT_COLUMN_MODE, DEFAULT_FOOTER_MARGIN, DEFAULT_HEADER_MARGIN, readingSession } from './stores/readingSessionStore';
import { playbackController } from './controllers/playbackController';
import { addBook, deleteBook, getBookByPath, updateBook, updateBookTextFitProfile, getAllBooks, getMostRecentlyOpenedBook, removeLegacyPdfBlobs, type Book, type StoredPDFFileHandle } from './services/db';
import { buildTextFitProfile, isTextFitProfileCurrent, isTextFitProfileUsable } from './services/textFitProfile';
import { DEFAULT_ZOOM_LEVEL } from './utils/zoom';
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

const MOBILE_CHROME_HIDE_DELAY_MS = 2400;
const MOBILE_TTS_DOCK_INSET_PX = 68;

const App: Component = () => {
  const [showLibrary, setShowLibrary] = createSignal(false);
  const [mobileTocOpen, setMobileTocOpen] = createSignal(false);
  const [mobileSettingsOpen, setMobileSettingsOpen] = createSignal(false);
  const [mobileChromeVisible, setMobileChromeVisible] = createSignal(true);
  const [mobileFitWidthRequest, setMobileFitWidthRequest] = createSignal(0);
  const [mobileFitTextRequest, setMobileFitTextRequest] = createSignal(0);
  const [isMobileShell, setIsMobileShell] = createSignal(false);
  let fileInputRef: HTMLInputElement | undefined;
  let openBookGeneration = 0;
  let pendingMobileInitialFitGeneration: number | null = null;
  let pendingMobileInitialFitWidthGeneration: number | null = null;
  let lockedMobileInitialFitGeneration: number | null = null;
  let mobileInitialAutoFitOwnedZoomGeneration: number | null = null;
  let mobileInitialAutoFitOwnedZoomBookId: number | undefined;
  let mobileChromeHideTimer: number | undefined;

  const canAutoHideMobileChrome = () => (
    isMobileShell() &&
    pdfStore.totalPages() > 0 &&
    !showLibrary() &&
    !mobileTocOpen() &&
    !mobileSettingsOpen()
  );

  const hasMobileDocument = () => isMobileShell() && pdfStore.totalPages() > 0;

  const mobileReaderTopInset = () => 0;

  const mobileReaderBottomInset = () => hasMobileDocument()
    ? MOBILE_TTS_DOCK_INSET_PX
    : 0;

  const isMobileChromeCollapsed = () => canAutoHideMobileChrome() && !mobileChromeVisible();

  const appShellClass = () => [
    'app-shell',
    isMobileShell() ? 'app-shell--mobile' : '',
    isMobileChromeCollapsed() ? 'app-shell--chrome-collapsed' : '',
  ].filter(Boolean).join(' ');

  function clearMobileInitialAutoFit(): void {
    pendingMobileInitialFitGeneration = null;
    pendingMobileInitialFitWidthGeneration = null;
    lockedMobileInitialFitGeneration = null;
    mobileInitialAutoFitOwnedZoomGeneration = null;
    mobileInitialAutoFitOwnedZoomBookId = undefined;
  }

  function armMobileInitialAutoFit(generation: number): void {
    if (!isMobileShell()) {
      clearMobileInitialAutoFit();
      return;
    }

    pendingMobileInitialFitGeneration = generation;
    pendingMobileInitialFitWidthGeneration = generation;
    lockedMobileInitialFitGeneration = null;
    mobileInitialAutoFitOwnedZoomGeneration = null;
    mobileInitialAutoFitOwnedZoomBookId = undefined;
  }

  function lockMobileInitialAutoFit(): void {
    lockedMobileInitialFitGeneration = openBookGeneration;
    pendingMobileInitialFitGeneration = null;
    pendingMobileInitialFitWidthGeneration = null;
    mobileInitialAutoFitOwnedZoomGeneration = null;
    mobileInitialAutoFitOwnedZoomBookId = undefined;
  }

  function canApplyMobileInitialAutoFit(generation: number, bookId: number | undefined): boolean {
    return (
      generation === openBookGeneration &&
      isMobileShell() &&
      lockedMobileInitialFitGeneration !== generation &&
      pdfStore.currentBook()?.id === bookId &&
      pdfStore.totalPages() > 0
    );
  }

  function clearMobileChromeHideTimer(): void {
    if (mobileChromeHideTimer !== undefined) {
      window.clearTimeout(mobileChromeHideTimer);
      mobileChromeHideTimer = undefined;
    }
  }

  function scheduleMobileChromeHide(): void {
    clearMobileChromeHideTimer();
    if (!canAutoHideMobileChrome()) {
      setMobileChromeVisible(true);
      return;
    }

    mobileChromeHideTimer = window.setTimeout(() => {
      mobileChromeHideTimer = undefined;
      if (canAutoHideMobileChrome()) setMobileChromeVisible(false);
    }, MOBILE_CHROME_HIDE_DELAY_MS);
  }

  function pinMobileChrome(): void {
    clearMobileChromeHideTimer();
    setMobileChromeVisible(true);
  }

  function revealMobileChromeTemporarily(): void {
    if (!isMobileShell()) return;
    setMobileChromeVisible(true);
    scheduleMobileChromeHide();
  }

  function toggleMobileChromeFromReaderTap(): void {
    if (!hasMobileDocument()) return;

    if (!canAutoHideMobileChrome()) {
      pinMobileChrome();
      return;
    }

    if (mobileChromeVisible()) {
      clearMobileChromeHideTimer();
      setMobileChromeVisible(false);
      return;
    }

    setMobileChromeVisible(true);
    scheduleMobileChromeHide();
  }

  function handleMobileSettingsOpenChange(open: boolean): void {
    setMobileSettingsOpen(open);
    if (open) {
      pinMobileChrome();
    } else {
      scheduleMobileChromeHide();
    }
  }

  function openMobileFileDialog(): void {
    pinMobileChrome();
    void openFileDialog();
  }

  function openMobileLibrary(): void {
    pinMobileChrome();
    setShowLibrary(true);
  }

  function toggleMobileToc(): void {
    pinMobileChrome();
    setMobileTocOpen(open => !open);
  }

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
      clearMobileInitialAutoFit();
      setMobileTocOpen(false);
      setMobileSettingsOpen(false);
      pinMobileChrome();

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
          zoomLevel: DEFAULT_ZOOM_LEVEL,
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
        armMobileInitialAutoFit(generation);

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

        void warmTextFitProfile(restoredBook, generation);
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
    lockMobileInitialAutoFit();
    pdfStore.goToPage(pageNum, y);
  }

  function handleZoomIn() {
    lockMobileInitialAutoFit();
    pdfStore.zoomIn();
  }

  function handleZoomOut() {
    lockMobileInitialAutoFit();
    pdfStore.zoomOut();
  }

  function handleFitWidth() {
    lockMobileInitialAutoFit();
    setMobileFitWidthRequest(request => request + 1);
  }

  function handleFitText() {
    lockMobileInitialAutoFit();
    setMobileFitTextRequest(request => request + 1);
  }

  function handleColumnModeToggle() {
    readingSession.setColumnMode(readingSession.columnMode() === 1 ? 2 : 1);
  }

  function handleResetTtsMargins() {
    readingSession.setHeaderMargin(DEFAULT_HEADER_MARGIN);
    readingSession.setFooterMargin(DEFAULT_FOOTER_MARGIN);
  }

  createEffect(() => {
    if (!canAutoHideMobileChrome()) {
      pinMobileChrome();
      return;
    }

    setMobileChromeVisible(true);
    scheduleMobileChromeHide();
  });

  createEffect(() => {
    const book = pdfStore.currentBook();
    const totalPages = pdfStore.totalPages();
    const mobile = isMobileShell();
    const profile = book?.textFitProfile;

    if (!book || totalPages <= 0) {
      clearMobileInitialAutoFit();
      return;
    }

    const generation = openBookGeneration;
    if (
      !mobile ||
      pendingMobileInitialFitGeneration !== generation ||
      lockedMobileInitialFitGeneration === generation
    ) {
      return;
    }

    if (isTextFitProfileUsable(profile, totalPages)) {
      pendingMobileInitialFitGeneration = null;
      pendingMobileInitialFitWidthGeneration = null;
      mobileInitialAutoFitOwnedZoomGeneration = generation;
      mobileInitialAutoFitOwnedZoomBookId = book.id;

      queueMicrotask(() => {
        if (canApplyMobileInitialAutoFit(generation, book.id)) {
          setMobileFitTextRequest(request => request + 1);
        }
      });
      return;
    }

    if (pendingMobileInitialFitWidthGeneration === generation) {
      pendingMobileInitialFitWidthGeneration = null;
      mobileInitialAutoFitOwnedZoomGeneration = generation;
      mobileInitialAutoFitOwnedZoomBookId = book.id;

      queueMicrotask(() => {
        if (canApplyMobileInitialAutoFit(generation, book.id)) {
          setMobileFitWidthRequest(request => request + 1);
        }
      });
    }
  });

  onCleanup(clearMobileChromeHideTimer);

  let persistTimer: number | undefined;

  async function warmTextFitProfile(book: Book, generation: number): Promise<void> {
    if (book.id === undefined) return;
    const pageCount = documentSession.numPages;
    if (isTextFitProfileCurrent(book.textFitProfile, pageCount)) return;

    const shouldContinue = () => {
      const activeBook = pdfStore.currentBook();
      return generation === openBookGeneration && activeBook?.id === book.id;
    };

    try {
      const profile = await buildTextFitProfile({
        pageCount,
        currentPage: Math.max(0, Math.min(book.lastPage, Math.max(0, pageCount - 1))),
        shouldContinue,
      });
      if (!profile || !shouldContinue()) return;

      const activeBook = pdfStore.currentBook();
      const existingProfile = activeBook?.textFitProfile;
      if (
        isTextFitProfileCurrent(existingProfile, pageCount) &&
        existingProfile.confidence >= profile.confidence &&
        existingProfile.sampleCount >= profile.sampleCount
      ) {
        return;
      }

      await updateBookTextFitProfile(book.id, profile);
      if (!shouldContinue()) return;

      const currentBook = pdfStore.currentBook();
      if (currentBook?.id === book.id) {
        pdfStore.setCurrentBook({ ...currentBook, textFitProfile: profile });
      }
    } catch (error) {
      if (shouldContinue()) {
        console.error('Failed to build text fit profile:', error);
      }
    }
  }

  onMount(() => {
    pdfHistory.setManualScrollRestoration();

    const mobileQuery = window.matchMedia('(max-width: 760px), (pointer: coarse) and (max-width: 900px)');
    const updateMobileShell = () => setIsMobileShell(mobileQuery.matches);
    updateMobileShell();
    mobileQuery.addEventListener('change', updateMobileShell);

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
      mobileQuery.removeEventListener('change', updateMobileShell);
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
    const autoFitOwnsZoom = (
      mobileInitialAutoFitOwnedZoomGeneration !== null &&
      mobileInitialAutoFitOwnedZoomBookId === book.id
    );
    const zoomLevel = autoFitOwnsZoom
      ? book.zoomLevel
      : pdfStore.zoomLevel();

    await updateBook(book.id, {
      lastPage: currentPage,
      lastPageOffsetY: pdfStore.currentPageOffsetY(),
      lastSentence: persistedSentence,
      zoomLevel,
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
    <div class={appShellClass()}>
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

      <div class="desktop-toolbar-shell">
        <Toolbar
          onOpenFile={openFileDialog}
          onOpenLibrary={() => setShowLibrary(true)}
          onPlay={() => playbackController.toggle()}
          onPrev={() => playbackController.prev()}
          onNext={() => playbackController.next()}
        />
      </div>

      <Show when={isMobileShell()}>
        <MobileReaderChrome
          title={pdfStore.currentBook()?.title ?? 'PDFest'}
          currentPage={pdfStore.currentPage()}
          totalPages={pdfStore.totalPages()}
          zoomLevel={pdfStore.zoomLevel()}
          columnMode={readingSession.columnMode()}
          isPlaying={readingSession.isPlaying()}
          chromeVisible={mobileChromeVisible()}
          settingsOpen={mobileSettingsOpen()}
          headerMargin={readingSession.headerMargin()}
          footerMargin={readingSession.footerMargin()}
          hasDocument={pdfStore.totalPages() > 0}
          onOpenFile={openMobileFileDialog}
          onOpenLibrary={openMobileLibrary}
          onToggleToc={toggleMobileToc}
          onPrevSentence={() => playbackController.prev()}
          onPlayPause={() => playbackController.toggle()}
          onNextSentence={() => playbackController.next()}
          onActivity={revealMobileChromeTemporarily}
          onSettingsOpenChange={handleMobileSettingsOpenChange}
          onZoomOut={handleZoomOut}
          onZoomIn={handleZoomIn}
          canFitText={isTextFitProfileUsable(pdfStore.currentBook()?.textFitProfile, pdfStore.totalPages())}
          onFitWidth={handleFitWidth}
          onFitText={handleFitText}
          onToggleColumnMode={handleColumnModeToggle}
          onHeaderMarginChange={readingSession.setHeaderMargin}
          onFooterMarginChange={readingSession.setFooterMargin}
          onResetTtsMargins={handleResetTtsMargins}
        />
      </Show>

      <div class="app-shell__main">
        <div class="app-shell__desktop-sidebar">
          <Sidebar onSelectItem={handleTOCSelect} />
        </div>

        <Show when={mobileTocOpen()}>
          <div class="mobile-drawer-backdrop" onClick={() => setMobileTocOpen(false)}>
            <div onClick={(event) => event.stopPropagation()}>
              <Sidebar
                variant="drawer"
                open={mobileTocOpen()}
                onSelectItem={handleTOCSelect}
                onClose={() => setMobileTocOpen(false)}
              />
            </div>
          </div>
        </Show>

        <Show
          when={pdfStore.totalPages() > 0}
          fallback={
            <div class="empty-reader-state">
              <div class="empty-reader-state__icon">PDF</div>
              <div>Open a PDF to start reading</div>
              <button onClick={openFileDialog}>
                Open PDF
              </button>
            </div>
          }
        >
          <PDFViewer
            shortcutsEnabled={!showLibrary() && !mobileTocOpen() && !mobileSettingsOpen()}
            fitWidthRequest={mobileFitWidthRequest()}
            fitTextRequest={mobileFitTextRequest()}
            textFitProfile={pdfStore.currentBook()?.textFitProfile}
            mobileLayout={isMobileShell()}
            readerTopInset={mobileReaderTopInset()}
            readerBottomInset={mobileReaderBottomInset()}
            onReaderTap={toggleMobileChromeFromReaderTap}
          />
        </Show>
      </div>
    </div>
  );
};

export default App;
