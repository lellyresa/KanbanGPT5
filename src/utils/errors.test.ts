import { describe, expect, it } from 'vitest';

import { resolveErrorMessage } from './errors';

describe('resolveErrorMessage', () => {
  it('returns the error message when provided with an Error instance', () => {
    const message = resolveErrorMessage(new Error('Boom'), 'fallback');
    expect(message).toBe('Boom');
  });

  it('returns message from plain object with message property', () => {
    const message = resolveErrorMessage({ message: 'Oops' }, 'fallback');
    expect(message).toBe('Oops');
  });

  it('falls back when message is empty or missing', () => {
    expect(resolveErrorMessage({}, 'fallback')).toBe('fallback');
    expect(resolveErrorMessage({ message: '   ' }, 'fallback')).toBe('fallback');
  });
});
