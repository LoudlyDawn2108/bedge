import { ttsService, type TTSRequest } from '../services/ttsService';
import { documentSession } from '../services/documentSession';
import { readingSession, type ReadingCursor } from '../stores/readingSessionStore';
import { pdfStore } from '../stores/pdfStore';
import { hasTerminalSentencePunctuation, joinSentenceParts } from '../services/sentenceContinuity';

interface SpokenRequest {
  request: TTSRequest;
  consumedNextFirstSentence?: ReadingCursor;
}

function isSameCursor(left: ReadingCursor | null, right: ReadingCursor): boolean {
  return left?.pageNum === right.pageNum && left.sentenceIndex === right.sentenceIndex;
}

class PlaybackController {
  private activeRunId = 0;

  private async ensurePageSentences(pageNum: number): Promise<boolean> {
    if (pageNum < 0 || pageNum >= pdfStore.totalPages()) return false;
    if (readingSession.hasPageSentences(pageNum)) return true;

    try {
      const [words, dims] = await Promise.all([
        documentSession.getPageText(pageNum),
        documentSession.getPageDimensions(pageNum),
      ]);
      readingSession.addPageSentences(pageNum, words, dims.height, dims.width, pdfStore.zoomLevel());
      return readingSession.hasPageSentences(pageNum);
    } catch (error) {
      console.error(`Failed to prepare page ${pageNum} for playback:`, error);
      return false;
    }
  }

  private async ensureCursorReady(pageNum: number, sentenceIndex: number = 0): Promise<boolean> {
    const ready = await this.ensurePageSentences(pageNum);
    if (!ready) return false;

    if (sentenceIndex === 0 && pageNum > 0) {
      await this.ensurePageSentences(pageNum - 1);
    }

    return readingSession.goToPageSentence(pageNum, sentenceIndex);
  }

  private async ensureContinuationPageForCursor(cursor: ReadingCursor): Promise<void> {
    const sentence = readingSession.getSentenceAtCursor(cursor);
    const pageSentences = readingSession.getPageSentences(cursor.pageNum);
    const nextPage = cursor.pageNum + 1;

    if (
      !sentence ||
      cursor.sentenceIndex !== pageSentences.length - 1 ||
      nextPage >= pdfStore.totalPages() ||
      hasTerminalSentencePunctuation(sentence.text)
    ) {
      readingSession.refreshContinuedHighlight();
      return;
    }

    await this.ensurePageSentences(nextPage);
    readingSession.refreshContinuedHighlight();
  }

  private getRequestForCursor(cursor: ReadingCursor): TTSRequest | null {
    const sentence = readingSession.getSentenceAtCursor(cursor);
    if (!sentence) return null;

    return {
      pageNum: cursor.pageNum,
      sentenceIndex: cursor.sentenceIndex,
      text: sentence.text,
    };
  }

  private async getSpokenRequestForCursor(cursor: ReadingCursor): Promise<SpokenRequest | null> {
    const request = this.getRequestForCursor(cursor);
    const sentence = readingSession.getSentenceAtCursor(cursor);
    if (!request || !sentence) return null;

    const pageSentences = readingSession.getPageSentences(cursor.pageNum);
    const isLastSentenceOnPage = cursor.sentenceIndex === pageSentences.length - 1;
    const nextPage = cursor.pageNum + 1;

    if (!isLastSentenceOnPage || nextPage >= pdfStore.totalPages() || hasTerminalSentencePunctuation(sentence.text)) {
      return { request };
    }

    const nextReady = await this.ensurePageSentences(nextPage);
    if (!nextReady) return { request };

    const nextSentence = readingSession.getSentenceAtCursor({ pageNum: nextPage, sentenceIndex: 0 });
    if (!nextSentence) return { request };

    return {
      request: {
        ...request,
        text: joinSentenceParts(sentence.text, nextSentence.text),
      },
      consumedNextFirstSentence: { pageNum: nextPage, sentenceIndex: 0 },
    };
  }

  private async advanceAfterSpokenRequest(spokenRequest: SpokenRequest, currentCursor: ReadingCursor): Promise<boolean> {
    const consumedNextFirstSentence = spokenRequest.consumedNextFirstSentence;

    if (consumedNextFirstSentence) {
      const nextPageSentences = readingSession.getPageSentences(consumedNextFirstSentence.pageNum);
      const nextSentenceIndex = consumedNextFirstSentence.sentenceIndex + 1;

      if (nextSentenceIndex < nextPageSentences.length) {
        readingSession.goToSentence(consumedNextFirstSentence.pageNum, nextSentenceIndex);
        return true;
      }

      const followingPage = consumedNextFirstSentence.pageNum + 1;
      if (followingPage >= pdfStore.totalPages()) return false;

      return await this.ensureCursorReady(followingPage);
    }

    const nextCursor = readingSession.peekNextCursor();
    if (nextCursor) {
      readingSession.nextSentence();
      return true;
    }

    const nextPage = currentCursor.pageNum + 1;
    if (nextPage >= pdfStore.totalPages()) return false;

    return await this.ensureCursorReady(nextPage);
  }

  private maybePrefetchNextPage(cursor: ReadingCursor): void {
    const pageSentences = readingSession.getPageSentences(cursor.pageNum);
    if (pageSentences.length === 0) return;

    const remainingOnPage = pageSentences.length - cursor.sentenceIndex - 1;
    if (remainingOnPage > 2) return;

    const nextPage = cursor.pageNum + 1;
    if (nextPage >= pdfStore.totalPages() || readingSession.isPageCached(nextPage)) return;

    void this.ensurePageSentences(nextPage);
  }

  private prefetchAroundCursor(): void {
    const currentCursor = readingSession.cursor();
    this.maybePrefetchNextPage(currentCursor);

    const requests: TTSRequest[] = [];
    const seen = new Set<string>();

    for (const offset of [0, 1, 2, -1]) {
      const targetCursor = offset === 0 ? currentCursor : readingSession.peekRelativeCursor(offset);
      if (!targetCursor) continue;

      const request = this.getRequestForCursor(targetCursor);
      if (!request) continue;

      const requestKey = `${request.pageNum}:${request.sentenceIndex}`;
      if (seen.has(requestKey)) continue;

      seen.add(requestKey);
      requests.push(request);
    }

    ttsService.primeWindow(requests);
  }

  async start(): Promise<void> {
    if (readingSession.isPlaying()) return;

    const visiblePage = pdfStore.currentPage();
    const currentCursor = readingSession.cursor();
    const targetSentenceIndex = currentCursor.pageNum === visiblePage ? currentCursor.sentenceIndex : 0;

    const ready = await this.ensureCursorReady(visiblePage, targetSentenceIndex);
    if (!ready) return;

    await this.ensureContinuationPageForCursor(readingSession.cursor());

    const runId = ++this.activeRunId;
    readingSession.setIsPlaying(true);
    this.prefetchAroundCursor();
    await this.runLoop(runId);
  }

  stop(): void {
    this.activeRunId += 1;
    ttsService.stop();
    readingSession.refreshContinuedHighlight();
    readingSession.setIsPlaying(false);
  }

  async next(): Promise<void> {
    const wasPlaying = readingSession.isPlaying();
    if (wasPlaying) this.stop();

    const before = readingSession.cursor();
    await this.ensureContinuationPageForCursor(readingSession.getLogicalStartCursor(before));
    readingSession.nextSentence();

    const after = readingSession.cursor();
    if (after.pageNum === before.pageNum && after.sentenceIndex === before.sentenceIndex) {
      const nextPage = readingSession.getLogicalEndCursor(before).pageNum + 1;
      if (await this.ensurePageSentences(nextPage)) {
        readingSession.nextSentence();
      }
    }

    this.prefetchAroundCursor();
  }

  async prev(): Promise<void> {
    const wasPlaying = readingSession.isPlaying();
    if (wasPlaying) this.stop();

    const before = readingSession.cursor();
    readingSession.prevSentence();

    const after = readingSession.cursor();
    if (after.pageNum === before.pageNum && after.sentenceIndex === before.sentenceIndex) {
      const prevPage = before.pageNum - 1;
      if (await this.ensurePageSentences(prevPage)) {
        readingSession.prevSentence();
      }
    }

    this.prefetchAroundCursor();
  }

  async toggle(): Promise<void> {
    if (readingSession.isPlaying()) {
      this.stop();
    } else {
      await this.start();
    }
  }

  private async runLoop(runId: number): Promise<void> {
    while (this.activeRunId === runId) {
      const currentCursor = readingSession.cursor();
      const spokenRequest = await this.getSpokenRequestForCursor(currentCursor);
      if (!spokenRequest) break;

      this.prefetchAroundCursor();
      const continuedHighlightCursor = spokenRequest.consumedNextFirstSentence ?? null;
      readingSession.setContinuedHighlightCursor(continuedHighlightCursor);

      try {
        try {
          await ttsService.play(spokenRequest.request);
        } finally {
          if (
            continuedHighlightCursor &&
            this.activeRunId === runId &&
            isSameCursor(readingSession.continuedHighlightCursor(), continuedHighlightCursor)
          ) {
            readingSession.setContinuedHighlightCursor(null);
          }
        }

        if (this.activeRunId !== runId) break;

        const advanced = await this.advanceAfterSpokenRequest(spokenRequest, currentCursor);
        if (!advanced || this.activeRunId !== runId) break;
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes('interrupted') || msg.includes('canceled')) break;
        console.error('TTS Error:', err);
        alert('TTS Error: ' + msg);
        break;
      }
    }

    if (this.activeRunId === runId) {
      readingSession.setContinuedHighlightCursor(null);
      readingSession.setIsPlaying(false);
    }
  }
}

export const playbackController = new PlaybackController();
