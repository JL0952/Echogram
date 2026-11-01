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
            { from: '20:00', to: '21:00', doing: 'y'.repeat(900) },
            'not a block',
        ],
        friday: [{ from: '01:00', to: '02:00' }],
    });
    assert.deepEqual(s.weekday.map(b => b.from), ['07:00', '18:00', '20:00']);
    assert.equal(s.weekday[0].phone, 'free');
    assert.equal(s.weekday[0].place, '');
    // Long text is kept whole; only runaway text is cut, with no ellipsis added
    assert.equal(s.weekday[0].doing, 'x'.repeat(80));
    assert.equal(s.weekday[2].doing, 'y'.repeat(500));
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
        // The meetings began later: work splits around them
        '09:00-13:00 office/work busy',
        '13:00-15:00 office/meetings busy',
        '15:00-17:00 office/work busy',
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
    assert.deepEqual(s.weekday.map(b => `${b.from}-${b.to}`), ['00:00-07:00', '09:00-12:00', '12:00-13:00', '13:00-18:00']);
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
    // Added blocks fall into time order (lunch inside work splits it)
    const added = Life.withBlock(s, 'weekday', -1, { from: '12:00', to: '13:00', doing: '午饭' });
    assert.deepEqual(added.weekday.map(b => b.doing), ['起床洗漱', '上班', '午饭', '上班', '睡觉']);
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
        'This is where Mira is in their life: treat it as true and let it show when it fits, without reciting it.',
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

const LIFE = {
    start: {
        errands: [
            { id: 'e1', text: '周六搬家', progress: '打包了一半', due: '2026-10-31', feeling: '嫌麻烦', from: 'you' },
            { id: 'e2', text: '期中考试', due: '2026-10-20' },
            { text: 'no due date' },
            { text: '', due: '2026-10-30' },
        ],
        log: [
            { id: 'l2', date: '2026-10-27', text: '中午和小雨和好了' },
            { id: 'l1', date: '2026-10-15', text: 'too old' },
            { date: '2026-10-26', text: '加班到十点' },
            { date: 'yesterday', text: 'bad date' },
        ],
        today: { date: '2026-10-28', text: '今晚和你吃饭，不去健身' },
    },
    startAt: 1,
};

test('a life is filled in and cleaned up', () => {
    // None yet: empty, and every report in the chat counts
    assert.deepEqual(Life.normalizeLife(undefined), { start: { errands: [], log: [], today: null }, startAt: 0 });
    const { start } = Life.normalizeLife(LIFE);
    assert.deepEqual(start.errands.map(e => e.text), ['周六搬家', '期中考试']);
    assert.equal(start.errands[1].from, 'you');
    assert.ok(start.errands[1].id);
    // Oldest first
    assert.deepEqual(start.log.map(e => e.date), ['2026-10-15', '2026-10-26', '2026-10-27']);
    assert.equal(Life.normalizeLife({ start: { errands: Array.from({ length: 5 }, (_, i) => ({ text: `e${i}`, due: '2026-11-01' })) } }).start.errands.length, 3);
    assert.equal(Life.normalizeLife({ start: { log: Array.from({ length: 30 }, (_, i) => ({ text: `l${i}`, date: '2026-10-28' })) } }).start.log.at(-1).text, 'l29');
});

test('the life as it stands: a week of what happened, today\'s change on its day', () => {
    const life = Life.currentLife(LIFE, at(28, 12));
    assert.deepEqual(life.log.map(e => e.text), ['加班到十点', '中午和小雨和好了']);
    assert.equal(life.today.text, '今晚和你吃饭，不去健身');
    assert.equal(Life.currentLife(LIFE, at(29, 12)).today, null);
    assert.equal(Life.hasLife(life), true);
    assert.equal(Life.hasLife(Life.currentLife(null, at(28, 12))), false);
});

test('editing a life', () => {
    const parts = Life.normalizeLife(LIFE).start;
    const edited = Life.withErrand(parts, 0, { ...parts.errands[0], progress: '打包完了' });
    assert.equal(edited.errands[0].progress, '打包完了');
    assert.equal(edited.errands[0].id, 'e1');
    const added = Life.withErrand(parts, -1, { text: '体检', due: '2026-11-03' });
    assert.deepEqual(added.errands.map(e => e.text), ['周六搬家', '期中考试', '体检']);
    // No room for a fourth; not an errand without a due date
    assert.equal(Life.withErrand(added, -1, { text: 'x', due: '2026-11-03' }).errands.length, 3);
    assert.deepEqual(Life.withErrand(parts, 0, { text: 'x' }).errands, parts.errands);
    assert.deepEqual(Life.withoutErrand(parts, 0).errands.map(e => e.text), ['期中考试']);
    // What happened falls into date order
    const logged = Life.withEntry(parts, -1, { date: '2026-10-16', text: '看了电影' });
    assert.deepEqual(logged.log.map(e => e.text), ['too old', '看了电影', '加班到十点', '中午和小雨和好了']);
    assert.deepEqual(Life.withoutEntry(logged, 0).log.map(e => e.text), ['看了电影', '加班到十点', '中午和小雨和好了']);
    assert.deepEqual(Life.withToday(parts, at(29, 9), '  去医院  ').today, { date: '2026-10-29', text: '去医院' });
    assert.equal(Life.withToday(parts, at(29, 9), '   ').today, null);
});

test('days said from today', () => {
    const today = '2026-10-28';
    assert.deepEqual(['2026-10-28', '2026-10-27', '2026-10-29', '2026-10-31', '2026-10-24', '2026-11-07', '2026-10-01'].map(d => Life.sayDay(d, today)),
        ['today', 'yesterday', 'tomorrow', 'Saturday', 'last Saturday', 'Nov 7', 'Oct 1']);
});

test('where the character is in their life, for the prompt', () => {
    const s = Life.parseSchedule(STANDARD);
    const life = Life.currentLife(LIFE, at(28, 10));
    assert.equal(Life.describeNow({ schedule: s, life, date: at(28, 10), charName: 'Mira' }), [
        '<daily_life>',
        'It is Wednesday, morning.',
        'Right now (09:00–18:00): 上班, at 公司.',
        'Mira is busy and can only glance at the phone now and then: replies are short or late, and Mira may say so.',
        'Next (from 23:30): 睡觉, at 家.',
        'Today, unlike usual (this wins over the plan above): 今晚和你吃饭，不去健身.',
        "On Mira's mind lately:",
        '- 周六搬家 (打包了一半; due Saturday; 嫌麻烦)',
        '- 期中考试 (was due Oct 20)',
        'What happened lately, oldest first:',
        '- last Monday: 加班到十点',
        '- yesterday: 中午和小雨和好了',
        'This is where Mira is in their life: treat it as true and let it show when it fits, without reciting it.',
        '</daily_life>',
    ].join('\n'));
    // Without a schedule: the life alone
    assert.equal(Life.describeNow({ schedule: Life.normalizeSchedule(null), life, date: at(28, 10), charName: 'Mira' }).split('\n').slice(1, 4).join('\n'),
        "It is Wednesday, morning.\nToday, for a change: 今晚和你吃饭，不去健身.\nOn Mira's mind lately:");
    assert.equal(Life.describeNow({ schedule: Life.normalizeSchedule(null), life: Life.currentLife(null, at(28, 10)), date: at(28, 10) }), '');
});

// 2026-10-31 is a Saturday
const SAT = new Date(2026, 9, 31, 15);

test('days a report names', () => {
    const cases = { '2026-11-07': '2026-11-07', '11-7': '2026-11-07', '11月9日': '2026-11-09', today: '2026-10-31', '明天': '2026-11-01',
        '后天': '2026-11-02', yesterday: '2026-10-30', Saturday: '2026-10-31', '周日': '2026-11-01', '下周一': '2026-11-02', 'next monday': '2026-11-02',
        'next week': '2026-11-07', 'in 3 days': '2026-11-03', '5天后': '2026-11-05', '周末': '2026-10-31', '下周末': '2026-11-07', someday: null };
    for (const [text, day] of Object.entries(cases)) assert.equal(Life.parseDay(text, SAT), day, text);
    // A month and day long past is next year's
    assert.equal(Life.parseDay('1-5', SAT), '2027-01-05');
});

test('the <life> line: standard', () => {
    const { text, life } = Life.parseLifeTag('刚到家\n累死\n<life>new 下周三考试 (due 下周三); update 周六搬家: 打包完了; done 和小雨冷战; happened 中午和小雨和好了; today 今晚和你吃饭，不去健身</life>', SAT);
    assert.equal(text, '刚到家\n累死');
    assert.deepEqual(life, [
        { op: 'new', text: '下周三考试', due: '2026-11-04', feeling: '' },
        { op: 'update', name: '周六搬家', progress: '打包完了' },
        { op: 'done', name: '和小雨冷战' },
        { op: 'happened', text: '中午和小雨和好了', date: '2026-10-31' },
        { op: 'today', date: '2026-10-31', text: '今晚和你吃饭，不去健身' },
    ]);
});

test('the <life> line: looser', () => {
    const loose = Life.parseLifeTag('ok <life>\n- 新增：体检（截止 11月9日，有点怕）\n- 更新 搬家 → 找好车了\n- 完成：论文\n- 发生了：被老板夸了（昨天）', SAT);
    assert.equal(loose.text, 'ok');
    assert.deepEqual(loose.life, [
        { op: 'new', text: '体检', due: '2026-11-09', feeling: '有点怕' },
        { op: 'update', name: '搬家', progress: '找好车了' },
        { op: 'done', name: '论文' },
        { op: 'happened', text: '被老板夸了', date: '2026-10-30' },
    ]);
    // Another tag name; "due" outside brackets; no day: a week out; nonsense dropped
    assert.deepEqual(Life.parseLifeTag('hi\n<Life_Update>new buy a gift by friday; new call mom; nonsense here; update nothing</Life_Update>', SAT).life, [
        { op: 'new', text: 'buy a gift', due: '2026-11-06', feeling: '' },
        { op: 'new', text: 'call mom', due: '2026-11-07', feeling: '' },
    ]);
    // A semicolon inside the brackets stays with its errand
    assert.deepEqual(Life.parseLifeTag('x\n<life>new 周六搬家 (due 2026-11-03; 嫌麻烦); happened 和好了</life>', SAT).life, [
        { op: 'new', text: '周六搬家', due: '2026-11-03', feeling: '嫌麻烦' },
        { op: 'happened', text: '和好了', date: '2026-10-31' },
    ]);
    assert.deepEqual(Life.parseLifeTag('fine\n<life>today none</life>', SAT), { text: 'fine', life: [{ op: 'today', date: '2026-10-31', text: '' }] });
    // Only junk inside: the line still goes, nothing reported
    assert.deepEqual(Life.parseLifeTag('a\n<life>whatever</life>', SAT), { text: 'a', life: null });
    assert.deepEqual(Life.parseLifeTag('just text', SAT), { text: 'just text', life: null });
});

test('reports replayed onto the life', () => {
    const t = (day, h) => new Date(2026, 9, day, h).getTime();
    const state = { startAt: t(30, 9), start: { errands: [{ id: 'e1', text: '周六搬家', due: '2026-10-31', progress: '打包了一半', from: 'you' }], log: [], today: null } };
    const reply = (time, life) => ({ is_user: false, mes: 'x', send_date: time, life });
    const history = [
        reply(t(29, 20), [{ op: 'done', name: '周六搬家' }]),   // before the start: no longer counts
        { is_user: true, mes: 'hi', send_date: t(30, 10) },
        reply(t(30, 11), [{ op: 'update', name: '搬家', progress: '打包完了' }, { op: 'new', text: '下周三考试', due: '2026-11-04', feeling: '' }]),
        reply(t(31, 12), [{ op: 'happened', text: '和小雨和好了', date: '2026-10-31' }, { op: 'today', date: '2026-10-31', text: '和你吃饭' },
            { op: 'new', text: '考试', due: '2026-11-05', feeling: '紧张' }]),
    ];
    const life = Life.currentLife(state, SAT, history);
    assert.deepEqual(life.errands.map(e => [e.text, e.progress, e.due, e.feeling, e.from]), [
        ['周六搬家', '打包完了', '2026-10-31', '', 'you'],
        // "考试" named the same errand: its day and feeling change, no second one
        ['下周三考试', '', '2026-11-05', '紧张', 'model'],
    ]);
    assert.deepEqual(life.log.map(e => e.text), ['和小雨和好了']);
    assert.equal(life.today.text, '和你吃饭');
    // The ids stay the same from one replay to the next
    assert.equal(Life.currentLife(state, SAT, history).errands[1].id, life.errands[1].id);
    // What the latest report touched
    assert.deepEqual(Life.lastLifeChange(state, history), [life.log[0].id, 'today', life.errands[1].id]);
    // A reply deleted (or another swipe without the report): its changes go
    assert.deepEqual(Life.currentLife(state, SAT, history.slice(0, 3)).errands.map(e => e.feeling), ['', '']);
    // done; no room past three
    const more = [...history, reply(t(31, 13), [{ op: 'done', name: '搬家' }, { op: 'new', text: 'a', due: '2026-11-01' },
        { op: 'new', text: 'b', due: '2026-11-01' }, { op: 'new', text: 'c', due: '2026-11-01' }])];
    assert.deepEqual(Life.currentLife(state, SAT, more).errands.map(e => e.text), ['下周三考试', 'a', 'b']);
    // An edit by hand after them: the start, with nothing replayed on top
    assert.equal(Life.currentLife({ ...state, startAt: t(31, 14) }, SAT, more).errands.length, 1);
    // Nothing edited by hand yet: every report counts
    assert.deepEqual(Life.currentLife(null, SAT, history).errands.map(e => e.text), ['下周三考试']);
});

test('finding the errand a report names', () => {
    const errands = [{ text: '周六搬家' }, { text: 'Finish the thesis draft' }, { text: '体检' }];
    assert.equal(Life.findErrand(errands, '周六 搬家！'), 0);
    assert.equal(Life.findErrand(errands, '搬家'), 0);
    assert.equal(Life.findErrand(errands, 'thesis draft'), 1);
    assert.equal(Life.findErrand(errands, 'finish thesis draft'), 1);
    assert.equal(Life.findErrand(errands, '买菜'), -1);
});

test('the rule for the <life> line', () => {
    const off = Life.lifeRules({ charName: 'Mira', userName: 'Qi' });
    assert.match(off, /^LIFE: /);
    assert.doesNotMatch(off, /2026/);
    assert.equal(Life.lifeDate(SAT), 'Today is 2026-10-31 (Saturday).');
    assert.match(off, /don't make up new ones/);
    assert.match(Life.lifeRules({ charName: 'Mira', userName: 'Qi', madeUp: true }), /now and then one of Mira's own/);
    assert.doesNotMatch(off, /[一-鿿]/);
});

test('the chance a busy or sleeping character notices, and when they look if not', () => {
    assert.equal(Life.noticeChance('free', 1), 1);
    assert.equal(Life.noticeChance(undefined, 1), 1);
    assert.deepEqual([1, 2, 3, 5].map(n => Math.round(Life.noticeChance('busy', n) * 100)), [35, 55, 75, 95]);
    assert.deepEqual([1, 2, 3, 7, 9].map(n => Math.round(Life.noticeChance('asleep', n) * 100)), [10, 25, 40, 90, 90]);
    const s = Life.parseSchedule(STANDARD);
    // Ends of blocks: today's, one running past midnight from tonight and from last night
    assert.equal(Life.blockEndAt(s, at(26, 10)).getTime(), at(26, 18).getTime());
    assert.equal(Life.blockEndAt(s, at(27, 23, 45)).getTime(), at(28, 7).getTime());
    assert.equal(Life.blockEndAt(s, at(27, 3)).getTime(), at(27, 7).getTime());
    assert.equal(Life.blockEndAt(s, at(26, 19)), null);
    // Rolls: below the chance, they see it; else busy looks 3–10 minutes later, asleep once awake
    const rolls = (...values) => () => values.shift();
    assert.equal(Life.unseenUntil({ schedule: s, date: at(26, 10), unread: 1, random: rolls(0.3) }), null);
    assert.equal(Life.unseenUntil({ schedule: s, date: at(26, 10), unread: 1, random: rolls(0.5, 0) }), at(26, 10, 3).getTime());
    assert.equal(Life.unseenUntil({ schedule: s, date: at(26, 10), unread: 1, random: rolls(0.5, 1) }), at(26, 10, 10).getTime());
    assert.equal(Life.unseenUntil({ schedule: s, date: at(26, 10), unread: 5, random: rolls(0.9) }), null);
    assert.equal(Life.unseenUntil({ schedule: s, date: at(27, 3), unread: 1, random: rolls(0.5, 0) }), at(27, 7).getTime());
    assert.equal(Life.unseenUntil({ schedule: s, date: at(27, 3), unread: 1, random: rolls(0.5, 1) }), at(27, 7, 15).getTime());
    // Free, or between blocks: always seen
    assert.equal(Life.unseenUntil({ schedule: s, date: at(26, 19), unread: 1, random: rolls(0.99) }), null);
});

const times = blocks => blocks.map(b => `${b.from}-${b.to} ${b.doing}`);

test('a block edited by hand keeps its time: others are cut, split or dropped', () => {
    const s = Life.normalizeSchedule({ weekday: [{ from: '09:00', to: '18:00', doing: '上班', phone: 'busy' }] });
    // Partly over it: cut back
    assert.deepEqual(times(Life.withBlock(s, 'weekday', -1, { from: '17:00', to: '19:00', doing: '健身' }).weekday), ['09:00-17:00 上班', '17:00-19:00 健身']);
    assert.deepEqual(times(Life.withBlock(s, 'weekday', -1, { from: '08:00', to: '10:00', doing: '通勤' }).weekday), ['08:00-10:00 通勤', '10:00-18:00 上班']);
    // All of it: gone
    assert.deepEqual(times(Life.withBlock(s, 'weekday', -1, { from: '08:00', to: '19:00', doing: '出差' }).weekday), ['08:00-19:00 出差']);
    // Inside it: split around, the pieces keep what they were
    const split = Life.withBlock(s, 'weekday', -1, { from: '12:00', to: '13:00', doing: '午饭' }).weekday;
    assert.deepEqual(times(split), ['09:00-12:00 上班', '12:00-13:00 午饭', '13:00-18:00 上班']);
    assert.equal(split[2].phone, 'busy');
    // Lengthening a block over a later one: the edited block wins even though it began first
    const both = Life.normalizeSchedule({ weekday: [{ from: '09:00', to: '18:00', doing: '上班' }, { from: '19:30', to: '21:00', doing: '健身' }] });
    assert.deepEqual(times(Life.withBlock(both, 'weekday', 0, { from: '09:00', to: '20:00', doing: '加班' }).weekday), ['09:00-20:00 加班', '20:00-21:00 健身']);
    // What's left under 5 minutes goes too
    assert.deepEqual(times(Life.withBlock(s, 'weekday', -1, { from: '09:03', to: '18:00', doing: '会' }).weekday), ['09:03-18:00 会']);
});

test('the night meets the next weekday morning; weekends nights run into another list', () => {
    const s = Life.normalizeSchedule({ weekday: [{ from: '07:00', to: '08:30', doing: '早饭' }, { from: '23:30', to: '07:00', doing: '睡觉', phone: 'asleep' }] });
    // Sleep lengthened into breakfast: breakfast starts later
    assert.deepEqual(times(Life.withBlock(s, 'weekday', 1, { from: '23:30', to: '08:00', doing: '睡觉', phone: 'asleep' }).weekday),
        ['08:00-08:30 早饭', '23:30-08:00 睡觉']);
    // A run added at 06:00: the night ends there
    assert.deepEqual(times(Life.withBlock(s, 'weekday', -1, { from: '06:00', to: '07:00', doing: '晨跑' }).weekday),
        ['06:00-07:00 晨跑', '07:00-08:30 早饭', '23:30-06:00 睡觉']);
    // Saturday: its early hours (Friday night's end) and its own night (into Sunday) don't meet
    const sat = Life.normalizeSchedule({ saturday: [{ from: '01:00', to: '10:00', doing: '睡懒觉' }, { from: '23:30', to: '08:00', doing: '睡觉' }] });
    assert.deepEqual(times(sat.saturday), ['01:00-10:00 睡懒觉', '23:30-08:00 睡觉']);
});

test('a schedule that overlaps (written so, or by the model): the later-begun keeps the time', () => {
    const s = Life.normalizeSchedule({ weekday: [
        { from: '22:00', to: '01:00', doing: '打游戏', phone: 'free' },
        { from: '23:00', to: '07:00', doing: '睡觉', phone: 'asleep' },
        { from: '06:00', to: '08:00', doing: '晨跑', phone: 'free' },
        { from: '09:00', to: '18:00', doing: '上班', phone: 'busy' },
        { from: '12:00', to: '13:00', doing: '午饭', phone: 'free' },
        { from: '12:00', to: '13:00', doing: '午饭（重复）', phone: 'free' },
    ] });
    assert.deepEqual(times(s.weekday), ['06:00-08:00 晨跑', '09:00-12:00 上班', '12:00-13:00 午饭（重复）', '13:00-18:00 上班', '22:00-23:00 打游戏', '23:00-06:00 睡觉']);
    // Looked up through the night: asleep from 23:00 until the run (it used to wake for the game at 00:30)
    const doing = (h, m = 0) => Life.blockAt(s, at(27, h, m))?.block.doing;
    assert.deepEqual([doing(22, 30), doing(23, 30), doing(0, 30), doing(3), doing(6, 30)], ['打游戏', '睡觉', '睡觉', '睡觉', '晨跑']);
    assert.equal(Life.blockEndAt(s, at(27, 3)).getTime(), at(27, 6).getTime());
});

test('waking up ends where the next block begins, across lists too', () => {
    // Friday night (weekdays) runs to 07:00, but Saturday starts at 06:00
    const s = Life.normalizeSchedule({ weekday: [{ from: '23:30', to: '07:00', doing: '睡觉', phone: 'asleep' }],
        saturday: [{ from: '06:00', to: '09:00', doing: '钓鱼', phone: 'free' }] });
    assert.equal(Life.blockAt(s, at(31, 3)).block.doing, '睡觉');
    assert.equal(Life.blockEndAt(s, at(31, 3)).getTime(), at(31, 6).getTime());
    assert.equal(Life.blockAt(s, at(31, 6, 30)).block.doing, '钓鱼');
});

test('where a time sits in the week: the stretch since when, and what came before', () => {
    const s = Life.parseSchedule(STANDARD);
    const at2 = (d, h, m = 0) => at(d, h, m).getTime();
    // At work since 09:00, after the morning
    let r = Life.blockAt(s, at(26, 10)) && Life.currentStretch(s, at(26, 10));
    assert.deepEqual([r.block.doing, r.since.getTime(), r.prev], ['上班', at2(26, 9), null]);
    // Between blocks: free since work ended; work came before
    r = Life.currentStretch(s, at(26, 18, 20));
    assert.deepEqual([r.block, r.since.getTime(), r.prev.doing], [null, at2(26, 18), '上班']);
    // Up at 07:00 after last night's sleep (which began the day before)
    r = Life.currentStretch(s, at(27, 7, 10));
    assert.deepEqual([r.block.doing, r.since.getTime(), r.prev.doing], ['起床洗漱', at2(27, 7), '睡觉']);
    // Asleep since 23:30 yesterday
    r = Life.currentStretch(s, at(27, 3));
    assert.deepEqual([r.block.doing, r.since.getTime()], ['睡觉', at2(26, 23, 30)]);
    assert.deepEqual(Life.currentStretch(Life.normalizeSchedule(null), at(26, 10)), { block: null, since: null, prev: null });
});

test('a change of plan by hand: made until the next time, held from when it was made until then', () => {
    // 23:00 Monday, until 01:00: tonight; until 22:00: tomorrow night
    const plan = Life.makeOverride('free', '01:00', at(26, 23));
    assert.deepEqual(plan, { phone: 'free', from: at(26, 23).getTime(), until: at(27, 1).getTime() });
    assert.equal(Life.makeOverride('free', '22:00', at(26, 23)).until, at(27, 22).getTime());
    assert.equal(Life.makeOverride('free', '01:00', at(26, 23), 5).from, 5);
    assert.equal(Life.makeOverride('dancing', '01:00', at(26, 23)), null);
    assert.equal(Life.makeOverride('free', '1am', at(26, 23)), null);
    assert.deepEqual(Life.activeOverride(plan, at(27, 0, 30)), plan);
    assert.equal(Life.activeOverride(plan, at(27, 1)), null);
    assert.equal(Life.activeOverride(plan, at(26, 22)), null);
    assert.equal(Life.activeOverride(null, at(27, 0)), null);
    assert.equal(Life.activeOverride({ phone: 'free', until: at(27, 1).getTime() }, at(27, 0)), null);
});

test('the phone now: a change of plan by hand, then still texting, then the schedule', () => {
    const s = Life.parseSchedule(STANDARD);
    const ms = (...a) => at(...a).getTime();
    // The schedule: asleep 23:30–07:00, free between blocks
    assert.deepEqual(Life.phoneAt({ schedule: s, date: at(27, 0) }), { phone: 'asleep', endsAt: ms(27, 7), by: 'schedule' });
    assert.deepEqual(Life.phoneAt({ schedule: s, date: at(26, 19) }), { phone: 'free', endsAt: ms(26, 23, 30), by: 'schedule' });
    assert.deepEqual(Life.phoneAt({ schedule: null, date: at(26, 19) }), { phone: 'free', endsAt: null, by: 'schedule' });
    // Answered under 10 minutes ago: still up
    assert.deepEqual(Life.phoneAt({ schedule: s, date: at(27, 0), repliedAt: ms(26, 23, 55) }), { phone: 'free', endsAt: ms(27, 0, 5), by: 'texting' });
    assert.equal(Life.phoneAt({ schedule: s, date: at(27, 0), repliedAt: ms(26, 23, 50) }).phone, 'asleep');
    assert.equal(Life.phoneAt({ schedule: s, date: at(26, 10), repliedAt: ms(26, 9, 58) }).by, 'texting');
    // By hand wins, even over texting; then back to the schedule
    const late = Life.makeOverride('free', '01:00', at(26, 23));
    assert.deepEqual(Life.phoneAt({ schedule: s, override: late, date: at(27, 0) }), { phone: 'free', endsAt: ms(27, 1), by: 'plan' });
    const nap = Life.makeOverride('asleep', '15:00', at(31, 13));
    assert.equal(Life.phoneAt({ schedule: s, override: nap, date: at(31, 14), repliedAt: ms(31, 13, 58) }).phone, 'asleep');
    assert.equal(Life.phoneAt({ schedule: s, override: late, date: at(27, 1) }).phone, 'asleep');
    // When it gives way: up till 01:00, then the schedule's sleep; asleep by hand into the schedule's sleep goes on with it
    assert.equal(Life.phoneEndsAt({ schedule: s, override: late, date: at(27, 0) }), ms(27, 1));
    assert.equal(Life.phoneEndsAt({ schedule: s, date: at(27, 0) }), ms(27, 7));
    assert.equal(Life.phoneEndsAt({ schedule: s, override: Life.makeOverride('asleep', '01:00', at(26, 22)), date: at(26, 22) }), ms(27, 7));
    assert.equal(Life.phoneEndsAt({ schedule: null, date: at(26, 22) }), null);
});

test('a sleeping character still texting, or up by hand, sees your texts; asleep by hand, they wake when it ends', () => {
    const s = Life.parseSchedule(STANDARD);
    const ms = (...a) => at(...a).getTime();
    const rolls = (...values) => () => values.shift();
    // Bedtime came mid-conversation: no roll while they answered under 10 minutes ago
    assert.equal(Life.unseenUntil({ schedule: s, date: at(26, 23, 35), unread: 1, repliedAt: ms(26, 23, 30), random: rolls(0.99) }), null);
    assert.equal(Life.unseenUntil({ schedule: s, date: at(26, 23, 45), unread: 1, repliedAt: ms(26, 23, 30), random: rolls(0.5, 0) }), ms(27, 7));
    // Up till 01:00 by hand
    const late = Life.makeOverride('free', '01:00', at(26, 23));
    assert.equal(Life.unseenUntil({ schedule: s, override: late, date: at(27, 0, 30), unread: 1, random: rolls(0.99) }), null);
    // A nap by hand on a free afternoon: they look once it's over
    const nap = Life.makeOverride('asleep', '15:00', at(31, 13));
    assert.equal(Life.unseenUntil({ schedule: s, override: nap, date: at(31, 14), unread: 1, random: rolls(0.5, 0) }), ms(31, 15));
    // Busy by hand: a few minutes later
    const busy = Life.makeOverride('busy', '17:00', at(31, 13));
    assert.equal(Life.unseenUntil({ schedule: s, override: busy, date: at(31, 14), unread: 1, random: rolls(0.5, 0) }), ms(31, 14, 3));
});

test('when the character last answered: not their own texts, nor yours', () => {
    const t = (h, m) => at(26, h, m).getTime();
    assert.equal(Life.lastReplyAt([
        { is_user: false, mes: 'hi', send_date: t(22, 0) },
        { is_user: true, mes: 'yo', send_date: t(22, 5) },
        { is_user: false, mes: 'sup', send_date: t(22, 6) },
        { is_user: false, mes: 'u there?', send_date: t(22, 40), meta: { proactive: true, proactiveType: 'follow_up' } },
        { is_user: true, mes: 'back', send_date: t(23, 0) },
    ]), t(22, 6));
    assert.equal(Life.lastReplyAt([{ is_user: true, send_date: t(22, 0) }]), null);
    assert.equal(Life.lastReplyAt(null), null);
});

test('a change of plan by hand in the prompt', () => {
    const s = Life.parseSchedule(STANDARD);
    const up = Life.describeNow({ schedule: s, date: at(27, 0), charName: 'Mira', override: Life.makeOverride('free', '01:00', at(26, 23)) });
    assert.match(up, /Right now \(23:30–07:00\): 睡觉, at 家\.\nUntil 01:00, a change of plan: Mira is up and free to look at the phone and text, whatever the schedule says\.\n/);
    assert.doesNotMatch(up, /time to sleep/);
    const nap = Life.describeNow({ schedule: s, date: at(26, 19), charName: 'Mira', override: Life.makeOverride('asleep', '20:00', at(26, 19)) });
    assert.match(nap, /Right now: nothing in particular\.\nUntil 20:00, a change of plan: Mira is asleep: if Mira is texting now, something woke Mira up\.\nNext/);
    // Run out: as without
    assert.equal(Life.describeNow({ schedule: s, date: at(27, 2), charName: 'Mira', override: Life.makeOverride('free', '01:00', at(26, 23)) }),
        Life.describeNow({ schedule: s, date: at(27, 2), charName: 'Mira' }));
});

test('what the life lets go of: errands done before you texted after them, what happened past the week', () => {
    const t = (d, h) => at(d, h).getTime();
    const state = { startAt: 0, start: {
        errands: [{ id: 'e1', text: '周六搬家', progress: '打包了一半', due: '2026-10-31' }, { id: 'e2', text: '体检', due: '2026-11-02' }],
        log: [{ id: 'l1', date: '2026-10-20', text: '加班到十点' }, { id: 'l2', date: '2026-10-25', text: '和小雨和好了' }, { id: 'l3', date: '2026-10-30', text: '买了新鞋' }],
        today: null,
    } };
    const history = [
        { is_user: true, mes: '搬完了吗', send_date: t(31, 18) },
        { is_user: false, mes: '搬完了！', send_date: t(31, 19), life: [{ op: 'update', name: '搬家', progress: '搬完了' }, { op: 'done', name: '周六搬家' }] },
        { is_user: false, mes: '体检取消了', send_date: t(31, 21), life: [{ op: 'done', name: '体检' }] },
    ];
    // Nov 1: you texted at 20:00, so only the move is settled; Oct 20 and 25 are past the week
    const user = t(31, 20);
    const gone = Life.lettingGo(state, history, at(32, 10), { settledBefore: user });
    assert.deepEqual(gone.done.map(e => [e.id, e.progress, e.date]), [['e1', '搬完了', '2026-10-31']]);
    assert.deepEqual(gone.expired.map(e => e.id), ['l1', 'l2']);
    // Everything, as an edit by hand or a catch-up settles it; a catch-up's own report too
    const all = Life.lettingGo(state, history, at(32, 10), { changes: [{ op: 'happened', date: '2026-10-21', text: '感冒了' }] });
    assert.deepEqual(all.done.map(e => e.id), ['e1', 'e2']);
    assert.deepEqual(all.expired.map(e => e.text), ['加班到十点', '感冒了', '和小雨和好了']);
    assert.deepEqual(Life.lettingGo(null, [], at(32, 10)), { done: [], expired: [] });
    // A report before the life was edited by hand no longer counts
    assert.deepEqual(Life.lettingGo({ ...state, startAt: t(31, 22) }, history, at(32, 10)).done, []);
});

test('what the life lets go of, as memories', () => {
    assert.equal(Life.weekOf('2026-11-01'), '2026-10-26');
    assert.equal(Life.weekOf('2026-10-26'), '2026-10-26');
    assert.equal(Life.weekOf('2026-10-25'), '2026-10-19');
    assert.deepEqual(Life.errandMemory({ text: '周六搬家', progress: '搬完了', date: '2026-10-31' }, 'Mira'),
        { label: '周六搬家', content: 'Mira\'s errand "周六搬家" came to an end on 2026-10-31: 搬完了.' });
    assert.equal(Life.errandMemory({ text: '体检', progress: '', date: '2026-10-31' }, 'Mira').content, 'Mira\'s errand "体检" came to an end on 2026-10-31.');
    assert.deepEqual(Life.weekMemory('2026-10-19', [{ date: '2026-10-25', text: '和小雨和好了' }, { date: '2026-10-20', text: '加班到十点' }], 'Mira'),
        { label: 'Week of 2026-10-19', content: 'What happened to Mira the week of 2026-10-19: 加班到十点 (10-20); 和小雨和好了 (10-25).' });
});

// ── With you (13a) ──────────────────────────────────────────────────────

const WEEK_BUSY = { weekday: [{ from: '09:00', to: '18:00', place: '公司', doing: '上班', phone: 'busy' }, { from: '23:30', to: '07:00', place: '家', doing: '睡觉', phone: 'asleep' }] };

test('with you is a change of plan, never part of a schedule', () => {
    assert.deepEqual(Life.PHONE_IDS, ['free', 'busy', 'asleep']);
    assert.equal(Life.PLAN_PHONES.at(-1).id, 'together');
    assert.equal(Life.parseSchedule('weekday 09:00-18:00 | 家 | 陪他 | together').weekday[0].phone, 'free');
    assert.equal(Life.normalizeSchedule({ weekday: [{ from: '09:00', to: '10:00', doing: 'x', phone: 'together' }] }).weekday[0].phone, 'free');
    const plan = Life.makeOverride('together', '01:30', at(26, 22));
    assert.deepEqual(plan, { phone: 'together', from: at(26, 22).getTime(), until: at(27, 1, 30).getTime() });
    assert.equal(Life.activeOverride(plan, at(26, 23)).phone, 'together');
    assert.equal(Life.activeOverride(plan, at(27, 2)), null);
    assert.equal(Life.makeOverride('dancing', '01:30', at(26, 22)), null);
});

test('with you, they see every text and their phone is theirs till it ends', () => {
    const override = Life.makeOverride('together', '12:00', at(26, 10));
    const phone = Life.phoneAt({ schedule: WEEK_BUSY, override, date: at(26, 11) });
    assert.deepEqual(phone, { phone: 'together', endsAt: at(26, 12).getTime(), by: 'plan' });
    assert.equal(Life.noticeChance('together', 1), 1);
    assert.equal(Life.unseenUntil({ schedule: WEEK_BUSY, override, date: at(26, 11), unread: 1, random: () => 0.999 }), null);
    assert.equal(Life.phoneEndsAt({ schedule: WEEK_BUSY, override, date: at(26, 11) }), at(26, 12).getTime());
    // Back to the schedule after
    assert.equal(Life.phoneAt({ schedule: WEEK_BUSY, override, date: at(26, 13) }).phone, 'busy');
});

test('the prompt has them together, not in the block, and what comes after it', () => {
    const date = at(26, 10);
    const override = Life.makeOverride('together', '19:00', date);
    const text = Life.describeNow({ schedule: WEEK_BUSY, date: at(26, 11), charName: 'Mira', userName: 'Qi', override,
        life: { errands: [], log: [], today: { date: '2026-10-26', text: '去看电影' } } });
    assert.match(text, /Right now Mira is with Qi in person \(since 10:00, until around 19:00\)/);
    assert.match(text, /answer as if Qi is right there/);
    assert.match(text, /Today, unlike usual \(this wins over the plan above\): 去看电影/);
    // Not the block they'd have been in, nor the first thing after now that's inside the time together
    assert.doesNotMatch(text, /上班/);
    assert.doesNotMatch(text, /a change of plan/);
    assert.match(text, /Next \(from 23:30\): 睡觉, at 家/);
    // Done: as before
    const after = Life.describeNow({ schedule: WEEK_BUSY, date: at(26, 20), charName: 'Mira', userName: 'Qi', override });
    assert.doesNotMatch(after, /in person/);
    // The other changes of plan read as they did
    const free = Life.describeNow({ schedule: WEEK_BUSY, date: at(26, 11), charName: 'Mira', override: Life.makeOverride('free', '12:00', date) });
    assert.match(free, /Right now \(09:00–18:00\): 上班, at 公司\./);
    assert.match(free, /Until 12:00, a change of plan: Mira is up and free/);
});

test('a note in the life start leaves the reports and their replay as they were', () => {
    const state = { start: { errands: [], log: [], today: null }, startAt: 500, settledAt: 400 };
    const entry = { id: 'with1', date: '2026-10-26', text: 'With Qi (19:30–22:30)' };
    const noted = Life.noteInStart(state, entry);
    assert.equal(noted.startAt, 500);
    assert.equal(noted.settledAt, 400);
    const history = [{ is_user: false, send_date: 1000, life: [{ op: 'happened', text: '下雨了', date: '2026-10-26' }] }];
    assert.deepEqual(Life.currentLife(noted, at(26, 23), history).log.map(e => e.text), ['With Qi (19:30–22:30)', '下雨了']);
    // Under the same id it takes the place of what's there
    const better = Life.noteInStart(noted, { ...entry, text: '和 Qi 去看了电影' });
    assert.deepEqual(better.start.log.map(e => e.text), ['和 Qi 去看了电影']);
    // With no life yet
    assert.deepEqual(Life.noteInStart(undefined, entry).start.log.map(e => e.id), ['with1']);
});

test('time together in a sentence', () => {
    const span = { userName: 'Qi', from: at(26, 14).getTime(), until: at(26, 17, 30).getTime() };
    assert.equal(Life.togetherEntry(span), '14:00–17:30 With Qi');
    assert.equal(Life.togetherEntry({ ...span, text: '和 Qi 去看了电影' }), '14:00–17:30 和 Qi 去看了电影');
    const { systemPrompt, prompt } = Life.buildTogetherRequest({ charName: 'Mira', userName: 'Qi', story: 'Qi: 走吧' });
    assert.match(systemPrompt, /what they did together, naming Qi: no heading, no quotes, no date or time/);
    assert.match(systemPrompt, /Write nothing else/);
    assert.doesNotMatch(systemPrompt, /feeling/);
    const auto = Life.buildTogetherRequest({ charName: 'Mira', userName: 'Qi', story: 'Qi: 走吧', moodRule: '\n\nMOOD: the rule' }).systemPrompt;
    assert.match(auto, /Then report how this time left Mira feeling, the story being Qi's latest messages:\nMOOD: the rule$/);
    assert.doesNotMatch(auto, /Write nothing else/);
    assert.equal(prompt, '<story>\nQi: 走吧\n</story>');
    assert.equal(Life.cleanTogetherEntry('和 Qi 去看了电影'), '和 Qi 去看了电影');
    assert.equal(Life.cleanTogetherEntry('\n"和 Qi 去看了电影。"\n还有别的'), '和 Qi 去看了电影。');
    assert.equal(Life.cleanTogetherEntry('Summary: 「和 Qi 吃了饭」'), '和 Qi 吃了饭');
    assert.equal(Life.cleanTogetherEntry('   '), '');
});
