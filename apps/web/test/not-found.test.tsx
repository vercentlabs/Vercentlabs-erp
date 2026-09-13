import { describe, expect, it } from 'vitest';
import NotFound from '../app/not-found.js';

describe('NotFound', () => {
  it('renders a heading announcing the page was not found', () => {
    const element = NotFound();
    expect(element.type).toBe('main');
    const children = element.props.children as unknown[];
    const heading = children[0] as { type: string; props: { children: string } };
    expect(heading.type).toBe('h1');
    expect(heading.props.children).toBe('Page not found');
  });
});
