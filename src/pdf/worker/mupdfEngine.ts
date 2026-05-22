import * as mupdf from 'mupdf';
import type {
  OpenDocumentResult,
  PageBounds,
  PageMetrics,
  PagePoint,
  PDFQuad,
  RenderedPage,
  SelectionResult,
  TOCItem,
  Word,
} from '../types';

interface StructuredTextChar {
  c: string;
  quad: number[];
}

interface StructuredTextLine {
  wmode: number;
  dir: number[];
  bbox: number[] | StructuredTextLineBBoxObject;
  chars?: StructuredTextChar[];
  text?: string;
}

interface StructuredTextBlock {
  type: string;
  bbox: number[];
  lines?: StructuredTextLine[];
}

interface StructuredTextJson {
  blocks: StructuredTextBlock[];
}

interface StructuredTextLineBBoxObject {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface OutlineItem {
  title?: string;
  page?: number;
  uri?: string;
  down?: OutlineItem[];
}

interface LinkDestination {
  page: number;
  y: number;
}

interface SelectionSession {
  documentId: number;
  page: mupdf.PDFPage;
  structuredText: mupdf.StructuredText;
}

function isStructuredTextLineBBoxObject(value: unknown): value is StructuredTextLineBBoxObject {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return ['x', 'y', 'w', 'h'].every(key => typeof candidate[key] === 'number');
}

function hasResolveLinkDestination(doc: mupdf.Document): doc is mupdf.Document & {
  resolveLinkDestination(uri: string | mupdf.Link): { page: number; y: number };
} {
  return typeof (doc as { resolveLinkDestination?: unknown }).resolveLinkDestination === 'function';
}

function clampPageNum(pageNum: number, totalPages: number): number | undefined {
  if (!Number.isFinite(pageNum)) return undefined;
  if (totalPages <= 0) return undefined;
  return Math.max(0, Math.min(Math.trunc(pageNum), totalPages - 1));
}

function normalizeDestination(
  totalPages: number,
  outlinePage: number | undefined,
  resolvedDestination: unknown
): LinkDestination | undefined {
  let pageNum = typeof outlinePage === 'number' ? clampPageNum(outlinePage, totalPages) : undefined;
  let y: number | undefined;

  if (resolvedDestination && typeof resolvedDestination === 'object') {
    const candidate = resolvedDestination as Record<string, unknown>;

    if (typeof candidate.page === 'number') {
      pageNum = clampPageNum(candidate.page, totalPages) ?? pageNum;
    }

    if (typeof candidate.y === 'number' && Number.isFinite(candidate.y) && candidate.y >= 0) {
      y = candidate.y;
    }
  }

  if (pageNum === undefined) return undefined;
  return y === undefined ? { page: pageNum, y: 0 } : { page: pageNum, y };
}

function toPageBounds(bounds: mupdf.Rect): PageBounds {
  const [x0, y0, x1, y1] = bounds;
  return {
    x0,
    y0,
    x1,
    y1,
    width: x1 - x0,
    height: y1 - y0,
  };
}

function isQuad(value: unknown): value is PDFQuad {
  return Array.isArray(value)
    && value.length === 8
    && value.every(point => typeof point === 'number' && Number.isFinite(point));
}

function cloneQuad(quad: PDFQuad): PDFQuad {
  return [quad[0], quad[1], quad[2], quad[3], quad[4], quad[5], quad[6], quad[7]];
}

function quadToPoint(quad: PDFQuad): PagePoint {
  return [
    (quad[0] + quad[2] + quad[4] + quad[6]) / 4,
    (quad[1] + quad[3] + quad[5] + quad[7]) / 4,
  ];
}

function normalizeSelectionPoint(structuredText: mupdf.StructuredText, point: PagePoint): PagePoint {
  const maybeSnap = (structuredText as { snap?: (p: PagePoint, q: PagePoint, mode: 'chars') => unknown }).snap;
  if (typeof maybeSnap !== 'function') return point;

  try {
    const snapped = maybeSnap.call(structuredText, point, point, 'chars');
    return isQuad(snapped) ? quadToPoint(snapped) : point;
  } catch {
    return point;
  }
}

function getSelectionFromStructuredText(
  structuredText: mupdf.StructuredText,
  anchor: PagePoint,
  focus: PagePoint,
  maxHits: number = 2000
): SelectionResult {
  const normalizedAnchor = normalizeSelectionPoint(structuredText, anchor);
  const normalizedFocus = normalizeSelectionPoint(structuredText, focus);
  const rawQuads = structuredText.highlight(normalizedAnchor, normalizedFocus, maxHits) as unknown[];

  return {
    quads: rawQuads.filter(isQuad).map(cloneQuad),
    text: structuredText.copy(normalizedAnchor, normalizedFocus),
  };
}

function createWordsFromStructuredText(stext: mupdf.StructuredText): Word[] {
  const words: Word[] = [];
  let lineChars: Word[] = [];
  let currentBlockId = 0;

  const processLine = () => {
    if (lineChars.length === 0) return;

    let currentWord: Word | null = null;

    for (const char of lineChars) {
      const isWhitespace = /\s/.test(char.text);

      if (isWhitespace) {
        if (currentWord && currentWord.text.trim()) {
          if (currentWord.x1 < currentWord.x0) {
            [currentWord.x0, currentWord.x1] = [currentWord.x1, currentWord.x0];
          }
          if (currentWord.y1 < currentWord.y0) {
            [currentWord.y0, currentWord.y1] = [currentWord.y1, currentWord.y0];
          }
          words.push(currentWord);
        }
        currentWord = null;
      } else if (!currentWord) {
        currentWord = { ...char };
      } else {
        currentWord.text += char.text;
        currentWord.x0 = Math.min(currentWord.x0, char.x0);
        currentWord.x1 = Math.max(currentWord.x1, char.x1);
        currentWord.y0 = Math.min(currentWord.y0, char.y0);
        currentWord.y1 = Math.max(currentWord.y1, char.y1);
      }
    }

    if (currentWord && currentWord.text.trim()) {
      if (currentWord.x1 < currentWord.x0) {
        [currentWord.x0, currentWord.x1] = [currentWord.x1, currentWord.x0];
      }
      if (currentWord.y1 < currentWord.y0) {
        [currentWord.y0, currentWord.y1] = [currentWord.y1, currentWord.y0];
      }
      words.push(currentWord);
    }

    lineChars = [];
  };

  try {
    stext.walk({
      beginLine: () => {
        lineChars = [];
      },
      endLine: () => {
        processLine();
      },
      beginTextBlock: () => {
        currentBlockId++;
      },
      endTextBlock: () => {},
      onChar: (utf: string, _origin: [number, number], _font: unknown, _size: number, quad: number[]) => {
        if (!utf || !quad || quad.length < 8) return;
        const xs = [quad[0], quad[2], quad[4], quad[6]];
        const ys = [quad[1], quad[3], quad[5], quad[7]];

        lineChars.push({
          text: utf,
          x0: Math.min(...xs),
          y0: Math.min(...ys),
          x1: Math.max(...xs),
          y1: Math.max(...ys),
          blockId: currentBlockId,
        });
      },
    });

    processLine();
  } catch (error) {
    console.log('[MuPDF Worker] walk failed, falling back to JSON parsing:', error);
    const json: StructuredTextJson = JSON.parse(stext.asJSON()) as StructuredTextJson;
    let blockIdCounter = 0;

    for (const block of json.blocks) {
      blockIdCounter++;
      if (block.type !== 'text' || !block.lines) continue;

      for (const line of block.lines) {
        const lineText = typeof line.text === 'string' ? line.text : undefined;
        const lineBbox = isStructuredTextLineBBoxObject(line.bbox) ? line.bbox : undefined;

        if (!lineText || !lineBbox) continue;

        const lineWords = lineText.split(/\s+/).filter(word => word.trim());
        if (lineWords.length === 0) continue;

        const avgCharWidth = lineBbox.w / lineText.length;
        let currentX = lineBbox.x;

        for (const word of lineWords) {
          const wordWidth = word.length * avgCharWidth;
          words.push({
            text: word,
            x0: currentX,
            y0: lineBbox.y,
            x1: currentX + wordWidth,
            y1: lineBbox.y + lineBbox.h,
            blockId: blockIdCounter,
          });
          currentX += wordWidth + avgCharWidth;
        }
      }
    }
  }

  return postProcessWords(words);
}

function postProcessWords(words: Word[]): Word[] {
  if (words.length === 0) return words;

  const mergedWords: Word[] = [];
  let currentWord = words[0];

  for (let i = 1; i < words.length; i++) {
    const nextWord = words[i];
    const yDiff = Math.abs(currentWord.y1 - nextWord.y1);
    const charHeight = currentWord.y1 - currentWord.y0;
    const isSameLine = yDiff < charHeight * 0.5;
    const dist = nextWord.x0 - currentWord.x1;
    const isAdjacent = dist < (currentWord.y1 - currentWord.y0) * 0.01;
    const isSameBlock = currentWord.blockId === nextWord.blockId;

    if (isSameLine && isAdjacent && isSameBlock) {
      currentWord.text += nextWord.text;
      currentWord.x1 = Math.max(currentWord.x1, nextWord.x1);
      currentWord.y0 = Math.min(currentWord.y0, nextWord.y0);
      currentWord.y1 = Math.max(currentWord.y1, nextWord.y1);
    } else {
      mergedWords.push(currentWord);
      currentWord = nextWord;
    }
  }

  mergedWords.push(currentWord);

  const dehyphenatedWords: Word[] = [];
  let activeWord = mergedWords[0];
  const HYPHEN_REGEX = /[-\u00AD\u2010\u2011\u002D\u2012\u2013\u2014\u2212]$/;

  for (let i = 1; i < mergedWords.length; i++) {
    const nextWord = mergedWords[i];

    if (HYPHEN_REGEX.test(activeWord.text)) {
      const isSameBlock = activeWord.blockId === nextWord.blockId;
      const isNextLine = nextWord.y0 > activeWord.y0;

      if (isSameBlock && isNextLine) {
        activeWord.text = activeWord.text.replace(HYPHEN_REGEX, '') + nextWord.text;
        nextWord.text = '';
      }
    }

    dehyphenatedWords.push(activeWord);
    activeWord = nextWord;
  }

  dehyphenatedWords.push(activeWord);
  return dehyphenatedWords;
}

export class MuPdfEngine {
  private readonly documents = new Map<number, mupdf.Document>();
  private readonly selections = new Map<number, SelectionSession>();
  private nextDocumentId = 1;
  private nextSelectionId = 1;

  openDocument(buffer: ArrayBuffer): OpenDocumentResult {
    const data = new Uint8Array(buffer);
    const doc = mupdf.Document.openDocument(data, 'application/pdf');
    const documentId = this.nextDocumentId++;
    this.documents.set(documentId, doc);

    return {
      documentId,
      numPages: doc.countPages(),
    };
  }

  closeDocument(documentId: number): null {
    this.closeSelectionsForDocument(documentId);
    const doc = this.documents.get(documentId);
    if (doc) {
      doc.destroy();
      this.documents.delete(documentId);
    }
    return null;
  }

  closeAll(): void {
    for (const selectionId of this.selections.keys()) {
      this.endSelection(selectionId);
    }
    for (const documentId of this.documents.keys()) {
      this.closeDocument(documentId);
    }
  }

  renderPage(documentId: number, pageNum: number, scale: number): RenderedPage {
    const page = this.loadPage(documentId, pageNum);
    let pixmap: mupdf.Pixmap | null = null;

    try {
      const bounds = toPageBounds(page.getBounds());
      pixmap = page.toPixmap(
        mupdf.Matrix.scale(scale, scale),
        mupdf.ColorSpace.DeviceRGB,
        true,
        true
      );
      const width = pixmap.getWidth();
      const height = pixmap.getHeight();
      const pixels = new Uint8ClampedArray(new Uint8ClampedArray(pixmap.getPixels()));

      return {
        width,
        height,
        bounds,
        pixels: pixels.buffer,
      };
    } finally {
      pixmap?.destroy();
      page.destroy();
    }
  }

  getPageText(documentId: number, pageNum: number): Word[] {
    const page = this.loadPage(documentId, pageNum);
    const structuredText = page.toStructuredText('preserve-spans');

    try {
      return createWordsFromStructuredText(structuredText);
    } finally {
      structuredText.destroy();
      page.destroy();
    }
  }

  getPageMetrics(documentId: number, pageNum: number): PageMetrics {
    const page = this.loadPage(documentId, pageNum);

    try {
      const bounds = toPageBounds(page.getBounds());
      return {
        bounds,
        dimensions: {
          width: bounds.width,
          height: bounds.height,
        },
      };
    } finally {
      page.destroy();
    }
  }

  getTOC(documentId: number): TOCItem[] {
    const doc = this.getDocument(documentId);
    const outline = doc.loadOutline() as OutlineItem[] | null;
    if (!outline || !Array.isArray(outline)) return [];

    const totalPages = doc.countPages();
    const items: TOCItem[] = [];

    const processOutline = (outlineItems: OutlineItem[], level: number) => {
      for (const item of outlineItems) {
        let destination = typeof item.page === 'number'
          ? normalizeDestination(totalPages, item.page, null)
          : undefined;

        if (item.uri && hasResolveLinkDestination(doc)) {
          try {
            destination = normalizeDestination(
              totalPages,
              item.page,
              doc.resolveLinkDestination(item.uri)
            ) ?? destination;
          } catch (error) {
            console.log('[MuPDF Worker] resolveLinkDestination error:', error);
          }
        }

        if (!destination) continue;

        items.push({
          title: item.title || '',
          pageNum: destination.page,
          level,
          y: destination.y > 0 ? destination.y : undefined,
        });

        if (item.down && Array.isArray(item.down)) {
          processOutline(item.down, level + 1);
        }
      }
    };

    processOutline(outline, 0);
    return items;
  }

  beginSelection(documentId: number, pageNum: number): number {
    const page = this.loadPage(documentId, pageNum);

    try {
      const structuredText = page.toStructuredText('preserve-whitespace,preserve-spans');
      const selectionId = this.nextSelectionId++;
      this.selections.set(selectionId, { documentId, page, structuredText });
      return selectionId;
    } catch (error) {
      page.destroy();
      throw error;
    }
  }

  updateSelection(selectionId: number, anchor: PagePoint, focus: PagePoint, maxHits?: number): SelectionResult {
    const session = this.selections.get(selectionId);
    if (!session) return { quads: [], text: '' };
    return getSelectionFromStructuredText(session.structuredText, anchor, focus, maxHits);
  }

  endSelection(selectionId: number): null {
    const session = this.selections.get(selectionId);
    if (!session) return null;
    session.structuredText.destroy();
    session.page.destroy();
    this.selections.delete(selectionId);
    return null;
  }

  private getDocument(documentId: number): mupdf.Document {
    const doc = this.documents.get(documentId);
    if (!doc) throw new Error('No PDF loaded');
    return doc;
  }

  private loadPage(documentId: number, pageNum: number): mupdf.PDFPage {
    return this.getDocument(documentId).loadPage(pageNum) as mupdf.PDFPage;
  }

  private closeSelectionsForDocument(documentId: number): void {
    for (const [selectionId, session] of this.selections) {
      if (session.documentId === documentId) {
        this.endSelection(selectionId);
      }
    }
  }
}
