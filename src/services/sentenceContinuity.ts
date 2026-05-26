const TERMINAL_SENTENCE_PATTERN = /[.!?:][)"'\]]*$/;

export function hasTerminalSentencePunctuation(text: string): boolean {
  return TERMINAL_SENTENCE_PATTERN.test(text.trim());
}

export function joinSentenceParts(left: string, right: string): string {
  const trimmedLeft = left.trim();
  const trimmedRight = right.trim();

  if (!trimmedLeft) return trimmedRight;
  if (!trimmedRight) return trimmedLeft;

  if (trimmedLeft.endsWith('-') && /^\w/.test(trimmedRight)) {
    return `${trimmedLeft.slice(0, -1)}${trimmedRight}`;
  }

  return `${trimmedLeft} ${trimmedRight}`;
}
