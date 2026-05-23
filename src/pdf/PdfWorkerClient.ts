import type {
  OpenDocumentResult,
  PageMetrics,
  PagePoint,
  PDFLink,
  RenderedPage,
  SelectionResult,
  TOCItem,
  Word,
} from './types';
import type { PdfWorkerOutboundMessage, PdfWorkerRequest, PdfWorkerResponse } from './protocol';

interface PendingRequest {
  resolve(value: unknown): void;
  reject(reason: unknown): void;
}

function isWorkerReadyMessage(message: PdfWorkerOutboundMessage): message is { type: 'ready' } {
  return 'type' in message && message.type === 'ready';
}

function isWorkerResponse(message: PdfWorkerOutboundMessage): message is PdfWorkerResponse {
  return 'id' in message && 'ok' in message;
}

function toWorkerError(response: Extract<PdfWorkerResponse, { ok: false }>): Error {
  const error = new Error(response.error.message);
  error.name = response.error.name;
  if (response.error.stack) {
    error.stack = response.error.stack;
  }
  return error;
}

export class PdfWorkerClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private resolveReady!: () => void;
  private rejectReady!: (reason: unknown) => void;
  private readonly readyPromise: Promise<void>;

  constructor() {
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    this.worker = new Worker(new URL('./worker/pdf.worker.ts', import.meta.url), { type: 'module' });
    this.worker.addEventListener('message', event => {
      this.handleMessage(event.data as PdfWorkerOutboundMessage);
    });
    this.worker.addEventListener('error', event => {
      const error = new Error(event.message || 'PDF worker failed');
      this.rejectReady(error);
      this.rejectAll(error);
    });
    this.worker.addEventListener('messageerror', () => {
      const error = new Error('PDF worker message could not be deserialized');
      this.rejectAll(error);
    });
  }

  async openDocument(buffer: ArrayBuffer): Promise<OpenDocumentResult> {
    await this.ready();
    const { id, promise } = this.createPending<OpenDocumentResult>();
    const request: PdfWorkerRequest = { id, type: 'openDocument', buffer };
    this.worker.postMessage(request, [buffer]);
    return promise;
  }

  async closeDocument(documentId: number): Promise<void> {
    await this.ready();
    const { id, promise } = this.createPending<null>();
    const request: PdfWorkerRequest = { id, type: 'closeDocument', documentId };
    this.worker.postMessage(request);
    await promise;
  }

  async renderPage(documentId: number, pageNum: number, scale: number): Promise<RenderedPage> {
    await this.ready();
    const { id, promise } = this.createPending<RenderedPage>();
    const request: PdfWorkerRequest = { id, type: 'renderPage', documentId, pageNum, scale };
    this.worker.postMessage(request);
    return promise;
  }

  async getPageText(documentId: number, pageNum: number): Promise<Word[]> {
    await this.ready();
    const { id, promise } = this.createPending<Word[]>();
    const request: PdfWorkerRequest = { id, type: 'getPageText', documentId, pageNum };
    this.worker.postMessage(request);
    return promise;
  }

  async getPageLinks(documentId: number, pageNum: number): Promise<PDFLink[]> {
    await this.ready();
    const { id, promise } = this.createPending<PDFLink[]>();
    const request: PdfWorkerRequest = { id, type: 'getPageLinks', documentId, pageNum };
    this.worker.postMessage(request);
    return promise;
  }

  async getPageMetrics(documentId: number, pageNum: number): Promise<PageMetrics> {
    await this.ready();
    const { id, promise } = this.createPending<PageMetrics>();
    const request: PdfWorkerRequest = { id, type: 'getPageMetrics', documentId, pageNum };
    this.worker.postMessage(request);
    return promise;
  }

  async getTOC(documentId: number): Promise<TOCItem[]> {
    await this.ready();
    const { id, promise } = this.createPending<TOCItem[]>();
    const request: PdfWorkerRequest = { id, type: 'getTOC', documentId };
    this.worker.postMessage(request);
    return promise;
  }

  async beginSelection(documentId: number, pageNum: number): Promise<number> {
    await this.ready();
    const { id, promise } = this.createPending<number>();
    const request: PdfWorkerRequest = { id, type: 'beginSelection', documentId, pageNum };
    this.worker.postMessage(request);
    return promise;
  }

  async updateSelection(
    selectionId: number,
    anchor: PagePoint,
    focus: PagePoint,
    maxHits?: number
  ): Promise<SelectionResult> {
    await this.ready();
    const { id, promise } = this.createPending<SelectionResult>();
    const request: PdfWorkerRequest = { id, type: 'updateSelection', selectionId, anchor, focus, maxHits };
    this.worker.postMessage(request);
    return promise;
  }

  async endSelection(selectionId: number): Promise<void> {
    await this.ready();
    const { id, promise } = this.createPending<null>();
    const request: PdfWorkerRequest = { id, type: 'endSelection', selectionId };
    this.worker.postMessage(request);
    await promise;
  }

  terminate(): void {
    this.rejectAll(new Error('PDF worker terminated'));
    this.worker.terminate();
  }

  private ready(): Promise<void> {
    return this.readyPromise;
  }

  private createPending<Result>(): { id: number; promise: Promise<Result> } {
    const id = this.nextRequestId++;
    const promise = new Promise<Result>((resolve, reject) => {
      this.pending.set(id, {
        resolve: value => resolve(value as Result),
        reject,
      });
    });

    return { id, promise };
  }

  private handleMessage(message: PdfWorkerOutboundMessage): void {
    if (isWorkerReadyMessage(message)) {
      this.resolveReady();
      return;
    }

    if (!isWorkerResponse(message)) return;

    const pending = this.pending.get(message.id);
    if (!pending) return;

    this.pending.delete(message.id);
    if (message.ok) {
      pending.resolve(message.result);
    } else {
      pending.reject(toWorkerError(message));
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export const pdfWorkerClient = new PdfWorkerClient();
