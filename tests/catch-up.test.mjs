// Run: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = {};
for (const f of ['lib/daily-life.js', 'lib/proactive-rounds.js', 'lib/catch-up.js']) {
    new Function(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'))();
}
const C = window.EchoTextCatchUp;
const Life = window.EchoTextDailyLife;

const HOUR = 3600000;
const DAY = 24 * HOUR;
// Saturday 2026-10-31 20:00
const NOW = new Date(2026, 9, 31, 20, 0).getTime();
const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime();
const clock = list => list.map(C.clockText);

const WEEK = Life.parseSchedule([
    'weekday 07:00-08:00 | 家 | 起床 | free', 'weekday 09:00-18:00 | 公司 | 上班 | busy', 'weekday 23:00-07:00 | 家 | 睡觉 | asleep',
    'saturday 00:00-10:00 | 家 | 睡懒觉 | asleep', 'saturday 10:00-23:00 | 城里 | 逛街 | free',
    'sunday 00:00-09:00 | 家 | 睡觉 | asleep',
].join('\n'));

test('where a text can go: out of sleep and work, or into the day', () => {
    // Without a schedule: not at night
    assert.equal(C.clockText(C.placeText(at(29, 3), null)), '2026-10-29 09:00');
    assert.equal(C.clockText(C.placeText(at(29, 23, 30), null)), '2026-10-30 09:00');
    assert.equal(C.placeText(at(29, 15), null), at(29, 15));
    // With one: asleep or busy, when that ends (and a few minutes)
    assert.equal(C.clockText(C.placeText(at(29, 3), WEEK)), '2026-10-29 07:05');
    assert.equal(C.clockText(C.placeText(at(29, 12), WEEK)), '2026-10-29 18:05');
    assert.equal(C.placeText(at(31, 15), WEEK), at(31, 15));
});

test('the texts over a gap: only the last days, one a day, waiting longer each time, up to the temperament', () => {
    // Clingy (3 in a row, 3–5 hours ×2 each), a week away: only the last 3 days, one a day
    const clingy = C.planTexts({ from: NOW - 7 * DAY, to: NOW, temperament: 'clingy', baseHours: 4 });
    // From Wed 20:00: the wait ends at midnight, so 09:00 Thursday; then a day each
    assert.deepEqual(clock(clingy), ['2026-10-29 09:00', '2026-10-30 09:00', '2026-10-31 09:00']);
    assert.ok(clingy.every(t => t > NOW - 3 * DAY && t <= NOW));
    assert.equal(new Set(clingy.map(t => new Date(t).getDate())).size, 3);
    // Obsessed caps at 5 in a row, but one a day: the last 72 hours touch 4 days (Wed evening to Sat)
    assert.deepEqual(clock(C.planTexts({ from: NOW - 30 * DAY, to: NOW, temperament: 'obsessed', baseHours: 1.5 })),
        ['2026-10-28 21:30', '2026-10-29 09:00', '2026-10-30 09:00', '2026-10-31 09:00']);
    // Two unanswered already: Normal has none left; clingy one
    assert.equal(C.planTexts({ from: NOW - 3 * DAY, to: NOW, temperament: 'normal', baseHours: 8, unanswered: 2 }).length, 0);
    assert.equal(C.planTexts({ from: NOW - 3 * DAY, to: NOW, temperament: 'clingy', baseHours: 4, unanswered: 2 }).length, 1);
    // Out of the day's requests: none
    assert.equal(C.planTexts({ from: NOW - 3 * DAY, to: NOW, temperament: 'clingy', baseHours: 4, left: 0 }).length, 0);
    // A short gap: the wait isn't over before now
    assert.equal(C.planTexts({ from: NOW - 4 * HOUR, to: NOW, temperament: 'normal', baseHours: 8 }).length, 0);
    // With a schedule: never asleep or at work
    for (const t of C.planTexts({ from: NOW - 3 * DAY, to: NOW, temperament: 'clingy', baseHours: 4, schedule: WEEK })) {
        assert.equal(Life.blockAt(WEEK, new Date(t))?.block.phone ?? 'free', 'free', C.clockText(t));
    }
});

test('the schedule over the last days, a line a day', () => {
    const lines = C.scheduleLines({ schedule: WEEK, from: NOW - 10 * DAY, to: NOW });
    assert.equal(lines.length, 4);
    assert.equal(lines[0], 'Wed 2026-10-28: 07:00–08:00 起床 (家); 09:00–18:00 上班 (公司); 23:00–07:00 睡觉 (家) [asleep]');
    assert.equal(lines[3], 'Sat 2026-10-31: 00:00–10:00 睡懒觉 (家) [asleep]; 10:00–23:00 逛街 (城里)');
    assert.deepEqual(C.scheduleLines({ schedule: null, from: NOW - DAY, to: NOW }), []);
});

test('what the model is told', () => {
    const text = C.buildInstruction({ charName: 'Mira', userName: 'Qi', from: NOW - 6 * DAY, now: NOW, settle: true, schedule: WEEK,
        errands: [{ text: '周六搬家', progress: '打包了一半', due: '2026-10-31' }], madeUp: false, texts: [at(30, 19), at(31, 12)] });
    assert.match(text, /^CATCH-UP: Qi hasn't been around since 2026-10-25 20:00; it is now 2026-10-31 20:00\. Mira's life went on meanwhile\./);
    assert.match(text, /Mira's days lately, from the schedule:\n- Wed 2026-10-28: /);
    assert.match(text, /Before those days, 3 more days went by\./);
    assert.match(text, /- 周六搬家 \(打包了一半\); due 2026-10-31/);
    assert.match(text, /happened <what> \(YYYY-MM-DD HH:MM\); update <errand>: <how it stands now>; done <errand>\. An errand past its due day/);
    assert.doesNotMatch(text, /new <errand>/);
    assert.match(text, /Sum up the days before in one happened entry/);
    assert.match(text, /Then the texts Mira sent Qi meanwhile, each still unanswered when the next came, one at each of these moments:\n- 2026-10-30 19:00\n- 2026-10-31 12:00 \(逛街\)/);
    assert.match(text, /<text at="YYYY-MM-DD HH:MM">…<\/text>/);
    assert.match(C.buildInstruction({ from: NOW - DAY, now: NOW, settle: true, madeUp: true }), /; new <errand> \(due YYYY-MM-DD\) for something that comes up/);
    // Only texts (no Daily Life)
    const only = C.buildInstruction({ charName: 'Mira', userName: 'Qi', from: NOW - DAY, now: NOW, texts: [at(31, 12)] });
    assert.doesNotMatch(only, /<life>|schedule/);
    assert.match(only, /Write the texts Mira sent Qi meanwhile/);
    assert.doesNotMatch(text + only, /[一-鿿]{3,}.*\bYYYY/);
});

test('reading the answer: the changes and the texts at their times', () => {
    const answer = '<think>hm</think>\n<life>happened 加班到十点 (2026-10-29); update 周六搬家: 搬完了; done 和小雨冷战</life>\n'
        + '<text at="2026-10-30 19:05">累死了\n今天加班</text>\n<text at="2026-10-31 12:10">搬完家了！</text>\n<text at="2026-10-31 13:00">extra</text>';
    const { life, texts } = C.readAnswer(answer, { from: NOW - 3 * DAY, now: NOW, planned: [at(30, 19), at(31, 12)] });
    assert.deepEqual(life.map(c => c.op), ['happened', 'update', 'done']);
    assert.equal(life[0].date, '2026-10-29');
    assert.deepEqual(texts, [{ at: at(30, 19, 5), mes: '累死了\n今天加班' }, { at: at(31, 12, 10), mes: '搬完家了！' }]);
    // A time missing, outside the gap or out of order: the planned moment
    const loose = C.readAnswer('<text>a</text><text at="2026-11-05 10:00">b</text>', { from: NOW - 3 * DAY, now: NOW, planned: [at(30, 19), at(31, 12)] });
    assert.deepEqual(loose.texts.map(t => t.at), [at(30, 19), at(31, 12)]);
    assert.deepEqual(C.readAnswer('nothing here', { from: NOW - DAY, now: NOW, planned: [] }), { life: null, texts: [] });
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

test('a change of plan by hand moves where a text can go', () => {
    // Busy by hand on Saturday's free afternoon, until 17:00
    const busy = Life.makeOverride('busy', '17:00', new Date(at(31, 11)));
    assert.equal(C.clockText(C.placeText(at(31, 15), WEEK, busy)), '2026-10-31 17:05');
    // Up by hand on a sleeping Wednesday night, until 01:00
    const up = Life.makeOverride('free', '01:00', new Date(at(28, 23)));
    assert.equal(C.placeText(at(28, 23, 30), WEEK, up), at(28, 23, 30));
    assert.equal(C.clockText(C.placeText(at(29, 1, 30), WEEK, up)), '2026-10-29 07:05');
});

test('time together: no texts in it', () => {
    const together = Life.makeOverride('together', '23:00', new Date(at(31, 10)));
    // A free Saturday in town, but with you till 23:00: the text waits till after
    assert.equal(C.clockText(C.placeText(at(31, 12), WEEK, together)), '2026-10-31 23:05');
    assert.equal(C.clockText(C.placeText(at(31, 9), WEEK, together)).slice(11), '23:05');
});

test('time together in Recent: no texts in it, and the ones before it kept', () => {
    // Saturday: her last text at 10:00, and nothing ran since (held by the main chat); with you 14:10–17:00
    const together = [{ from: at(31, 14, 10), until: at(31, 17) }];
    const plan = (temperament, baseHours, to, spans = together) => clock(C.planTexts({ from: at(31, 10), to, temperament, baseHours, schedule: WEEK, together: spans }));
    // Due before it: kept, back at 22:00 or already at 18:30
    assert.deepEqual(plan('clingy', 4, at(31, 22)), ['2026-10-31 14:00']);
    assert.deepEqual(plan('clingy', 4, at(31, 18, 30)), ['2026-10-31 14:00']);
    // Due in it: after it
    assert.deepEqual(plan('normal', 5, at(31, 22), []), ['2026-10-31 15:00']);
    assert.deepEqual(plan('normal', 5, at(31, 22)), ['2026-10-31 17:05']);
    // Over days: Friday evening together, Thursday's and Saturday's texts as they were
    assert.deepEqual(clock(C.planTexts({ from: at(29, 19), to: NOW, temperament: 'obsessed', baseHours: 1.5, schedule: WEEK,
        together: [{ from: at(30, 19), until: at(30, 22, 30) }] })), ['2026-10-29 20:30', '2026-10-30 18:05', '2026-10-31 10:05']);
    // The app closed while together (texts ran till 14:30), back after it ran out
    const closed = { from: at(31, 14, 30), to: at(31, 22), temperament: 'obsessed', baseHours: 1.5, schedule: WEEK };
    assert.deepEqual(clock(C.planTexts(closed)), ['2026-10-31 16:00']);
    assert.deepEqual(clock(C.planTexts({ ...closed, together: [{ from: at(31, 14, 10), until: at(31, 17, 10) }] })), ['2026-10-31 17:15']);
    // Without a schedule too, and one span right after another
    assert.equal(C.clockText(C.placeText(at(31, 12), null, null, [{ from: at(31, 11), until: at(31, 14) }, { from: at(31, 14, 3), until: at(31, 18) }])), '2026-10-31 18:05');
    // Outside the gap: nothing moves
    assert.deepEqual(plan('clingy', 4, at(31, 22), [{ from: at(30, 14), until: at(30, 17) }]), ['2026-10-31 14:00']);
});

test('texts moved out of time together keep their waits and their number', () => {
    // Together every day 08:00–22:00: each text goes after it, a day apart, no more than before
    const spans = [28, 29, 30, 31].map(d => ({ from: at(d, 8), until: at(d, 22) }));
    for (const [temperament, baseHours] of [['obsessed', 1], ['clingy', 3], ['normal', 6]]) {
        const gap = { from: at(28, 20), to: at(31, 23, 30), temperament, baseHours };
        const plain = C.planTexts(gap);
        const moved = C.planTexts({ ...gap, together: spans });
        assert.equal(moved.length, plain.length, temperament);
        assert.ok(moved.every(t => C.clockText(t).endsWith('22:05')), temperament);
        moved.slice(1).forEach((t, i) => assert.ok(t - moved[i] >= Math.max(baseHours * HOUR, DAY), temperament));
    }
    // Two that would have gone in it on one day: one after it, the day's one
    assert.deepEqual(clock(C.planTexts({ from: at(31, 10), to: at(31, 23), temperament: 'obsessed', baseHours: 1 })), ['2026-10-31 11:00']);
    assert.deepEqual(clock(C.planTexts({ from: at(31, 10), to: at(31, 23), temperament: 'obsessed', baseHours: 1, together: [{ from: at(31, 10, 30), until: at(31, 20) }] })),
        ['2026-10-31 20:05']);
});

test('the last line asks only for what is wanted: settling alone, no texts', () => {
    const settleOnly = C.buildInstruction({ charName: 'Mira', userName: 'Qi', from: at(31, 8), now: NOW, settle: true, schedule: WEEK });
    assert.match(settleOnly, /Write only the <life> line, in the language of the conversation: no texts this time, and nothing else\.$/);
    assert.doesNotMatch(settleOnly, /the texts/);
    const both = C.buildInstruction({ charName: 'Mira', userName: 'Qi', from: at(31, 8), now: NOW, settle: true, schedule: WEEK, texts: [at(31, 12)] });
    assert.match(both, /Write the changes and the texts in the language of the conversation, and nothing else\.$/);
    const textsOnly = C.buildInstruction({ charName: 'Mira', userName: 'Qi', from: at(31, 8), now: NOW, texts: [at(31, 12)] });
    assert.match(textsOnly, /Write the texts in the language of the conversation, and nothing else\.$/);
});

test('settling is told not to repeat what\'s recorded, and may still build on it', () => {
    const told = C.buildInstruction({ charName: 'Mira', userName: 'Qi', from: at(31, 8), now: NOW, settle: true, schedule: WEEK });
    assert.match(told, /Do not create duplicate entries for events already recorded in What happened lately\./);
    assert.match(told, /You may reference those events for continuity, but only add genuinely new developments\./);
    // Texts alone write no entries
    assert.doesNotMatch(C.buildInstruction({ charName: 'Mira', userName: 'Qi', from: at(31, 8), now: NOW, texts: [at(31, 12)] }), /duplicate entries/);
});

test('what a catch-up reports says when it happened, never the time you came back', () => {
    const { life } = C.readAnswer('<life>happened 加班到十点 (2026-10-30 21:00); happened 睡了一天</life>', { from: at(29, 8), now: NOW, planned: [] });
    assert.deepEqual(life.map(c => c.time), ['21:00', undefined]);
    const settled = Life.rewriteLife({ startAt: 0, start: { errands: [], log: [], today: null } }, [], new Date(NOW), { changes: life });
    assert.deepEqual(settled.start.log.map(e => e.text).sort(), ['21:00 加班到十点', '睡了一天']);
});
