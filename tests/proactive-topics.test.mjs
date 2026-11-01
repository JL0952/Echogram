// Run: node --test tests/*.test.mjs
// New topics (round B, docs/platform-plan.md 12d-2) through the real trigger evaluation
// in lib/proactive-messaging.js, the character's day stubbed.
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

/**
 * The candidates now (null: nothing may come), you last texting `userHours` ago and her
 * last proactive text `proactiveHours` ago; `topics` of hers since, unanswered.
 */
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
    return p.evaluateProactiveTrigger({ history, state, config, now, collect: true });
}
const types = c => (c || []).map(x => x.type);
const day = (over = {}) => ({ phone: 'free', block: { from: '07:00', doing: '吃早饭', place: '家', phone: 'free' }, since: NOW.getTime() - 2 * HOUR,
    prevPhone: 'free', prevDoing: '', today: '2026-10-26', life: { errands: [], log: [], today: null }, ...over });

test('without a schedule the clock triggers stay; with one they give way', () => {
    assert.ok(types(candidates({})).includes('morning_wave'));
    const own = types(candidates({ day: day() }));
    assert.ok(!own.includes('morning_wave'));
    assert.ok(!own.some(t => window.EchoTextProactiveRounds.CLOCK_TRIGGERS.includes(t)));
    // The rest stay
    assert.ok(own.includes('followup_callback') || own.includes('random_thought'));
});

test('asleep: nothing; busy: only on some stretches, the same all day', () => {
    assert.equal(candidates({ day: day({ phone: 'asleep' }) }), null);
    let open = 0;
    for (let h = 0; h < 24; h++) {
        for (const m of ['00', '30']) {
            const from = `${String(h).padStart(2, '0')}:${m}`;
            const c = candidates({ day: day({ phone: 'busy', block: { from, doing: '上班', phone: 'busy' } }) });
            if (c) open++;
            // The same answer again for the same stretch today
            assert.equal(!!candidates({ day: day({ phone: 'busy', block: { from, doing: '上班', phone: 'busy' } }) }), !!c);
        }
    }
    assert.ok(open >= 5 && open <= 27, String(open));
});

test('just got free: a topic about it, and the wait is halved', () => {
    const free = day({ since: NOW.getTime() - 10 * 60000, prevPhone: 'busy', prevDoing: '开会' });
    const c = candidates({ day: free });
    const topic = c.find(x => x.type === 'block_change');
    // (How long since you texted is worded from the real clock)
    assert.match(topic.prompt, /^Mira just got free: 开会 is over; now: 吃早饭\. It has been [^.]+ since Qi last texted\. Text Qi about what Mira just did or what's next\.$/);
    // Obsessed waits 1–2 hours: 0.99 hours since the last topic is too soon, unless just got free
    assert.equal(candidates({ temperament: 'obsessed', day: day(), proactiveHours: 0.99 }), null);
    assert.ok(candidates({ temperament: 'obsessed', day: free, proactiveHours: 0.99 }));
    // Too long ago, or not after a busy or sleeping stretch: not just free
    assert.ok(!types(candidates({ day: day({ since: NOW.getTime() - 40 * 60000, prevPhone: 'busy' }) })).includes('block_change'));
    assert.ok(!types(candidates({ day: day({ since: NOW.getTime() - 10 * 60000, prevPhone: 'free' }) })).includes('block_change'));
});

test('an errand due by tomorrow, and today\'s news', () => {
    const life = { errands: [{ text: '交论文', progress: '还差结论', due: '2026-10-27' }, { text: '搬家', due: '2026-11-07' }], log: [{ date: '2026-10-26', text: '早上摔了一跤' }], today: null };
    const c = candidates({ day: day({ life }) });
    assert.match(c.find(x => x.type === 'errand').prompt, /^On Mira's mind: 交论文 \(还差结论\), due tomorrow\. It has been [^.]+ since Qi last texted\. Tell Qi about it, the way Mira would\.$/);
    assert.match(c.find(x => x.type === 'life_event').prompt, /^Something from Mira's day: 早上摔了一跤\./);
    // Nothing due soon, nothing today: neither
    const quiet = types(candidates({ day: day({ life: { errands: [{ text: '搬家', due: '2026-11-07' }], log: [], today: null } }) }));
    assert.ok(!quiet.includes('errand') && !quiet.includes('life_event'));
    // You texted half an hour ago: too soon for these
    assert.ok(!types(candidates({ day: day({ life }), userHours: 1 })).includes('errand'));
});

test('unanswered topics: capped by the temperament, each one longer to wait; follow-ups don\'t count', () => {
    // Normal: 2 in a row at most
    assert.ok(candidates({ topics: 1, proactiveHours: 40 }));
    assert.equal(candidates({ topics: 2, proactiveHours: 40 }), null);
    assert.ok(candidates({ topics: 1, followUps: 4, proactiveHours: 40 }));
    // Aloof: 1; Obsessed: 5
    assert.equal(candidates({ temperament: 'aloof', topics: 1, proactiveHours: 200 }), null);
    assert.ok(candidates({ temperament: 'obsessed', topics: 4, proactiveHours: 20 }));
    assert.equal(candidates({ temperament: 'obsessed', topics: 5, proactiveHours: 20 }), null);
    // Normal waits 6–10 hours; with one unanswered, three times that
    assert.ok(candidates({ proactiveHours: 10.1 }));
    assert.equal(candidates({ topics: 1, proactiveHours: 10.1 }), null);
    assert.ok(candidates({ topics: 1, proactiveHours: 30.1 }));
});

test('the insights panel: why nothing comes, and the own day\'s topics in place of the clock', () => {
    const now = Date.now();
    const history = [{ is_user: true, mes: 'ok', send_date: now - 20 * HOUR },
        { is_user: false, mes: 'a', send_date: now - 19 * HOUR, meta: { proactive: true, proactiveType: 'random_thought' } },
        { is_user: false, mes: 'b', send_date: now - 18 * HOUR, meta: { proactive: true, proactiveType: 'checkin' } }];
    const snapshot = dayInfo => window.EchoTextProactiveMessaging.createProactiveMessaging({
        getSettings: () => ({ proactiveMessagingEnabled: true }), getUserName: () => 'Qi', getActiveFeatures: () => [],
        expandTimeDateMacros: t => t, replaceMacros: t => t, getEmotionState: () => null, getProactivePace: () => 1,
        getTemperament: () => 'normal', getDailyLife: () => (dayInfo ? { ...dayInfo } : null),
        getCurrentCharacter: () => ({ name: 'Mira', avatar: 'mira.png' }), getCharacterKey: () => 'mira.png',
        getChatHistory: () => history,
    }).getProactiveInsightsSnapshot();
    assert.equal(snapshot(null).next, 'Waiting for you (2 unanswered)');
    history.pop();
    assert.equal(snapshot(day({ phone: 'asleep' })).next, 'Asleep');
    const withDay = snapshot(day()).triggerDiagnostics.map(t => t.id);
    assert.ok(withDay.includes('errand') && withDay.includes('block_change') && !withDay.includes('morning_wave'));
    const without = snapshot(null).triggerDiagnostics.map(t => t.id);
    assert.ok(without.includes('morning_wave') && !without.includes('errand'));
});

test('with you in person: no new topics', () => {
    assert.equal(candidates({ day: day({ phone: 'together' }) }), null);
});
