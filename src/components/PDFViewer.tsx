import { For, createSignal, createMemo, onMount, onCleanup, createEffect, on } from 'solid-js';
import type { Component } from 'solid-js';
import { pdfService } from '../services/pdfService';
import { pdfStore } from '../stores/pdfStore';
import { ttsStore } from '../stores/ttsStore';

interface Props {
  onPageChange?: (page: number) => void;
}

export const PDFViewer: Component<Props> = (props) => {
  let containerRef: HTMLDivElement | undefined;
  const canvasRefs: Map<number, HTMLCanvasElement> = new Map();
  const [pageHeights, setPageHeights] = createSignal<number[]>([]);
  const renderingPages: Set<number> = new Set(); // Track pages currently rendering
  
  const PAGE_GAP = 20;
  const PAGES_PER_BATCH = 5;
  
  // Render a single page
  async function renderPage(pageNum: number) {
    // Skip if already loaded or currently rendering
    if (pdfStore.isPageLoaded(pageNum) || renderingPages.has(pageNum)) return;
    
    const canvas = canvasRefs.get(pageNum);
    if (!canvas) return;
    
    // Mark as rendering
    renderingPages.add(pageNum);
    
    try {
      const { width, height } = await pdfService.renderPage(
        pageNum, 
        canvas, 
        pdfStore.zoomLevel()
      );
      
      pdfStore.addLoadedPage(pageNum);
      
      // Get text content for TTS
      const words = await pdfService.getTextContent(pageNum, pdfStore.zoomLevel());
      ttsStore.addPageSentences(words, pageNum, height, width);
      
      // Update page heights
      setPageHeights(prev => {
        const newHeights = [...prev];
        newHeights[pageNum] = height + PAGE_GAP;
        return newHeights;
      });
    } catch (e) {
      console.error(`Failed to render page ${pageNum}:`, e);
    } finally {
      // Always remove from rendering set
      renderingPages.delete(pageNum);
    }
  }
  
  // Load pages around visible area
  function loadVisiblePages() {
    if (!containerRef) return;
    
    const scrollTop = containerRef.scrollTop;
    const viewHeight = containerRef.clientHeight;
    const scrollBottom = scrollTop + viewHeight;
    
    // Find which pages are visible
    let currentTop = 0;
    let firstVisible = 0;
    let lastVisible = 0;
    
    const heights = pageHeights();
    const defaultHeight = 800; // Estimate before rendered
    
    for (let i = 0; i < pdfStore.totalPages(); i++) {
      const pageHeight = heights[i] || defaultHeight;
      const pageBottom = currentTop + pageHeight;
      
      if (pageBottom > scrollTop && currentTop < scrollBottom) {
        if (firstVisible === 0 && i > 0) firstVisible = i;
        lastVisible = i;
      }
      
      currentTop = pageBottom;
    }
    
    // Update current page
    pdfStore.setCurrentPage(firstVisible);
    props.onPageChange?.(firstVisible);
    
    // Load pages around visible area
    const start = Math.max(0, firstVisible - PAGES_PER_BATCH);
    const end = Math.min(pdfStore.totalPages(), lastVisible + PAGES_PER_BATCH);
    
    for (let i = start; i < end; i++) {
      renderPage(i);
    }
  }
  
  // Scroll handler with throttle
  let scrollTimeout: number | null = null;
  function onScroll() {
    // Track user scrolling for auto-scroll protection
    handleUserScroll();
    
    if (scrollTimeout) return;
    scrollTimeout = window.setTimeout(() => {
      loadVisiblePages();
      scrollTimeout = null;
    }, 100);
  }
  
  // Scroll to specific page, optionally to a specific y position within the page
  function scrollToPage(pageNum: number, yInPage?: number) {
    if (!containerRef) return;
    
    const heights = pageHeights();
    const defaultHeight = 800;
    let targetY = 0;
    
    // Calculate offset to top of target page
    for (let i = 0; i < pageNum; i++) {
      targetY += heights[i] || defaultHeight;
    }
    
    // Add y offset within page if provided (scale by zoom level)
    if (yInPage !== undefined) {
      targetY += yInPage * pdfStore.zoomLevel();
    }
    
    containerRef.scrollTo({ top: targetY, behavior: 'instant' });
  }
  
  // Re-render when zoom changes - use on() to explicitly track only zoomLevel
  createEffect(on(
    () => pdfStore.zoomLevel(),
    (zoomLevel, prevZoom) => {
      // Skip if zoom didn't actually change
      if (prevZoom !== undefined && zoomLevel === prevZoom) return;
      pdfStore.clearLoadedPages();
      ttsStore.clearSentences();
      loadVisiblePages();
    },
    { defer: true } // Don't run on initial mount
  ));
  
  // Scroll to page when navigation is requested (e.g., from TOC click)
  createEffect(on(
    () => pdfStore.navigateToPage(),
    async (pageNum) => {
      // Only scroll if there's a pending navigation
      if (pageNum === null) return;
      
      // Immediately render target page and surrounding pages BEFORE scrolling
      // This ensures the page is ready when we scroll to it
      const start = Math.max(0, pageNum - 2);
      const end = Math.min(pdfStore.totalPages(), pageNum + 3);
      
      for (let i = start; i < end; i++) {
        await renderPage(i);
      }
      
      // Now scroll to the page
      const yPos = pdfStore.navigateY();
      scrollToPage(pageNum, yPos);
      
      // Clear navigation after a short delay (after scroll starts)
      setTimeout(() => pdfStore.clearNavigation(), 100);
    },
    { defer: true }
  ));
  
  onMount(() => {
    loadVisiblePages();
  });
  
  onCleanup(() => {
    if (scrollTimeout) clearTimeout(scrollTimeout);
  });
  
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
  
  // Helper to get Y offset for a page
  function getPageTopY(pageNum: number): number {
    const heights = pageHeights();
    const defaultHeight = 800 * pdfStore.zoomLevel();
    let y = 0;
    for (let i = 0; i < pageNum; i++) {
      y += heights[i] || defaultHeight;
    }
    return y;
  }
  
  // Auto-scroll when current sentence changes during TTS playback
  createEffect(on(
    () => ttsStore.currentSentenceIdx(),
    () => {
      // Only auto-scroll when playing AND user isn't manually scrolling
      if (!ttsStore.isPlaying()) return;
      if (userScrolling()) return;
      if (!containerRef) return;
      
      const sentence = ttsStore.getCurrentSentence();
      if (!sentence || !sentence.words || sentence.words.length === 0) return;
      
      // Get container metrics
      const containerHeight = containerRef.clientHeight;
      const scrollTop = containerRef.scrollTop;
      
      // Calculate the Y position of the sentence in the scroll container
      const pageTopY = getPageTopY(sentence.pageNum);
      
      // Sentence Y position (use first word's y0)
      const sentenceY = pageTopY + sentence.words[0].y0;
      
      // Calculate where sentence appears relative to viewport
      const sentenceViewportY = sentenceY - scrollTop;
      
      // If sentence is below 80% of container or above viewport, scroll it into view
      // Target: scroll so sentence is at ~20% from top
      const threshold = containerHeight * 0.8;
      const targetPosition = containerHeight * 0.2;
      
      if (sentenceViewportY > threshold || sentenceViewportY < 0) {
        const newScrollTop = sentenceY - targetPosition;
        containerRef.scrollTo({ top: Math.max(0, newScrollTop), behavior: 'instant' });
      }
    },
    { defer: true }
  ));
  
  // Get highlight style for current sentence
  function getHighlightStyle(pageNum: number): string {
    const sentence = ttsStore.getCurrentSentence();
    // Show highlight even when paused so user can see current position
    if (!sentence || sentence.pageNum !== pageNum) {
      return '';
    }
    
    // Group words by line (similar Y position) and create one box per line
    const lineThreshold = 5; // Words within 5px are on same line
    const lines: { x0: number; y0: number; x1: number; y1: number }[] = [];
    
    for (const word of sentence.words) {
      // Find existing line with similar Y
      const existingLine = lines.find(line => 
        Math.abs(line.y0 - word.y0) < lineThreshold
      );
      
      if (existingLine) {
        // Extend the line box
        existingLine.x0 = Math.min(existingLine.x0, word.x0);
        existingLine.x1 = Math.max(existingLine.x1, word.x1);
        existingLine.y0 = Math.min(existingLine.y0, word.y0);
        existingLine.y1 = Math.max(existingLine.y1, word.y1);
      } else {
        // Create new line
        lines.push({ x0: word.x0, y0: word.y0, x1: word.x1, y1: word.y1 });
      }
    }
    
    // Generate SVG rect elements - MuPDF provides accurate positions, no padding needed
    const rects = lines.map(line => 
      `<rect x="${line.x0}" y="${line.y0}" width="${line.x1 - line.x0}" height="${line.y1 - line.y0}" rx="2" fill="#ebff7a"/>`
    ).join('');
    
    // Return SVG with solid fill rects inside a group with opacity
    // This prevents color accumulation when boxes overlap
    return `<svg style="position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;overflow:visible;">
      <g opacity="0.33">${rects}</g>
    </svg>`;
  }
  
  // Memoize page indices array to prevent re-creation on every render
  const pageIndices = createMemo(() => {
    return Array.from({ length: pdfStore.totalPages() }, (_, i) => i);
  });
  
  // Calculate total height
  const totalHeight = createMemo(() => {
    const heights = pageHeights();
    const defaultHeight = 800;
    let total = 0;
    for (let i = 0; i < pdfStore.totalPages(); i++) {
      total += heights[i] || defaultHeight;
    }
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
            <div style={{ position: 'relative' }}>
              <canvas 
                ref={(el) => canvasRefs.set(pageNum, el)}
                style={{ display: 'block', 'box-shadow': '0 2px 10px rgba(0,0,0,0.3)' }}
              />
              {/* Highlight overlay */}
              <div 
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', 'pointer-events': 'none' }}
                innerHTML={getHighlightStyle(pageNum)}
              />
            </div>
          )}
        </For>
      </div>
    </div>
  );
};

export default PDFViewer;
