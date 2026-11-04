// Run: node --test tests/*.test.mjs
// What may be on her mind (docs/mechanics-reference.md 5.5) through the real topic picker in
// lib/proactive-messaging.js, the character's day stubbed. When she texts is the sequence's
// (tests/proactive-rounds-engine.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = {};
for (const f of ['lib/rich-messages.js', 'lib/features.js', 'lib/chat-view-model.js', 'lib/daily-life.js', 'lib/proactive-rounds.js', 'lib/proactive-messaging.js']) {
    new Function(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'))();
}

const HOUR = 3600000;
// A Monday morning
const NOW = new Date(2026, 9, 26, 7, 30);

function engine({ temperament = 'normal', day = null } = {}) {
    return window.EchoTextProactiveMessaging.createProactiveMessaging({
        getSettings: () => ({ proactiveMessagingEnabled: true }), getUserName: () => 'Qi', getActiveFeatures: () => [],
        expandTimeDateMacros: t => t, replaceMacros: t => t, getEmotionState: () => null, getProactivePace: () => 1,
        findLastUserMessageIndex: h => h.map(m => m.is_user).lastIndexOf(true),
        getTemperament: () => temperament, getDailyLife: () => (day ? { ...day } : null),
        getCurrentCharacter: () => ({ name: 'Mira', avatar: 'mira.png' }), getCharacterKey: () => 'mira.png',
    });
}

/** The topics there are now, you last texting `userHours` ago; `topics` of hers since, unanswered. */
function candidates({ temperament, day, userHours = 10, proactiveHours = null, topics = 0, followUps = 0, now = NOW }) {
    const p = engine({ temperament, day });
    const t = now.getTime();
    const userAt = t - userHours * HOUR;
    const history = [{ is_user: false, mes: 'hi', send_date: userAt - HOUR }, { is_user: true, mes: 'ok', send_date: userAt }];
    for (let i = 0; i < followUps; i++) history.push({ is_user: false, mes: '?', send_date: userAt + (i + 1) * 60000, meta: { proactive: true, proactiveType: 'follow_up' } });
    for (let i = 0; i < topics; i++) history.push({ is_user: false, mes: 'news', send_date: userAt + HOUR, meta: { proactive: true, proactiveType: 'random_thought' } });
    const state = { lastUserMessageAt: userAt, lastCharacterMessageAt: userAt, triggerHistory: {}, lastEmotionSnapshot: null,
        lastProactiveAt: proactiveHours === null ? 0 : t - proactiveHours * HOUR };
    const config = { ...p.getDefaultProactiveConfigForCharacter({}), temperament };
    return p.topicAt({ history, state, config, now, collect: true });
}
const types = c => (c || []).map(x => x.type);
const day = (over = {}) => ({ phone: 'free', block: { from: '07:00', doing: '吃早饭', place: '家', phone: 'free' }, since: NOW.getTime() - 2 * HOUR,
    prevPhone: 'free', prevDoing: '', today: '2026-10-26', life: { errands: [], log: [], today: null }, ...over });

test('without a schedule one clock text that fits now is Life, fixed for the day; with one, her own day is', () => {
    const R = window.EchoTextProactiveRounds;
    const clock = c => types(c).filter(t => R.CLOCK_TRIGGERS.includes(t));
    // Monday 07:30: morning, the commute and the new week all fit; one of them, the same all day
    const fits = R.clockTopics(NOW);
    assert.deepEqual([...fits].sort(), ['commute_ping', 'monday_reboot', 'morning_wave']);
    const picked = clock(candidates({}));
    assert.equal(picked.length, 1);
    assert.ok(fits.includes(picked[0]));
    assert.deepEqual(clock(candidates({ now: new Date(NOW.getTime() + 20 * 60000) })), picked);
    assert.equal(candidates({}).find(c => c.type === picked[0]).kind, 'life');
    // With a schedule: none of them
    assert.deepEqual(clock(candidates({ day: day() })), []);
    // The other kinds stay either way
    assert.ok(types(candidates({ day: day() })).includes('random_thought'));
});

test('without a schedule the other kinds lead with the time of day; with one they don\'t', () => {
    const plain = candidates({});
    const scene = plain.find(c => c.type === 'random_thought').prompt;
    const clockType = plain.find(c => window.EchoTextProactiveRounds.CLOCK_TRIGGERS.includes(c.type)).type;
    // Its first sentence, then the topic's own words
    const first = window.EchoTextProactiveMessaging.createProactiveMessaging({ getSettings: () => ({}), expandTimeDateMacros: t => t, replaceMacros: t => t })
        .getDefaultProactiveConfigForCharacter().triggerTemplates[clockType];
    assert.ok(scene.endsWith('Share the genuinely random or weird observation.'));
    assert.ok(!scene.startsWith('A completely random thought'), scene);
    assert.ok(first.length > 0);
    assert.ok(candidates({ day: day() }).find(c => c.type === 'random_thought').prompt.startsWith('A completely random thought'));
});

test('just got free: a topic about it', () => {
    const free = day({ since: NOW.getTime() - 10 * 60000, prevPhone: 'busy', prevDoing: '开会' });
    const c = candidates({ day: free });
    const topic = c.find(x => x.type === 'block_change');
    // (How long since you texted is worded from the real clock)
    assert.match(topic.prompt, /^Mira just got free: 开会 is over; now: 吃早饭\. Text Qi about what Mira just did or what's next\.$/);
    // Too long ago, or not after a busy or sleeping stretch: not just free
    assert.ok(!types(candidates({ day: day({ since: NOW.getTime() - 40 * 60000, prevPhone: 'busy' }) })).includes('block_change'));
    assert.ok(!types(candidates({ day: day({ since: NOW.getTime() - 10 * 60000, prevPhone: 'free' }) })).includes('block_change'));
});

test('an errand due by tomorrow, and today\'s news', () => {
    const life = { errands: [{ text: '交论文', progress: '还差结论', due: '2026-10-27' }, { text: '搬家', due: '2026-11-07' }], log: [{ date: '2026-10-26', text: '早上摔了一跤' }], today: null };
    const c = candidates({ day: day({ life }) });
    assert.match(c.find(x => x.type === 'errand').prompt, /^On Mira's mind: 交论文 \(还差结论\), due tomorrow\. Tell Qi about it, the way Mira would\.$/);
    assert.match(c.find(x => x.type === 'life_event').prompt, /^Something from Mira's day: 早上摔了一跤\./);
    // Nothing due soon, nothing today: neither
    const quiet = types(candidates({ day: day({ life: { errands: [{ text: '搬家', due: '2026-11-07' }], log: [], today: null } }) }));
    assert.ok(!quiet.includes('errand') && !quiet.includes('life_event'));
    // However soon after your last text
    assert.ok(types(candidates({ day: day({ life }), userHours: 1 })).includes('errand'));
});

test('the insights panel: why nothing comes, and the six kinds, Life by her own day or by the clock', () => {
    const now = Date.now();
    const history = [{ is_user: true, mes: 'ok', send_date: now - 20 * HOUR },
        { is_user: false, mes: 'a', send_date: now - 19 * HOUR, meta: { proactive: true, proactiveType: 'random_thought' } },
        { is_user: false, mes: 'b', send_date: now - 18 * HOUR, meta: { proactive: true, proactiveType: 'checkin' } }];
    const snapshot = (dayInfo, phone = null) => {
        const settings = { proactiveMessagingEnabled: true };
        return window.EchoTextProactiveMessaging.createProactiveMessaging({
        getSettings: () => settings, getUserName: () => 'Qi', getActiveFeatures: () => [],
        expandTimeDateMacros: t => t, replaceMacros: t => t, getEmotionState: () => null, getProactivePace: () => 1,
        getTemperament: () => 'normal', getDailyLife: () => (dayInfo ? { ...dayInfo } : null), getScheduleNow: () => phone,
        getCurrentCharacter: () => ({ name: 'Mira', avatar: 'mira.png' }), getCharacterKey: () => 'mira.png',
        getChatHistory: () => history,
        }).getProactiveInsightsSnapshot();
    };
    // Her two texts unanswered: the next one, its wait three times longer twice (Normal)
    assert.match(snapshot(null).next, /^Next text (in .*|due) · 2 unanswered$/);
    // Asleep: held until she's up
    assert.match(snapshot(day({ phone: 'asleep' }), { phone: 'asleep', endsAt: now + 3 * HOUR }).next, /^Asleep until \d\d:\d\d · 2 unanswered$/);
    const rows = dayInfo => snapshot(dayInfo).triggerDiagnostics;
    const KINDS = ['life', 'you', 'share', 'callback', 'mood', 'gap'];
    assert.deepEqual(rows(day()).map(t => t.id), KINDS);
    assert.deepEqual(rows(null).map(t => t.id), KINDS);
    // Life: her own day, or the clock without a schedule
    assert.equal(rows(day()).find(t => t.id === 'life').req, "Just got free, an errand due or today's news");
    assert.equal(rows(day()).find(t => t.id === 'life').reason, 'Nothing new in their day');
    assert.equal(rows(null).find(t => t.id === 'life').req, 'A time of day with its own text (no schedule)');
    // Emotions off: Rapport 0, nothing strong; you last texted 20 hours ago
    assert.equal(rows(null).find(t => t.id === 'you').reason, 'Rapport 0, needs 20');
    assert.equal(rows(null).find(t => t.id === 'mood').reason, 'No feeling strong enough');
    assert.equal(rows(null).find(t => t.id === 'share').reason, 'Can pick · no memories');
    assert.equal(rows(null).find(t => t.id === 'callback').reason, 'Can pick');
    assert.equal(rows(null).find(t => t.id === 'gap').reason, 'Your last text 20h ago');
    // When one went last: the newest of its texts
    assert.equal(rows(null).find(t => t.id === 'share').last === 'Never', false);
});
