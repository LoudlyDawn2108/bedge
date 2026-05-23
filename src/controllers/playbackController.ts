import { ttsService, type TTSRequest } from '../services/ttsService';
import { documentSession } from '../services/documentSession';
import { readingSession, type ReadingCursor } from '../stores/readingSessionStore';
import { pdfStore } from '../stores/pdfStore';

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
    return readingSession.goToPageSentence(pageNum, sentenceIndex);
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

    const runId = ++this.activeRunId;
    readingSession.setIsPlaying(true);
    this.prefetchAroundCursor();
    await this.runLoop(runId);
  }

  stop(): void {
    this.activeRunId += 1;
    ttsService.stop();
    readingSession.setIsPlaying(false);
  }

  async next(): Promise<void> {
    const wasPlaying = readingSession.isPlaying();
    if (wasPlaying) this.stop();

    const before = readingSession.cursor();
    readingSession.nextSentence();

    const after = readingSession.cursor();
    if (after.pageNum === before.pageNum && after.sentenceIndex === before.sentenceIndex) {
      const nextPage = before.pageNum + 1;
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
      const request = this.getRequestForCursor(currentCursor);
      if (!request) break;

      this.prefetchAroundCursor();

      try {
        await ttsService.play(request);

        if (this.activeRunId !== runId) break;

        const nextCursor = readingSession.peekNextCursor();
        if (nextCursor) {
          readingSession.nextSentence();
          continue;
        }

        const nextPage = currentCursor.pageNum + 1;
        if (nextPage >= pdfStore.totalPages()) break;

        const nextReady = await this.ensureCursorReady(nextPage);
        if (!nextReady) break;

        if (this.activeRunId !== runId) break;
        continue;
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes('interrupted') || msg.includes('canceled')) break;
        console.error('TTS Error:', err);
        alert('TTS Error: ' + msg);
        break;
      }
    }

    if (this.activeRunId === runId) {
      readingSession.setIsPlaying(false);
    }
  }
}

export const playbackController = new PlaybackController();
