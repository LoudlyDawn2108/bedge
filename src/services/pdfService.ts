// MuPDF-based PDF Service
// Using MuPDF WebAssembly for exact word bounding boxes (same engine as PyMuPDF)

import * as mupdf from 'mupdf';

export interface Word {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  blockId?: number;
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
    let currentBlockId = 0;
    
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
            // Keep the blockId of the first char (should be consistent within a word)
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
        beginTextBlock: () => {
          currentBlockId++;
        },
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
            y1: Math.max(quad[5], quad[7]) * scale,  // bottom edge
            blockId: currentBlockId
          });
        }
      });
      
      // Process any remaining line
      processLine();

    } catch (e) {
      console.log('[MuPDF] walk failed, falling back to JSON parsing:', e);
      
      // Fallback to JSON-based extraction
      const json: StructuredText = JSON.parse(stext.asJSON());
      
      let blockIdCounter = 0;
      for (const block of json.blocks) {
        blockIdCounter++;
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
              y1: lineY0 + lineHeight,
              blockId: blockIdCounter
            });
            currentX += wordWidth + avgCharWidth;
          }
        }
      }
    }
    
    // Post-processing: Merge split words
    // Sometimes mupdf's walk endLine triggers prematurely, splitting words
    // We merge words that are:
    // 1. On the same line (vertical overlap / alignment)
    // 2. Very close to each other horizontally
    
    if (words.length > 0) {
      const mergedWords: Word[] = [];
      let currentWord = words[0];

      for (let i = 1; i < words.length; i++) {
        const nextWord = words[i];

        // Check vertical alignment (same line)
        // We use y1 (bottom/baseline) for alignment check, allowing some variance
        // If the bottom of the words are roughly aligned, they are on the same line
        const yDiff = Math.abs(currentWord.y1 - nextWord.y1);
        const charHeight = currentWord.y1 - currentWord.y0;
        // Allow 50% height variance for misalignment (e.g. different font sizes or slight offsets)
        const isSameLine = yDiff < (charHeight * 0.5); 

        // Check horizontal distance
        // Words split by endLine should be very close to each other (almost touching)
        // x0 is left, x1 is right. Distance is next.left - current.right
        const dist = nextWord.x0 - currentWord.x1;
        
        // Use a small tolerance (e.g., 1% of character width or fixed small pixel value)
        // Here we use a fixed small value because split words are usually adjacent
        const isAdjacent = dist < (currentWord.y1 - currentWord.y0) * 0.01; // 1% of height as proxy for char width spacing

        // Check if blockIds match (or are undefined)
        const isSameBlock = currentWord.blockId === nextWord.blockId;

        if (isSameLine && isAdjacent && isSameBlock) {
          // Merge
          currentWord.text += nextWord.text;
          // Update bounding box
          currentWord.x1 = Math.max(currentWord.x1, nextWord.x1); // Extend right
          currentWord.y0 = Math.min(currentWord.y0, nextWord.y0); // Expand top if needed
          currentWord.y1 = Math.max(currentWord.y1, nextWord.y1); // Expand bottom if needed
        } else {
          mergedWords.push(currentWord);
          currentWord = nextWord; // Move to next
        }
      }
      mergedWords.push(currentWord);
      
      // Second Post-processing pass: Dehyphenation
      // Merge words ending with hyphen that continue on next line
      const dehyphenatedWords: Word[] = [];
      if (mergedWords.length > 0) {
        let currentWord = mergedWords[0];
        // Matches standard hyphen, soft hyphen, non-breaking hyphen, figure dash, en dash, em dash, minus sign
        const HYPHEN_REGEX = /[-\u00AD\u2010\u2011\u002D\u2012\u2013\u2014\u2212]$/;

        for (let i = 1; i < mergedWords.length; i++) {
          const nextWord = mergedWords[i];
          
          // Check if current word ends with hyphen
          if (HYPHEN_REGEX.test(currentWord.text)) {
            // Check if next word is in same block
            const isSameBlock = currentWord.blockId === nextWord.blockId;
            
            // Check if next word is effectively on a subsequent line
            // (y0 of next word should be greater than y0 of current word)
            const isNextLine = nextWord.y0 > currentWord.y0;

            if (isSameBlock && isNextLine) {
              // Remove hyphen and merge text to the first word
              currentWord.text = currentWord.text.replace(HYPHEN_REGEX, '') + nextWord.text;
              
              // Clear text of the second word (phantom word)
              // This preserves its bounding box for highlighting but it won't be read by TTS (if handled correctly)
              nextWord.text = "";
              
              // Do NOT merge coordinates. Keep them as separate words.
              // Do NOT skip nextWord. Let it be added to the list.
            }
          }
          
          dehyphenatedWords.push(currentWord);
          currentWord = nextWord;
        }
        dehyphenatedWords.push(currentWord);
        
        return dehyphenatedWords;
      }
      
      return mergedWords;
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
