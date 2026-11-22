import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './App';
describe('design prototype', () => {
  it('labels example content and offers a reading preview', () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('内容尚未上线');
    expect(html).toContain('阅读体验预览');
  });
});
