import { createSignal, createRoot } from 'solid-js';
import type { Word } from '../pdf/types';
import type { Sentence } from '../services/readingTypes';
import { buildSentences } from '../services/sentenceBuilder';
import { pdfStore } from './pdfStore';

export interface ReadingCursor {
  pageNum: number;
  sentenceIndex: number;
}

function createReadingSessionStore() {
  const pageCache = new Map<number, Sentence[]>();

  const [cursor, setCursor] = createSignal<ReadingCursor>({ pageNum: 0, sentenceIndex: 0 });
  const [isPlaying, setIsPlaying] = createSignal(false);
  const [columnMode, setColumnMode] = createSignal(1);
  const [headerMargin, setHeaderMargin] = createSignal(50);
  const [footerMargin, setFooterMargin] = createSignal(60);

  function addPageSentences(pageNum: number, words: Word[], pageHeightPts: number, pageWidthPts: number, scale: number): void {
    const sentences = buildSentences(
      words,
      pageNum,
      pageHeightPts,
      pageWidthPts,
      headerMargin(),
      footerMargin(),
      columnMode(),
      scale
    );
    pageCache.set(pageNum, sentences);

    const currentCursor = cursor();
    if (currentCursor.pageNum === pageNum && sentences.length > 0 && currentCursor.sentenceIndex >= sentences.length) {
      setCursor({ pageNum, sentenceIndex: 0 });
    }
  }

  function clearPageSentences(pageNum: number): void {
    pageCache.delete(pageNum);
  }

  function clearAllSentences(): void {
    pageCache.clear();
  }

  function resetDocumentState(): void {
    pageCache.clear();
    setCursor({ pageNum: 0, sentenceIndex: 0 });
    setIsPlaying(false);
  }

  function getPageSentences(pageNum: number): Sentence[] {
    return pageCache.get(pageNum) ?? [];
  }

  function hasPageSentences(pageNum: number): boolean {
    return (pageCache.get(pageNum)?.length ?? 0) > 0;
  }

  function isPageCached(pageNum: number): boolean {
    return pageCache.has(pageNum);
  }

  function getCurrentSentence(): Sentence | undefined {
    const c = cursor();
    return pageCache.get(c.pageNum)?.[c.sentenceIndex];
  }

  function getSentenceAtCursor(target: ReadingCursor): Sentence | undefined {
    return pageCache.get(target.pageNum)?.[target.sentenceIndex];
  }

  function nextSentence(): void {
    const nextCursor = getNextCursorFrom(cursor());
    if (nextCursor) {
      setCursor(nextCursor);
    }
  }

  function prevSentence(): void {
    const prevCursor = getPrevCursorFrom(cursor());
    if (prevCursor) {
      setCursor(prevCursor);
    }
  }

  function peekRelativeCursor(offset: number): ReadingCursor | null {
    if (offset === 0) return cursor();

    let target = cursor();

    if (offset > 0) {
      for (let step = 0; step < offset; step += 1) {
        const nextCursor = getNextCursorFrom(target);
        if (!nextCursor) return null;
        target = nextCursor;
      }
      return target;
    }

    for (let step = 0; step < Math.abs(offset); step += 1) {
      const prevCursor = getPrevCursorFrom(target);
      if (!prevCursor) return null;
      target = prevCursor;
    }

    return target;
  }

  function goToPageSentence(pageNum: number, sentenceIndex: number = 0): boolean {
    const sentences = pageCache.get(pageNum);
    if (sentences && sentences.length > 0) {
      const clampedSentenceIndex = Math.max(0, Math.min(sentenceIndex, sentences.length - 1));
      setCursor({ pageNum, sentenceIndex: clampedSentenceIndex });
      return true;
    }
    return false;
  }

  function goToSentence(pageNum: number, sentenceIndex: number): void {
    setCursor({ pageNum: Math.max(0, pageNum), sentenceIndex: Math.max(0, sentenceIndex) });
  }

  function isAtEnd(): boolean {
    const c = cursor();
    const pageSentences = pageCache.get(c.pageNum) ?? [];
    if (c.sentenceIndex < pageSentences.length - 1) return false;

    const nextCachedPage = findNextPageWithSentences(c.pageNum + 1);
    if (nextCachedPage !== -1) return false;

    return c.pageNum >= Math.max(0, pdfStore.totalPages() - 1);
  }

  function peekNextCursor(): ReadingCursor | null {
    return getNextCursorFrom(cursor());
  }

  function getNextCursorFrom(fromCursor: ReadingCursor): ReadingCursor | null {
    const pageSentences = pageCache.get(fromCursor.pageNum) ?? [];
    if (fromCursor.sentenceIndex + 1 < pageSentences.length) {
      return { pageNum: fromCursor.pageNum, sentenceIndex: fromCursor.sentenceIndex + 1 };
    }

    const nextPage = findNextPageWithSentences(fromCursor.pageNum + 1);
    if (nextPage !== -1) {
      return { pageNum: nextPage, sentenceIndex: 0 };
    }

    return null;
  }

  function getPrevCursorFrom(fromCursor: ReadingCursor): ReadingCursor | null {
    if (fromCursor.sentenceIndex > 0) {
      return { pageNum: fromCursor.pageNum, sentenceIndex: fromCursor.sentenceIndex - 1 };
    }

    const prevPage = findPrevPageWithSentences(fromCursor.pageNum - 1);
    if (prevPage !== -1) {
      const prevSentences = pageCache.get(prevPage) ?? [];
      return { pageNum: prevPage, sentenceIndex: Math.max(0, prevSentences.length - 1) };
    }

    return null;
  }

  function findNextPageWithSentences(fromPage: number): number {
    let page = fromPage;
    while (page < 10000) {
      const s = pageCache.get(page);
      if (s && s.length > 0) return page;
      if (!pageCache.has(page)) break;
      page++;
    }
    return -1;
  }

  function findPrevPageWithSentences(fromPage: number): number {
    for (let page = fromPage; page >= 0; page--) {
      const s = pageCache.get(page);
      if (s && s.length > 0) return page;
    }
    return -1;
  }

  return {
    cursor,
    setCursor,
    isPlaying,
    setIsPlaying,
    columnMode,
    setColumnMode,
    headerMargin,
    setHeaderMargin,
    footerMargin,
    setFooterMargin,
    addPageSentences,
    clearPageSentences,
    clearAllSentences,
    resetDocumentState,
    getPageSentences,
    hasPageSentences,
    isPageCached,
    getCurrentSentence,
    getSentenceAtCursor,
    nextSentence,
    prevSentence,
    goToPageSentence,
    goToSentence,
    isAtEnd,
    peekNextCursor,
    peekRelativeCursor,
  };
}

export const readingSession = createRoot(createReadingSessionStore);
