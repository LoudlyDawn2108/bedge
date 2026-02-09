import { createSignal, createRoot } from 'solid-js';
import type { Word } from '../services/pdfService';

export interface Sentence {
  text: string;
  words: Word[];
  pageNum: number;
}

function createTTSStore() {
  const [sentences, setSentences] = createSignal<Sentence[]>([]);
  const [currentSentenceIdx, setCurrentSentenceIdx] = createSignal(0);
  const [isPlaying, setIsPlaying] = createSignal(false);
  const [columnMode, setColumnMode] = createSignal(1); // 1 = single, 2 = two-column
  const [headerMargin, setHeaderMargin] = createSignal(50);
  const [footerMargin, setFooterMargin] = createSignal(60);
  
  // Build sentences from extracted words
  function buildSentences(words: Word[], pageNum: number, pageHeight: number, pageWidth: number) {
    const hMargin = headerMargin();
    const fMargin = footerMargin();
    const colMode = columnMode();
    
    // Filter out header/footer words
    let filteredWords = words.filter(w => {
      if (hMargin > 0 && w.y0 < hMargin) return false;
      if (fMargin > 0 && w.y0 > pageHeight - fMargin) return false;
      return true;
    });
    
    // For 2-column mode, reorder words
    if (colMode === 2) {
      const midpoint = pageWidth / 2;
      const leftWords = filteredWords.filter(w => w.x1 < midpoint);
      const rightWords = filteredWords.filter(w => w.x0 >= midpoint);
      
      // Sort each column by Y, then X
      leftWords.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
      rightWords.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
      
      filteredWords = [...leftWords, ...rightWords];
    }
    
    // Group words into sentences
    const newSentences: Sentence[] = [];
    let currentWords: Word[] = [];
    let currentText: string[] = [];
    
    for (const word of filteredWords) {
      currentWords.push(word);
      currentText.push(word.text);
      
      // Check for sentence ending
      if (/[.!?]$/.test(word.text)) {
        newSentences.push({
          text: currentText.join(' '),
          words: [...currentWords],
          pageNum
        });
        currentWords = [];
        currentText = [];
      }
    }
    
    // Add remaining words
    if (currentWords.length > 0) {
      newSentences.push({
        text: currentText.join(' '),
        words: currentWords,
        pageNum
      });
    }
    
    return newSentences;
  }
  
  function addPageSentences(words: Word[], pageNum: number, pageHeight: number, pageWidth: number) {
    const pageSentences = buildSentences(words, pageNum, pageHeight, pageWidth);
    // Remove existing sentences for this page and add new ones
    setSentences(prev => {
      const filtered = prev.filter(s => s.pageNum !== pageNum);
      const combined = [...filtered, ...pageSentences];
      // Sort by page and position
      combined.sort((a, b) => {
        if (a.pageNum !== b.pageNum) return a.pageNum - b.pageNum;
        const aY = a.words[0]?.y0 ?? 0;
        const bY = b.words[0]?.y0 ?? 0;
        return aY - bY;
      });
      return combined;
    });
  }
  
  function clearSentences() {
    setSentences([]);
    setCurrentSentenceIdx(0);
  }
  
  function nextSentence() {
    setCurrentSentenceIdx(prev => Math.min(prev + 1, sentences().length - 1));
  }
  
  function prevSentence() {
    setCurrentSentenceIdx(prev => Math.max(prev - 1, 0));
  }
  
  function getCurrentSentence(): Sentence | undefined {
    return sentences()[currentSentenceIdx()];
  }
  
  // Find the index of the first sentence on a specific page
  function getFirstSentenceIdxOnPage(pageNum: number): number {
    const idx = sentences().findIndex(s => s.pageNum === pageNum);
    return idx >= 0 ? idx : -1;
  }
  
  // Jump to first sentence on a specific page
  function goToPageSentence(pageNum: number): boolean {
    const idx = getFirstSentenceIdxOnPage(pageNum);
    if (idx >= 0) {
      setCurrentSentenceIdx(idx);
      return true;
    }
    return false;
  }
  
  return {
    sentences,
    currentSentenceIdx,
    setCurrentSentenceIdx,
    isPlaying,
    setIsPlaying,
    columnMode,
    setColumnMode,
    headerMargin,
    setHeaderMargin,
    footerMargin,
    setFooterMargin,
    addPageSentences,
    clearSentences,
    nextSentence,
    prevSentence,
    getCurrentSentence,
    getFirstSentenceIdxOnPage,
    goToPageSentence
  };
}

// Create singleton store
export const ttsStore = createRoot(createTTSStore);
