const { test, expect } = require('@playwright/test');

const play = page => page.locator('#duel-play');
const cards = page => play(page).locator('button[onclick="voteDuel(0)"], button[onclick="voteDuel(1)"]');

async function openDuel(page, city, issue, blind = false) {
  await page.goto('/#quiz');
  if (blind) await page.locator('#btn-blind-toggle').click();
  await page.locator('#local-duel > summary').click();
  await page.locator('#duel-city').selectOption(city);
  await page.locator('#duel-issue').selectOption(issue);
  const start = page.getByRole('button', { name: '開始對決', exact: true });
  if (await start.isVisible()) await start.click();
}

async function finishDuel(page) {
  while (true) {
    const resume = play(page).getByRole('button', { name: '繼續下一段' });
    if (await resume.isVisible()) await resume.click();
    if (!await cards(page).count()) break;
    await cards(page).first().click();
  }
}

async function openBulletins(container) {
  const sources = container.getByText('公報來源', { exact: true });
  for (const summary of await sources.all()) await summary.click();
}

test('C01: Taoyuan transit cards preserve distinct policy details; bulletin sources appear only after reveal', async ({ page }) => {
  await openDuel(page, '桃園市', 'transit', true);
  await expect(cards(page)).toHaveCount(2);
  for (const detail of ['公開工程進度', '公車脫班', '捷運綠線北段七站年底通車為目標', '幹線公車與桃小巴']) {
    await expect(play(page)).toContainText(detail);
  }
  await finishDuel(page);
  await play(page).getByText('回看逐場選擇與來源', { exact: true }).click();
  await expect(play(page)).not.toContainText('公報來源');
  await page.locator('#btn-blind-toggle').click();
  await play(page).getByText('回看逐場選擇與來源', { exact: true }).click();
  await openBulletins(play(page));
  const links = play(page).getByRole('link', { name: '桃園市選舉公報 PDF 第 1 頁' });
  await expect(links).toHaveCount(2);
  for (const link of await links.all()) await expect(link).toHaveAttribute('href', /^https:\/\/bulletin\.cec\.gov\.tw\/.*\.pdf#page=1$/);
  for (const heading of ['交通新治理 路網大翻新', '軌道齊發，城市再造']) {
    await expect(play(page)).toContainText(heading);
  }
  await expect(play(page)).not.toContainText('頁碼待補');
});

test('BLIND-05/C02: Yunlin partisan text stays out of the slate and is reviewable after reveal', async ({ page }) => {
  await openDuel(page, '雲林縣', 'governance', true);
  await cards(page).first().click();
  await cards(page).first().click();
  await expect(play(page)).not.toContainText('文化復興黨');
  await finishDuel(page);
  await expect(play(page)).not.toContainText('文化復興黨');
  await page.locator('#btn-blind-toggle').click();
  await play(page).getByText('查看比較覆蓋範圍', { exact: true }).click();
  await openBulletins(play(page));
  await expect(play(page)).toContainText('文化復興黨');
  await expect(play(page).getByRole('link', { name: /雲林縣選舉公報 PDF 第/ })).toBeVisible();
});

test('BLIND-05: Kinmen personal pledge and slogan stay out of blind cards and in revealed sources', async ({ page }) => {
  await openDuel(page, '金門縣', 'governance', true);
  for (let i = 0; i < 2; i++) await cards(page).first().click();
  await expect(play(page)).not.toContainText('任滿後不競選連任');
  await expect(play(page)).toContainText('縣政智庫');
  await finishDuel(page);
  await play(page).getByText('回看逐場選擇與來源', { exact: true }).click();
  await expect(play(page)).not.toContainText('讓金門換個樣子，給家鄉不一樣');
  await expect(play(page)).not.toContainText('任滿後不競選連任');
  await page.locator('#btn-blind-toggle').click();
  await play(page).getByText('回看逐場選擇與來源', { exact: true }).click();
  await play(page).getByText('查看比較覆蓋範圍', { exact: true }).click();
  await openBulletins(play(page));
  await expect(play(page)).toContainText('讓金門換個樣子，給家鄉不一樣');
  await expect(play(page)).toContainText('不再競選連任');
});

test('C03: Kinmen housing summaries without comparable measures stay reviewable but are not paired', async ({ page }) => {
  await openDuel(page, '金門縣', 'housing', true);
  for (const card of await cards(page).all()) await expect(card).not.toContainText('未詳列住宅方案');
  await expect(cards(page)).toHaveCount(0);
  await expect(play(page)).toContainText('3／7 位候選人有已查證摘要，但沒有可比較的措施。');
  await expect(play(page)).not.toContainText('公報來源');
  await expect(play(page)).not.toContainText('活化閒置營區');
  await page.locator('#btn-blind-toggle').click();
  await play(page).getByText('查看比較覆蓋範圍', { exact: true }).click();
  await openBulletins(play(page));
  await expect(play(page)).toContainText('未說明營區將提供住宅或其他居住措施。');
  await expect(play(page)).toContainText('活化閒置營區');
  await expect(play(page)).toContainText('城鄉建設');
  await expect(play(page).getByRole('link', { name: '金門縣選舉公報 PDF 第 1 頁' })).toHaveCount(3);
});
