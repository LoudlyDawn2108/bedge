export interface Word {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  blockId?: number;
}

export interface PageDimensions {
  width: number;
  height: number;
}

export interface PageBounds extends PageDimensions {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PageMetrics {
  bounds: PageBounds;
  dimensions: PageDimensions;
}

export type PagePoint = [number, number];
export type PDFQuad = [number, number, number, number, number, number, number, number];

export interface SelectionResult {
  quads: PDFQuad[];
  text: string;
}

export interface TOCItem {
  title: string;
  pageNum: number;
  level: number;
  y?: number;
}

export type PDFLinkDestinationType = 'Fit' | 'FitB' | 'FitH' | 'FitBH' | 'FitV' | 'FitBV' | 'FitR' | 'XYZ';

export interface PDFInternalLinkTarget {
  kind: 'internal';
  pageNum: number;
  x?: number;
  y?: number;
  zoom?: number;
  destinationType?: PDFLinkDestinationType;
}

export interface PDFExternalLinkTarget {
  kind: 'external';
  uri: string;
}

export type PDFLinkTarget = PDFInternalLinkTarget | PDFExternalLinkTarget;

export interface PDFLink {
  id: string;
  bounds: PageBounds;
  uri: string;
  target: PDFLinkTarget;
}

export interface RenderedPage {
  width: number;
  height: number;
  bounds: PageBounds;
  pixels: ArrayBuffer;
}

export interface OpenDocumentResult {
  documentId: number;
  numPages: number;
}
