import { createSignal, createRoot } from 'solid-js';
import type { Word } from '../pdf/types';
import type { Sentence } from '../services/readingTypes';
import { buildSentences } from '../services/sentenceBuilder';
import { hasTerminalSentencePunctuation } from '../services/sentenceContinuity';
import { pdfStore } from './pdfStore';

export const DEFAULT_COLUMN_MODE = 1;
export const DEFAULT_HEADER_MARGIN = 50;
export const DEFAULT_FOOTER_MARGIN = 175;

export interface ReadingCursor {
  pageNum: number;
  sentenceIndex: number;
}

function createReadingSessionStore() {
  const pageCache = new Map<number, Sentence[]>();

  const [cursor, setCursor] = createSignal<ReadingCursor>({ pageNum: 0, sentenceIndex: 0 });
  const [continuedHighlightCursor, setContinuedHighlightCursorSignal] = createSignal<ReadingCursor | null>(null);
  const [isPlaying, setIsPlaying] = createSignal(false);
  const [columnMode, setColumnMode] = createSignal(DEFAULT_COLUMN_MODE);
  const [headerMargin, setHeaderMargin] = createSignal(DEFAULT_HEADER_MARGIN);
  const [footerMargin, setFooterMargin] = createSignal(DEFAULT_FOOTER_MARGIN);

  function sameCursor(left: ReadingCursor | null, right: ReadingCursor): boolean {
    return left?.pageNum === right.pageNum && left.sentenceIndex === right.sentenceIndex;
  }

  function getContinuationCursorForStart(startCursor: ReadingCursor): ReadingCursor | null {
    const pageSentences = pageCache.get(startCursor.pageNum) ?? [];
    const sentence = pageSentences[startCursor.sentenceIndex];
    if (!sentence || startCursor.sentenceIndex !== pageSentences.length - 1) return null;
    if (hasTerminalSentencePunctuation(sentence.text)) return null;

    const nextPage = startCursor.pageNum + 1;
    const nextSentences = pageCache.get(nextPage) ?? [];
    return nextSentences.length > 0 ? { pageNum: nextPage, sentenceIndex: 0 } : null;
  }

  function getLogicalStartCursor(target: ReadingCursor): ReadingCursor {
    if (target.sentenceIndex !== 0 || target.pageNum <= 0) return target;

    const prevPage = target.pageNum - 1;
    const prevSentences = pageCache.get(prevPage) ?? [];
    const prevSentenceIndex = prevSentences.length - 1;
    const prevSentence = prevSentences[prevSentenceIndex];
    if (!prevSentence || hasTerminalSentencePunctuation(prevSentence.text)) return target;

    return { pageNum: prevPage, sentenceIndex: prevSentenceIndex };
  }

  function getLogicalEndCursor(target: ReadingCursor): ReadingCursor {
    const startCursor = getLogicalStartCursor(target);
    return getContinuationCursorForStart(startCursor) ?? startCursor;
  }

  function syncContinuedHighlightForCursor(target: ReadingCursor): void {
    const nextCursor = getContinuationCursorForStart(target);
    const currentContinuedCursor = continuedHighlightCursor();

    if (nextCursor) {
      if (!sameCursor(currentContinuedCursor, nextCursor)) {
        setContinuedHighlightCursorSignal(nextCursor);
      }
      return;
    }

    if (currentContinuedCursor) {
      setContinuedHighlightCursorSignal(null);
    }
  }

  function refreshContinuedHighlight(): void {
    const currentCursor = cursor();
    const logicalCursor = getLogicalStartCursor(currentCursor);

    if (!sameCursor(currentCursor, logicalCursor)) {
      setReadingCursor(logicalCursor);
      return;
    }

    syncContinuedHighlightForCursor(logicalCursor);
  }

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
      setReadingCursor({ pageNum, sentenceIndex: 0 });
    } else {
      refreshContinuedHighlight();
    }
  }

  function clearPageSentences(pageNum: number): void {
    pageCache.delete(pageNum);
    const continuedCursor = continuedHighlightCursor();
    if (continuedCursor?.pageNum === pageNum) {
      setContinuedHighlightCursor(null);
    }
    refreshContinuedHighlight();
  }

  function clearAllSentences(): void {
    pageCache.clear();
    setContinuedHighlightCursor(null);
  }

  function resetDocumentState(): void {
    pageCache.clear();
    setReadingCursor({ pageNum: 0, sentenceIndex: 0 });
    setContinuedHighlightCursor(null);
    setIsPlaying(false);
  }

  function setReadingCursor(nextCursor: ReadingCursor): void {
    const logicalCursor = getLogicalStartCursor(nextCursor);
    setCursor(logicalCursor);
    syncContinuedHighlightForCursor(logicalCursor);
  }

  function setContinuedHighlightCursor(nextCursor: ReadingCursor | null): void {
    setContinuedHighlightCursorSignal(nextCursor ? { ...nextCursor } : null);
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

  function getContinuedHighlightSentence(): Sentence | undefined {
    const target = continuedHighlightCursor();
    return target ? getSentenceAtCursor(target) : undefined;
  }

  function nextSentence(): void {
    const nextCursor = getNextCursorFrom(cursor());
    if (nextCursor) {
      setReadingCursor(nextCursor);
    }
  }

  function prevSentence(): void {
    const prevCursor = getPrevCursorFrom(cursor());
    if (prevCursor) {
      setReadingCursor(prevCursor);
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
      setReadingCursor({ pageNum, sentenceIndex: clampedSentenceIndex });
      return true;
    }
    return false;
  }

  function goToSentence(pageNum: number, sentenceIndex: number): void {
    setReadingCursor({ pageNum: Math.max(0, pageNum), sentenceIndex: Math.max(0, sentenceIndex) });
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
    const logicalEndCursor = getLogicalEndCursor(fromCursor);
    const physicalNextCursor = getNextPhysicalCursorFrom(logicalEndCursor);
    return physicalNextCursor ? getLogicalStartCursor(physicalNextCursor) : null;
  }

  function getPrevCursorFrom(fromCursor: ReadingCursor): ReadingCursor | null {
    const logicalStartCursor = getLogicalStartCursor(fromCursor);
    const physicalPrevCursor = getPrevPhysicalCursorFrom(logicalStartCursor);
    return physicalPrevCursor ? getLogicalStartCursor(physicalPrevCursor) : null;
  }

  function getNextPhysicalCursorFrom(fromCursor: ReadingCursor): ReadingCursor | null {
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

  function getPrevPhysicalCursorFrom(fromCursor: ReadingCursor): ReadingCursor | null {
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
    continuedHighlightCursor,
    setContinuedHighlightCursor,
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
    getContinuedHighlightSentence,
    nextSentence,
    prevSentence,
    goToPageSentence,
    goToSentence,
    isAtEnd,
    peekNextCursor,
    peekRelativeCursor,
    getLogicalStartCursor,
    getLogicalEndCursor,
    refreshContinuedHighlight,
  };
}

export const readingSession = createRoot(createReadingSessionStore);
