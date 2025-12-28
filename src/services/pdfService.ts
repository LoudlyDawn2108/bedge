// MuPDF-based PDF Service
// Using MuPDF WebAssembly for exact word bounding boxes (same engine as PyMuPDF)

import * as mupdf from 'mupdf';

export interface Word {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PDFPage {
  pageNum: number;
  width: number;
  height: number;
}

export interface TOCItem {
  title: string;
  pageNum: number;
  level: number;
  y?: number; // Y position on page (in PDF points, for precise scrolling)
}

// Structured text types from MuPDF
interface StructuredTextChar {
  c: string;
  quad: number[]; // [x0,y0, x1,y1, x2,y2, x3,y3] - corners of quad
}

interface StructuredTextLine {
  wmode: number;
  dir: number[];
  bbox: number[]; // [x0, y0, x1, y1]
  chars?: StructuredTextChar[];
}

interface StructuredTextBlock {
  type: string;
  bbox: number[];
  lines?: StructuredTextLine[];
}

interface StructuredText {
  blocks: StructuredTextBlock[];
}

export class PDFService {
  private doc: mupdf.Document | null = null;
  
  async loadFromBlob(blob: Blob): Promise<void> {
    const arrayBuffer = await blob.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    this.doc = mupdf.Document.openDocument(data, 'application/pdf');
  }
  
  async loadFromFile(file: File): Promise<void> {
    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    this.doc = mupdf.Document.openDocument(data, 'application/pdf');
  }
  
  get numPages(): number {
    return this.doc?.countPages() ?? 0;
  }
  
  getPage(pageNum: number): mupdf.PDFPage {
    if (!this.doc) throw new Error('No PDF loaded');
    return this.doc.loadPage(pageNum) as mupdf.PDFPage;
  }
  
  async renderPage(
    pageNum: number, 
    canvas: HTMLCanvasElement, 
    scale: number = 2.5
  ): Promise<{ width: number; height: number }> {
    const page = this.getPage(pageNum);
    
    // Create a pixmap with alpha channel (RGBA) for canvas conversion
    const pixmap = page.toPixmap(
      mupdf.Matrix.scale(scale, scale),
      mupdf.ColorSpace.DeviceRGB,
      true, // include alpha
      true  // render annotations
    );
    
    // Use pixmap's actual dimensions
    const width = pixmap.getWidth();
    const height = pixmap.getHeight();
    
    canvas.width = width;
    canvas.height = height;
    
    const ctx = canvas.getContext('2d')!;
    
    // Fill with white background first
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, width, height);
    
    // Create ImageData from pixmap
    const imageData = new ImageData(
      new Uint8ClampedArray(pixmap.getPixels()),
      width,
      height
    );
    
    // Use createImageBitmap + drawImage for proper alpha compositing over white background
    const bitmap = await createImageBitmap(imageData);
    ctx.drawImage(bitmap, 0, 0);
    
    return { width, height };
  }
  
  async getTextContent(pageNum: number, scale: number = 2.5): Promise<Word[]> {
    const page = this.getPage(pageNum);
    
    // Get structured text with preserve-spans option
    const stext = page.toStructuredText('preserve-spans');
    const json: StructuredText = JSON.parse(stext.asJSON());
    
    const words: Word[] = [];
    
    // Process blocks -> lines -> chars to extract words
    for (const block of json.blocks) {
      if (block.type !== 'text' || !block.lines) continue;
      
      for (const line of block.lines) {
        if (!line.chars || line.chars.length === 0) continue;
        
        let currentWord = '';
        let wordX0 = 0;
        let wordY0 = 0;
        let wordX1 = 0;
        let wordY1 = 0;
        let inWord = false;
        
        for (let i = 0; i < line.chars.length; i++) {
          const char = line.chars[i];
          const isWhitespace = /\s/.test(char.c);
          
          // Get char bounds from quad (quad has 8 values: 4 corner points)
          // [x0,y0, x1,y1, x2,y2, x3,y3] - top-left, top-right, bottom-right, bottom-left
          const charX0 = char.quad[0] * scale;
          const charY0 = char.quad[1] * scale;
          const charX1 = char.quad[2] * scale;
          const charY1 = char.quad[5] * scale; // Use bottom-left Y for height
          
          if (isWhitespace) {
            // End current word if we have one
            if (inWord && currentWord.trim()) {
              words.push({
                text: currentWord,
                x0: wordX0,
                y0: wordY0,
                x1: wordX1,
                y1: wordY1
              });
            }
            currentWord = '';
            inWord = false;
          } else {
            if (!inWord) {
              // Start new word
              wordX0 = charX0;
              wordY0 = charY0;
              inWord = true;
            }
            currentWord += char.c;
            wordX1 = charX1;
            wordY1 = Math.max(wordY1, charY1);
            wordY0 = Math.min(wordY0, charY0);
          }
        }
        
        // Don't forget last word in line
        if (inWord && currentWord.trim()) {
          words.push({
            text: currentWord,
            x0: wordX0,
            y0: wordY0,
            x1: wordX1,
            y1: wordY1
          });
        }
      }
    }
    
    return words;
  }
  
  async getTOC(): Promise<TOCItem[]> {
    if (!this.doc) return [];
    
    try {
      const outline = this.doc.loadOutline();
      if (!outline || !Array.isArray(outline)) return [];
      
      const items: TOCItem[] = [];
      
      // MuPDF loadOutline returns an array of objects with title, page, uri, and down (children)
      const processOutline = (outlineItems: any[], level: number) => {
        for (const item of outlineItems) {
          let y: number | undefined;
          
          // Try to resolve the uri to get exact position
          if (item.uri && this.doc) {
            try {
              // resolveLink returns different formats depending on the destination type
              const resolved = (this.doc as any).resolveLink(item.uri);
              console.log('[MuPDF] resolveLink for', item.title, ':', item.uri, '->', resolved);
              if (resolved) {
                // resolved can be "page,x,y" format or an object
                if (typeof resolved === 'string') {
                  const parts = resolved.split(',');
                  if (parts.length >= 3) {
                    y = parseFloat(parts[2]);
                  }
                } else if (typeof resolved === 'object' && resolved.y !== undefined) {
                  y = resolved.y;
                }
              }
            } catch (e) {
              console.log('[MuPDF] resolveLink error:', e);
            }
          }
          
          items.push({
            title: item.title || '',
            pageNum: typeof item.page === 'number' ? item.page : 0,
            level,
            y
          });
          
          // Process children if present
          if (item.down && Array.isArray(item.down)) {
            processOutline(item.down, level + 1);
          }
        }
      };
      
      processOutline(outline, 0);
      return items;
    } catch (e) {
      console.error('[MuPDF] getTOC error:', e);
      return [];
    }
  }
  
  async getPageDimensions(pageNum: number): Promise<{ width: number; height: number }> {
    const page = this.getPage(pageNum);
    const bounds = page.getBounds();
    return { 
      width: bounds[2] - bounds[0], 
      height: bounds[3] - bounds[1] 
    };
  }
  
  close(): void {
    // MuPDF documents are garbage collected
    this.doc = null;
  }
}

// Singleton instance
export const pdfService = new PDFService();
