"use strict";
// Oracle: visible UI vocabulary, literal UTC/measurement meanings and actual revealed controls.
// Show may arrange UI but must preserve the view and must not start analysis.
const { test, expect } = require('./fixtures.js');
test.use({ reducedMotion: 'reduce' });
async function open(page, fakeFor, probe) {
  const fake = await fakeFor('mini');
  await page.goto(fake.url + '/#w=24h&r=4,0&vis=2');
  await probe.waitForReady();
  await page.locator('#ol-reference-toggle').click();
  return fake;
}
for (const [term, id, content] of [
  ['Since (UTC)', 'window', 'UTC midnight'],
  ['Last year', 'window', 'previous complete UTC calendar year'],
  ['Fit the price range', 'window', 'F fits price once'],
  ['ISO A', 'columns', 'm = round(ISO A + ISO B × n)'],
  ['Calibrated on', 'scales', 'fitting population, count and exclusions'],
  ['Invalid input', 'state-glossary', 'correct the input/source'],
  ['No coarser parent', 'state-glossary', 'Required comparison input absent'],
  ['precision', 'feature-rules', 'fraction of flagged bars that were marked'],
  ['Cell counts', 'context-reading', 'covered closed cells without trades'],
  ['Restore previous capture', 'query', 'requires an opened captured investigation'],
]) test(`System reference discovers ${term} and its explanation`, async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe);
  await page.locator('#ol-reference-search').fill(term);
  await expect(page.locator(`#ol-reference-topic option[value="${id}"]`)).not.toHaveAttribute('hidden', '');
  await page.locator('#ol-reference-topic').selectOption(id);
  await expect(page.locator('#ol-reference-article')).toContainText(content);
  await expect(page.locator('#ol-reference-article dt')).toHaveText(['Purpose', 'Read', 'Use']);
  await page.locator('#ol-reference-search').fill('no such ui meaning xyz');
  await expect(page.locator('#ol-reference-position')).toHaveText('0 / 0 matches');
  await page.locator('#ol-reference-search').fill('');
  await expect(page.locator('#ol-reference-topic option:not([hidden])')).toHaveCount(60);
});
async function expectSettingVisible(page, selector) {
  // Native scroll bounds round to CSS pixels; allow one pixel at a clipped edge.
  await expect.poll(() => page.locator(selector).evaluate(node => {
    const target = node.getBoundingClientRect(), body = document.querySelector('#ol-reference-body').getBoundingClientRect();
    return target.top >= body.top - 1 && target.bottom <= body.bottom + 1;
  })).toBe(true);
}
for (const phone of [false, true]) test(`Show Since reveals the generated date field without applying it (${phone ? 'phone' : 'desktop'})`, async ({ page, fakeFor, probe }) => {
  if (phone) await page.setViewportSize({ width: 390, height: 844 });
  await open(page, fakeFor, probe);
  const hash = await page.evaluate(() => location.hash);
  await page.locator('#ol-reference-topic').selectOption('window');
  const show = page.getByRole('button', { name: 'Show Since (UTC)', exact: true });
  await show.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#ol-window-menu')).toBeVisible();
  await expect(page.locator('#ol-window-since')).toBeVisible();
  await expect(page.locator('#ol-reference-status')).toContainText('Highlighted: Since (UTC)');
  expect(await page.evaluate(() => location.hash)).toBe(hash);
  if (phone) {
    await page.locator('#ol-reference-back').click();
    await expect(page.locator('#ol-reference-topic')).toBeFocused();
    await expect(page.locator('#ol-window-menu')).toBeHidden();
  }
});
test('Show bounds opens Query, and axes/profile settings are reachable in their own articles', async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe);
  const hash = await page.evaluate(() => location.hash);
  await page.locator('#ol-reference-topic').selectOption('query');
  await page.getByRole('button', { name: 'Show bounds form', exact: true }).click();
  await expect(page.locator('#ol-panel-query')).toBeVisible();
  await expect(page.locator('#ol-reference-status')).toContainText('Highlighted: bounds form');
  await page.locator('#ol-reference-topic').selectOption('columns');
  await page.getByRole('button', { name: 'Show axes settings', exact: true }).click();
  await expect(page.locator('#ol-reference-status')).toContainText('Highlighted: axes settings');
  await expectSettingVisible(page, '#ol-axis-chip');
  await page.locator('#ol-axis-chip').click();
  await expect(page.locator('#ol-axis-pop')).toBeVisible();
  await page.locator('#ol-reference-topic').selectOption('profiles');
  await page.getByRole('button', { name: 'Show profile settings', exact: true }).click();
  await expect(page.locator('#ol-reference-status')).toContainText('Highlighted: profile settings');
  await expectSettingVisible(page, '#ol-profile-chip');
  expect(await page.evaluate(() => location.hash)).toBe(hash);
  await page.screenshot({ path: 'reports/reference-profile-settings.png' });
});
test('conditional feature documentation is searchable without Mill and its absent target is explicit', async ({ page, fakeFor, probe }) => {
  await open(page, fakeFor, probe);
  await page.locator('#ol-reference-search').fill('Moves with it');
  await page.locator('#ol-reference-topic').selectOption('features');
  await expect(page.locator('#ol-reference-article')).toContainText('absolute correlation above 0.9');
  await page.getByRole('button', { name: 'Show Find features panel', exact: true }).click();
  await expect(page.locator('#ol-reference-status')).toContainText('not visible');
  await expect(page.locator('#ol-reference-spotlight')).toBeHidden();
});
test('Mill-enabled page reveals its existing tab without starting feature discovery', async ({ page, fakeFor, probe }) => {
  const fake = await fakeFor('mini');
  let discover = 0;
  await page.route(fake.url + '/', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('<head>', '<head><meta name="explorer-mill" content="/mill/">') });
  });
  await page.route('**/mill/**', async route => {
    if (route.request().method() === 'POST') discover++;
    await route.fulfill({ json: { data_window: { start: '2024-01-01', end: '2026-05-15' }, views: ['ochlv'] } });
  });
  await page.goto(fake.url + '/#w=24h');
  await probe.waitForReady();
  await page.locator('#ol-reference-toggle').click();
  await page.locator('#ol-reference-topic').selectOption('feature-rules');
  await page.getByRole('button', { name: 'Show Find features panel', exact: true }).click();
  await expect(page.locator('#ol-reference-status')).toContainText('Highlighted: Find features panel');
  expect(discover).toBe(0);
});
