// Run: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = {};
new Function(readFileSync(new URL('../lib/proactive-rounds.js', import.meta.url), 'utf8'))();
const R = window.EchoTextProactiveRounds;

const MIN = 60000;
const T0 = new Date(2026, 9, 31, 20, 0).getTime();
const fixed = v => () => v;
const minutesAfter = times => times.map(t => Math.round((t - T0) / MIN * 10) / 10);

test('four temperaments, Normal by default; the Big Five suggest one, never Obsessed', () => {
    assert.deepEqual(R.TEMPERAMENT_IDS, ['aloof', 'normal', 'clingy', 'obsessed']);
    assert.equal(R.temperamentOf('nonsense').id, 'normal');
    assert.equal(R.defaultTemperament({ E: 'high', N: 'high' }), 'clingy');
    assert.equal(R.defaultTemperament({ E: 'low', N: 'high' }), 'aloof');
    assert.equal(R.defaultTemperament({ E: 'high', N: 'mid' }), 'normal');
    assert.equal(R.defaultTemperament(undefined), 'normal');
});

test('the wait before her next text: the base wait times the growth once per unanswered one, the feelings stretching it', () => {
    // random 0.5: the middle of the base, no jitter
    const minutes = (temperament, unanswered, pace = 1) => R.waitMs({ temperament, unanswered, pace, random: fixed(0.5) }) / MIN;
    assert.deepEqual([0, 1, 2, 3].map(n => minutes('normal', n)), [40, 120, 360, 1080]);
    assert.deepEqual([0, 1, 2, 3].map(n => minutes('clingy', n)), [6.5, 13, 26, 52]);
    assert.deepEqual([0, 1, 2].map(n => minutes('aloof', n)), [120, 480, 1920]);
    assert.equal(minutes('obsessed', 0), 1.25);
    assert.ok(Math.abs(minutes('obsessed', 4) - 1.25 * 1.5 ** 4) < 0.001);
    // The feelings' pace
    assert.equal(minutes('normal', 0, 1.4), 56);
    // random 0 and 1: the base's ends, a fifth either way
    assert.equal(R.waitMs({ temperament: 'normal', random: fixed(0) }) / MIN, 16);
    assert.equal(R.waitMs({ temperament: 'normal', random: fixed(0.999999) }) / MIN > 71, true);
    // Never closer than 30 seconds
    assert.equal(R.waitMs({ temperament: 'obsessed', pace: 0.1, random: fixed(0) }), R.MIN_GAP_MS);
    // Two numbers a temperament: nothing else
    for (const t of R.TEMPERAMENTS) assert.deepEqual(Object.keys(t).sort(), ['baseMinutes', 'growth', 'id', 'label', 'partedChance', 'partedMinutes']);
});

test('the two numbers as you set them: kept in range, the rest of the temperament as it was', () => {
    const own = { normal: { baseMinutes: [5, 10], growth: 2 } };
    assert.deepEqual(R.temperamentOf('normal', own).baseMinutes, [5, 10]);
    assert.equal(R.temperamentOf('normal', own).growth, 2);
    assert.equal(R.temperamentOf('normal', own).partedChance, 0.7);
    assert.equal(R.temperamentOf('clingy', own).growth, 2);
    assert.equal(R.waitMs({ temperament: 'normal', overrides: own, unanswered: 2, random: () => 0.5 }) / MIN, 30);
    // Out of range: the start at least 0.1, the end no earlier than the start, growth at least 1; what's missing, the default
    assert.deepEqual(R.cleanParams({ baseMinutes: [-3, -1], growth: 0.5 }), { baseMinutes: [0.1, 0.1], growth: 1 });
    assert.deepEqual(R.cleanParams({ baseMinutes: [30, 10] }), { baseMinutes: [30, 30], growth: 3 });
    assert.deepEqual(R.cleanParams({ baseMinutes: ['', 'x'], growth: '' }), { baseMinutes: [20, 60], growth: 3 });
});

test('what the model is told for each of her texts: how many are unanswered, the time and the schedule\'s line, a fresh decision, what may be on her mind', () => {
    const t = (h, m = 0) => new Date(2026, 9, 31, h, m).getTime();
    const first = R.outreachInstruction({ charName: 'Mira', userName: 'Qi', unanswered: 1, now: t(20, 6), lastAt: t(20), doing: '18:00–21:00 逛街 (城里)',
        material: 'You just thought of Qi.', media: 'If it feels natural, send a <photo>.', format: 'Reply only with what Mira sends now.' });
    assert.equal(first, "Qi hasn't replied to Mira's last text. Mira texts Qi now (it is 20:06, 6 minutes after Mira's last one · 18:00–21:00 逛街 (城里)). "
        + 'It is a fresh decision Mira makes now. '
        + "What Mira brings up and how Mira says it come from who Mira is: Mira's age and stage of life, personality, outlook, interests, and what's going on in Mira's life. "
        + "You just thought of Qi. If it feels natural, send a <photo>. Reply only with what Mira sends now.");
    const third = R.outreachInstruction({ charName: 'Mira', userName: 'Qi', unanswered: 3, now: t(22), lastAt: t(20, 45) });
    assert.match(third, /^Qi hasn't replied to Mira's last 3 texts\. Mira texts Qi now \(it is 22:00, an hour after Mira's last one\)\. It is a fresh decision Mira makes now\. /);
    // That they're unanswered is said once
    assert.equal(third.match(/hasn't replied/g).length, 1);
    assert.doesNotMatch(third, /unanswered/);
    assert.doesNotMatch(third, /on Mira's mind/);
    // Said with or without a topic
    assert.match(third, /What Mira brings up and how Mira says it come from who Mira is/);
    // Days are said as days
    assert.match(R.outreachInstruction({ now: t(20) + 3 * 24 * 60 * MIN, lastAt: t(20) }), /3 days after/);
});

test('a catch-up\'s texts: how they\'re written, said once', () => {
    const guide = R.catchUpGuidance({ charName: 'Mira', userName: 'Qi' });
    assert.match(guide, /^They were sent one after another\. Each is a fresh decision Mira made at its own time: /);
    // Not said again that you didn't reply, no choice of what it's about: that's the topic's
    assert.doesNotMatch(guide, /reply|unanswered|silence|if it fits/);
    assert.match(guide, /not chapters of a planned emotional arc/);
    assert.match(guide, /not chapters of a planned emotional arc\. What Mira brings up and how Mira says it come from who Mira is: .+, and what's going on in Mira's life\.$/);
    assert.equal(guide.match(/come from who Mira is/g).length, 1);
});

test('just got free: within half an hour of a busy or sleeping stretch ending', () => {
    const now = T0;
    assert.equal(R.justGotFree({ phone: 'free', prevPhone: 'busy', since: now - 10 * MIN, now }), true);
    assert.equal(R.justGotFree({ phone: 'free', prevPhone: 'asleep', since: now - 30 * MIN, now }), true);
    assert.equal(R.justGotFree({ phone: 'free', prevPhone: 'busy', since: now - 31 * MIN, now }), false);
    assert.equal(R.justGotFree({ phone: 'free', prevPhone: 'free', since: now - 5 * MIN, now }), false);
    assert.equal(R.justGotFree({ phone: 'busy', prevPhone: 'asleep', since: now - 5 * MIN, now }), false);
});

test('texted around when a stretch ended: from half an hour before it on', () => {
    const since = T0;
    assert.equal(R.textedAround({ since, lastTextAt: since + 5 * MIN }), true);
    assert.equal(R.textedAround({ since, lastTextAt: since - 30 * MIN }), true);
    assert.equal(R.textedAround({ since, lastTextAt: since - 31 * MIN }), false);
    assert.equal(R.textedAround({ since, lastTextAt: -Infinity }), false);
    assert.equal(R.textedAround({ since: null, lastTextAt: since }), false);
});

test('topics from the character\'s own day', () => {
    const say = (d, today) => (d === today ? 'today' : d === '2026-11-01' ? 'tomorrow' : d);
    const day = {
        justFree: true, prevDoing: '上班', block: { doing: '回家路上', place: '地铁' }, today: '2026-10-31',
        life: {
            errands: [{ text: '交论文', progress: '', due: '2026-11-05' }, { text: '周日搬家', progress: '打包了一半', due: '2026-11-01' }],
            log: [{ date: '2026-10-30', text: '昨天的事' }, { date: '2026-10-31', text: '中午和小雨和好了' }], today: null,
        },
    };
    assert.deepEqual(R.lifeTopics({ day, sayDay: say }), [
        { type: 'block_change', weight: 70, detail: '上班 is over; now: 回家路上' },
        { type: 'errand', weight: 65, detail: '周日搬家 (打包了一半), due tomorrow' },
        { type: 'life_event', weight: 55, detail: '中午和小雨和好了' },
    ]);
    // Not just free, nothing due by tomorrow, today's change of plans first
    const quiet = { ...day, justFree: false, life: { errands: [{ text: 'x', due: '2026-11-05' }], log: [], today: { date: '2026-10-31', text: '今晚和你吃饭' } } };
    assert.deepEqual(R.lifeTopics({ day: quiet, sayDay: say }), [{ type: 'life_event', weight: 55, detail: "today's change of plans: 今晚和你吃饭" }]);
    assert.deepEqual(R.lifeTopics({ day: null }), []);
    // Overdue still counts
    const late = { ...quiet, life: { errands: [{ text: '交房租', due: '2026-10-29' }], log: [], today: null } };
    assert.equal(R.lifeTopics({ day: late, sayDay: say })[0].detail, '交房租, was due 2026-10-29');
});

test('what the model is told for a topic', () => {
    const t = (type, detail) => R.topicInstruction({ type, detail, charName: 'Mira', userName: 'Qi' });
    assert.equal(t('block_change', '上班 is over'), "Mira just got free: 上班 is over. Text Qi about what Mira just did or what's next.");
    assert.match(t('errand', 'x'), /^On Mira's mind: x\. Tell Qi/);
    assert.match(t('life_event', 'x'), /^Something from Mira's day: x\./);
});

test('after time together: when they text, by temperament, and what the model is told', () => {
    const end = 1000000;
    const minutes = (temperament, roll) => (R.partedAt({ temperament, endedAt: end, random: () => roll }) - end) / 60000;
    assert.equal(minutes('clingy', 0), 10);
    assert.equal(minutes('clingy', 0.999) <= 20, true);
    assert.equal(minutes('obsessed', 0), 10);
    assert.equal(minutes('normal', 0), 15);
    assert.equal(minutes('aloof', 0), 20);
    for (const t of R.TEMPERAMENTS) assert.ok(t.partedMinutes[0] >= 10 && t.partedMinutes[1] <= 30, t.id);
    // Some let it go
    assert.equal(R.partedAt({ temperament: 'aloof', endedAt: end, random: () => 0.5 }), null);
    assert.equal(R.partedAt({ temperament: 'normal', endedAt: end, random: () => 0.8 }), null);
    assert.notEqual(R.partedAt({ temperament: 'clingy', endedAt: end, random: () => 0.999 }), null);
    const told = R.topicInstruction({ type: 'parted', charName: 'Mira', userName: 'Qi' });
    assert.match(told, /Mira and Qi were together in person and have just parted/);
    assert.doesNotMatch(told, /since Qi last texted/);
    assert.ok(R.LIFE_TRIGGERS.includes('parted'));
});

// ── New topics: the six kinds (docs/platform-plan.md 12f) ───────────────────

const AFTERNOON = new Date(2026, 10, 3, 15, 0); // a Tuesday
const kindsAt = (over = {}) => R.topicKinds({ feelings: {}, hoursSinceUser: 5, now: AFTERNOON, ...over });
const kind = (kinds, id) => kinds.find(k => k.id === id);
const typesOf = (kinds, id) => kind(kinds, id).topics.map(t => t.type);

test('each kind and when it can be picked', () => {
    const calm = kindsAt();
    assert.deepEqual(calm.map(k => k.id), ['life', 'you', 'share', 'callback', 'mood', 'gap']);
    // Thinking of you: Rapport 20 and up
    assert.equal(kind(calm, 'you').why, 'Rapport 0, needs 20');
    // Rapport 20 but no shared moment or inside joke in the memories: nothing to bring up
    assert.deepEqual(typesOf(kindsAt({ feelings: { rapport: 20 } }), 'you'), []);
    assert.equal(kind(kindsAt({ feelings: { rapport: 20 } }), 'you').why, 'No Shared Moment or Inside Joke memory to bring up');
    // Sharing: always; dreams only in the morning, boredom when little is going on, pride with anticipation and joy
    assert.ok(kind(calm, 'share').ok);
    assert.ok(!typesOf(calm, 'share').includes('dream_mention'));
    assert.ok(typesOf(kindsAt({ now: new Date(2026, 10, 3, 8, 0) }), 'share').includes('dream_mention'));
    assert.ok(typesOf(calm, 'share').includes('boredom_break'));
    assert.ok(!typesOf(kindsAt({ feelings: { joy: 90, anticipation: 70 } }), 'share').includes('boredom_break'));
    assert.ok(typesOf(kindsAt({ feelings: { joy: 40, anticipation: 70 } }), 'share').includes('pride_share'));
    // Picking up: your last text 2–48 hours ago
    assert.ok(kind(calm, 'callback').ok);
    assert.equal(kind(kindsAt({ hoursSinceUser: 1 }), 'callback').why, 'Your last text 1h ago');
    assert.ok(!kind(kindsAt({ hoursSinceUser: 49 }), 'callback').ok);
    // Feelings: each its own condition, the dark ones too
    assert.equal(kind(calm, 'mood').why, 'No feeling strong enough');
    assert.deepEqual(typesOf(kindsAt({ feelings: { anger: 40, romance: 50 } }), 'mood'), ['jealousy_nudge']);
    assert.deepEqual(typesOf(kindsAt({ feelings: { disgust: 40 } }), 'mood'), ['suppressed_thought']);
    assert.ok(typesOf(kindsAt({ feelings: { anxiety: 60, sadness: 45 } }), 'mood').includes('overwhelm_check'));
    // Overthinking only late at night
    assert.ok(!typesOf(kindsAt({ feelings: { anxiety: 45 } }), 'mood').includes('overthinking_spiral'));
    assert.ok(typesOf(kindsAt({ feelings: { anxiety: 45 }, now: new Date(2026, 10, 3, 23, 30) }), 'mood').includes('overthinking_spiral'));
    // It's been a while: 24 hours, a week
    assert.equal(kind(calm, 'gap').why, 'Your last text 5h ago');
    assert.deepEqual(typesOf(kindsAt({ hoursSinceUser: 30 }), 'gap'), ['checkin']);
    assert.deepEqual(typesOf(kindsAt({ hoursSinceUser: 200 }), 'gap'), ['dormancy_break']);
});

test('Life: her own day with a schedule; without one the clock text that fits, fixed by the day\'s pick', () => {
    const own = kindsAt({ life: [{ type: 'errand', weight: 65, detail: '交论文, due tomorrow' }] });
    assert.deepEqual(kind(own, 'life').topics, [{ type: 'errand', detail: '交论文, due tomorrow' }]);
    assert.equal(kind(kindsAt({ life: [] }), 'life').why, 'Nothing new in their day');
    // Tuesday 15:00: the afternoon slump
    assert.deepEqual(typesOf(kindsAt(), 'life'), ['afternoon_slump']);
    // Friday 17:45: the Friday feeling, the commute and the end of work fit; the pick says which
    const friday = new Date(2026, 10, 6, 17, 45);
    assert.deepEqual(R.clockTopics(friday), ['commute_ping', 'post_work', 'friday_feeling']);
    assert.deepEqual(typesOf(kindsAt({ now: friday, clockPick: 0 }), 'life'), ['commute_ping']);
    assert.deepEqual(typesOf(kindsAt({ now: friday, clockPick: 0.99 }), 'life'), ['friday_feeling']);
    // A window past midnight; one for weekends only
    assert.deepEqual(R.clockTopics(new Date(2026, 10, 3, 1, 0)), ['late_night', 'post_midnight_impulse']);
    assert.ok(R.clockTopics(new Date(2026, 10, 7, 15, 0)).includes('weekend_ping'));
    assert.equal(kind(kindsAt({ now: new Date(2026, 10, 3, 3, 0) }), 'life').why, 'No time-of-day text for now');
});

test('the pick: a kind first, the last one\'s less likely; in it the feelings by weight, the rest past their last three', () => {
    const kinds = kindsAt({ feelings: { rapport: 30 }, memories: [{ id: 'm', category: 'shared_moment', content: '一起看过的海' }] });
    // With the last topic a share, its kind is less likely
    const pick = random => R.pickTopic({ kinds: kinds.filter(k => ['you', 'share'].includes(k.id)), history: { daily_observation: 5 }, random });
    // you 1, share 0.3: the first 1/1.3 of the roll is you
    assert.equal(pick(fixed(0.7)).kind, 'you');
    assert.equal(pick(fixed(0.8)).kind, 'share');
    // Nothing that can be picked: null
    assert.equal(R.pickTopic({ kinds: kinds.map(k => ({ ...k, ok: false })) }), null);
    // In a kind, past the last three of it
    const shareOnly = kinds.filter(k => k.id === 'share');
    const used = { daily_observation: 4, interest_share: 3, song_stuck: 2 };
    for (const roll of [0, 0.5, 0.99]) {
        assert.ok(!['daily_observation', 'interest_share', 'song_stuck'].includes(R.pickTopic({ kinds: shareOnly, history: used, random: fixed(roll) }).type));
    }
    // A core interest weighs twice each of the others, which are even
    const shares = shareOnly[0].topics;
    const total = shares.reduce((n, t) => n + (t.weight || 1), 0);
    const counts = {};
    for (let i = 0; i < 1000; i++) {
        const topic = R.pickTopic({ kinds: shareOnly, random: fixed((i + 0.5) / 1000) });
        assert.equal(topic.weight, undefined);
        counts[topic.type] = (counts[topic.type] || 0) + 1;
    }
    assert.ok(Math.abs(counts.interest_share / 1000 - 2 / total) < 0.005, JSON.stringify(counts));
    for (const t of shares.filter(t => t.type !== 'interest_share')) assert.ok(Math.abs(counts[t.type] / 1000 - 1 / total) < 0.005, t.type);
    // Feelings by their weights: reassurance (65 + 0.3 × anxiety) outweighs jealousy
    const mood = kindsAt({ feelings: { anxiety: 90, anger: 40, romance: 50 } }).filter(k => k.id === 'mood');
    assert.equal(R.pickTopic({ kinds: mood, random: fixed(0) }).type, 'anxiety_reassurance');
    assert.equal(R.pickTopic({ kinds: mood, random: fixed(0.99) }).type, 'jealousy_nudge');
    // With a schedule Life is half as likely again; a strong feeling makes Feelings so
    const two = kindsAt({ feelings: { anxiety: 80 }, life: [{ type: 'errand', detail: 'x' }] }).filter(k => ['life', 'mood'].includes(k.id));
    assert.equal(R.pickTopic({ kinds: two, withSchedule: true, random: fixed(0.55) }).kind, 'life');
    assert.equal(R.pickTopic({ kinds: two, withSchedule: false, random: fixed(0.55) }).kind, 'mood');
    assert.equal(R.pickTopic({ kinds: two, strongest: 0, random: fixed(0.45) }).kind, 'life');
    assert.equal(R.pickTopic({ kinds: two, strongest: 80, random: fixed(0.45) }).kind, 'mood');
});

test('memories: a shared moment or an inside joke for Thinking of you, others now and then for Sharing; none again within a week', () => {
    const DAY = 24 * 60 * MIN;
    const memories = [
        { id: 'm', category: 'shared_moment', content: '第一次一起看烟花' },
        { id: 'j', category: 'inside_joke', content: '青蛙装' },
        { id: 'h', category: 'hobby', content: '齐宁在学滑板' },
        { id: 'f', category: 'favorite_thing', content: '齐宁最喜欢栗子蛋糕' },
        { id: 'l', category: 'life', content: '上周搬了家' },
        { id: 'e', category: 'shared_moment', content: '' },
    ];
    const at = (recalled = {}) => kindsAt({ feelings: { rapport: 30 }, memories, recalled });
    const you = kind(at(), 'you');
    // Each memory text with its own memories
    assert.deepEqual(you.topics.map(t => [t.type, t.memories.map(m => m.id)]), [['memory_nudge', ['m']], ['inside_joke_callback', ['j']]]);
    assert.equal(you.memoryCount, 2);
    assert.deepEqual(kind(at(), 'share').memories.map(m => m.id), ['h', 'f']);
    // Brought up 6 days ago: not yet; 8 days ago: again
    assert.deepEqual(typesOf(at({ m: AFTERNOON.getTime() - 6 * DAY, j: AFTERNOON.getTime() - 8 * DAY }), 'you'), ['inside_joke_callback']);
    assert.deepEqual(typesOf(at({ m: AFTERNOON.getTime() - DAY, j: AFTERNOON.getTime() - DAY }), 'you'), []);
    // The pick carries the memory it brings up
    const pick = R.pickTopic({ kinds: at().filter(k => k.id === 'you'), random: fixed(0) });
    assert.deepEqual(pick, { kind: 'you', type: 'memory_nudge', memory: memories[0] });
    // A share is about one of its memories three times in ten
    const share = at().filter(k => k.id === 'share');
    assert.equal(R.pickTopic({ kinds: share, random: fixed(0.29) }).memory?.id, 'h');
    assert.equal(R.pickTopic({ kinds: share, random: fixed(0.31) }).memory, undefined);
});
