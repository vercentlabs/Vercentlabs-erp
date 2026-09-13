import { describe, expect, it } from 'vitest';
import { VisuallyHidden } from '../src/visually-hidden.js';

describe('VisuallyHidden', () => {
  it('renders its children inside a span with clip-based hiding styles', () => {
    const element = VisuallyHidden({ children: 'Loading' });
    expect(element.type).toBe('span');
    expect(element.props.children).toBe('Loading');
    expect(element.props.style.position).toBe('absolute');
    expect(element.props.style.overflow).toBe('hidden');
  });
});
