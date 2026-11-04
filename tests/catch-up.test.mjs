// Run: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = {};
for (const f of ['lib/daily-life.js', 'lib/catch-up.js']) {
    new Function(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'))();
}
const C = window.EchoTextCatchUp;
const Life = window.EchoTextDailyLife;

const HOUR = 3600000;
const DAY = 24 * HOUR;
// Saturday 2026-10-31 20:00
const NOW = new Date(2026, 9, 31, 20, 0).getTime();
const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime();

const WEEK = Life.parseSchedule([
    'weekday 07:00-08:00 | 家 | 起床 | free', 'weekday 09:00-18:00 | 公司 | 上班 | busy', 'weekday 23:00-07:00 | 家 | 睡觉 | asleep',
    'saturday 00:00-10:00 | 家 | 睡懒觉 | asleep', 'saturday 10:00-23:00 | 城里 | 逛街 | free',
    'sunday 00:00-09:00 | 家 | 睡觉 | asleep',
].join('\n'));

test('what the model is told', () => {
    // What may be on her mind with each (none for the first)
    const texts = [{ n: 1, at: at(30, 19), note: '' },
        { n: 3, at: at(31, 12), note: 'You feel like texting Qi.' }];
    const text = C.buildInstruction({ charName: 'Mira', userName: 'Qi', from: NOW - 6 * DAY, now: NOW, settle: true, schedule: WEEK,
        errands: [{ text: '周六搬家', progress: '打包了一半', due: '2026-10-31' }], madeUp: false, texts, guidance: 'They were sent one after another.' });
    assert.match(text, /^CATCH-UP: Qi hasn't been around since Sun 2026-10-25 20:00; it is now Sat 2026-10-31 20:00\. Mira's life went on meanwhile\./);
    // The week is in the system prompt's <schedule>: pointed to, not listed again
    assert.match(text, /Those days went by as Mira's usual week in <schedule> has them, unless something changed them\./);
    assert.doesNotMatch(text, /上班|起床/);
    assert.match(text, /Only the last 3 days are told in detail: 3 more days went by before them\./);
    assert.match(text, /- 周六搬家 \(打包了一半\); due 2026-10-31/);
    assert.match(text, /happened <what> \(YYYY-MM-DD HH:MM\); update <errand>: <how it stands now>; done <errand>\. An errand past its due day/);
    assert.doesNotMatch(text, /new <errand>/);
    assert.match(text, /Sum up the days before in one happened entry/);
    // The same bar as a reply's: out of the ordinary; the schedule, time passing and no reply aren't events
    assert.match(text, /A handful of entries, the ones that matter: what happened is something out of the ordinary that happened to Mira — .*\. What <schedule> already has Mira doing, time passing and Qi not replying are not events\./);
    // Each text with its number, its time, what she was doing and what it's about; the times and order the engine's
    assert.match(text, /Then the texts Mira sent Qi meanwhile, in this order:\n- n=1 · Fri 2026-10-30 19:00\n- n=3 · Sat 2026-10-31 12:00 · 10:00–23:00 逛街 \(城里\) · on Mira's mind: You feel like texting Qi\./);
    assert.match(text, /Write each as <text n="…">…<\/text> with its number, .*, one to three texts\. One for every number and no others: the times and the order are fixed\.\nThey were sent one after another\./);
    assert.doesNotMatch(text, /at="/);
    // No guidance given: none said
    assert.doesNotMatch(C.buildInstruction({ userName: 'Qi', from: NOW - DAY, now: NOW, texts: [texts[1]] }), /one after another/);
    assert.match(C.buildInstruction({ from: NOW - DAY, now: NOW, settle: true, madeUp: true }), /; new <errand> \(due YYYY-MM-DD\) for something that comes up/);
    // Only texts (no Daily Life)
    const only = C.buildInstruction({ charName: 'Mira', userName: 'Qi', from: NOW - DAY, now: NOW, texts: [{ n: 1, at: at(31, 12), note: 'x' }] });
    assert.doesNotMatch(only, /<life>|schedule/);
    assert.match(only, /Write the texts Mira sent Qi meanwhile/);
    assert.doesNotMatch(text + only, /[一-鿿]{3,}.*\bYYYY/);
});
test('reading the answer: the changes, and the texts by their number only', () => {
    const answer = '<think>hm</think>\n<life>happened 加班到十点 (2026-10-29); update 周六搬家: 搬完了; done 和小雨冷战</life>\n'
        + '<text n="2" at="2026-10-31 13:00">搬完家了！</text>\n<text n="1">累死了\n今天加班</text>\n<text n="9">extra</text>\n<text n="1">again</text>';
    const { life, texts } = C.readAnswer(answer, { now: NOW, asked: [1, 2, 3] });
    assert.deepEqual(life.map(c => c.op), ['happened', 'update', 'done']);
    assert.equal(life[0].date, '2026-10-29');
    // A time the model writes changes nothing; an unasked number, a second one and a missing one are left out
    assert.deepEqual(texts, [{ n: 2, mes: '搬完家了！' }, { n: 1, mes: '累死了\n今天加班' }]);
    // Without numbers (the old way, or a format slip): nothing goes in
    assert.deepEqual(C.readAnswer('<text at="2026-10-31 12:00">a</text><text>b</text>', { now: NOW, asked: [1, 2] }).texts, []);
    assert.deepEqual(C.readAnswer('nothing here', { now: NOW, asked: [] }), { life: null, texts: [] });
    // Loose quoting still reads
    assert.deepEqual(C.readAnswer("<text n=1>a</text><text n='2'>b</text>", { now: NOW, asked: [1, 2] }).texts.map(t => t.n), [1, 2]);
});
test('settling the changes into the life', () => {
    const state = { startAt: at(28, 9), start: { errands: [{ id: 'e1', text: '周六搬家', progress: '打包了一半', due: '2026-10-31' }], log: [], today: null } };
    const changes = Life.parseLifeTag('<life>happened 加班到十点 (2026-10-29); update 搬家: 搬完了</life>', new Date(NOW)).life;
    const settled = Life.rewriteLife(state, [], new Date(NOW), { changes });
    assert.equal(settled.startAt, NOW + 1);
    assert.equal(settled.start.errands[0].progress, '搬完了');
    assert.deepEqual(settled.start.log.map(e => [e.date, e.text]), [['2026-10-29', '加班到十点']]);
    // Not replayed again on top of itself
    assert.deepEqual(Life.currentLife(settled, new Date(NOW), [{ is_user: false, send_date: NOW, life: changes }]).log.length, 1);
});

test('the last line asks only for what is wanted: settling alone, no texts', () => {
    const settleOnly = C.buildInstruction({ charName: 'Mira', userName: 'Qi', from: at(31, 8), now: NOW, settle: true, schedule: WEEK });
    assert.match(settleOnly, /Write only the <life> line, in the language of the conversation: no texts this time, and nothing else\.$/);
    assert.doesNotMatch(settleOnly, /the texts/);
    const both = C.buildInstruction({ charName: 'Mira', userName: 'Qi', from: at(31, 8), now: NOW, settle: true, schedule: WEEK, texts: [{ n: 1, at: at(31, 12), note: 'x' }] });
    assert.match(both, /Write the changes and the texts in the language of the conversation, and nothing else\.$/);
    const textsOnly = C.buildInstruction({ charName: 'Mira', userName: 'Qi', from: at(31, 8), now: NOW, texts: [{ n: 1, at: at(31, 12), note: 'x' }] });
    assert.match(textsOnly, /Write the texts in the language of the conversation, and nothing else\.$/);
});

test('settling is told not to repeat what\'s recorded, and may still build on it', () => {
    const told = C.buildInstruction({ charName: 'Mira', userName: 'Qi', from: at(31, 8), now: NOW, settle: true, schedule: WEEK });
    assert.match(told, /Do not create duplicate entries for events already recorded in What happened lately\./);
    assert.match(told, /You may reference those events for continuity, but only add genuinely new developments\./);
    // Texts alone write no entries
    assert.doesNotMatch(C.buildInstruction({ charName: 'Mira', userName: 'Qi', from: at(31, 8), now: NOW, texts: [{ n: 1, at: at(31, 12), note: 'x' }] }), /duplicate entries/);
});

test('what a catch-up reports says when it happened, never the time you came back', () => {
    const { life } = C.readAnswer('<life>happened 加班到十点 (2026-10-30 21:00); happened 睡了一天</life>', { now: NOW, asked: [] });
    assert.deepEqual(life.map(c => c.time), ['21:00', undefined]);
    const settled = Life.rewriteLife({ startAt: 0, start: { errands: [], log: [], today: null } }, [], new Date(NOW), { changes: life });
    assert.deepEqual(settled.start.log.map(e => e.text).sort(), ['21:00 加班到十点', '睡了一天']);
});
