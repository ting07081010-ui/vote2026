const { test, expect } = require('@playwright/test');
const path = require('node:path');

const storageKey = 'policy_compass_duels_v1';
const play = page => page.locator('#duel-play');
const heading = page => play(page).locator('h3');
const progress = page => play(page).locator('progress');
const button = (page, name) => play(page).getByRole('button', { name, exact: true });
const skip = '無法二選一，跳過本場';
const next = '繼續下一段';
const back = '回上一場修改';
const enter = (page, name = '開始對決') => page.getByRole('button', { name, exact: true }).click();

async function shot(page, name) {
  if (!process.env.DUEL_BLIND_SCREENS) return;
  await page.evaluate(() => document.fonts.ready.then(() => null));
  await page.locator('#local-duel').screenshot({
    path: path.join(process.env.DUEL_BLIND_SCREENS, 'local-' + page.viewportSize().width + '-' + name + '.png'),
    animations: 'disabled'
  });
}

test('FLOW-02: pending break survives reload and switching county or topic', async ({ page }) => {
  await page.goto('./#quiz');
  await page.locator('#local-duel > summary').click();
  await page.locator('#duel-city').selectOption('金門縣');
  await enter(page);
  for (let i = 0; i < 7; i++) await button(page, skip).click();
  await expect(heading(page)).toHaveText('已完成第 1 段');
  await page.reload();
  await enter(page, '繼續對決');
  await expect(progress(page)).toHaveAttribute('value', '7');
  await shot(page, 'break-reload');
  await expect.soft(heading(page)).toHaveText('已完成第 1 段', { timeout: 1000 });
  if (await button(page, next).isVisible()) await button(page, next).click();
  await page.reload();
  await enter(page, '繼續對決');
  await expect(heading(page)).toContainText('第 8 / 15 場');
  for (let i = 7; i < 14; i++) await button(page, skip).click();
  await expect(heading(page)).toHaveText('已完成第 2 段');
  await page.locator('#duel-city').selectOption('新北市');
  await page.locator('#duel-city').selectOption('金門縣');
  await enter(page, '繼續對決');
  await expect(progress(page)).toHaveAttribute('value', '14');
  await shot(page, 'break-county');
  await expect.soft(heading(page)).toHaveText('已完成第 2 段', { timeout: 1000 });
  await button(page, back).click();
  await expect(heading(page)).toContainText('第 14 / 15 場');
  await button(page, skip).click();
  await page.locator('#duel-issue').selectOption('governance');
  await page.locator('#duel-issue').selectOption('all');
  await enter(page, '繼續對決');
  await expect(progress(page)).toHaveAttribute('value', '14');
  await shot(page, 'break-issue');
  await expect(heading(page)).toHaveText('已完成第 2 段', { timeout: 1000 });
});

async function seedLegacy(page, content) {
  await page.addInitScript(({ key, content }) => {
    if (sessionStorage.getItem(key)) return;
    const entry = { votes: ['TYN-1'], slate: [['transit', 'TYN-1', 'TYN-2']] };
    if (content) entry.content = content;
    sessionStorage.setItem(key, JSON.stringify({ '桃園市/transit': entry }));
    sessionStorage.setItem(key + '_selection', JSON.stringify(['桃園市', 'transit']));
  }, { key: storageKey, content });
  await page.goto('./#quiz');
}

test('FLOW-04: legacy ballots without a snapshot must be re-answered', async ({ page }) => {
  await seedLegacy(page);
  await enter(page);
  await shot(page, 'legacy-resume');
  await expect(progress(page)).toHaveAttribute('value', '0', { timeout: 1000 });
  await expect(play(page).getByRole('status')).toHaveCount(1);
  await expect(play(page).getByRole('status')).toContainText('題卡已更新');
  await play(page).getByRole('button', { name: /^方案 B/ }).click();
  await expect(heading(page)).toContainText('張善政');
  await page.reload();
  await enter(page, '查看對決結果');
  await expect(heading(page)).toContainText('張善政');
  await expect(play(page).getByRole('status')).toHaveCount(0);
});

test('v1 ballots that contain the old Taoyuan transit cards must be re-answered', async ({ page }) => {
  await seedLegacy(page, [['推動捷運路網建設；強化交通路網接駁。', '推動捷運路網擴建；整合幹線公車與桃小巴接駁。']]);
  await enter(page);
  await expect(progress(page)).toHaveAttribute('value', '0');
  await expect(play(page).getByRole('status')).toContainText('題卡已更新');
});

test('verified v1 ballots still resume and migrate without losing attribution', async ({ page }) => {
  await seedLegacy(page, [['加快捷運建設並公開工程進度；由市府統籌公共運輸，改善路網轉乘與公車脫班。', '推動捷運路網擴建，以捷運綠線北段七站年底通車為目標；整合幹線公車與桃小巴，改善鄰里接駁。']]);
  await enter(page, '查看對決結果');
  await expect(progress(page)).toHaveAttribute('value', '1');
  await expect(heading(page)).toContainText('黃世杰');
  await expect(play(page).getByRole('status')).toHaveCount(0);
  const entry = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key))['桃園市/transit'], storageKey);
  expect(entry).toMatchObject({ v: 2, votes: [0] });
  expect(entry).not.toHaveProperty('content');
});

test('a changed round keeps only the verifiable saved prefix', async ({ page }) => {
  await page.goto('./#quiz');
  await page.locator('#local-duel > summary').click();
  await page.locator('#duel-city').selectOption('桃園市');
  await enter(page);
  for (let i = 0; i < 2; i++) await play(page).getByRole('button', { name: /^方案 A/ }).click();
  await page.evaluate(key => {
    const history = JSON.parse(sessionStorage.getItem(key));
    const entry = history['桃園市/all'];
    if (entry.v === 2) entry.rounds[1] = 'changed';
    else entry.content[1][0] += '（模擬舊版內容）';
    sessionStorage.setItem(key, JSON.stringify(history));
  }, storageKey);
  await page.reload();
  await enter(page, '繼續對決');
  await expect(progress(page)).toHaveAttribute('value', '1');
  await expect(play(page).getByRole('status')).toContainText('題卡已更新');
  await play(page).getByRole('button', { name: /^方案 B/ }).click();
  await expect(play(page).getByRole('status')).toHaveCount(0);
  await page.reload();
  await enter(page, '繼續對決');
  await expect(progress(page)).toHaveAttribute('value', '2');
  await expect(play(page).getByRole('status')).toHaveCount(0);
});
