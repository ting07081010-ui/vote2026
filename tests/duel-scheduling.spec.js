const { test, expect } = require('@playwright/test');

const historyKey = 'policy_compass_duels_v1';

async function openDuel(page) {
  await page.goto('/#quiz', { waitUntil: 'domcontentloaded' });
  await page.locator('#local-duel > summary').click();
}

async function selectDuel(page, city, issue = 'all') {
  await page.locator('#duel-city').selectOption(city);
  await page.locator('#duel-issue').selectOption(issue);
}

test('FLOW-01 / C04: every candidate has balanced sides and a deterministic slate', async ({ page }) => {
  await openDuel(page);
  const failures = await page.evaluate(() => {
    const citySelect = document.querySelector('#duel-city');
    const issueSelect = document.querySelector('#duel-issue');
    const failures = [];
    for (const { value: city } of [...citySelect.options].slice(1)) {
      citySelect.value = city;
      const people = CANDIDATES.filter(candidate => candidate.city === city);
      for (const { value: issue } of issueSelect.options) {
        issueSelect.value = issue;
        startDuel(city);
        const readSlate = () => duelRounds.map(({key, pair}) => [key, ...pair.map(candidate => candidate.id)]);
        const slate = readSlate();
        startDuel(city);
        if (JSON.stringify(slate) !== JSON.stringify(readSlate())) failures.push({ city, issue, slate });
        for (const { id } of people) {
          const a = slate.filter(([, left]) => left === id).length;
          const b = slate.filter(([, , right]) => right === id).length;
          if (Math.abs(a - b) > 1) failures.push({ city, issue, id, a, b });
        }
        if (people.length === 2 && issue === 'all' && slate.slice(1).some(([, a], i) => a === slate[i][1])) {
          failures.push({ city, issue, slate, reason: 'Two-candidate slates must alternate' });
        }
      }
    }
    return failures;
  });
  expect(failures).toEqual([]);
});

test('FLOW-03: maximize topic coverage, then minimize squared counts', async ({ page }) => {
  await openDuel(page);
  const audit = {};
  for (const city of ['臺北市', '澎湖縣', '金門縣']) {
    await selectDuel(page, city);
    audit[city] = await page.evaluate(() => {
      const keys = Object.keys(ISSUE_META);
      const score = counts => [-counts.filter(Boolean).length, counts.reduce((sum, value) => sum + value * value, 0)];
      const current = keys.map(key => duelRounds.filter(round => round.key === key).length);
      const people = CANDIDATES.filter(candidate => candidate.city === duelSelection);
      const eligiblePairs = [];
      for (const [i, a] of people.entries()) {
        for (const b of people.slice(i + 1)) {
          const eligible = keys.flatMap((key, index) => [a, b].every(candidate =>
            !duelCardSource(candidate, key)?.exclusionReason
            && ['有原始來源', '已有查證摘要・逐條引文待補'].includes(policyRecord(candidate, key).status)
          ) && duelCardText(a, key) !== duelCardText(b, key) ? [index] : []);
          if (eligible.length) eligiblePairs.push({ a, b, eligible });
        }
      }
      let feasible = new Set([keys.map(() => 0).join(',')]);
      const valid = eligiblePairs.every(({ a, b, eligible }) => {
        const rounds = duelRounds.filter(round => round.pair.includes(a) && round.pair.includes(b));
        return rounds.length === 1 && eligible.includes(keys.indexOf(rounds[0].key));
      });
      for (const { eligible } of eligiblePairs) {
        const next = new Set();
        for (const vector of feasible) {
          const counts = vector.split(',').map(Number);
          for (const i of eligible) next.add(counts.map((value, j) => value + Number(i === j)).join(','));
        }
        feasible = next;
      }
      const best = [...feasible].map(vector => score(vector.split(',').map(Number)))
        .reduce((a, b) => b[0] < a[0] || (a[0] === b[0] && b[1] < a[1]) ? b : a);
      return { score: score(current), best, valid, rounds: duelRounds.length, eligible: eligiblePairs.length };
    });
  }
  for (const [city, result] of Object.entries(audit)) {
    expect.soft(result.rounds, city).toBe(result.eligible);
    expect.soft(result.valid, city).toBe(true);
    expect.soft(result.score, city).toEqual(result.best);
  }
});

test('C05: exposure limitation appears before voting and the Taipei result remains a record', async ({ page }) => {
  await openDuel(page);
  await selectDuel(page, '臺北市');
  const preview = page.locator('#duel-preview');
  const play = page.locator('#duel-play');
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('每位候選人安排 2–5 場');
  await expect(preview).toContainText('出場機會不同');
  await expect(preview).toContainText('結果僅列逐場選擇與出場紀錄');
  await page.getByRole('button', { name: '開始對決', exact: true }).click();
  for (let index = 0; index < 12; index++) {
    if (index === 7) await play.getByRole('button', { name: '繼續下一段' }).click();
    await play.getByRole('button', { name: /^方案 A/ }).click();
  }
  await expect(play.getByRole('heading')).toHaveText('本輪政策選擇紀錄');
});

test('C06: absence of summaries, no common opponent, and an unsampled topic are distinct', async ({ page }) => {
  await openDuel(page);
  const play = page.locator('#duel-play');
  await selectDuel(page, '臺南市', 'housing');
  await expect.soft(play).toContainText('1／4 位候選人有已查證摘要');
  await expect.soft(play).toContainText('無共同對手');
  const missing = await page.evaluate(() => {
    const people = CANDIDATES.filter(candidate => candidate.city === '臺南市');
    return Object.keys(ISSUE_META).find(key => people.every(candidate =>
      !['有原始來源', '已有查證摘要・逐條引文待補'].includes(policyRecord(candidate, key).status)));
  });
  // Supply the no-summary case even when data updates fill all topics in Tainan.
  if (!missing) {
    await page.evaluate(() => {
      const city = '臺南市';
      for (const candidate of CANDIDATES.filter(c => c.city === city)) candidate.issues.housing = '';
      startDuel(city, true);
    });
  } else {
    await selectDuel(page, '臺南市', missing);
  }
  await expect.soft(play).toContainText('缺少已查證摘要');
  await selectDuel(page, '新北市');
  await page.getByText('查看本輪涵蓋的議題', { exact: true }).click();
  await expect(page.locator('#duel-preview-coverage p')).toBeVisible();
  await expect(page.locator('#duel-preview-coverage p')).toContainText('綜合比較未抽到');
});

test('C07: spacing and punctuation variants of identical text never pair', async ({ page }) => {
  await openDuel(page);
  await selectDuel(page, '彰化縣', 'senior');
  const result = await page.evaluate(() => {
    const key = 'senior';
    const city = '彰化縣';
    const people = CANDIDATES.filter(c => c.city === city).slice(0, 2);
    const text = '補助 1.5 萬元，擴大長青卡；增設日照中心。';
    const setSummary = (candidate, summary) => {
      candidate.issues[key] = summary;
      REVIEWED_POLICY_CORRECTIONS[candidate.id].issues[key] = summary;
    };
    setSummary(people[0], text);
    const run = value => {
      setSummary(people[1], value);
      startDuel(city, true);
      return {
        paired: duelRounds.some(round => people.every(candidate => round.pair.includes(candidate))),
        statuses: people.map(candidate => policyRecord(candidate, key).status),
      };
    };
    return [run(text), run(text + '　 '), run(' 補助   1.5 萬元, 擴大　長 青卡; 增設日照中心 '), run(text.replace('1.5', '15'))];
  });
  expect(result.map(entry => entry.statuses)).toEqual(Array(4).fill(Array(2).fill('已有查證摘要・逐條引文待補')));
  expect(result.map(entry => entry.paired)).toEqual([false, false, false, true]);
});

for (const version of [1, 2]) {
  test(`a pre-change v${version} slate preserves topic order, sides, and votes until restart`, async ({ page }) => {
    await openDuel(page);
    await selectDuel(page, '新北市');
    // Captured from a9e7197, including the two rounds that put NTP-1 on side A.
    const slate = [['childcare', 'NTP-1', 'NTP-2'], ['senior', 'NTP-1', 'NTP-3'], ['transit', 'NTP-2', 'NTP-3']];
    const readSlate = () => page.evaluate(() => duelRounds.map(({key, pair}) => [key, ...pair.map(candidate => candidate.id)]));
    expect.soft(await readSlate()).not.toEqual(slate);
    await page.evaluate(({ historyKey, slate, version }) => {
      const content = slate.map(([issue, ...ids]) => ids.map(id => duelCardText(CANDIDATES.find(c => c.id === id), issue)));
      const entry = version === 1 ? { slate, content, votes: ['NTP-1'] }
        : { v: 2, votes: [0], rounds: [duelFingerprint(slate[0], content[0])] };
      sessionStorage.setItem(historyKey, JSON.stringify({ '新北市/all': entry }));
    }, { historyKey, slate, version });
    await page.reload({ waitUntil: 'domcontentloaded' });
    const play = page.locator('#duel-play');
    const resume = page.getByRole('button', { name: '繼續對決', exact: true });
    await resume.click();
    await expect(play.getByRole('progressbar')).toHaveAttribute('value', '1');
    expect(await readSlate()).toEqual(slate);
    await selectDuel(page, '臺北市');
    await selectDuel(page, '新北市');
    await resume.click();
    await expect(play.getByRole('heading')).toContainText('第 2 / 3 場');
    await play.getByRole('button', { name: /^方案 B/ }).click();
    await play.getByRole('button', { name: /^方案 B/ }).click();
    await page.reload();
    expect(await readSlate()).toEqual(slate);
    expect(await page.evaluate(() => duelVotes)).toEqual(['NTP-1', 'NTP-3', 'NTP-3']);
    const saved = await page.evaluate(key => sessionStorage.getItem(key), historyKey);
    expect(JSON.parse(saved)['新北市/all']).toMatchObject({v: 2, votes: [0, 1, 1]});
    expect(saved).not.toMatch(/NTP-|slate|content/);
    await page.getByRole('button', { name: '查看對決結果', exact: true }).click();
    page.once('dialog', dialog => dialog.accept());
    await play.getByRole('button', { name: '重新對決' }).click();
    await expect(play.getByRole('progressbar')).toHaveAttribute('value', '0');
    expect(await readSlate()).not.toEqual(slate);
  });
}

test('resume keeps a verified choice when the legacy schedule only matches more unanswered rounds', async ({ page }) => {
  await openDuel(page);
  await selectDuel(page, '臺北市');
  await page.getByRole('button', { name: '開始對決', exact: true }).click();
  const play = page.locator('#duel-play');
  await play.getByRole('button', { name: /^方案 A/ }).click();
  const before = await page.evaluate(() => {
    const [first, second] = ['TPE-1', 'TPE-2'].map(id => CANDIDATES.find(candidate => candidate.id === id));
    // A revised senior summary changes later matchups, while the first choice is still verifiable.
    second.issues.senior = first.issues.senior;
    return duelVotes[0];
  });
  await selectDuel(page, '新北市');
  await selectDuel(page, '臺北市');
  await page.locator('#duel-start').click();
  await expect(play.getByRole('progressbar')).toHaveAttribute('value', '1', { timeout: 2000 });
  expect(await page.evaluate(() => duelVotes)).toEqual([before]);
});
