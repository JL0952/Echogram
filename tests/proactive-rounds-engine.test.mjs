// Run: node --test tests/*.test.mjs
// Her texts when you don't answer, one sequence (docs/mechanics-reference.md 5.13), through the
// real engine in lib/proactive-messaging.js: live (runSequenceFor) and when catching up
// (simulateAway), by the same rules. A fake clock, the model stubbed, typing delays skipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = {};
for (const f of ['lib/daily-life.js', 'lib/proactive-rounds.js', 'lib/proactive-messaging.js']) {
    new Function(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'))();
}

const MIN = 60000;
const HOUR = 60 * MIN;
const T0 = new Date(2026, 9, 31, 20, 0).getTime();

// Time and timers: the clock moves only when a test moves it; short waits (typing) run at once
let clock = T0;
const realNow = Date.now;
Date.now = () => clock;
globalThis.setTimeout = (fn, ms) => { if (ms <= 6000) queueMicrotask(fn); return 1; };
globalThis.clearTimeout = () => {};
test.after(() => { Date.now = realNow; });

// Randomness fixed at the middle: every wait is the middle of the base, no jitter
const fixedRandom = fn => async () => { const real = Math.random; Math.random = () => 0.5; try { await fn(); } finally { Math.random = real; } };

// The model's answers: each text is its own request, so a list answers them in turn (a string, every one)
function setup({ temperament = 'clingy', answer = ['?', '人呢', '你去哪了', '算了'] } = {}) {
    const settings = { enabled: true, proactiveMessagingEnabled: true, chatHistory: { 'mira.png': [] }, proactiveState: {} };
    const asked = [];
    const warnings = [];
    const env = { temperament, answer, open: 'mira.png' };
    const p = window.EchoTextProactiveMessaging.createProactiveMessaging({
        getSettings: () => settings, saveSettings: () => {}, warn: (...a) => warnings.push(a.join(' ')),
        getCurrentCharacter: () => ({ name: env.open === 'mira.png' ? 'Mira' : 'Other', avatar: env.open }), getCharacterKey: () => env.open,
        chatTarget: () => ({ group: null, combine: false, key: env.open }), isViewing: t => !!t && t.key === env.open,
        getChatHistory: () => settings.chatHistory['mira.png'], getUserName: () => 'Qi',
        getTemperament: () => env.temperament,
        getStoryPauseUntil: at => (typeof env.storyUntil === 'function' ? env.storyUntil(at ?? Date.now()) : env.storyUntil || 0),
        // Her phone now (or at `at`, ms, when catching up): { phone, endsAt }
        getScheduleNow: at => (typeof env.schedule === 'function' ? env.schedule(at ?? Date.now()) : env.schedule || null),
        getDailyLife: () => null,
        withYouAt: at => (env.together || []).some(span => span.from <= at && at < span.until),
        catchUpPending: () => !!env.pending,
        expandTimeDateMacros: t => t, replaceMacros: t => t, getActiveFeatures: () => [], getProactivePace: () => 1,
        isGroupSession: () => false, isPanelOpen: () => true, getIsGenerating: () => !!env.generating, getEmotionState: () => env.feelings || null,
        getMemories: () => [],
        buildApiMessagesFromHistoryForChar: async (history, extraSystem) => {
            env.onBuild?.();
            return { apiMessages: [{ role: 'system', content: extraSystem.join('\n') }], rawPrompt: '', systemPrompt: '' };
        },
        requestEchoTextCompletion: async ({ apiMessages }) => {
            asked.push(apiMessages);
            const a = typeof env.answer === 'function' ? env.answer() : env.answer;
            return Array.isArray(a) ? a[(asked.length - 1) % a.length] : a;
        },
        readReply: t => ({ mes: String(t).trim(), mood: null, life: null }),
        renderMessages: () => {}, setTypingIndicatorVisible: () => {}, setFabUnreadIndicator: () => {}, noteMoodReport: () => {},
    });
    const chat = () => settings.chatHistory['mira.png'];
    const state = () => settings.proactiveState['mira.png'];
    // You text, she answers a minute later
    const talk = () => {
        chat().push({ is_user: true, mes: 'hey', send_date: clock });
        p.markProactiveUserActivity('mira.png', clock);
        clock += MIN;
        chat().push({ is_user: false, mes: 'hi!', send_date: clock });
        p.markProactiveCharacterActivity('mira.png', false, 'reply', clock);
    };
    const run = () => p.runSequenceFor({ name: 'Mira', avatar: 'mira.png' }, 'mira.png');
    return { p, settings, asked, warnings, env, chat, state, talk, run };
}
const turnOf = asked => asked.at(-1).at(-1).content;

test('her reply starts the sequence: each text after the one before by the base wait × growth^unanswered, one request each', fixedRandom(async () => {
    clock = T0;
    const { asked, chat, state, talk, run } = setup();
    talk();
    // Clingy: 6.5 minutes (the middle of 3–10), then ×2 each unanswered one
    assert.equal(state().seq.next, clock + 6.5 * MIN);
    assert.equal(state().unanswered, 0);
    clock = state().seq.next - 1000;
    assert.equal(await run(), false);
    assert.equal(asked.length, 0);
    clock = state().seq.next;
    assert.equal(await run(), true);
    assert.equal(asked.length, 1);
    // One instruction for every text: said once that she's unanswered, the time, a fresh decision, what may be on her mind
    assert.match(asked[0][0].content, /^PROACTIVE MODE: you are texting Qi on your own, not replying\.\n<proactive_situation>/);
    assert.match(turnOf(asked), /^\[Instruction for this turn[^:]*: Qi hasn't replied to Mira's last text\. Mira texts Qi now \(it is 20:07, 7 minutes after Mira's last one\)\. It is a fresh decision Mira makes now\./);
    assert.match(turnOf(asked), /Something that may be on Mira's mind now, for if it fits: /);
    assert.match(turnOf(asked), /Reply only with the text message\(s\) Mira sends now, 3 at most, in the usual format\.\]$/);
    assert.deepEqual(chat().slice(-1).map(m => [m.mes, m.meta.proactive, m.send_date]), [['?', true, clock]]);
    assert.equal(state().unanswered, 1);
    assert.equal(state().seq.next, clock + 13 * MIN);
    clock = state().seq.next;
    await run();
    assert.match(turnOf(asked), /Qi hasn't replied to Mira's last 2 texts\. .*aware of the earlier ones still unanswered/);
    assert.equal(chat().at(-1).mes, '人呢');
    assert.equal(state().seq.next, clock + 26 * MIN);
    // It never stops on its own: the waits only grow
    for (let i = 0; i < 4; i++) { clock = state().seq.next; await run(); }
    assert.equal(state().unanswered, 6);
    assert.equal(state().seq.next - clock, 6.5 * 2 ** 6 * MIN);
}));

test('the temperament\'s two numbers as set in the settings', fixedRandom(async () => {
    clock = T0;
    const { settings, state, talk, run } = setup({ temperament: 'normal' });
    settings.proactiveTemperamentParams = { normal: { baseMinutes: [10, 20], growth: 5 } };
    talk();
    assert.equal(state().seq.next, clock + 15 * MIN);
    clock = state().seq.next;
    await run();
    assert.equal(state().seq.next, clock + 75 * MIN);
}));

test('you text: the sequence starts over from her reply, at the base wait', fixedRandom(async () => {
    clock = T0;
    const { state, talk, run } = setup({ temperament: 'normal' });
    talk();
    clock = state().seq.next;
    await run();
    assert.equal(state().unanswered, 1);
    talk();
    assert.equal(state().unanswered, 0);
    assert.equal(state().seq.next, clock + 40 * MIN);
}));

test('you text while it is being written: it is dropped', fixedRandom(async () => {
    clock = T0;
    const { p, asked, chat, state, talk, run, env } = setup();
    talk();
    clock = state().seq.next;
    let release;
    env.answer = () => new Promise(resolve => { release = () => resolve('?'); });
    const running = run();
    await new Promise(r => queueMicrotask(r));
    chat().push({ is_user: true, mes: 'sorry', send_date: clock });
    p.markProactiveUserActivity('mira.png', clock);
    release();
    assert.equal(await running, false);
    assert.equal(asked.length, 1);
    assert.equal(chat().at(-1).mes, 'sorry');
    assert.equal(state().seq, null);
}));

test('what holds her text back moves it to when that is over: asleep, busy, with you, the main chat, the cold shoulder', fixedRandom(async () => {
    for (const [label, apply, until] of [
        ['asleep', env => { env.schedule = { phone: 'asleep', endsAt: T0 + 9 * HOUR }; }, T0 + 9 * HOUR],
        ['busy', env => { env.schedule = { phone: 'busy', endsAt: T0 + 2 * HOUR }; }, T0 + 2 * HOUR],
        ['together', env => { env.schedule = { phone: 'together', endsAt: T0 + 3 * HOUR }; }, T0 + 3 * HOUR],
        ['story', env => { env.storyUntil = T0 + 30 * MIN; }, T0 + 30 * MIN],
    ]) {
        clock = T0;
        const { asked, state, talk, run, env } = setup();
        talk();
        apply(env);
        clock = state().seq.next;
        assert.equal(await run(), false, label);
        assert.equal(asked.length, 0, label);
        assert.equal(state().seq.next, until, label);
    }
    // The cold shoulder: to its end, from your last text
    clock = T0;
    const { asked, state, talk, run, env } = setup();
    talk();
    env.feelings = { anger: 90 };
    clock = state().seq.next;
    await run();
    assert.equal(asked.length, 0);
    assert.equal(state().seq.next, state().ghost.until);
    assert.ok(state().ghost.until - T0 >= 7 * HOUR);
}));

test('the day\'s requests, all characters together: 20 by default, at least 1; used up, the next text waits for tomorrow', fixedRandom(async () => {
    const midnight = new Date(2026, 10, 1).getTime();
    const day = '2026-10-31';
    for (const [limit, used, goes] of [[undefined, 19, true], [undefined, 20, false], [0, 1, false], [-5, 0, true], [50, 20, true]]) {
        clock = T0;
        const { asked, settings, state, talk, run } = setup();
        talk();
        if (limit !== undefined) settings.proactiveDailyLimit = limit;
        settings.proactiveDaily = { day, count: used };
        clock = state().seq.next;
        await run();
        assert.equal(asked.length, goes ? 1 : 0, `limit ${limit}, used ${used}`);
        if (goes) assert.equal(settings.proactiveDaily.count, used + 1);
        else assert.equal(state().seq.next, midnight);
    }
}));

test('after time together, that text comes first and once; too late, it is dropped and the sequence goes on', fixedRandom(async () => {
    clock = T0;
    const { p, asked, state, talk, run } = setup({ temperament: 'normal' });
    talk();
    // Normal: 70% of the time (0.5 is under it), 15–30 minutes after
    p.planParted('mira.png', clock);
    assert.equal(state().parted.at, clock + 22.5 * MIN);
    // Before the sequence's next text (40 minutes): the text after parting goes first
    clock = state().parted.at;
    await run();
    assert.match(turnOf(asked), /Mira and Qi were together in person and have just parted/);
    assert.equal(state().parted, null);
    // Left too late: dropped, nothing asked; the sequence still has its next one
    p.planParted('mira.png', clock);
    clock = state().parted.at + 2 * HOUR;
    assert.equal(await run(), false);
    assert.equal(state().parted, null);
    assert.ok(state().seq.next);
}));

test('another chat open while it is put together: not sent, tried again when it is back; the chat cleared: nothing lands', fixedRandom(async () => {
    clock = T0;
    const a = setup();
    a.talk();
    clock = a.state().seq.next;
    a.env.onBuild = () => { a.env.open = 'other.png'; };
    assert.equal(await a.run(), false);
    assert.equal(a.chat().length, 2);
    a.env.onBuild = null;
    a.env.open = 'mira.png';
    assert.equal(await a.run(), true);
    assert.equal(a.chat().at(-1).mes, '?');
    // Cleared while it was written
    clock = T0;
    const b = setup();
    b.talk();
    clock = b.state().seq.next;
    b.env.onBuild = () => { b.settings.chatHistory['mira.png'] = []; };
    assert.equal(await b.run(), false);
    assert.deepEqual(b.chat(), []);
}));

test('a failed request (an error, an empty answer) plans the next one from then; a catch-up due or a reply unseen holds it', fixedRandom(async () => {
    clock = T0;
    const { asked, settings, state, talk, run, env, warnings } = setup();
    talk();
    clock = state().seq.next;
    env.answer = () => { throw new Error('no answer for 3 minutes'); };
    assert.equal(await run(), false);
    assert.equal(state().seq.next, clock + 6.5 * MIN);
    assert.ok(warnings.some(w => /no answer for 3 minutes/.test(w)));
    env.answer = '?';
    clock = state().seq.next;
    env.pending = true;
    assert.equal(await run(), false);
    env.pending = false;
    settings.pendingReplies = { 'mira.png': clock + HOUR };
    assert.equal(await run(), false);
    assert.equal(asked.length, 1);
}));

test('a catch-up works out the same sequence: the same waits, the same holds, the day\'s count, the last three days, at most thirty', fixedRandom(async () => {
    clock = T0;
    const { p, state, talk } = setup({ temperament: 'normal' });
    talk();
    const from = clock;
    // Normal: 40 minutes, then ×3 each: 40m, 2h, 6h, 18h after the one before
    const sim = p.simulateAway('mira.png', { name: 'Mira' }, { from, to: from + 30 * HOUR });
    const gaps = sim.events.map((e, i) => (e.at - (i ? sim.events[i - 1].at : from)) / MIN);
    assert.deepEqual(gaps, [40, 120, 360, 1080]);
    assert.ok(sim.events.every(e => typeof e.type === 'string' && 'note' in e));
    assert.match(sim.guidance, /^They were sent one after another with no reply from Qi in between\./);
    // Where it stands by then, on a copy: the fifth 54 hours after the fourth
    assert.equal(sim.state.unanswered, 4);
    assert.equal(sim.state.seq.next, sim.events[3].at + 3240 * MIN);
    // The day's count goes by the day each fell on: two on the 1st (04:41, 22:41)
    assert.deepEqual(sim.state._daily, { day: '2026-11-01', count: 2 });
    assert.equal(state().unanswered, 0);
    // Adopted: hers now
    p.adoptSimulation('mira.png', sim.state);
    assert.equal(state().unanswered, 4);
    // Asleep from 21:00 to 07:00 every day: the one due at 22:41 waits till 07:00, then on from there
    clock = T0;
    const sleepy = setup({ temperament: 'normal' });
    sleepy.talk();
    const at = (d, h) => new Date(2026, 9, d, h).getTime();
    sleepy.env.schedule = ms => { const d = new Date(ms); const h = d.getHours(); return h >= 21 || h < 7
        ? { phone: 'asleep', endsAt: at(d.getDate() + (h >= 21 ? 1 : 0), 7) } : { phone: 'free', endsAt: ms + HOUR }; };
    const night = sleepy.p.simulateAway('mira.png', { name: 'Mira' }, { from: clock, to: clock + 12 * HOUR });
    assert.deepEqual(night.events.map(e => e.at), [clock + 40 * MIN, at(32, 7)]);
    // You playing the main chat then: put off past it (kept in index.js storySpans)
    clock = T0;
    const played = setup({ temperament: 'normal' });
    played.talk();
    const start = clock;
    played.env.storyUntil = ms => (ms >= start && ms < start + HOUR ? start + HOUR : 0);
    assert.equal(played.p.simulateAway('mira.png', { name: 'Mira' }, { from: start, to: start + 2 * HOUR }).events[0].at, start + HOUR);
    // The day's count used up: nothing that day, and the bar can say why
    clock = T0;
    const full = setup({ temperament: 'clingy' });
    full.talk();
    full.settings.proactiveDaily = { day: '2026-10-31', count: 20 };
    const capped = full.p.simulateAway('mira.png', { name: 'Mira' }, { from: clock, to: clock + 3 * HOUR });
    assert.deepEqual(capped.events, []);
    assert.deepEqual(capped.quiet, { why: 'limit' });
    // A week away, obsessed: only the last three days' are written, thirty at most, the latest kept
    clock = T0;
    const away = setup({ temperament: 'obsessed' });
    away.talk();
    away.settings.proactiveDailyLimit = 1000;
    const week = away.p.simulateAway('mira.png', { name: 'Mira' }, { from: clock, to: clock + 7 * 24 * HOUR });
    assert.ok(week.events.length <= 30);
    assert.ok(week.events.every(e => e.at > clock + 4 * 24 * HOUR));
}));

test('the insights: her next text and how many are unanswered, what holds it, or waiting to reply', fixedRandom(async () => {
    clock = T0;
    const { p, state, talk, run, env, chat } = setup({ temperament: 'normal' });
    talk();
    assert.equal(p.getProactiveInsightsSnapshot().next, 'Next text in 40m');
    clock = state().seq.next;
    await run();
    assert.equal(p.getProactiveInsightsSnapshot().next, 'Next text in 2h · 1 unanswered');
    env.schedule = { phone: 'asleep', endsAt: new Date(2026, 10, 1, 7).getTime() };
    assert.equal(p.getProactiveInsightsSnapshot().next, 'Asleep until 07:00 · 1 unanswered');
    env.schedule = null;
    chat().push({ is_user: true, mes: 'hey', send_date: clock });
    p.markProactiveUserActivity('mira.png', clock);
    assert.equal(p.getProactiveInsightsSnapshot().next, 'Waiting to reply');
    assert.equal(p.getProactiveInsightsSnapshot().character, 'Mira · Normal');
}));
