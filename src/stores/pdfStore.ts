import { createSignal, createRoot } from 'solid-js';
import type { TOCItem } from '../services/pdfService';
import type { Book } from '../services/db';

function createPDFStore() {
  // Current PDF state
  const [currentBook, setCurrentBook] = createSignal<Book | null>(null);
  const [totalPages, setTotalPages] = createSignal(0);
  const [currentPage, setCurrentPage] = createSignal(0);
  const [zoomLevel, setZoomLevel] = createSignal(2.5);
  const [brightness, setBrightness] = createSignal(1.0);
  
  // Navigation target (set to request a scroll, null means no pending navigation)
  const [navigateToPage, setNavigateToPage] = createSignal<number | null>(null);
  
  // TOC
  const [toc, setTOC] = createSignal<TOCItem[]>([]);
  const [sidebarVisible, setSidebarVisible] = createSignal(true);
  
  // Loaded pages tracking
  const [loadedPages, setLoadedPages] = createSignal<Set<number>>(new Set());
  
  function addLoadedPage(pageNum: number) {
    setLoadedPages(prev => new Set([...prev, pageNum]));
  }
  
  function clearLoadedPages() {
    setLoadedPages(new Set<number>());
  }
  
  function isPageLoaded(pageNum: number): boolean {
    return loadedPages().has(pageNum);
  }
  
  function zoomIn() {
    setZoomLevel(prev => Math.min(prev + 0.5, 4.0));
  }
  
  function zoomOut() {
    setZoomLevel(prev => Math.max(prev - 0.5, 0.5));
  }
  
  function toggleSidebar() {
    setSidebarVisible(prev => !prev);
  }
  
  // Navigation target includes y position for precise scrolling within page
  const [navigateY, setNavigateY] = createSignal<number | undefined>(undefined);
  
  // Request navigation to a page (for TOC clicks, etc.)
  function goToPage(pageNum: number, y?: number) {
    setNavigateToPage(pageNum);
    setNavigateY(y);
    setCurrentPage(pageNum);
  }
  
  // Clear navigation request (called after scroll completes)
  function clearNavigation() {
    setNavigateToPage(null);
    setNavigateY(undefined);
  }
  
  return {
    currentBook,
    setCurrentBook,
    totalPages,
    setTotalPages,
    currentPage,
    setCurrentPage,
    zoomLevel,
    setZoomLevel,
    brightness,
    setBrightness,
    toc,
    setTOC,
    sidebarVisible,
    setSidebarVisible,
    toggleSidebar,
    loadedPages,
    addLoadedPage,
    clearLoadedPages,
    isPageLoaded,
    zoomIn,
    zoomOut,
    navigateToPage,
    navigateY,
    goToPage,
    clearNavigation
  };
}

// Create singleton store
export const pdfStore = createRoot(createPDFStore);

