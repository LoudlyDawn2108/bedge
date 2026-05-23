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

export interface SerializedWorkerError {
  name: string;
  message: string;
  stack?: string;
}

export type PdfWorkerRequest =
  | { id: number; type: 'openDocument'; buffer: ArrayBuffer }
  | { id: number; type: 'closeDocument'; documentId: number }
  | { id: number; type: 'renderPage'; documentId: number; pageNum: number; scale: number }
  | { id: number; type: 'getPageText'; documentId: number; pageNum: number }
  | { id: number; type: 'getPageLinks'; documentId: number; pageNum: number }
  | { id: number; type: 'getPageMetrics'; documentId: number; pageNum: number }
  | { id: number; type: 'getTOC'; documentId: number }
  | { id: number; type: 'beginSelection'; documentId: number; pageNum: number }
  | {
      id: number;
      type: 'updateSelection';
      selectionId: number;
      anchor: PagePoint;
      focus: PagePoint;
      maxHits?: number;
    }
  | { id: number; type: 'endSelection'; selectionId: number };

export type PdfWorkerResult =
  | OpenDocumentResult
  | RenderedPage
  | Word[]
  | PDFLink[]
  | PageMetrics
  | TOCItem[]
  | number
  | SelectionResult
  | null;

export type PdfWorkerResponse =
  | { id: number; ok: true; result: PdfWorkerResult }
  | { id: number; ok: false; error: SerializedWorkerError };

export type PdfWorkerReadyMessage = { type: 'ready' };
export type PdfWorkerOutboundMessage = PdfWorkerReadyMessage | PdfWorkerResponse;
