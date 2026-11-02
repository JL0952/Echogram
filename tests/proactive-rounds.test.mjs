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

test('a round: the first wait, then each one the last times the growth', () => {
    // random 0: the shortest first wait, waits shrunk by a fifth
    assert.deepEqual(minutesAfter(R.planRound({ temperament: 'normal', startAt: T0, random: fixed(0) })), [20, 68]);
    assert.deepEqual(minutesAfter(R.planRound({ temperament: 'clingy', startAt: T0, random: fixed(0) })), [3, 7.8, 17.4, 36.6]);
    // random 0.5: the middle of each range, no jitter
    assert.deepEqual(minutesAfter(R.planRound({ temperament: 'clingy', startAt: T0, random: fixed(0.5) })), [6.5, 19.5, 45.5, 97.5]);
    const obsessed = R.planRound({ temperament: 'obsessed', startAt: T0, random: fixed(0.5) });
    assert.equal(obsessed.length, 10);
    assert.equal(minutesAfter(obsessed)[0], 1.3);
    // Waits only grow; never closer than 30 seconds
    for (let i = 1; i < obsessed.length; i++) assert.ok(obsessed[i] - obsessed[i - 1] >= R.MIN_GAP_MS);
    // A later obsessed round starts hours on, then the quick waits again
    const later = minutesAfter(R.planRound({ temperament: 'obsessed', startAt: T0, random: fixed(0.5), firstHours: [2, 4] }));
    assert.equal(later[0], 180);
    assert.ok(later[1] - later[0] < 5);
});

test('aloof: one text, or none at all', () => {
    assert.deepEqual(R.planRound({ temperament: 'aloof', startAt: T0, random: fixed(0.1) }), []);
    assert.deepEqual(minutesAfter(R.planRound({ temperament: 'aloof', startAt: T0, random: fixed(0.5) })), [120]);
});

test('the conversation was open: you texted within half an hour before her last text', () => {
    const at = m => T0 + m * MIN;
    assert.equal(R.isConversationOpen([{ is_user: true, send_date: at(0) }, { is_user: false, send_date: at(1) }]), true);
    assert.equal(R.isConversationOpen([{ is_user: true, send_date: at(0) }, { is_user: false, send_date: at(29) }, { is_user: false, send_date: at(30) }]), true);
    assert.equal(R.isConversationOpen([{ is_user: true, send_date: at(0) }, { is_user: false, send_date: at(45) }]), false);
    // Your text is the last one: she's the one to answer
    assert.equal(R.isConversationOpen([{ is_user: false, send_date: at(0) }, { is_user: true, send_date: at(1) }]), false);
    assert.equal(R.isConversationOpen([{ is_user: false, send_date: at(0) }]), false);
    assert.equal(R.isConversationOpen([]), false);
});

test('what the model is told for a round', () => {
    const text = R.roundInstruction({ charName: 'Mira', userName: 'Qi', temperament: 'clingy', waits: [5 * MIN, 15 * MIN, 45 * MIN, 2 * 60 * MIN] });
    assert.match(text, /^Qi went quiet in the middle of your conversation/);
    assert.match(text, /Write the 4 texts Mira sends while still getting no answer/);
    assert.match(text, /a little more needy with each one/);
    assert.match(text, /the first 5 minutes after Mira's last one, text 2 15 minutes after .*, the last 2 hours after/);
    assert.match(text, /a line holding only ---/);
    const one = R.roundInstruction({ charName: 'Mira', userName: 'Qi', temperament: 'aloof', waits: [90 * MIN], round: 2 });
    assert.match(one, /hasn't answered Mira's earlier follow-ups for hours either/);
    assert.match(one, /It comes 2 hours after Mira's last one/);
    assert.doesNotMatch(one, /---/);
    assert.doesNotMatch(text + one, /[一-鿿]/);
});

test('a round whose texts all went by while the page wasn\'t running: by the clock, beside the time now', () => {
    const t = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime();
    const waits = [3.5, 3.8, 4.6, 5.9].map(h => h * 60 * MIN);
    const sentAt = [t(31, 18), t(31, 18, 15), t(31, 19, 2), t(31, 20, 19)];
    const text = R.roundInstruction({ charName: 'Mira', userName: 'Qi', temperament: 'clingy', waits, sentAt, now: t(31, 21, 46) });
    assert.match(text, /They were sent one after another while Qi was away: the first at 18:00, text 2 at 18:15, text 3 at 19:02, the last at 20:19; it is now 21:46\./);
    assert.doesNotMatch(text, /hours after/);
    // Past midnight: the day before is said
    const late = R.roundInstruction({ charName: 'Mira', userName: 'Qi', temperament: 'aloof', waits: [waits[0]], sentAt: [t(31, 23)], now: t(32, 1, 5) });
    assert.match(late, /It was sent while Qi was away, at 2026-10-31 23:00; it is now 01:05\./);
});

test('the model\'s answer split into the round\'s texts', () => {
    assert.deepEqual(R.splitRound('?\n---\n人呢\n你去哪了\n---\n算了', 3), ['?', '人呢\n你去哪了', '算了']);
    assert.deepEqual(R.splitRound('a\n***\nb\n———\nc\n---\nd', 3), ['a', 'b', 'c']);
    // No separators: a line each, the rest in the last
    assert.deepEqual(R.splitRound('one\ntwo\nthree\nfour', 3), ['one', 'two', 'three\nfour']);
    assert.deepEqual(R.splitRound('only one', 3), ['only one']);
    assert.deepEqual(R.splitRound('\n---\n\n---\nx', 2), ['x']);
    assert.deepEqual(R.splitRound('', 2), []);
});

test('the hour, for counting requests', () => {
    assert.equal(R.hourKey(new Date(2026, 0, 5, 7, 59)), '2026-01-05T07');
});

test('new topics: the wait grows with each unanswered one, up to a few in a row', () => {
    assert.deepEqual(R.TEMPERAMENTS.map(t => t.topicCap), [1, 2, 3, 5]);
    assert.equal(R.topicWaitHours({ baseHours: 8, temperament: 'normal' }), 8);
    assert.equal(R.topicWaitHours({ baseHours: 8, temperament: 'normal', unanswered: 1 }), 24);
    assert.equal(R.topicWaitHours({ baseHours: 4, temperament: 'clingy', unanswered: 2 }), 16);
    assert.equal(R.topicWaitHours({ baseHours: 30, temperament: 'aloof', unanswered: 3 }), 30);
    assert.equal(R.CLOCK_TRIGGERS.length, 16);
});

test('just got free: within half an hour of a busy or sleeping stretch ending', () => {
    const now = T0;
    assert.equal(R.justGotFree({ phone: 'free', prevPhone: 'busy', since: now - 10 * MIN, now }), true);
    assert.equal(R.justGotFree({ phone: 'free', prevPhone: 'asleep', since: now - 30 * MIN, now }), true);
    assert.equal(R.justGotFree({ phone: 'free', prevPhone: 'busy', since: now - 31 * MIN, now }), false);
    assert.equal(R.justGotFree({ phone: 'free', prevPhone: 'free', since: now - 5 * MIN, now }), false);
    assert.equal(R.justGotFree({ phone: 'busy', prevPhone: 'asleep', since: now - 5 * MIN, now }), false);
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
    const t = (type, detail) => R.topicInstruction({ type, detail, charName: 'Mira', userName: 'Qi', timeSince: '5 hours' });
    assert.equal(t('block_change', '上班 is over'), "Mira just got free: 上班 is over. It has been 5 hours since Qi last texted. Text Qi about what Mira just did or what's next.");
    assert.match(t('errand', 'x'), /^On Mira's mind: x\. It has been 5 hours/);
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
