// Run: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = {};
new Function(readFileSync(new URL('../lib/daily-life.js', import.meta.url), 'utf8'))();
const Life = window.EchoTextDailyLife;

// 2026-10-26 is a Monday, 10-31 a Saturday, 11-01 a Sunday (local time)
const at = (day, h, m = 0) => new Date(2026, 9, day, h, m);

const STANDARD = [
    'weekday 07:00-08:30 | 家 | 起床洗漱 | free',
    'weekday 09:00-18:00 | 公司 | 上班 | busy',
    'weekday 23:30-07:00 | 家 | 睡觉 | asleep',
    'saturday 10:00-12:00 | 健身房 | 健身 | free',
    'saturday 01:00-10:00 | 家 | 睡懒觉 | asleep',
    'sunday 23:00-07:00 | 家 | 睡觉 | asleep',
].join('\n');

test('a schedule is filled in and cleaned up', () => {
    assert.deepEqual(Life.normalizeSchedule(undefined), { weekday: [], saturday: [], sunday: [] });
    const s = Life.normalizeSchedule({
        weekday: [
            { from: '18:00', to: '19:00', place: 'gym', doing: 'lifting', phone: 'busy' },
            { from: '09:00', to: '9:30', doing: 'bad end' },
            { from: '10:00', to: '10:00', doing: 'no time at all' },
            { from: '07:00', to: '08:00', doing: 'x'.repeat(80), phone: 'dancing' },
            'not a block',
        ],
        friday: [{ from: '01:00', to: '02:00' }],
    });
    assert.deepEqual(s.weekday.map(b => b.from), ['07:00', '18:00']);
    assert.equal(s.weekday[0].phone, 'free');
    assert.equal(s.weekday[0].place, '');
    assert.equal(s.weekday[0].doing.length, 60);
    assert.ok(s.weekday[0].doing.endsWith('…'));
    assert.deepEqual(Object.keys(s), ['weekday', 'saturday', 'sunday']);
    assert.equal(Life.hasSchedule(s), true);
    assert.equal(Life.hasSchedule(Life.normalizeSchedule({})), false);
});

test('the standard answer', () => {
    const s = Life.parseSchedule(STANDARD);
    assert.deepEqual(s.weekday, [
        { from: '07:00', to: '08:30', place: '家', doing: '起床洗漱', phone: 'free' },
        { from: '09:00', to: '18:00', place: '公司', doing: '上班', phone: 'busy' },
        { from: '23:30', to: '07:00', place: '家', doing: '睡觉', phone: 'asleep' },
    ]);
    assert.deepEqual(s.saturday.map(b => b.doing), ['睡懒觉', '健身']);
    assert.equal(s.sunday.length, 1);
});

test('a looser answer', () => {
    const s = Life.parseSchedule([
        '```',
        '## Weekdays',
        '- **7:00 - 8:00** | home | breakfast',
        '- 9am-5pm | office | work | (busy)',
        '* 1-3pm | office | meetings | BUSY',
        '* 22:30 to 6:30 | home | sleeping',
        '周末：',
        '10：00—12：00 ｜ 咖啡店 ｜ 看书 ｜ 有空',
        '每天 18:00~19:00, 公园, 跑步, 忙',
        'Here is the schedule you asked for!',
        'saturday 25:00-26:00 | nowhere | nothing',
        '```',
    ].join('\n'));
    assert.deepEqual(s.weekday.map(b => `${b.from}-${b.to} ${b.place}/${b.doing} ${b.phone}`), [
        '07:00-08:00 home/breakfast free',
        '09:00-17:00 office/work busy',
        '13:00-15:00 office/meetings busy',
        '18:00-19:00 公园/跑步 busy',
        '22:30-06:30 home/sleeping asleep',
    ]);
    // "周末" and "每天" fill both weekend days
    for (const day of ['saturday', 'sunday']) {
        assert.deepEqual(s[day].map(b => `${b.from} ${b.place} ${b.phone}`), ['10:00 咖啡店 free', '18:00 公园 busy']);
    }
});

test('two fields, and a time in the place', () => {
    const s = Life.parseSchedule('weekday 09:00-18:00 | 上班 | busy\nweekday 22:00-07:00 | 睡觉\nsunday 08:00-09:00 | 7-11 | 买早餐 | free');
    assert.deepEqual(s.weekday, [
        { from: '09:00', to: '18:00', place: '', doing: '上班', phone: 'busy' },
        { from: '22:00', to: '07:00', place: '', doing: '睡觉', phone: 'asleep' },
    ]);
    assert.deepEqual(s.sunday, [{ from: '08:00', to: '09:00', place: '7-11', doing: '买早餐', phone: 'free' }]);
});

test('am and pm', () => {
    const s = Life.parseSchedule('weekday 9-6pm | office | work\nweekday 12am-7am | home | asleep\nweekday 12pm-1pm | cafe | lunch');
    assert.deepEqual(s.weekday.map(b => `${b.from}-${b.to}`), ['00:00-07:00', '09:00-18:00', '12:00-13:00']);
});

test('no schedule in it', () => {
    for (const text of ['', 'I cannot help with that.', 'weekday | office | work', '09:00-18:00 | office | work']) {
        assert.equal(Life.hasSchedule(Life.parseSchedule(text)), false, text);
    }
});

test('which day a date is', () => {
    assert.equal(Life.dayOf(at(26, 12)), 'weekday');
    assert.equal(Life.dayOf(at(30, 12)), 'weekday');
    assert.equal(Life.dayOf(at(31, 12)), 'saturday');
    assert.equal(Life.dayOf(new Date(2026, 10, 1, 12)), 'sunday');
});

test('the block at a time', () => {
    const s = Life.parseSchedule(STANDARD);
    const doing = date => Life.blockAt(s, date)?.block.doing ?? null;
    assert.equal(doing(at(26, 10)), '上班');
    assert.equal(doing(at(26, 9)), '上班');
    assert.equal(doing(at(26, 18)), null);
    assert.equal(doing(at(26, 8, 30)), null);
    // Its own block past midnight, and last night's
    assert.equal(doing(at(27, 23, 45)), '睡觉');
    assert.deepEqual(Life.blockAt(s, at(27, 3)), { day: 'weekday', index: 2, block: s.weekday[2] });
    // Saturday 03:00: Friday night's sleep has not ended; Saturday's own starts at 01:00 and wins
    assert.equal(Life.blockAt(s, at(31, 3)).day, 'saturday');
    assert.equal(doing(at(31, 0, 30)), '睡觉');
    assert.equal(Life.blockAt(s, at(31, 0, 30)).day, 'weekday');
    // Monday 02:00: Sunday night's sleep
    assert.equal(Life.blockAt(s, at(26, 2)).day, 'sunday');
    // Overlaps: the one that began last
    const o = Life.normalizeSchedule({ weekday: [
        { from: '09:00', to: '18:00', doing: 'work' }, { from: '12:00', to: '13:00', doing: 'lunch' }] });
    assert.equal(Life.blockAt(o, at(26, 12, 30)).block.doing, 'lunch');
    assert.equal(Life.blockAt(o, at(26, 14)).block.doing, 'work');
    assert.equal(Life.blockAt(Life.normalizeSchedule(null), at(26, 12)), null);
});

test('the request', () => {
    const { systemPrompt, prompt } = Life.buildScheduleRequest({
        charName: 'Mira', userName: '齐宁',
        card: ["Mira's description: a night-shift nurse", "Mira's personality: dry"], persona: 'her neighbour',
    });
    assert.match(systemPrompt, /Mira's typical week/);
    assert.match(systemPrompt, /<day> <HH:MM>-<HH:MM> \| <place> \| <what they are doing> \| <free, busy or asleep>/);
    // No example sentence in any one language
    assert.doesNotMatch(systemPrompt, /[一-鿿]/);
    assert.equal(prompt, "<character_reference>\nMira's description: a night-shift nurse\n\nMira's personality: dry\n\n齐宁's persona: her neighbour\n</character_reference>");
    assert.doesNotMatch(Life.buildScheduleRequest({ card: ['x'] }).prompt, /persona/);
});

test('editing a day: replace, add, delete', () => {
    const s = Life.parseSchedule(STANDARD);
    const edited = Life.withBlock(s, 'weekday', 1, { from: '10:00', to: '19:00', place: '医院', doing: '值班', phone: 'busy' });
    assert.deepEqual(edited.weekday.map(b => `${b.from} ${b.doing}`), ['07:00 起床洗漱', '10:00 值班', '23:30 睡觉']);
    // Added blocks fall into time order
    const added = Life.withBlock(s, 'weekday', -1, { from: '12:00', to: '13:00', doing: '午饭' });
    assert.deepEqual(added.weekday.map(b => b.doing), ['起床洗漱', '上班', '午饭', '睡觉']);
    assert.equal(added.weekday[2].phone, 'free');
    // Not a block: nothing changes
    assert.deepEqual(Life.withBlock(s, 'weekday', 0, { from: '12:00', to: '12:00', doing: 'x' }), s);
    assert.deepEqual(Life.withBlock(s, 'friday', -1, { from: '12:00', to: '13:00' }), s);
    assert.deepEqual(Life.withoutBlock(s, 'weekday', 1).weekday.map(b => b.doing), ['起床洗漱', '睡觉']);
    assert.equal(s.weekday.length, 3);
});

test('the next block today', () => {
    const s = Life.parseSchedule(STANDARD);
    assert.equal(Life.nextBlockAt(s, at(26, 8)).doing, '上班');
    assert.equal(Life.nextBlockAt(s, at(26, 12)).doing, '睡觉');
    assert.equal(Life.nextBlockAt(s, at(26, 23, 45)), null);
});

test('where the character is now, for the prompt', () => {
    const s = Life.parseSchedule(STANDARD);
    assert.equal(Life.describeNow({ schedule: s, date: at(26, 10), charName: 'Mira' }), [
        '<daily_life>',
        'It is Monday, morning.',
        'Right now (09:00–18:00): 上班, at 公司.',
        'Mira is busy and can only glance at the phone now and then: replies are short or late, and Mira may say so.',
        'Next (from 23:30): 睡觉, at 家.',
        'This is where Mira is in their day: treat it as true and let it show when it fits, without reciting it.',
        '</daily_life>',
    ].join('\n'));
    // Between blocks, and asleep (last night's sleep, nothing next today)
    assert.match(Life.describeNow({ schedule: s, date: at(26, 19), charName: 'Mira' }),
        /It is Monday, evening\.\nRight now: nothing in particular\. Mira is free to look at the phone and text\.\nNext \(from 23:30\)/);
    const night = Life.describeNow({ schedule: s, date: at(27, 2), charName: 'Mira' });
    assert.match(night, /It is Tuesday, before dawn\.\nRight now \(23:30–07:00\): 睡觉, at 家\.\nIt is Mira's time to sleep/);
    assert.match(night, /Next \(from 07:00\): 起床洗漱/);
    // A block with only a place
    const placeOnly = Life.normalizeSchedule({ saturday: [{ from: '10:00', to: '12:00', place: '健身房', phone: 'free' }] });
    assert.match(Life.describeNow({ schedule: placeOnly, date: at(31, 11), charName: 'Mira' }), /Right now \(10:00–12:00\): 健身房\.\nMira is free/);
    assert.equal(Life.describeNow({ schedule: Life.normalizeSchedule(null), date: at(26, 10) }), '');
});
