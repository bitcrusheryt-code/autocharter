import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MainMenu from '../src/components/MainMenu';

test('main menu renders its real tasks without decorative gradients or fake status', () => {
  const noop = () => {};
  const html = renderToStaticMarkup(<MainMenu onSelectAutocharter={noop} onSelectConverter={noop} onSelectPlay={noop} onSelectSettings={noop} />);
  for (const label of ['IRIS', 'Play charts', 'Auto-Charter', 'Universal Converter', 'Settings']) {
    assert.ok(html.includes(label), `missing task: ${label}`);
  }
  assert.ok(html.includes('aria-label="Enter fullscreen"'));
  assert.ok(!html.includes('bg-gradient'));
  assert.ok(!html.includes('blur-3xl'));
  assert.ok(!html.includes('Engine Live'));
});
