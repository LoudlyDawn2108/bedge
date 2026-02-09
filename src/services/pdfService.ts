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
    
    // Get structured text
    const stext = page.toStructuredText('preserve-spans');
    
    const words: Word[] = [];
    
    // Track current line's characters for grouping
    let lineChars: Word[] = [];
    
    // Process a line's chars into words
    const processLine = () => {
      if (lineChars.length === 0) return;
      
      let currentWord: Word | null = null;
      
      for (const char of lineChars) {
        const isWhitespace = /\s/.test(char.text);
        
        if (isWhitespace) {
          if (currentWord && currentWord.text.trim()) {
            // Ensure x1 >= x0 and y1 >= y0
            if (currentWord.x1 < currentWord.x0) {
              [currentWord.x0, currentWord.x1] = [currentWord.x1, currentWord.x0];
            }
            if (currentWord.y1 < currentWord.y0) {
              [currentWord.y0, currentWord.y1] = [currentWord.y1, currentWord.y0];
            }
            words.push(currentWord);
          }
          currentWord = null;
        } else {
          if (!currentWord) {
            currentWord = { ...char };
          } else {
            // Extend current word horizontally
            currentWord.text += char.text;
            currentWord.x0 = Math.min(currentWord.x0, char.x0);
            currentWord.x1 = Math.max(currentWord.x1, char.x1);
            currentWord.y0 = Math.min(currentWord.y0, char.y0);
            currentWord.y1 = Math.max(currentWord.y1, char.y1);
          }
        }
      }
      
      // Add last word in line
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
    
    // Try using walk method with line tracking
    try {
      stext.walk({
        beginLine: () => {
          // Start fresh for each line
          lineChars = [];
        },
        endLine: () => {
          // Process accumulated chars into words
          processLine();
        },
        beginTextBlock: () => {},
        endTextBlock: () => {},
        onChar: (utf: string, _origin: [number, number], _font: any, _size: number, quad: number[]) => {
          if (!utf || !quad || quad.length < 8) return;
          
          // quad: [ul.x, ul.y, ur.x, ur.y, ll.x, ll.y, lr.x, lr.y]
          // Bounding box: x0=left, y0=top, x1=right, y1=bottom
          lineChars.push({
            text: utf,
            x0: Math.min(quad[0], quad[4]) * scale, // left edge
            y0: Math.min(quad[1], quad[3]) * scale, // top edge  
            x1: Math.max(quad[2], quad[6]) * scale, // right edge
            y1: Math.max(quad[5], quad[7]) * scale  // bottom edge
          });
        }
      });
      
      // Process any remaining line
      processLine();

    } catch (e) {
      console.log('[MuPDF] walk failed, falling back to JSON parsing:', e);
      
      // Fallback to JSON-based extraction
      const json: StructuredText = JSON.parse(stext.asJSON());
      
      for (const block of json.blocks) {
        if (block.type !== 'text' || !block.lines) continue;
        
        for (const line of block.lines) {
          const lineText = (line as any).text as string | undefined;
          const lineBbox = (line as any).bbox as { x: number; y: number; w: number; h: number } | undefined;
          
          if (!lineText || !lineBbox) continue;
          
          const lineX0 = lineBbox.x * scale;
          const lineY0 = lineBbox.y * scale;
          const lineWidth = lineBbox.w * scale;
          const lineHeight = lineBbox.h * scale;
          
          const lineWords = lineText.split(/\s+/).filter(w => w.trim());
          if (lineWords.length === 0) continue;
          
          const avgCharWidth = lineWidth / lineText.length;
          let currentX = lineX0;
          
          for (const word of lineWords) {
            const wordWidth = word.length * avgCharWidth;
            words.push({
              text: word,
              x0: currentX,
              y0: lineY0,
              x1: currentX + wordWidth,
              y1: lineY0 + lineHeight
            });
            currentX += wordWidth + avgCharWidth;
          }
        }
      }
    }
    
    // merge two words if the distance between them is less than 1 pixel
    const mergedWords: Word[] = [];

    for (let i = 0; i < words.length; i++) {
      if (words[i + 1].x0 - words[i].x1 < 1) {
        mergedWords.push({
          text: words[i].text + words[i + 1].text,
          x0: words[i].x0,
          y0: words[i].y0,
          x1: words[i + 1].x1,
          y1: words[i + 1].y1
        });
        i++;
      } else {
        mergedWords.push(words[i]);
      }
    }

    console.log('Merged words:', mergedWords);
    
    return mergedWords;
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
