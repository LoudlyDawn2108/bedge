import type { Word } from '../pdf/types';
import type { Sentence } from './readingTypes';

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

  for (const word of filteredWords) {
    const blockChanged =
      currentWords.length > 0 &&
      word.blockId !== undefined &&
      currentWords[0].blockId !== undefined &&
      word.blockId !== currentWords[0].blockId;

    if (blockChanged) {
      flush();
    }

    currentWords.push(word);
    currentText.push(word.text);

    if (/[.!?]$/.test(word.text)) {
      flush();
    }
  }

  flush();

  return result;
}
