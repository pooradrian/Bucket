export interface SplitThinking {
  hasThinking: boolean;
  thinking: string;
  answer: string;
  open: boolean;
}

export function formatThinkingDuration(ms: number): string {
  const s = ms / 1000;
  return s < 10 ? `${+s.toFixed(1)}s` : `${Math.round(s)}s`;
}

const NO_THINKING: SplitThinking = {hasThinking: false, thinking: '', answer: '', open: false};

export function splitThinking(content: string): SplitThinking {
  const openMatch = /<think>/i.exec(content);
  if (!openMatch) return NO_THINKING;
  const openEnd = openMatch.index + openMatch[0].length;
  const closeMatch = /<\/think>/i.exec(content.slice(openEnd));
  if (!closeMatch) {
    return {
      hasThinking: true,
      thinking: content.slice(openEnd).trim(),
      answer: '',
      open: true,
    };
  }
  return {
    hasThinking: true,
    thinking: content.slice(openEnd, openEnd + closeMatch.index).trim(),
    answer: content.slice(openEnd + closeMatch.index + closeMatch[0].length).trim(),
    open: false,
  };
}

export function visibleContent(content: string, showThinking: boolean): string {
  if (showThinking) return content;
  const split = splitThinking(content);
  return split.hasThinking ? split.answer : content;
}
