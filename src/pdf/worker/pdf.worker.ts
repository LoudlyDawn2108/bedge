/// <reference lib="webworker" />

import { MuPdfEngine } from './mupdfEngine';
import type {
  PdfWorkerOutboundMessage,
  PdfWorkerRequest,
  PdfWorkerResponse,
  PdfWorkerResult,
  SerializedWorkerError,
} from '../protocol';

const workerScope = self as DedicatedWorkerGlobalScope;
const engine = new MuPdfEngine();

function serializeError(error: unknown): SerializedWorkerError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    name: 'Error',
    message: String(error),
  };
}

function postResponse(response: PdfWorkerResponse, transfer: Transferable[] = []): void {
  workerScope.postMessage(response, transfer);
}

function postSuccess(id: number, result: PdfWorkerResult, transfer: Transferable[] = []): void {
  postResponse({ id, ok: true, result }, transfer);
}

async function handleRequest(request: PdfWorkerRequest): Promise<void> {
  try {
    switch (request.type) {
      case 'openDocument': {
        postSuccess(request.id, engine.openDocument(request.buffer));
        break;
      }
      case 'closeDocument': {
        postSuccess(request.id, engine.closeDocument(request.documentId));
        break;
      }
      case 'renderPage': {
        const renderedPage = engine.renderPage(request.documentId, request.pageNum, request.scale);
        postSuccess(request.id, renderedPage, [renderedPage.pixels]);
        break;
      }
      case 'getPageText': {
        postSuccess(request.id, engine.getPageText(request.documentId, request.pageNum));
        break;
      }
      case 'getPageMetrics': {
        postSuccess(request.id, engine.getPageMetrics(request.documentId, request.pageNum));
        break;
      }
      case 'getTOC': {
        postSuccess(request.id, engine.getTOC(request.documentId));
        break;
      }
      case 'beginSelection': {
        postSuccess(request.id, engine.beginSelection(request.documentId, request.pageNum));
        break;
      }
      case 'updateSelection': {
        postSuccess(
          request.id,
          engine.updateSelection(request.selectionId, request.anchor, request.focus, request.maxHits)
        );
        break;
      }
      case 'endSelection': {
        postSuccess(request.id, engine.endSelection(request.selectionId));
        break;
      }
    }
  } catch (error) {
    postResponse({ id: request.id, ok: false, error: serializeError(error) });
  }
}

workerScope.addEventListener('message', event => {
  void handleRequest(event.data as PdfWorkerRequest);
});

workerScope.addEventListener('close', () => {
  engine.closeAll();
});

const readyMessage: PdfWorkerOutboundMessage = { type: 'ready' };
workerScope.postMessage(readyMessage);
