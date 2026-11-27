const { test, expect } = require('@playwright/test');
const path = require('node:path');

const duel = '#local-duel';
const play = '#duel-play';
const entry = page => page.getByRole('button', { name: '開始縣市對決' });
const cards = page => page.locator(play).getByRole('button', { name: /^方案 [AB]/ });
const heading = page => page.locator(play).getByRole('heading', { level: 3 });
const skip = page => page.getByRole('button', { name: '無法二選一，跳過本場' });
const previous = page => page.getByRole('button', { name: '回上一場修改' });
const resume = page => page.getByRole('button', { name: '繼續下一段' });
const city = page => page.locator('#duel-city');
const start = page => page.getByRole('button', { name: '開始對決', exact: true });
const bar = page => page.getByRole('progressbar', { name: '對決進度' });
const activate = (target, touch) => touch ? target.tap() : target.click();
const kinmenRounds = 15;

async function shot(page, stage) {
  if (!process.env.DUEL_UX_ARTIFACTS) return;
  const width = page.viewportSize().width;
  await page.screenshot({ path: path.join(process.env.DUEL_UX_ARTIFACTS, `duel-${width}-${stage}.png`) });
}

async function open(page, county, touch, keyboard = false) {
  await page.goto('/#quiz');
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await activate(entry(page), touch);
  await expect(city(page)).toBeFocused();
  if (keyboard) {
    await page.keyboard.press('Home');
    const index = await city(page).locator('option').evaluateAll((options, county) =>
      options.findIndex(option => option.value === county), county);
    for (let i = 0; i < index; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
  } else {
    await city(page).selectOption(county);
  }
  await expect(city(page)).toHaveValue(county);
  await expect(city(page)).toBeFocused();
}

async function progressInView(page, count) {
  await expect(heading(page)).toBeFocused();
  await expect(bar(page)).toHaveAttribute('value', String(count));
  const progress = page.locator(play).getByText(`已完成 ${count}／${kinmenRounds} 場`, { exact: true });
  await expect(progress).toBeVisible();
  const covered = await Promise.all([progress, bar(page), heading(page)].map(item => item.evaluate(el => {
    const rect = el.getBoundingClientRect();
    const header = document.getElementById('global-header').getBoundingClientRect();
    return rect.top < header.bottom || rect.bottom > innerHeight ? el.textContent || el.getAttribute('aria-label') : null;
  })));
  expect.soft(covered.filter(Boolean), 'UX-02: progress text, bar and heading clear the sticky header').toEqual([]);
}

async function largeTargets(target) {
  const small = await target.evaluateAll(elements => elements.flatMap(element => {
    const { width, height } = element.getBoundingClientRect();
    return width && height && (width < 44 || height < 44)
      ? [{ control: element.id || element.textContent.trim(), width, height }] : [];
  }));
  expect.soft(small, 'UX-03: 44 × 44 CSS px targets').toEqual([]);
}

async function audit(page, stage) {
  if (!process.env.DUEL_AXE) return;
  const AxeBuilder = require('@axe-core/playwright').default;
  const { violations } = await new AxeBuilder({ page }).include(duel).analyze();
  console.log(`axe ${page.viewportSize().width}px ${stage}: ${violations.length} violations`);
  expect.soft(violations, `axe ${stage}`).toEqual([]);
}

test('duel setup, round progress, pause, result and review', async ({ page }, info) => {
  const touch = info.project.name === 'mobile';
  await open(page, '金門縣', touch, !touch);
  await shot(page, 'setup');

  expect.soft(await page.locator(duel).locator(':scope > p').first().innerText(), 'UX-05: skipping is explained before starting').toMatch(/可跳過/);
  const startBox = await start(page).count() ? await start(page).boundingBox() : null;
  const issueBox = await page.locator('#duel-issue').boundingBox();
  expect.soft(startBox?.y - issueBox.y, 'UX-01: start action is close to the selectors').toBeLessThan(140);
  await largeTargets(page.locator(`${duel} > summary, ${duel} select, ${duel} button:visible`));
  if (startBox) {
    await expect(start(page)).toBeInViewport({ ratio: 1 });
    await expect(cards(page)).toHaveCount(0);
    if (touch) await start(page).tap();
    else {
      // Chromium can consume the first Tab when dismissing the native county selector.
      const issue = page.locator('#duel-issue');
      for (let i = 0; i < 3 && !(await issue.evaluate(el => el === document.activeElement)); i++) {
        await page.keyboard.press('Tab');
      }
      await expect(page.locator('#duel-issue')).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(start(page)).toBeFocused();
      await page.keyboard.press('Enter');
    }
    await progressInView(page, 0);
  }

  await expect(page.locator(play)).toHaveAttribute('aria-live', 'polite');
  await audit(page, 'round');
  await skip(page).scrollIntoViewIfNeeded();
  await activate(skip(page), touch);
  await shot(page, 'after-skip');
  await progressInView(page, 1);
  await largeTargets(page.locator(play).getByRole('button'));
  await activate(previous(page), touch);
  await progressInView(page, 0);
  await activate(skip(page), touch);
  if (startBox) {
    await page.reload();
    await expect(city(page)).toHaveValue('金門縣');
    await activate(page.getByRole('button', { name: '繼續對決', exact: true }), touch);
    await progressInView(page, 1);
  }
  for (let done = 2; done <= kinmenRounds; done++) {
    await activate(cards(page).nth(done % 2), touch);
    await progressInView(page, done);
    if (done === 7 || done === 14) {
      expect.soft(await heading(page).innerText(), 'UX-05: pause tells you which segment is done').toContain(`第 ${done / 7} 段`);
      expect.soft(await page.locator(play).innerText(), 'UX-05: pause explains progress is saved').toContain('進度已保留在此分頁');
      await largeTargets(page.locator(play).getByRole('button'));
      if (done === 7) {
        await shot(page, 'pause');
        await audit(page, 'pause');
      }
      await activate(resume(page), touch);
      await progressInView(page, done);
    }
  }
  await shot(page, 'result');
  const result = page.locator(play);
  await expect(result.getByText(`完成 ${kinmenRounds} 場，有效選擇 ${kinmenRounds - 1} 場，跳過 1 場。`, { exact: false })).toBeVisible();
  const table = result.getByRole('table');
  expect.soft(await table.getByRole('columnheader', { name: '選中', exact: true }).count(), 'UX-06: selected count column').toBe(1);
  expect.soft(await table.getByRole('columnheader', { name: '有效出場', exact: true }).count(), 'UX-06: appearance count column').toBe(1);
  const rows = await table.locator('tbody tr').all();
  expect.soft(rows.length, 'UX-06: one row for each candidate').toBe(7);
  const totals = await Promise.all(rows.map(async row => (await row.getByRole('cell').allTextContents()).map(Number)));
  if (rows.length) {
    expect(totals.reduce((sum, [wins]) => sum + wins, 0)).toBe(kinmenRounds - 1);
    expect(totals.reduce((sum, [, appearances]) => sum + appearances, 0)).toBe(2 * (kinmenRounds - 1));
  }
  await largeTargets(result.locator('summary, button'));
  await audit(page, 'result');
  const review = result.locator(':scope > details').first();
  await activate(review.locator(':scope > summary'), touch);
  await expect(review).toHaveAttribute('open', '');
  await largeTargets(review.locator('summary'));
  await audit(page, 'review');
  await activate(review.locator(':scope > summary'), touch);
  await expect(review).not.toHaveAttribute('open', '');
});

test('duel renders policy separators in the visible text and button name', async ({ page }, info) => {
  const touch = info.project.name === 'mobile';
  await open(page, '彰化縣', touch);
  await page.locator('#duel-issue').selectOption('childcare');
  if (await start(page).count()) await activate(start(page), touch);
  const card = cards(page).filter({ hasText: '托育津貼' });
  await card.scrollIntoViewIfNeeded();
  await shot(page, 'card');
  const separator = /8萬元；\s*托育津貼/;
  expect.soft(await card.innerText(), 'UX-04: retain source punctuation in the card').toMatch(separator);
  expect(await card.ariaSnapshot()).toMatch(separator);
});

test('suggested issue waits for the explicit start action', async ({ page }, info) => {
  const touch = info.project.name === 'mobile';
  await open(page, '臺南市', touch);
  const issue = page.locator('#duel-issue');
  await issue.selectOption('housing');
  await expect(cards(page)).toHaveCount(0);
  await activate(page.locator(play).getByRole('button', { name: '育兒與教育（6 場）' }), touch);
  await expect(issue).toHaveValue('childcare');
  await expect(cards(page)).toHaveCount(0);
  await expect(start(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(heading(page)).toBeFocused();
  await expect(cards(page)).toHaveCount(2);
});

for (const width of [320, 414]) {
  test(`duel progress stays visible at ${width}px`, async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile');
    await page.setViewportSize({ width, height: 812 });
    await open(page, '金門縣', true);
    await expect(start(page)).toBeInViewport({ ratio: 1 });
    await start(page).tap();
    await progressInView(page, 0);
    await skip(page).scrollIntoViewIfNeeded();
    await skip(page).tap();
    await progressInView(page, 1);
    await cards(page).first().tap();
    await progressInView(page, 2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}
