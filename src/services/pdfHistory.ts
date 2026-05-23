export interface PDFHistoryLocation {
  pageNum: number;
  y: number;
}

interface PDFHistoryState extends PDFHistoryLocation {
  app: 'pdfest';
  version: 1;
  type: 'pdf-location';
  docSessionId: string;
  index: number;
}

const APP_MARKER = 'pdfest';
const STATE_VERSION = 1;

function hasHistory(): boolean {
  return typeof window !== 'undefined' && typeof window.history !== 'undefined';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function createDocSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

class PDFHistoryService {
  private activeDocSessionId: string | null = null;
  private currentIndex = 0;
  private previousScrollRestoration: ScrollRestoration | null = null;

  startDocumentSession(location: PDFHistoryLocation): string {
    const docSessionId = createDocSessionId();
    this.activeDocSessionId = docSessionId;
    this.currentIndex = 0;
    this.replaceState(location, 0);
    return docSessionId;
  }

  clearDocumentSession(): void {
    this.activeDocSessionId = null;
    this.currentIndex = 0;
  }

  getCurrentIndex(): number {
    return this.currentIndex;
  }

  canGoBack(): boolean {
    return this.currentIndex > 0;
  }

  back(): void {
    if (!hasHistory() || !this.canGoBack()) return;
    window.history.back();
  }

  setManualScrollRestoration(): void {
    if (!hasHistory() || !('scrollRestoration' in window.history)) return;
    this.previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
  }

  restoreScrollRestoration(): void {
    if (!hasHistory() || !('scrollRestoration' in window.history) || this.previousScrollRestoration === null) return;
    window.history.scrollRestoration = this.previousScrollRestoration;
    this.previousScrollRestoration = null;
  }

  replaceCurrentLocation(location: PDFHistoryLocation): void {
    if (!this.activeDocSessionId) return;
    this.replaceState(location, this.currentIndex);
  }

  pushInternalLinkLocation(location: PDFHistoryLocation): number {
    if (!hasHistory() || !this.activeDocSessionId) return this.currentIndex;

    const nextIndex = this.currentIndex + 1;
    const state = this.createState(location, nextIndex);
    window.history.pushState(state, '', window.location.href);
    this.currentIndex = nextIndex;
    return nextIndex;
  }

  readPopState(value: unknown, totalPages: number): PDFHistoryState | null {
    if (!isRecord(value)) return null;
    if (value.app !== APP_MARKER || value.version !== STATE_VERSION || value.type !== 'pdf-location') return null;
    if (typeof value.docSessionId !== 'string' || value.docSessionId !== this.activeDocSessionId) return null;
    if (typeof value.pageNum !== 'number' || !Number.isFinite(value.pageNum)) return null;
    if (typeof value.y !== 'number' || !Number.isFinite(value.y)) return null;
    if (typeof value.index !== 'number' || !Number.isInteger(value.index) || value.index < 0) return null;

    const maxPage = totalPages - 1;
    if (maxPage < 0) return null;

    return {
      app: APP_MARKER,
      version: STATE_VERSION,
      type: 'pdf-location',
      docSessionId: value.docSessionId,
      index: value.index,
      pageNum: Math.max(0, Math.min(Math.trunc(value.pageNum), maxPage)),
      y: Math.max(0, value.y),
    };
  }

  applyPopState(state: PDFHistoryState): PDFHistoryLocation {
    this.currentIndex = state.index;
    return { pageNum: state.pageNum, y: state.y };
  }

  private replaceState(location: PDFHistoryLocation, index: number): void {
    if (!hasHistory() || !this.activeDocSessionId) return;
    window.history.replaceState(this.createState(location, index), '', window.location.href);
  }

  private createState(location: PDFHistoryLocation, index: number): PDFHistoryState {
    return {
      app: APP_MARKER,
      version: STATE_VERSION,
      type: 'pdf-location',
      docSessionId: this.activeDocSessionId ?? '',
      index,
      pageNum: location.pageNum,
      y: location.y,
    };
  }
}

export const pdfHistory = new PDFHistoryService();
