import type { PageMetrics, Word } from '../pdf/types';
import { documentSession } from './documentSession';

export const TEXT_FIT_PROFILE_VERSION = 1;
export const TEXT_FIT_PROFILE_MIN_CONFIDENCE = 0.6;
export const TEXT_FIT_PROFILE_MIN_SAMPLES = 3;

const MAX_SAMPLE_PAGES = 12;
const BODY_VERTICAL_MARGIN_RATIO = 0.1;
const MIN_BODY_WORDS = 25;
const MIN_BODY_LINES = 4;

interface TextLineBox {
  x0: number;
  x1: number;
  yCenter: number;
  height: number;
  wordCount: number;
}

interface PageTextFitProfile {
  widthRatio: number;
  centerRatio: number;
  wordCount: number;
}

export interface TextFitProfile {
  version: number;
  pageCount: number;
  widthRatio: number;
  centerRatio: number;
  confidence: number;
  sampleCount: number;
}

export interface BuildTextFitProfileOptions {
  pageCount: number;
  currentPage?: number;
  shouldContinue?: () => boolean;
}

function isFiniteWordBox(word: Word): boolean {
  return word.text.trim().length > 0
    && Number.isFinite(word.x0)
    && Number.isFinite(word.x1)
    && Number.isFinite(word.y0)
    && Number.isFinite(word.y1)
    && word.x1 > word.x0
    && word.y1 > word.y0;
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * ratio)));
  return sorted[index] ?? 0;
}

function median(values: number[]): number {
  return percentile(values, 0.5);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function roundRatio(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function roundConfidence(value: number): number {
  return Math.round(value * 100) / 100;
}

function getSamplePages(pageCount: number, currentPage?: number): number[] {
  if (pageCount <= 0) return [];

  const firstBodyPage = pageCount > 8 ? Math.floor(pageCount * 0.1) : 0;
  const lastBodyPage = pageCount > 8 ? Math.max(firstBodyPage, Math.ceil(pageCount * 0.9) - 1) : pageCount - 1;
  const bodyPageCount = lastBodyPage - firstBodyPage + 1;
  const sampleCount = Math.min(MAX_SAMPLE_PAGES, bodyPageCount);
  const pages = new Set<number>();

  if (currentPage !== undefined && currentPage >= firstBodyPage && currentPage <= lastBodyPage) {
    pages.add(currentPage);
  }

  if (sampleCount <= 1) {
    pages.add(firstBodyPage);
  } else {
    for (let index = 0; index < sampleCount; index += 1) {
      const offset = Math.round((index * Math.max(0, bodyPageCount - 1)) / (sampleCount - 1));
      pages.add(firstBodyPage + offset);
    }
  }

  return [...pages].sort((a, b) => a - b);
}

function createLineBoxes(words: Word[], metrics: PageMetrics): TextLineBox[] {
  const { bounds } = metrics;
  const bodyWords = words
    .filter(isFiniteWordBox)
    .filter(word => {
      const yRatio = ((word.y0 + word.y1) / 2 - bounds.y0) / bounds.height;
      return yRatio >= BODY_VERTICAL_MARGIN_RATIO && yRatio <= 1 - BODY_VERTICAL_MARGIN_RATIO;
    })
    .sort((a, b) => ((a.y0 + a.y1) / 2) - ((b.y0 + b.y1) / 2) || a.x0 - b.x0);

  const lines: TextLineBox[] = [];

  for (const word of bodyWords) {
    const yCenter = (word.y0 + word.y1) / 2;
    const height = word.y1 - word.y0;
    const previous = lines[lines.length - 1];

    if (previous && Math.abs(yCenter - previous.yCenter) <= Math.max(2, Math.max(previous.height, height) * 0.65)) {
      const nextWordCount = previous.wordCount + 1;
      previous.x0 = Math.min(previous.x0, word.x0);
      previous.x1 = Math.max(previous.x1, word.x1);
      previous.yCenter = ((previous.yCenter * previous.wordCount) + yCenter) / nextWordCount;
      previous.height = Math.max(previous.height, height);
      previous.wordCount = nextWordCount;
    } else {
      lines.push({
        x0: word.x0,
        x1: word.x1,
        yCenter,
        height,
        wordCount: 1,
      });
    }
  }

  return lines;
}

function isLikelyTwoColumn(lines: TextLineBox[], metrics: PageMetrics): boolean {
  const { bounds } = metrics;
  const leftLines = lines.filter(line => (line.x1 - bounds.x0) / bounds.width < 0.48).length;
  const rightLines = lines.filter(line => (line.x0 - bounds.x0) / bounds.width > 0.52).length;
  const crossingLines = lines.filter(line => {
    const left = (line.x0 - bounds.x0) / bounds.width;
    const right = (line.x1 - bounds.x0) / bounds.width;
    return left < 0.45 && right > 0.55;
  }).length;

  return leftLines >= 4 && rightLines >= 4 && crossingLines < lines.length * 0.35;
}

function getPageTextFitProfile(words: Word[], metrics: PageMetrics): PageTextFitProfile | null {
  const lines = createLineBoxes(words, metrics)
    .filter(line => line.wordCount >= 3)
    .filter(line => {
      const widthRatio = (line.x1 - line.x0) / metrics.bounds.width;
      return widthRatio >= 0.2 && widthRatio <= 0.95;
    });

  const wordCount = lines.reduce((total, line) => total + line.wordCount, 0);
  if (wordCount < MIN_BODY_WORDS || lines.length < MIN_BODY_LINES || isLikelyTwoColumn(lines, metrics)) return null;

  const lineWidths = lines.map(line => line.x1 - line.x0);
  const medianWidth = median(lineWidths);
  const bodyLines = lines.filter(line => line.x1 - line.x0 >= medianWidth * 0.6);
  if (bodyLines.length < MIN_BODY_LINES) return null;

  const leftRatios = bodyLines.map(line => (line.x0 - metrics.bounds.x0) / metrics.bounds.width);
  const rightRatios = bodyLines.map(line => (line.x1 - metrics.bounds.x0) / metrics.bounds.width);
  const leftRatio = percentile(leftRatios, 0.1);
  const rightRatio = percentile(rightRatios, 0.9);
  const widthRatio = rightRatio - leftRatio;
  const centerRatio = (leftRatio + rightRatio) / 2;

  if (widthRatio < 0.3 || widthRatio > 0.92 || centerRatio < 0.2 || centerRatio > 0.8) return null;

  return {
    widthRatio,
    centerRatio,
    wordCount,
  };
}

function aggregateProfiles(pageProfiles: PageTextFitProfile[], pageCount: number): TextFitProfile | null {
  if (pageProfiles.length === 0) return null;

  const medianWidth = median(pageProfiles.map(profile => profile.widthRatio));
  const clusteredProfiles = pageProfiles.filter(profile => Math.abs(profile.widthRatio - medianWidth) <= 0.12);
  const profiles = clusteredProfiles.length >= Math.min(TEXT_FIT_PROFILE_MIN_SAMPLES, pageProfiles.length)
    ? clusteredProfiles
    : pageProfiles;

  const widthRatios = profiles.map(profile => profile.widthRatio);
  const centerRatios = profiles.map(profile => profile.centerRatio);
  const widthRatio = median(widthRatios);
  const centerRatio = median(centerRatios);
  const widthSpread = percentile(widthRatios, 0.75) - percentile(widthRatios, 0.25);
  const centerSpread = percentile(centerRatios, 0.75) - percentile(centerRatios, 0.25);
  const coverage = clamp01(profiles.length / TEXT_FIT_PROFILE_MIN_SAMPLES);
  const stability = clamp01(1 - (((widthSpread / 0.15) + (centerSpread / 0.12)) / 2));
  const confidence = roundConfidence((coverage * 0.45) + (stability * 0.55));

  return {
    version: TEXT_FIT_PROFILE_VERSION,
    pageCount,
    widthRatio: roundRatio(widthRatio),
    centerRatio: roundRatio(centerRatio),
    confidence,
    sampleCount: profiles.length,
  };
}

export function isTextFitProfileCurrent(profile: TextFitProfile | undefined, pageCount: number): profile is TextFitProfile {
  return !!profile && profile.version === TEXT_FIT_PROFILE_VERSION && profile.pageCount === pageCount;
}

export function isTextFitProfileUsable(profile: TextFitProfile | undefined, pageCount: number): profile is TextFitProfile {
  return isTextFitProfileCurrent(profile, pageCount)
    && profile.confidence >= TEXT_FIT_PROFILE_MIN_CONFIDENCE
    && profile.sampleCount >= TEXT_FIT_PROFILE_MIN_SAMPLES;
}

export async function buildTextFitProfile(options: BuildTextFitProfileOptions): Promise<TextFitProfile | null> {
  const shouldContinue = options.shouldContinue ?? (() => true);
  const pageProfiles: PageTextFitProfile[] = [];

  for (const pageNum of getSamplePages(options.pageCount, options.currentPage)) {
    if (!shouldContinue()) return null;

    const cachedText = documentSession.peekPageText(pageNum);
    const textPromise = cachedText ? Promise.resolve(cachedText) : documentSession.getPageText(pageNum);
    const [words, metrics] = await Promise.all([
      textPromise,
      documentSession.ensurePageMetrics(pageNum),
    ]);

    if (!shouldContinue()) return null;

    const pageProfile = getPageTextFitProfile(words, metrics);
    if (pageProfile) pageProfiles.push(pageProfile);
  }

  return aggregateProfiles(pageProfiles, options.pageCount);
}
