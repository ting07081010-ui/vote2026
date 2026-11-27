const { test, expect } = require('@playwright/test');
const path = require('node:path');

const duel = '#local-duel';
const play = '#duel-play';
const toggle = '#btn-blind-toggle';
const storageKey = 'policy_compass_duels_v1';
const cards = (page) => page.locator(play + ' button[onclick="voteDuel(0)"], ' + play + ' button[onclick="voteDuel(1)"]');
const heading = (page) => page.locator(play + ' h3');
const enter = (page, name = '開始對決') => page.getByRole('button', { name, exact: true }).click();

async function expectAttribution(page, counts) {
  for (const [name, wins, appearances] of counts) {
    const row = page.locator(play).getByRole('row').filter({ has: page.getByRole('rowheader', { name, exact: true }) });
    await expect(row.getByRole('cell')).toHaveText([String(wins), String(appearances)]);
  }
}

async function setup(page, city, issue = 'all') {
  await page.goto('./#quiz', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#duel-city option').last()).toHaveAttribute('value', '連江縣');
  expect(await page.evaluate(() => innerWidth)).toBe(page.viewportSize().width);
  await page.locator(duel + ' > summary').click();
  await page.locator('#duel-issue').selectOption(issue);
  await page.locator('#duel-city').selectOption(city);
  await enter(page);
  await expect(cards(page)).toHaveCount(2);
}

async function setBlind(page, on) {
  await page.locator(toggle).click();
  await expect(page.locator(toggle)).toHaveAttribute('aria-pressed', String(on));
}

async function save(page, file, locator) {
  if (!process.env.DUEL_BLIND_SCREENS) return;
  const prefix = new URL(page.url()).hostname === '127.0.0.1' ? 'local' : 'live';
  await page.evaluate(() => document.fonts.ready.then(() => null));
  const target = path.join(process.env.DUEL_BLIND_SCREENS, prefix + '-' + page.viewportSize().width + '-' + file + '.png');
  if (locator) await locator.screenshot({ path: target, animations: 'disabled' });
  else await page.screenshot({ path: target, animations: 'disabled' });
}

async function surface(page) {
  return page.evaluate(() => {
    const root = document.querySelector('#local-duel');
    const exact = [...new Set(CANDIDATES.flatMap(c => [c.name, c.party]))].filter(Boolean);
    const sensitiveColors = ['#2563eb', '#0d9488', '#087f83', '#d97706', 'rgb(37, 99, 235)',
      'rgb(13, 148, 136)', 'rgb(8, 127, 131)', 'rgb(217, 119, 6)'];
    const attrs = [...root.querySelectorAll('*')].flatMap(e => [...e.attributes].map(a => a.value)).join('\n');
    const text = root.textContent;
    const focused = document.activeElement;
    const announcement = Array.from(root.querySelectorAll('[aria-live], [role="status"], [role="alert"]'),
      el => el.textContent).concat(document.querySelector('#toast-notification').textContent).join('\n');
    const styles = Array.from(root.querySelectorAll('*'), e => {
      const s = getComputedStyle(e);
      return [s.color, s.backgroundColor, s.borderColor, s.fill, s.stroke, s.backgroundImage].join(' ');
    }).join('\n').toLowerCase();
    return {
      markup: exact.filter(x => (text + '\n' + attrs).includes(x)),
      focusOrLive: exact.filter(x => (focused.textContent + '\n' + announcement).includes(x)),
      ballot: [...(text + '\n' + attrs).matchAll(/(?:號次\s*[:：]?\s*\d+|(?:^|[\s（(：:])(?:第\s*)?\d{1,2}\s*號(?![路線學]))/g)].map(m => m[0]),
      partyColors: sensitiveColors.filter(x => (styles + attrs.toLowerCase()).includes(x)),
      portraits: root.querySelectorAll('img, picture, image, [poster]').length,
      tooltips: root.querySelectorAll('[title], [data-chart-tip], [role="tooltip"]').length,
      active: focused === document.querySelector('#duel-play h3') ? 'heading' : focused.id,
      live: root.querySelector('#duel-play').getAttribute('aria-live')
    };
  });
}

async function expectMasked(page, active) {
  expect(await surface(page)).toEqual({
    markup: [], focusOrLive: [], ballot: [], partyColors: [], portraits: 0, tooltips: 0, active, live: 'polite'
  });
  const ax = await page.locator(duel).ariaSnapshot();
  const names = await page.evaluate(() => [...new Set(CANDIDATES.flatMap(c => [c.name, c.party]))]);
  expect(names.filter(name => ax.includes(name)), 'names/parties in rendered accessibility tree').toEqual([]);
  await expect(page.locator('#roster-illustration')).toBeHidden();
}

test('mid-duel and result toggles preserve choice order, focus and correct revealed attribution', async ({ page }) => {
  await setup(page, '桃園市');
  await cards(page).nth(0).click();
  await expect(heading(page)).toContainText('第 2 / 6 場');
  await setBlind(page, true);
  await expectMasked(page, 'btn-blind-toggle');
  await cards(page).nth(1).click();
  await expect(heading(page)).toBeFocused();
  await expectMasked(page, 'heading');
  await expect(heading(page)).toContainText('第 3 / 6 場');
  await setBlind(page, false);
  await expect(heading(page)).toContainText('第 3 / 6 場');
  await page.getByRole('button', { name: '無法二選一，跳過本場' }).click();
  for (const side of [1, 0, 0]) await cards(page).nth(side).click();
  await expect(heading(page)).toContainText('黃世杰');
  await expectAttribution(page, [['黃世杰', 4, 5], ['張善政', 1, 5]]);
  await setBlind(page, true);
  await expectMasked(page, 'btn-blind-toggle');
  await expect(heading(page)).toContainText('匿名候選人');
  await page.getByText('回看逐場選擇與來源', { exact: true }).click();
  const review = page.locator(play + ' > details').first();
  await expect(review).toContainText('已跳過');
  await expect(review.locator('div').filter({ hasText: '你的選擇' })).toHaveCount(5);
  await expect(review.locator('a')).toHaveCount(0);
  await setBlind(page, false);
  await expectAttribution(page, [['黃世杰', 4, 5], ['張善政', 1, 5]]);
  await expect(review.locator('div').filter({ hasText: /黃世杰（你的選擇）/ })).toHaveCount(4);
  await expect(review.locator('div').filter({ hasText: /張善政（你的選擇）/ })).toHaveCount(1);
});

test('coverage, hidden review, accessible names and copy/export mask candidate metadata', async ({ page, context }) => {
  await setup(page, '臺北市', 'industry');
  await setBlind(page, true);
  await expectMasked(page, 'btn-blind-toggle');
  await cards(page).first().click();
  await expect(heading(page)).toBeFocused();
  await expectMasked(page, 'heading');
  const coverage = page.locator(play + ' > details').last();
  await expect(coverage).toContainText('未安排比較的組合');
  await expect(coverage.locator('li')).toHaveCount(14);
  await coverage.locator('summary').click();
  await expect(coverage.locator('li').first()).toBeVisible();
  await expect(coverage.locator('li').first()).toContainText(/匿名候選人 \d+與匿名候選人 \d+/);
  await save(page, 'blind-coverage', page.locator(play));
  const exports = await page.evaluate(() => {
    const payloads = [];
    const original = [triggerCSVDownload, copyTextToClipboard];
    triggerCSVDownload = (...args) => payloads.push(['download', ...args]);
    copyTextToClipboard = (...args) => payloads.push(['copy', ...args]);
    try { exportFilteredCSV(); exportComparisonCSV(); copyComparisonSummary(); }
    finally { [triggerCSVDownload, copyTextToClipboard] = original; }
    return payloads;
  });
  expect(exports).toEqual([]);
  await expect(page.locator(duel).getByRole('button', { name: /複製|匯出|下載|分享/ })).toHaveCount(0);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('#duel-play'));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await page.keyboard.press('Control+c');
  await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText())).toContain('匿名候選人');
  const copiedNames = await page.evaluate(async () => {
    const text = await navigator.clipboard.readText();
    return CANDIDATES.flatMap(c => [c.name, c.party]).filter(x => text.includes(x));
  });
  expect(copiedNames).toEqual([]);
  await setBlind(page, false);
  await expect(heading(page)).toContainText('蔣萬安');
  await expect(coverage.locator('li').first()).not.toContainText('匿名候選人');
});

test('BLIND-01: reload mid-duel and on results keeps blind enabled while preserving votes', async ({ page }) => {
  await setup(page, '桃園市');
  await setBlind(page, true);
  await cards(page).first().click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await enter(page, '繼續對決');
  await expect(heading(page)).toContainText('第 2 / 6 場');
  await save(page, 'reload-mid', page.locator(duel));
  await expect.soft(page.locator(toggle)).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 });
  for (const side of [1, 0, 1, 0, 0]) await cards(page).nth(side).click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await enter(page, '查看對決結果');
  await expect(page.locator(play)).toContainText('完成 6 場，有效選擇 6 場');
  await save(page, 'reload-results', page.locator(duel));
  await expect(page.locator(toggle)).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 });
  await expect(heading(page)).toContainText('匿名候選人');
  await expect(page.locator(play)).not.toContainText(/黃世杰|張善政/);
  await expect(page.locator('#roster-illustration')).toBeHidden();
  await setBlind(page, false);
  await expectAttribution(page, [['黃世杰', 5, 6], ['張善政', 1, 6]]);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await enter(page, '查看對決結果');
  await expect(page.locator(toggle)).toHaveAttribute('aria-pressed', 'false');
  await expect(heading(page)).toContainText('黃世杰');
});

test('BLIND-02: blind DOM does not contain the roster image', async ({ page }) => {
  await setup(page, '桃園市');
  const roster = page.locator('#roster-illustration');
  const image = roster.locator('img');
  await roster.locator('summary').click();
  await expect.poll(() => image.evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
  await save(page, 'roster-revealed', roster);
  await setBlind(page, true);
  await expect(roster).toBeHidden();
  await save(page, 'roster-blind', page.locator(duel));
  await expect(image).toHaveCount(0, { timeout: 1000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(image).toHaveCount(0);
  await setBlind(page, false);
  await expect(image).toHaveCount(1);
});

test('BLIND-03: blind storage contains no candidate IDs or card snapshots', async ({ page }) => {
  await setup(page, '桃園市');
  await setBlind(page, true);
  await cards(page).first().click();
  await page.getByRole('button', { name: '無法二選一，跳過本場' }).click();
  await save(page, 'anonymous-storage', page.locator(duel));
  const { entry, containsId } = await page.evaluate(key => {
    const raw = sessionStorage.getItem(key);
    return { entry: JSON.parse(raw)['桃園市/all'], containsId: CANDIDATES.some(c => raw.includes(c.id)) };
  }, storageKey);
  expect(containsId).toBe(false);
  expect(entry).toMatchObject({ v: 2, votes: [0, null] });
  expect(entry).not.toHaveProperty('content');
  expect(entry).not.toHaveProperty('slate');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await enter(page, '繼續對決');
  await expect(heading(page)).toContainText('第 3 / 6 場');
  await expect(page.locator(toggle)).toHaveAttribute('aria-pressed', 'true');
});

test('BLIND-04: enabling blind on another app tab scrubs the mounted duel', async ({ page }) => {
  await setup(page, '臺北市', 'industry');
  await cards(page).first().click();
  await expect(heading(page)).toContainText('蔣萬安');
  await page.locator('#tab-btn-matrix').click();
  await setBlind(page, true);
  await expect(page.locator(duel)).toBeHidden();
  const stale = await surface(page);
  const hiddenImages = await page.locator('#roster-illustration img').count();
  await page.locator('#tab-btn-quiz').click();
  await expect(heading(page)).toContainText('匿名候選人');
  await save(page, 'cross-tab-blind', page.locator(duel));
  expect(stale.markup).toEqual([]);
  expect(hiddenImages).toBe(0);
});
