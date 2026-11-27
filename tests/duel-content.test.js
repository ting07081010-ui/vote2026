const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { candidates } = require('../data/candidates-2026.json');

const partyAliases = ['國民黨', '民進黨', '民眾黨', '台聯', '臺聯', '台灣團結聯盟', '臺灣團結聯盟', '麻將最大黨', 'SoR無法黨', '文化復興黨'];
const listedSlogans = ['交通新治理 路網大翻新', '軌道齊發，城市再造', '讓金門換個樣子，給家鄉不一樣'];
const compact = text => text.normalize('NFKC').replace(/[\s\p{P}\p{Cf}]/gu, '').replaceAll('臺', '台').toLowerCase();
const terms = [...new Set(candidates.flatMap(c => [c.name, c.party, c.slogan]).concat(partyAliases, listedSlogans))];
const ballotNumber = /(?:號次|候選人|投給|票投)\s*[:：]?\s*[\[(]?\s*[\d一二三四五六七八九十]+\s*[\])]?\s*(?:號|(?<=[\d一二三四五六七八九十])(?![\p{L}\p{N}]))|[\d一二三四五六七八九十]+\s*號\s*候選人|(?:^|[\p{P}\s])[\d一二三四五六七八九十]+\s*號(?=$|[\p{P}\s])/u;

function identifyingText(value) {
  const normalized = value.normalize('NFKC');
  const text = compact(value);
  return terms.filter(term => text.includes(compact(term)))
    .concat(normalized.match(/\b(?:KMT|DPP|TPP|TSU)\b/gi) || [])
    .concat(normalized.match(ballotNumber) || []);
}

test('duel card lint catches listed identifiers without treating policy numbers as ballot numbers', () => {
  for (const identifier of ['文化復興黨：同舞', '民進黨', 'ＫＭＴ', '黃世杰', '號次：２', '投給２號', '2號候選人', '讓金門換個樣子、給家鄉不一樣']) {
    assert.ok(identifyingText(identifier).length, identifier);
  }
  assert.deepEqual(identifyingText('改善台2號公路；規劃2號線、8線齊發及2030年社宅完工萬戶。'), []);
});

test('effective duel card summaries contain no listed candidate, party, ballot or slogan clues', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const addEventListener = () => {};
  const cards = vm.runInNewContext(script + `
    CANDIDATES.flatMap(c => Object.keys(ISSUE_META).map(issue => ({
      id: c.id, issue, text: duelCardText(c, issue)
    })));
  `, { document: { addEventListener, getElementById: () => ({ options: [] }) }, window: { addEventListener }, innerWidth: 1280 });
  const failures = cards.flatMap(({ id, issue, text }) => identifyingText(text).map(clue => `${id}/${issue}: ${clue}`));
  assert.deepEqual([...failures], []);
});
