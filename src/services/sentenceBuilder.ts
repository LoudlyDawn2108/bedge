import type { Word } from '../pdf/types';
import type { Sentence } from './readingTypes';
import { hasTerminalSentencePunctuation } from './sentenceContinuity';

const LIST_MARKER_PATTERN = /^(?:[•‣▪▫◦●○■□◆◇*\-–—]|\(?[A-Za-z][.)]|[ivxlcdmIVXLCDM]{1,8}[.)])$/;
const HEADING_HEIGHT_RATIO = 1.15;
const HEADING_WIDTH_RATIO = 0.85;
const MAX_HEADING_WORDS = 12;

function getWordHeight(word: Word): number {
  return Math.max(1, word.y1 - word.y0);
}

function isListMarker(text: string): boolean {
  return LIST_MARKER_PATTERN.test(text.trim());
}

function hasParagraphSizedGap(previous: Word, next: Word): boolean {
  const lineHeight = Math.max(getWordHeight(previous), getWordHeight(next));
  const topDelta = next.y0 - previous.y0;
  const boxGap = next.y0 - previous.y1;

  return topDelta > lineHeight * 1.8 || boxGap > lineHeight * 0.8 || topDelta < -lineHeight * 1.8;
}

function startsNewVisualLine(previous: Word, next: Word): boolean {
  const lineHeight = Math.max(getWordHeight(previous), getWordHeight(next));
  return Math.abs(next.y0 - previous.y0) > lineHeight * 0.5;
}

function getLineWidth(words: Word[]): number {
  if (words.length === 0) return 0;

  const x0 = Math.min(...words.map(word => word.x0));
  const x1 = Math.max(...words.map(word => word.x1));
  return Math.max(0, x1 - x0);
}

function getMedianWordHeight(words: Word[]): number {
  if (words.length === 0) return 0;

  const heights = words.map(getWordHeight).sort((a, b) => a - b);
  return heights[Math.floor(heights.length / 2)];
}

function isSingleVisualLine(words: Word[]): boolean {
  const firstWord = words[0];
  if (firstWord === undefined) return false;

  return words.every(word => !startsNewVisualLine(firstWord, word));
}

function collectVisualLine(words: Word[], startIndex: number): Word[] {
  const firstWord = words[startIndex];
  if (firstWord === undefined) return [];

  const lineWords: Word[] = [];
  for (let index = startIndex; index < words.length; index++) {
    const word = words[index];
    if (word === undefined || startsNewVisualLine(firstWord, word)) break;
    lineWords.push(word);
  }

  return lineWords;
}

export function buildSentences(
  words: Word[],
  pageNum: number,
  pageHeightPts: number,
  pageWidthPts: number,
  headerMarginPx: number,
  footerMarginPx: number,
  columnMode: number,
  scale: number
): Sentence[] {
  const hMarginPts = headerMarginPx / scale;
  const fMarginPts = footerMarginPx / scale;

  let filteredWords = words.filter(w => {
    if (hMarginPts > 0 && w.y0 < hMarginPts) return false;
    if (fMarginPts > 0 && w.y0 > pageHeightPts - fMarginPts) return false;
    return true;
  });

  if (columnMode === 2) {
    const midpoint = pageWidthPts / 2;
    const leftWords = filteredWords.filter(w => w.x1 < midpoint);
    const rightWords = filteredWords.filter(w => w.x0 >= midpoint);

    leftWords.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
    rightWords.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);

    filteredWords = [...leftWords, ...rightWords];
  }

  const result: Sentence[] = [];
  let currentWords: Word[] = [];
  let currentText: string[] = [];
  let sentenceIndex = 0;

  const currentTextHasTerminalPunctuation = () => hasTerminalSentencePunctuation(currentText.join(' '));

  const flush = () => {
    if (currentWords.length === 0) return;
    const normalizedText = currentText.filter(text => text.trim().length > 0).join(' ');
    result.push({
      id: `${pageNum}:${sentenceIndex}`,
      text: normalizedText,
      words: [...currentWords],
      pageNum,
    });
    sentenceIndex++;
    currentWords = [];
    currentText = [];
  };

  const shouldFlushBeforeWord = (word: Word, wordIndex: number) => {
    if (currentWords.length === 0) return false;

    const previousWord = currentWords[currentWords.length - 1];
    return (
      currentTextHasTerminalPunctuation() ||
      isListMarker(word.text) ||
      hasParagraphSizedGap(previousWord, word) ||
      shouldFlushAfterListItem(previousWord, word) ||
      shouldFlushAfterStandaloneHeading(previousWord, word, wordIndex)
    );
  };

  const shouldFlushAfterStandaloneHeading = (previousWord: Word, word: Word, wordIndex: number) => {
    if (!startsNewVisualLine(previousWord, word) || word.y0 <= previousWord.y0) return false;
    if (currentWords.length > MAX_HEADING_WORDS || !isSingleVisualLine(currentWords)) return false;
    if (isListMarker(currentWords[0]?.text ?? '') || isListMarker(word.text)) return false;

    const nextLineWords = collectVisualLine(filteredWords, wordIndex);
    if (nextLineWords.length === 0) return false;

    const currentLineHeight = getMedianWordHeight(currentWords);
    const nextLineHeight = getMedianWordHeight(nextLineWords);
    const currentLineWidth = getLineWidth(currentWords);
    const nextLineWidth = getLineWidth(nextLineWords);

    return (
      nextLineHeight > 0 &&
      nextLineWidth > 0 &&
      currentLineHeight >= nextLineHeight * HEADING_HEIGHT_RATIO &&
      currentLineWidth <= nextLineWidth * HEADING_WIDTH_RATIO
    );
  };

  const shouldFlushAfterListItem = (previousWord: Word, word: Word) => {
    const listMarker = currentWords[0];
    if (listMarker === undefined || !isListMarker(listMarker.text)) return false;
    if (!startsNewVisualLine(previousWord, word)) return false;

    const markerLineHeight = getWordHeight(listMarker);
    const firstListTextWord = currentWords
      .slice(1)
      .find(currentWord => Math.abs(currentWord.y0 - listMarker.y0) <= markerLineHeight * 0.5);
    if (firstListTextWord === undefined) return false;

    const lineHeight = Math.max(getWordHeight(previousWord), getWordHeight(word));
    const indentTolerance = Math.max(2, lineHeight * 0.25);
    return word.x0 < firstListTextWord.x0 - indentTolerance;
  };

  for (const [wordIndex, word] of filteredWords.entries()) {
    if (shouldFlushBeforeWord(word, wordIndex)) {
      flush();
    }

    currentWords.push(word);
    currentText.push(word.text);
  }

  flush();

  return result;
}
