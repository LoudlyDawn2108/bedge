import { pdfWorkerClient } from '../pdf/PdfWorkerClient';
import type {
  PageBounds,
  PageDimensions,
  PageMetrics,
  PagePoint,
  PDFLink,
  PDFQuad,
  RenderedPage,
  SelectionResult,
  TOCItem,
  Word,
} from '../pdf/types';

export type { TOCItem };
export type PageDims = PageDimensions;

export interface PageSelection {
  quads: PDFQuad[];
  text: string;
}

const EMPTY_SELECTION: PageSelection = {
  quads: [],
  text: '',
};

async function drawRenderedPage(canvas: HTMLCanvasElement, renderedPage: RenderedPage): Promise<void> {
  canvas.width = renderedPage.width;
  canvas.height = renderedPage.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get 2D canvas context');
  }

  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, renderedPage.width, renderedPage.height);

  let bitmap: ImageBitmap | null = null;
  try {
    const imageData = new ImageData(
      new Uint8ClampedArray(renderedPage.pixels),
      renderedPage.width,
      renderedPage.height
    );
    bitmap = await createImageBitmap(imageData);
    ctx.drawImage(bitmap, 0, 0);
  } finally {
    bitmap?.close();
  }
}

export class DocumentSession {
  private _numPages = 0;
  private documentId: number | null = null;
  private tocCache: TOCItem[] | null = null;
  private pageDimCache = new Map<number, PageDims>();
  private pageBoundsCache = new Map<number, PageBounds>();
  private pageMetricsInFlight = new Map<number, Promise<PageMetrics>>();
  private pageTextCache = new Map<number, Word[]>();
  private textInFlight = new Map<number, Promise<Word[]>>();
  private pageLinksCache = new Map<number, PDFLink[]>();
  private linksInFlight = new Map<number, Promise<PDFLink[]>>();
  private sessionToken = 0;
  private activeSelectionPage: number | null = null;
  private activeSelectionId: number | null = null;
  private selectionInFlight: Promise<number | null> | null = null;
  private selectionToken = 0;

  onPageTextReady?: (pageNum: number, words: Word[], dims: PageDims) => void;

  async open(source: File | Blob): Promise<void> {
    this.sessionToken += 1;
    const token = this.sessionToken;
    this.resetCaches();
    await this.closeLoadedDocument();

    const buffer = await source.arrayBuffer();
    const result = await pdfWorkerClient.openDocument(buffer);

    if (token !== this.sessionToken) {
      await pdfWorkerClient.closeDocument(result.documentId);
      return;
    }

    this.documentId = result.documentId;
    this._numPages = result.numPages;
    this.warmPageMetrics(0);
  }

  close(): void {
    this.sessionToken += 1;
    this.resetCaches();
    void this.closeLoadedDocument();
  }

  private async closeLoadedDocument(): Promise<void> {
    const documentId = this.documentId;
    this.documentId = null;
    this.clearSelection();

    if (documentId !== null) {
      await pdfWorkerClient.closeDocument(documentId);
    }
  }

  private resetCaches(): void {
    this.clearSelection();
    this._numPages = 0;
    this.tocCache = null;
    this.pageDimCache.clear();
    this.pageBoundsCache.clear();
    this.pageMetricsInFlight.clear();
    this.pageTextCache.clear();
    this.textInFlight.clear();
    this.pageLinksCache.clear();
    this.linksInFlight.clear();
  }

  private requireDocumentId(): number {
    if (this.documentId === null) throw new Error('No PDF loaded');
    return this.documentId;
  }

  private cachePageMetrics(pageNum: number, metrics: PageMetrics): void {
    this.pageBoundsCache.set(pageNum, metrics.bounds);
    this.pageDimCache.set(pageNum, metrics.dimensions);
  }

  private warmPageMetrics(pageNum: number): void {
    void this.ensurePageMetrics(pageNum).catch(error => {
      console.error(`Failed to warm page metrics for page ${pageNum}:`, error);
    });
  }

  get numPages(): number {
    return this._numPages;
  }

  async getTOC(): Promise<TOCItem[]> {
    if (this.tocCache !== null) return this.tocCache;
    const documentId = this.requireDocumentId();
    const token = this.sessionToken;
    const toc = await pdfWorkerClient.getTOC(documentId);

    if (token === this.sessionToken && documentId === this.documentId) {
      this.tocCache = toc;
    }

    return toc;
  }

  async ensurePageMetrics(pageNum: number): Promise<PageMetrics> {
    const cachedBounds = this.pageBoundsCache.get(pageNum);
    const cachedDims = this.pageDimCache.get(pageNum);
    if (cachedBounds && cachedDims) {
      return { bounds: cachedBounds, dimensions: cachedDims };
    }

    const inFlight = this.pageMetricsInFlight.get(pageNum);
    if (inFlight) return inFlight;

    const documentId = this.requireDocumentId();
    const token = this.sessionToken;
    const promise = pdfWorkerClient.getPageMetrics(documentId, pageNum)
      .then(metrics => {
        if (token === this.sessionToken && documentId === this.documentId) {
          this.cachePageMetrics(pageNum, metrics);
        }
        return metrics;
      })
      .finally(() => {
        this.pageMetricsInFlight.delete(pageNum);
      });

    this.pageMetricsInFlight.set(pageNum, promise);
    return promise;
  }

  async getPageDimensions(pageNum: number): Promise<PageDims> {
    return (await this.ensurePageMetrics(pageNum)).dimensions;
  }

  async getPageBounds(pageNum: number): Promise<PageBounds> {
    return (await this.ensurePageMetrics(pageNum)).bounds;
  }

  peekPageBounds(pageNum: number): PageBounds | null {
    return this.pageBoundsCache.get(pageNum) ?? null;
  }

  async getPageText(pageNum: number): Promise<Word[]> {
    const cached = this.pageTextCache.get(pageNum);
    if (cached) return cached;

    const inFlight = this.textInFlight.get(pageNum);
    if (inFlight) return inFlight;

    const documentId = this.requireDocumentId();
    const token = this.sessionToken;
    const promise = pdfWorkerClient.getPageText(documentId, pageNum)
      .then(words => {
        if (token === this.sessionToken && documentId === this.documentId) {
          this.pageTextCache.set(pageNum, words);
        }
        return words;
      })
      .finally(() => {
        this.textInFlight.delete(pageNum);
      });

    this.textInFlight.set(pageNum, promise);
    return promise;
  }

  peekPageText(pageNum: number): Word[] | null {
    return this.pageTextCache.get(pageNum) ?? null;
  }

  async getPageLinks(pageNum: number): Promise<PDFLink[]> {
    const cached = this.pageLinksCache.get(pageNum);
    if (cached) return cached;

    const inFlight = this.linksInFlight.get(pageNum);
    if (inFlight) return inFlight;

    const documentId = this.requireDocumentId();
    const token = this.sessionToken;
    const promise = pdfWorkerClient.getPageLinks(documentId, pageNum)
      .then(links => {
        if (token === this.sessionToken && documentId === this.documentId) {
          this.pageLinksCache.set(pageNum, links);
        }
        return links;
      })
      .finally(() => {
        this.linksInFlight.delete(pageNum);
      });

    this.linksInFlight.set(pageNum, promise);
    return promise;
  }

  peekPageLinks(pageNum: number): PDFLink[] | null {
    return this.pageLinksCache.get(pageNum) ?? null;
  }

  async renderPage(pageNum: number, canvas: HTMLCanvasElement, scale: number): Promise<{ width: number; height: number; bounds: PageBounds }> {
    return this.loadPage(pageNum, canvas, scale);
  }

  async beginSelection(pageNum: number): Promise<void> {
    await this.ensureSelection(pageNum);
  }

  async selectText(pageNum: number, anchor: PagePoint, focus: PagePoint, maxHits?: number): Promise<PageSelection> {
    const selectionId = await this.ensureSelection(pageNum);
    if (selectionId === null) return EMPTY_SELECTION;

    const token = this.selectionToken;
    const selection: SelectionResult = await pdfWorkerClient.updateSelection(selectionId, anchor, focus, maxHits);

    if (token !== this.selectionToken || this.activeSelectionId !== selectionId) {
      return EMPTY_SELECTION;
    }

    return {
      quads: selection.quads,
      text: selection.text,
    };
  }

  clearSelection(pageNum?: number): void {
    if (pageNum !== undefined && this.activeSelectionPage !== pageNum) return;

    this.selectionToken += 1;
    const selectionId = this.activeSelectionId;
    this.activeSelectionId = null;
    this.activeSelectionPage = null;
    this.selectionInFlight = null;

    if (selectionId !== null) {
      void pdfWorkerClient.endSelection(selectionId).catch(error => {
        console.error(`Failed to end PDF selection ${selectionId}:`, error);
      });
    }
  }

  preloadPageText(pageNum: number, width: number, height: number, scale: number): void {
    const token = this.sessionToken;
    const dims: PageDims = { width: width / scale, height: height / scale };

    void this.getPageText(pageNum)
      .then(words => {
        if (token !== this.sessionToken) return;
        this.onPageTextReady?.(pageNum, words, dims);
      })
      .catch(error => {
        console.error(`Failed to preload text for page ${pageNum}:`, error);
      });
  }

  async loadPage(pageNum: number, canvas: HTMLCanvasElement, scale: number): Promise<{ width: number; height: number; bounds: PageBounds }> {
    const documentId = this.requireDocumentId();
    const token = this.sessionToken;
    const renderedPage = await pdfWorkerClient.renderPage(documentId, pageNum, scale);
    const metrics: PageMetrics = {
      bounds: renderedPage.bounds,
      dimensions: {
        width: renderedPage.bounds.width,
        height: renderedPage.bounds.height,
      },
    };

    if (token === this.sessionToken && documentId === this.documentId) {
      this.cachePageMetrics(pageNum, metrics);
      await drawRenderedPage(canvas, renderedPage);
      this.preloadPageText(pageNum, renderedPage.width, renderedPage.height, scale);
    }

    return { width: renderedPage.width, height: renderedPage.height, bounds: renderedPage.bounds };
  }

  private async ensureSelection(pageNum: number): Promise<number | null> {
    if (this.activeSelectionPage === pageNum && this.activeSelectionId !== null) {
      return this.activeSelectionId;
    }

    if (this.activeSelectionPage === pageNum && this.selectionInFlight) {
      return this.selectionInFlight;
    }

    this.clearSelection();
    this.activeSelectionPage = pageNum;

    const documentId = this.requireDocumentId();
    const token = this.selectionToken;
    const promise = pdfWorkerClient.beginSelection(documentId, pageNum)
      .then(selectionId => {
        if (token !== this.selectionToken || this.activeSelectionPage !== pageNum || documentId !== this.documentId) {
          void pdfWorkerClient.endSelection(selectionId).catch(error => {
            console.error(`Failed to end stale PDF selection ${selectionId}:`, error);
          });
          return null;
        }

        this.activeSelectionId = selectionId;
        return selectionId;
      })
      .finally(() => {
        if (this.selectionInFlight === promise) {
          this.selectionInFlight = null;
        }
      });

    this.selectionInFlight = promise;
    return promise;
  }
}

export const documentSession = new DocumentSession();
