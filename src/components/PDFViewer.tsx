import { For, Show, createSignal, createMemo, onMount, onCleanup, createEffect, on } from 'solid-js';
import type { Component } from 'solid-js';
import { documentSession } from '../services/documentSession';
import { pdfStore } from '../stores/pdfStore';
import { readingSession } from '../stores/readingSessionStore';
import type { PageDims } from '../services/documentSession';
import type { PageBounds, PDFQuad, Word } from '../pdf/types';

interface Props {
  onPageChange?: (page: number) => void;
}

interface RenderedPageSize {
  width: number;
  height: number;
  bounds: PageBounds;
}

interface VisibleRange {
  firstVisible: number;
  lastVisible: number;
  start: number;
  end: number;
}

interface RenderJob {
  epoch: number;
  canvas: HTMLCanvasElement;
  jobId: number;
}

interface PageSelectionState {
  pageNum: number;
  quads: PDFQuad[];
  text: string;
}

interface ActiveDragSelection {
  pageNum: number;
  pointerId: number;
  anchor: [number, number];
  focus: [number, number];
  updateId: number;
}

export const PDFViewer: Component<Props> = (props) => {
  let containerRef: HTMLDivElement | undefined;
  const canvasRefs: Map<number, HTMLCanvasElement> = new Map();
  const pageWrapperRefs: Map<number, HTMLDivElement> = new Map();
  const [pageSizes, setPageSizes] = createSignal<RenderedPageSize[]>([]);
  const [estimatedPageDims, setEstimatedPageDims] = createSignal<PageDims | null>(null);
  const [viewport, setViewport] = createSignal({ scrollTop: 0, viewHeight: 0 });
  const [selection, setSelection] = createSignal<PageSelectionState | null>(null);
  const [hoverCursorPage, setHoverCursorPage] = createSignal<number | null>(null);
  const renderingPages: Map<number, RenderJob> = new Map();
  let renderEpoch = 0;
  let nextRenderJobId = 0;
  let activeDragSelection: ActiveDragSelection | null = null;
  let pendingSelectionFrame: number | null = null;
  let pendingHoverFrame: number | null = null;
  let pendingHoverPage: number | null = null;
  let pendingHoverClientX = 0;
  let pendingHoverClientY = 0;

  const PAGE_GAP = 20;
  const VIEWER_PADDING = 20;
  const PAGES_PER_BATCH = 5;

  function getEstimatedPageHeight(): number {
    const dims = estimatedPageDims();
    return dims ? dims.height * pdfStore.zoomLevel() : 800;
  }

  function getEstimatedPageWidth(): number {
    const dims = estimatedPageDims();
    return dims ? dims.width * pdfStore.zoomLevel() : 600;
  }

  function getPageHeight(pageNum: number, sizes: RenderedPageSize[] = pageSizes()): number {
    return sizes[pageNum]?.height ?? getEstimatedPageHeight();
  }

  function getPageWidth(pageNum: number, sizes: RenderedPageSize[] = pageSizes()): number {
    return sizes[pageNum]?.width ?? getEstimatedPageWidth();
  }

  function cancelSelectionInteraction(pageNum?: number) {
    if (pendingSelectionFrame !== null) {
      window.cancelAnimationFrame(pendingSelectionFrame);
      pendingSelectionFrame = null;
    }

    activeDragSelection = null;
    documentSession.clearSelection(pageNum);
  }

  function clearCommittedSelection(pageNum?: number) {
    setSelection(current => {
      if (pageNum !== undefined && current?.pageNum !== pageNum) return current;
      return null;
    });
  }

  function clearHoverCursor(pageNum?: number) {
    if (pendingHoverFrame !== null) {
      window.cancelAnimationFrame(pendingHoverFrame);
      pendingHoverFrame = null;
    }

    pendingHoverPage = null;
    setHoverCursorPage(current => {
      if (pageNum !== undefined && current !== pageNum) return current;
      return null;
    });
  }

  function clearSelection(pageNum?: number) {
    cancelSelectionInteraction(pageNum);
    clearCommittedSelection(pageNum);
  }

  function resetViewerState(options?: { resetScroll?: boolean; preserveSelection?: boolean }): number {
    renderEpoch += 1;
    renderingPages.clear();
    setPageSizes([]);
    pdfStore.clearLoadedPages();
    cancelSelectionInteraction();

    if (!options?.preserveSelection) {
      clearCommittedSelection();
    }

    clearHoverCursor();

    if (options?.resetScroll && containerRef) {
      containerRef.scrollTo({ top: 0, behavior: 'auto' });
      setViewport({ scrollTop: 0, viewHeight: containerRef.clientHeight });
    }

    return renderEpoch;
  }

  function getPageBounds(pageNum: number): PageBounds | null {
    const reactiveBounds = pageSizes()[pageNum]?.bounds;
    if (reactiveBounds) return reactiveBounds;

    const bounds = documentSession.peekPageBounds(pageNum);
    if (bounds) return bounds;

    void documentSession.ensurePageMetrics(pageNum).catch(error => {
      console.error(`Failed to get page bounds for page ${pageNum}:`, error);
    });
    return null;
  }

  function applySelectionResult(pageNum: number, nextSelection: { quads: PDFQuad[]; text: string }) {
    if (nextSelection.quads.length === 0 || nextSelection.text.trim().length === 0) {
      setSelection(current => (current?.pageNum === pageNum ? null : current));
      return;
    }

    setSelection({
      pageNum,
      quads: nextSelection.quads,
      text: nextSelection.text,
    });
  }

  function clampPointToBounds(point: [number, number], bounds: PageBounds): [number, number] {
    return [
      Math.min(Math.max(point[0], bounds.x0), bounds.x1),
      Math.min(Math.max(point[1], bounds.y0), bounds.y1),
    ];
  }

  function getPointFromPointer(pageNum: number, clientX: number, clientY: number): [number, number] | null {
    const wrapper = pageWrapperRefs.get(pageNum);
    const bounds = getPageBounds(pageNum);
    if (!wrapper || !bounds) return null;

    const rect = wrapper.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const x = bounds.x0 + ((clientX - rect.left) * bounds.width) / rect.width;
    const y = bounds.y0 + ((clientY - rect.top) * bounds.height) / rect.height;

    return clampPointToBounds([x, y], bounds);
  }

  async function requestSelectionUpdate(
    pageNum: number,
    anchor: [number, number],
    focus: [number, number],
    updateId: number | null
  ): Promise<void> {
    const bounds = getPageBounds(pageNum);
    if (!bounds) return;

    const clampedAnchor = clampPointToBounds(anchor, bounds);
    const clampedFocus = clampPointToBounds(focus, bounds);
    const nextSelection = await documentSession.selectText(pageNum, clampedAnchor, clampedFocus);

    if (updateId !== null) {
      const drag = activeDragSelection;
      if (!drag || drag.pageNum !== pageNum || drag.updateId !== updateId) {
        return;
      }
    }

    applySelectionResult(pageNum, nextSelection);
  }

  function updateSelection(pageNum: number, anchor: [number, number], focus: [number, number]) {
    const drag = activeDragSelection;
    if (!drag || drag.pageNum !== pageNum) return;

    const updateId = ++drag.updateId;
    void requestSelectionUpdate(pageNum, anchor, focus, updateId).catch(error => {
      if (activeDragSelection?.updateId !== updateId) return;
      console.error(`Failed to update selection for page ${pageNum}:`, error);
    });
  }

  function handleCopy(event: ClipboardEvent) {
    const currentSelection = selection();
    if (!currentSelection?.text) return;

    event.preventDefault();
    event.clipboardData?.setData('text/plain', currentSelection.text);
  }

  function isPointNearWord(point: [number, number], word: Word, paddingPts: number): boolean {
    return point[0] >= word.x0 - paddingPts
      && point[0] <= word.x1 + paddingPts
      && point[1] >= word.y0 - paddingPts
      && point[1] <= word.y1 + paddingPts;
  }

  function updateHoverCursor(pageNum: number, clientX: number, clientY: number) {
    const point = getPointFromPointer(pageNum, clientX, clientY);
    if (!point) {
      setHoverCursorPage(current => (current === pageNum ? null : current));
      return;
    }

    const words = documentSession.peekPageText(pageNum);
    if (!words) {
      void documentSession.getPageText(pageNum).catch(error => {
        console.error(`Failed to preload hover text for page ${pageNum}:`, error);
      });
      setHoverCursorPage(current => (current === pageNum ? null : current));
      return;
    }

    const paddingPts = 3 / Math.max(pdfStore.zoomLevel(), 0.001);
    const hitsText = words.some(word => word.text.trim().length > 0 && isPointNearWord(point, word, paddingPts));
    setHoverCursorPage(current => {
      if (hitsText) return pageNum;
      return current === pageNum ? null : current;
    });
  }

  function scheduleHoverCursor(pageNum: number, clientX: number, clientY: number) {
    pendingHoverPage = pageNum;
    pendingHoverClientX = clientX;
    pendingHoverClientY = clientY;

    if (pendingHoverFrame !== null) return;

    pendingHoverFrame = window.requestAnimationFrame(() => {
      pendingHoverFrame = null;
      const nextPage = pendingHoverPage;
      if (nextPage === null) return;
      updateHoverCursor(nextPage, pendingHoverClientX, pendingHoverClientY);
    });
  }

  function scheduleSelectionUpdate() {
    if (pendingSelectionFrame !== null) return;

    pendingSelectionFrame = window.requestAnimationFrame(() => {
      pendingSelectionFrame = null;
      const drag = activeDragSelection;
      if (!drag) return;
      updateSelection(drag.pageNum, drag.anchor, drag.focus);
    });
  }

  async function refreshEstimatedPageDims(epoch: number): Promise<void> {
    if (pdfStore.totalPages() <= 0) {
      setEstimatedPageDims(null);
      return;
    }

    try {
      const dims = await documentSession.getPageDimensions(0);
      if (epoch !== renderEpoch) return;
      setEstimatedPageDims(dims);
    } catch (error) {
      console.error('Failed to get estimated page dimensions:', error);
      if (epoch === renderEpoch) {
        setEstimatedPageDims(null);
      }
    }
  }

  function syncViewport() {
    if (!containerRef) return;
    setViewport({
      scrollTop: containerRef.scrollTop,
      viewHeight: containerRef.clientHeight,
    });
  }

  let viewportRaf: number | null = null;
  function scheduleViewportSync() {
    if (viewportRaf !== null) return;
    viewportRaf = window.requestAnimationFrame(() => {
      viewportRaf = null;
      syncViewport();
    });
  }

  function computeVisibleRange(scrollTop: number, viewHeight: number): VisibleRange {
    const totalPages = pdfStore.totalPages();
    if (totalPages <= 0) {
      return { firstVisible: -1, lastVisible: -1, start: 0, end: 0 };
    }

    const scrollBottom = scrollTop + Math.max(viewHeight, 1);
    const sizes = pageSizes();
    let currentTop = VIEWER_PADDING;
    let firstVisible = -1;
    let lastVisible = -1;

    for (let i = 0; i < totalPages; i++) {
      const pageHeight = getPageHeight(i, sizes);
      const pageBottom = currentTop + pageHeight;

      if (pageBottom > scrollTop && currentTop < scrollBottom) {
        if (firstVisible === -1) firstVisible = i;
        lastVisible = i;
      }

      currentTop = pageBottom + PAGE_GAP;
    }

    if (firstVisible === -1) {
      firstVisible = Math.max(0, Math.min(pdfStore.currentPage(), totalPages - 1));
      lastVisible = firstVisible;
    }

    return {
      firstVisible,
      lastVisible,
      start: Math.max(0, firstVisible - PAGES_PER_BATCH),
      end: Math.min(totalPages, lastVisible + PAGES_PER_BATCH + 1),
    };
  }

  const visibleRange = createMemo(() => {
    const { scrollTop, viewHeight } = viewport();
    return computeVisibleRange(scrollTop, viewHeight);
  });

  const pinnedPageNum = createMemo(() => {
    if (!readingSession.isPlaying()) return null;
    const pageNum = readingSession.cursor().pageNum;
    if (pageNum < 0 || pageNum >= pdfStore.totalPages()) return null;
    return pageNum;
  });

  const mountedPages = createMemo(() => {
    const range = visibleRange();
    const pages = new Set<number>();

    for (let pageNum = range.start; pageNum < range.end; pageNum++) {
      pages.add(pageNum);
    }

    const pinnedPage = pinnedPageNum();
    if (pinnedPage !== null) {
      pages.add(pinnedPage);
    }

    return pages;
  });

  function isPageMounted(pageNum: number): boolean {
    return mountedPages().has(pageNum);
  }

  async function renderPage(pageNum: number, mountedCanvas?: HTMLCanvasElement) {
    const canvas = mountedCanvas ?? canvasRefs.get(pageNum);
    if (!canvas) return;
    if (pdfStore.isPageLoaded(pageNum) && canvasRefs.get(pageNum) === canvas) return;

    const epoch = renderEpoch;
    const currentJob = renderingPages.get(pageNum);
    if (currentJob && currentJob.epoch === epoch && currentJob.canvas === canvas) return;

    const jobId = ++nextRenderJobId;
    renderingPages.set(pageNum, { epoch, canvas, jobId });

    try {
      const scale = pdfStore.zoomLevel();
      const { width, height, bounds } = await documentSession.loadPage(pageNum, canvas, scale);
      const activeJob = renderingPages.get(pageNum);

      if (epoch !== renderEpoch) return;
      if (!activeJob || activeJob.jobId !== jobId) return;
      if (canvasRefs.get(pageNum) !== canvas) return;
      if (!isPageMounted(pageNum)) return;

      pdfStore.addLoadedPage(pageNum);
      setPageSizes(prev => {
        const nextSizes = [...prev];
        nextSizes[pageNum] = { width, height, bounds };
        return nextSizes;
      });
    } catch (e) {
      console.error(`Failed to render page ${pageNum}:`, e);
    } finally {
      const activeJob = renderingPages.get(pageNum);
      if (activeJob?.jobId === jobId) {
        renderingPages.delete(pageNum);
      }
    }
  }

  // Track if user is manually scrolling to avoid fighting with auto-scroll
  const [userScrolling, setUserScrolling] = createSignal(false);
  let userScrollTimeout: number | null = null;

  // Handle user scroll - mark as scrolling for brief period
  function handleUserScroll() {
    setUserScrolling(true);
    if (userScrollTimeout) clearTimeout(userScrollTimeout);
    userScrollTimeout = window.setTimeout(() => {
      setUserScrolling(false);
    }, 500); // 500ms cooldown after user stops scrolling
  }

  function onScroll() {
    handleUserScroll();
    scheduleViewportSync();
  }

  // Scroll to specific page, optionally to a specific y position within the page
  function scrollToPage(pageNum: number, yInPage?: number) {
    if (!containerRef) return;

    let targetY = Math.max(0, getPageTopY(pageNum) - VIEWER_PADDING);

    // Add y offset within page if provided (scale by zoom level)
    if (yInPage !== undefined) {
      const bounds = getPageBounds(pageNum);
      targetY += (yInPage - (bounds?.y0 ?? 0)) * pdfStore.zoomLevel();
    }

    containerRef.scrollTo({ top: targetY, behavior: 'auto' });
    syncViewport();
  }

  function getPageOffsetY(pageNum: number, scrollTop: number): number {
    return Math.max(0, (scrollTop - (getPageTopY(pageNum) - VIEWER_PADDING)) / pdfStore.zoomLevel());
  }

  createEffect(on(
    () => [pdfStore.currentBook(), pdfStore.totalPages()] as const,
    async ([book, totalPages], previousValue) => {
      if (totalPages <= 0) {
        setEstimatedPageDims(null);
        resetViewerState({ resetScroll: true });
        setViewport({ scrollTop: 0, viewHeight: 0 });
        return;
      }

      if (!book && previousValue === undefined) return;

      const epoch = resetViewerState({ resetScroll: true });
      await refreshEstimatedPageDims(epoch);
      if (epoch !== renderEpoch) return;
      syncViewport();
    },
    { defer: true }
  ));

  // Re-render when zoom changes - use on() to explicitly track only zoomLevel
  createEffect(on(
    () => pdfStore.zoomLevel(),
    async (zoomLevel, prevZoom) => {
      // Skip if zoom didn't actually change
      if (prevZoom !== undefined && zoomLevel === prevZoom) return;
      const epoch = resetViewerState({ preserveSelection: true });
      readingSession.clearAllSentences();
      await refreshEstimatedPageDims(epoch);
      if (epoch !== renderEpoch) return;
      syncViewport();
    },
    { defer: true } // Don't run on initial mount
  ));

  createEffect(on(
    () => [readingSession.columnMode(), readingSession.headerMargin(), readingSession.footerMargin()] as const,
    (_settings, previousValue) => {
      if (previousValue === undefined) return;
      readingSession.clearAllSentences();
      syncViewport();
    },
    { defer: true }
  ));

  createEffect(on(
    () => visibleRange(),
    (range) => {
      if (range.firstVisible < 0) return;
      for (let pageNum = range.start; pageNum < range.end; pageNum++) {
        void documentSession.ensurePageMetrics(pageNum).catch(error => {
          console.error(`Failed to warm metrics for page ${pageNum}:`, error);
        });
      }

      const offsetY = getPageOffsetY(range.firstVisible, viewport().scrollTop);
      const previousPage = pdfStore.currentPage();
      pdfStore.setCurrentViewportPosition(range.firstVisible, offsetY);
      if (previousPage !== range.firstVisible) {
        props.onPageChange?.(range.firstVisible);
      }
    },
    { defer: true }
  ));

  // Scroll to page when navigation is requested (e.g., from TOC click)
  createEffect(on(
    () => [pdfStore.navigateToPage(), pdfStore.navigateY()] as const,
    async ([pageNum, yPos]) => {
      // Only scroll if there's a pending navigation
      if (pageNum === null) return;

      const epoch = renderEpoch;
      await refreshEstimatedPageDims(epoch);
      if (epoch !== renderEpoch) return;

      scrollToPage(pageNum, yPos);

      // Clear navigation after a short delay (after scroll starts)
      window.setTimeout(() => pdfStore.clearNavigation(), 100);
    },
    { defer: true }
  ));

  onMount(() => {
    void refreshEstimatedPageDims(renderEpoch);
    syncViewport();
    window.addEventListener('copy', handleCopy);
    window.addEventListener('resize', scheduleViewportSync);
  });

  onCleanup(() => {
    if (viewportRaf !== null) {
      window.cancelAnimationFrame(viewportRaf);
    }
    clearHoverCursor();
    if (userScrollTimeout) clearTimeout(userScrollTimeout);
    clearSelection();
    window.removeEventListener('copy', handleCopy);
    window.removeEventListener('resize', scheduleViewportSync);
  });

  // Helper to get Y offset for a page
  function getPageTopY(pageNum: number): number {
    const sizes = pageSizes();
    let y = VIEWER_PADDING;
    for (let i = 0; i < pageNum; i++) {
      y += getPageHeight(i, sizes) + PAGE_GAP;
    }
    return y;
  }

  // Auto-scroll when current sentence changes during TTS playback
  createEffect(on(
    () => readingSession.cursor(),
    () => {
      // Only auto-scroll when playing AND user isn't manually scrolling
      if (!readingSession.isPlaying()) return;
      if (userScrolling()) return;
      if (!containerRef) return;

      const sentence = readingSession.getCurrentSentence();
      if (!sentence || !sentence.words || sentence.words.length === 0) return;

      const scale = pdfStore.zoomLevel();
      const containerHeight = containerRef.clientHeight;
      const scrollTop = containerRef.scrollTop;
      const pageTopY = getPageTopY(sentence.pageNum);
      const bounds = getPageBounds(sentence.pageNum);
      const sentenceY = pageTopY + (sentence.words[0].y0 - (bounds?.y0 ?? 0)) * scale;
      const sentenceViewportY = sentenceY - scrollTop;
      const threshold = containerHeight * 0.8;
      const targetPosition = containerHeight * 0.2;

      if (sentenceViewportY > threshold || sentenceViewportY < 0) {
        const newScrollTop = sentenceY - targetPosition;
        containerRef.scrollTo({ top: Math.max(0, newScrollTop), behavior: 'instant' });
        syncViewport();
      }
    },
    { defer: true }
  ));

  function getHighlightRects(pageNum: number): { x0: number; y0: number; x1: number; y1: number }[] {
    const sentence = readingSession.getCurrentSentence();
    if (!sentence || sentence.pageNum !== pageNum) {
      return [];
    }

    const lineThreshold = 5;
    const lines: { x0: number; y0: number; x1: number; y1: number }[] = [];

    for (const word of sentence.words) {
      const existingLine = lines.find(line => Math.abs(line.y0 - word.y0) < lineThreshold);

      if (existingLine) {
        existingLine.x0 = Math.min(existingLine.x0, word.x0);
        existingLine.x1 = Math.max(existingLine.x1, word.x1);
        existingLine.y0 = Math.min(existingLine.y0, word.y0);
        existingLine.y1 = Math.max(existingLine.y1, word.y1);
      } else {
        lines.push({ x0: word.x0, y0: word.y0, x1: word.x1, y1: word.y1 });
      }
    }

    return lines;
  }

  function getSelectionQuads(pageNum: number): PDFQuad[] {
    const currentSelection = selection();
    if (!currentSelection || currentSelection.pageNum !== pageNum) {
      return [];
    }

    return currentSelection.quads;
  }

  function handlePointerDown(pageNum: number, event: PointerEvent) {
    if (event.button !== 0) return;

    const point = getPointFromPointer(pageNum, event.clientX, event.clientY);
    if (!point) return;

    clearSelection();

    const wrapper = pageWrapperRefs.get(pageNum);
    wrapper?.setPointerCapture(event.pointerId);

    activeDragSelection = {
      pageNum,
      pointerId: event.pointerId,
      anchor: point,
      focus: point,
      updateId: 0,
    };

    void documentSession.beginSelection(pageNum)
      .then(() => {
        const drag = activeDragSelection;
        if (!drag || drag.pageNum !== pageNum || drag.pointerId !== event.pointerId) return;
        updateSelection(pageNum, drag.anchor, drag.focus);
      })
      .catch(error => {
        console.error(`Failed to begin selection for page ${pageNum}:`, error);
      });
    event.preventDefault();
  }

  function handlePointerMove(pageNum: number, event: PointerEvent) {
    const drag = activeDragSelection;
    if (!drag) {
      scheduleHoverCursor(pageNum, event.clientX, event.clientY);
      return;
    }

    if (drag.pageNum !== pageNum || drag.pointerId !== event.pointerId) return;

    const point = getPointFromPointer(pageNum, event.clientX, event.clientY);
    if (!point) return;

    drag.focus = point;
    scheduleSelectionUpdate();
    event.preventDefault();
  }

  function finishPointerSelection(pageNum: number, event: PointerEvent) {
    const drag = activeDragSelection;
    if (!drag || drag.pageNum !== pageNum || drag.pointerId !== event.pointerId) return;

    const point = getPointFromPointer(pageNum, event.clientX, event.clientY);
    let finalSelection: Promise<void> = Promise.resolve();

    if (point) {
      drag.focus = point;
      finalSelection = requestSelectionUpdate(pageNum, drag.anchor, drag.focus, null);
    }

    const wrapper = pageWrapperRefs.get(pageNum);
    if (wrapper?.hasPointerCapture(event.pointerId)) {
      wrapper.releasePointerCapture(event.pointerId);
    }

    activeDragSelection = null;
    void finalSelection
      .catch(error => {
        console.error(`Failed to finish selection for page ${pageNum}:`, error);
      })
      .finally(() => {
        documentSession.clearSelection(pageNum);
      });
    event.preventDefault();
  }

  function handlePointerLeave(pageNum: number) {
    if (activeDragSelection?.pageNum === pageNum) return;
    clearHoverCursor(pageNum);
  }

  function renderSelectionQuad(quad: PDFQuad) {
    const points = `${quad[0]},${quad[1]} ${quad[2]},${quad[3]} ${quad[6]},${quad[7]} ${quad[4]},${quad[5]}`;
    return <polygon points={points} fill="#6ea8ff" opacity="0.35" />;
  }

  const PageCanvasLayer: Component<{ pageNum: number }> = (pageProps) => {
    let canvasRef: HTMLCanvasElement | undefined;

    createEffect(() => {
      const canvas = canvasRef;
      if (!canvas) return;
      if (!isPageMounted(pageProps.pageNum)) return;
      if (pdfStore.isPageLoaded(pageProps.pageNum)) return;
      void renderPage(pageProps.pageNum, canvas);
    });

    onCleanup(() => {
      const canvas = canvasRef;
      pdfStore.removeLoadedPage(pageProps.pageNum);
      cancelSelectionInteraction(pageProps.pageNum);
      clearHoverCursor(pageProps.pageNum);
      if (canvas && canvasRefs.get(pageProps.pageNum) === canvas) {
        canvasRefs.delete(pageProps.pageNum);
      }
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    });

    return (
      <>
        <canvas
          ref={(el) => {
            canvasRef = el;
            canvasRefs.set(pageProps.pageNum, el);
          }}
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            visibility: pdfStore.isPageLoaded(pageProps.pageNum) ? 'visible' : 'hidden'
          }}
        />
        <Show when={getPageBounds(pageProps.pageNum)}>
          {(bounds) => (
            <svg
              viewBox={`${bounds().x0} ${bounds().y0} ${bounds().width} ${bounds().height}`}
              preserveAspectRatio="none"
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', 'pointer-events': 'none', overflow: 'visible' }}
            >
              <g>
                <For each={getSelectionQuads(pageProps.pageNum)}>
                  {(quad) => renderSelectionQuad(quad)}
                </For>
              </g>
              <g opacity="0.33">
                <For each={getHighlightRects(pageProps.pageNum)}>
                  {(line) => (
                    <rect
                      x={line.x0}
                      y={line.y0}
                      width={line.x1 - line.x0}
                      height={line.y1 - line.y0}
                      rx="2"
                      fill="#ebff7a"
                    />
                  )}
                </For>
              </g>
            </svg>
          )}
        </Show>
      </>
    );
  };

  // Memoize page indices array to prevent re-creation on every render
  const pageIndices = createMemo(() => {
    return Array.from({ length: pdfStore.totalPages() }, (_, i) => i);
  });

  // Calculate total height
  const totalHeight = createMemo(() => {
    const sizes = pageSizes();
    let total = VIEWER_PADDING * 2;
    for (let i = 0; i < pdfStore.totalPages(); i++) {
      total += getPageHeight(i, sizes);
    }
    total += Math.max(0, pdfStore.totalPages() - 1) * PAGE_GAP;
    return total;
  });

  return (
    <div
      ref={containerRef}
      class="pdf-viewer"
      onScroll={onScroll}
      style={{
        flex: 1,
        overflow: 'auto',
        background: '#1a1a1a',
        filter: `brightness(${pdfStore.brightness()})`
      }}
    >
      <div style={{
        "position": 'relative',
        "min-height": `${totalHeight()}px`,
        "display": 'flex',
        "flex-direction": 'column',
        "align-items": 'center',
        "gap": `${PAGE_GAP}px`,
        "padding": '20px'
      }}>
        <For each={pageIndices()}>
          {(pageNum) => (
            <div
              ref={(el) => {
                pageWrapperRefs.set(pageNum, el);
              }}
              onPointerDown={(event) => handlePointerDown(pageNum, event)}
              onPointerMove={(event) => handlePointerMove(pageNum, event)}
              onPointerUp={(event) => finishPointerSelection(pageNum, event)}
              onPointerCancel={(event) => finishPointerSelection(pageNum, event)}
              onPointerLeave={() => handlePointerLeave(pageNum)}
              style={{
                position: 'relative',
                width: `${getPageWidth(pageNum)}px`,
                height: `${getPageHeight(pageNum)}px`,
                'flex': '0 0 auto',
                background: 'white',
                'box-shadow': '0 2px 10px rgba(0,0,0,0.3)',
                cursor: hoverCursorPage() === pageNum ? 'text' : 'default',
                'touch-action': 'none',
                'user-select': 'none'
              }}
            >
              <Show when={isPageMounted(pageNum)}>
                <PageCanvasLayer pageNum={pageNum} />
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  );
};

export default PDFViewer;
