import {formatThinkingDuration, splitThinking} from '../src/thinking';

describe('splitThinking', () => {
  it('reports no thinking for plain content', () => {
    expect(splitThinking('hello there')).toEqual({
      hasThinking: false,
      thinking: '',
      answer: '',
      open: false,
    });
  });

  it('splits a closed think block', () => {
    expect(splitThinking('<think>hmm</think>the answer')).toEqual({
      hasThinking: true,
      thinking: 'hmm',
      answer: 'the answer',
      open: false,
    });
  });

  it('marks an unclosed block as open with empty answer', () => {
    expect(splitThinking('<think>still going')).toEqual({
      hasThinking: true,
      thinking: 'still going',
      answer: '',
      open: true,
    });
  });

  it('matches tags case-insensitively and trims parts', () => {
    expect(splitThinking('<THINK>  spaced  </Think>  done  ')).toEqual({
      hasThinking: true,
      thinking: 'spaced',
      answer: 'done',
      open: false,
    });
  });

  it('ignores a stray close tag without an opener', () => {
    expect(splitThinking('oops </think> hi').hasThinking).toBe(false);
  });
});

describe('formatThinkingDuration', () => {
  it('shows tenths under 10s and whole seconds above', () => {
    expect(formatThinkingDuration(300)).toBe('0.3s');
    expect(formatThinkingDuration(9800)).toBe('9.8s');
    expect(formatThinkingDuration(12000)).toBe('12s');
  });
});
