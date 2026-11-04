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

test('what the model is told for one follow-up: how many are unanswered, the time and the schedule\'s line, a fresh decision, whether it may mention the silence', () => {
    const t = (h, m = 0) => new Date(2026, 9, 31, h, m).getTime();
    const first = R.textInstruction({ charName: 'Mira', userName: 'Qi', unanswered: 1, now: t(20, 6), lastAt: t(20), doing: '18:00–21:00 逛街 (城里)', silence: false });
    assert.equal(first, "Qi hasn't replied to Mira's last text. Write the one text Mira sends now (it is 20:06, 6 minutes after Mira's last one · 18:00–21:00 逛街 (城里)). "
        + 'It is a fresh decision Mira makes now. Let who Mira is and what Mira is doing now decide whether it goes on with what was said or brings up something new. '
        + "It doesn't mention that Qi hasn't replied. Write it as one text, in the usual format.");
    const third = R.textInstruction({ charName: 'Mira', userName: 'Qi', unanswered: 3, now: t(22), lastAt: t(20, 45), silence: true });
    assert.match(third, /^Qi hasn't replied to Mira's last 3 texts\. Write the one text Mira sends now \(it is 22:00, an hour after Mira's last one\)\. /);
    assert.match(third, /aware of the earlier ones still unanswered\. .*, brings up something new, or mentions the silence\. Write it as one text/);
    assert.equal(third.match(/hasn't replied/g).length, 1);
    // The day before is said
    assert.match(R.textInstruction({ now: new Date(2026, 10, 1, 0, 30).getTime(), lastAt: t(23) }), /\(it is 00:30, 2 hours after/);
});

test('a catch-up\'s follow-ups: numbered only, with one note on how they\'re written, the cap per round', () => {
    assert.equal(R.followUpNote({ index: 0 }), 'follow-up 1');
    assert.equal(R.followUpNote({ round: 2, index: 3 }), 'follow-up 4 of round 2');
    const guide = temperament => R.followUpGuidance({ charName: 'Mira', userName: 'Qi', temperament, rounds: true });
    assert.match(guide('normal'), /^Each follow-up is a fresh decision Mira makes at its own time, aware of the earlier ones still unanswered\. They belong to the same conversation, but they are not chapters of a planned emotional arc\./);
    assert.match(guide('normal'), /At most one in each round mentions that Qi hasn't replied\.$/);
    assert.match(guide('clingy'), /At most two in each round mention that Qi hasn't replied\.$/);
    assert.match(guide('obsessed'), /Any of them may come back to Qi's silence\.$/);
    assert.match(guide('aloof'), /goes on with what was said or brings up something new\. None of them mentions that Qi hasn't replied\.$/);
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
    // With no shared moment or inside joke in the memories, they just think of you
    assert.deepEqual(typesOf(kindsAt({ feelings: { rapport: 20 } }), 'you'), ['thinking_of_you']);
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
    const kinds = kindsAt({ feelings: { rapport: 30 } });
    // With the last topic a share, its kind is less likely
    const pick = random => R.pickTopic({ kinds: kinds.filter(k => ['you', 'share'].includes(k.id)), history: { random_thought: 5 }, random });
    // you 1, share 0.3: the first 1/1.3 of the roll is you
    assert.equal(pick(fixed(0.7)).kind, 'you');
    assert.equal(pick(fixed(0.8)).kind, 'share');
    // Nothing that can be picked: null
    assert.equal(R.pickTopic({ kinds: kinds.map(k => ({ ...k, ok: false })) }), null);
    // In a kind, past the last three of it
    const shareOnly = kinds.filter(k => k.id === 'share');
    const used = { random_thought: 4, sharing_impulse: 3, song_stuck: 2 };
    for (const roll of [0, 0.5, 0.99]) {
        assert.ok(!['random_thought', 'sharing_impulse', 'song_stuck'].includes(R.pickTopic({ kinds: shareOnly, history: used, random: fixed(roll) }).type));
    }
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
    // Each memory text with its own memories; no plain "thinking of you" while there are some
    assert.deepEqual(you.topics.map(t => [t.type, t.memories.map(m => m.id)]), [['memory_nudge', ['m']], ['inside_joke_callback', ['j']]]);
    assert.equal(you.memoryCount, 2);
    assert.deepEqual(kind(at(), 'share').memories.map(m => m.id), ['h', 'f']);
    // Brought up 6 days ago: not yet; 8 days ago: again
    assert.deepEqual(typesOf(at({ m: AFTERNOON.getTime() - 6 * DAY, j: AFTERNOON.getTime() - 8 * DAY }), 'you'), ['inside_joke_callback']);
    assert.deepEqual(typesOf(at({ m: AFTERNOON.getTime() - DAY, j: AFTERNOON.getTime() - DAY }), 'you'), ['thinking_of_you']);
    // The pick carries the memory it brings up
    const pick = R.pickTopic({ kinds: at().filter(k => k.id === 'you'), random: fixed(0) });
    assert.deepEqual(pick, { kind: 'you', type: 'memory_nudge', memory: memories[0] });
    // A share is about one of its memories three times in ten
    const share = at().filter(k => k.id === 'share');
    assert.equal(R.pickTopic({ kinds: share, random: fixed(0.29) }).memory?.id, 'h');
    assert.equal(R.pickTopic({ kinds: share, random: fixed(0.31) }).memory, undefined);
});
