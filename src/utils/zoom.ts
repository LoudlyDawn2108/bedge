export const DEFAULT_ZOOM_LEVEL = 2.5;
export const MIN_ZOOM_LEVEL = 0.5;
export const MAX_ZOOM_LEVEL = 4;
export const ZOOM_STEP = 0.5;

export function clampZoomLevel(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ZOOM_LEVEL;
  return Math.max(MIN_ZOOM_LEVEL, Math.min(MAX_ZOOM_LEVEL, value));
}

export function roundZoomLevel(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeFitWidthZoom(containerWidth: number, pageWidth: number, horizontalPadding: number): number | null {
  const availableWidth = containerWidth - horizontalPadding;
  if (availableWidth <= 0 || pageWidth <= 0) return null;

  return clampZoomLevel(availableWidth / pageWidth);
}

export function computeFitTextZoom(
  containerWidth: number,
  pageWidth: number,
  textWidthRatio: number,
  horizontalPadding: number
): number | null {
  if (!Number.isFinite(textWidthRatio) || textWidthRatio <= 0 || textWidthRatio > 1) return null;
  return computeFitWidthZoom(containerWidth, pageWidth * textWidthRatio, horizontalPadding);
}
