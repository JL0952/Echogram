// Run: node --test tests/*.test.mjs
// Follow-up rounds (docs/platform-plan.md 12d-1) through the real engine in
// lib/proactive-messaging.js: a fake clock, the model stubbed, typing delays skipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = {};
for (const f of ['lib/proactive-rounds.js', 'lib/proactive-messaging.js']) {
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

function setup({ temperament = 'clingy', answer = '?\n---\n人呢\n---\n你去哪了\n---\n算了', schedule = null, group = false } = {}) {
    const settings = { enabled: true, proactiveMessagingEnabled: true, chatHistory: { 'mira.png': [] }, proactiveState: {} };
    const asked = [];
    const warnings = [];
    const env = { temperament, answer, schedule, group };
    const p = window.EchoTextProactiveMessaging.createProactiveMessaging({
        getSettings: () => settings, saveSettings: () => {}, warn: (...a) => warnings.push(a.join(' ')),
        getCurrentCharacter: () => ({ name: 'Mira', avatar: 'mira.png' }), getCharacterKey: () => 'mira.png',
        getChatHistory: () => settings.chatHistory['mira.png'], getUserName: () => 'Qi',
        getTemperament: () => env.temperament, getScheduleNow: () => env.schedule,
        isGroupSession: () => env.group, isPanelOpen: () => true, getIsGenerating: () => false, getEmotionState: () => null,
        buildApiMessagesFromHistoryForChar: async (history, extraSystem) => ({ apiMessages: [{ role: 'system', content: extraSystem.join('\n') }], rawPrompt: '', systemPrompt: '' }),
        requestEchoTextCompletion: async ({ apiMessages }) => { asked.push(apiMessages); return env.answer; },
        readReply: t => ({ mes: String(t).trim(), mood: null, life: null }),
        renderMessages: () => {}, setTypingIndicatorVisible: () => {}, setFabUnreadIndicator: () => {}, noteMoodReport: () => {},
        findLastUserMessageIndex: h => h.map(m => m.is_user).lastIndexOf(true),
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
    return { p, settings, asked, warnings, env, chat, state, talk };
}

test('you go quiet mid-conversation: a round, written in one request, let out one by one', async () => {
    clock = T0;
    const { p, asked, chat, state, talk } = setup();
    talk();
    const round = state().round;
    assert.equal(round.times.length, 4);
    assert.ok(round.times[0] - clock >= 3 * MIN && round.times[0] - clock <= 10 * MIN);
    // Not yet: nothing asked
    clock = round.times[0] - 1000;
    assert.equal(await p.runDueRound(), true);
    assert.equal(asked.length, 0);
    // The first is due: one request for the round, its first text out now
    clock = round.times[0];
    await p.runDueRound();
    assert.equal(asked.length, 1);
    const turn = asked[0].at(-1).content;
    assert.match(asked[0][0].content, /^FOLLOW-UP MODE: Qi stopped answering/);
    assert.match(turn, /Write the 4 texts Mira sends while still getting no answer/);
    assert.match(turn, /a little more needy with each one/);
    assert.deepEqual(chat().slice(-1).map(m => [m.mes, m.meta.proactiveType, m.send_date]), [['?', 'follow_up', round.times[0]]]);
    assert.equal(state().round.sent, 1);
    // The page slept through the rest: they go in with their own times, no new request
    clock = round.times[3] + 2 * HOUR;
    await p.runDueRound();
    assert.equal(asked.length, 1);
    assert.deepEqual(chat().slice(-3).map(m => [m.mes, m.send_date]), [['人呢', round.times[1]], ['你去哪了', round.times[2]], ['算了', round.times[3]]]);
    // Clingy lets it go after that
    assert.equal(state().round, null);
});

test('you answer: the round is over, even one being written', async () => {
    clock = T0;
    const { p, asked, chat, state, talk, env } = setup();
    talk();
    p.markProactiveUserActivity('mira.png', clock);
    assert.equal(state().round, null);
    // Answering while the texts are being written: they're thrown away
    talk();
    const due = state().round.times[0];
    let release;
    env.answer = new Promise(resolve => { release = () => resolve('?\n---\n人呢'); });
    clock = due;
    const running = p.runDueRound();
    await new Promise(r => queueMicrotask(r));
    chat().push({ is_user: true, mes: 'sorry', send_date: clock });
    p.markProactiveUserActivity('mira.png', clock);
    release();
    await running;
    assert.equal(asked.length, 1);
    assert.equal(chat().at(-1).mes, 'sorry');
    assert.equal(state().round, null);
});

test('no round when you weren\'t talking, in a group, or with follow-ups off', () => {
    clock = T0;
    const a = setup();
    a.chat().push({ is_user: true, mes: 'hey', send_date: clock - 2 * HOUR }, { is_user: false, mes: 'hi', send_date: clock });
    a.p.markProactiveCharacterActivity('mira.png', false, 'reply', clock);
    assert.equal(a.state().round, null);
    const b = setup({ group: true });
    b.talk();
    assert.equal(b.state().round, null);
    const c = setup();
    c.settings.proactiveMessagingEnabled = false;
    c.talk();
    assert.equal(c.state().round, null);
});

test('obsessed: another round hours later, more insistent; until the day\'s requests run out', async () => {
    clock = T0;
    const { p, asked, state, talk, env } = setup({ temperament: 'obsessed', answer: Array.from({ length: 10 }, (_, i) => `msg ${i}`).join('\n---\n') });
    talk();
    const first = state().round;
    assert.equal(first.times.length, 10);
    clock = first.times[9];
    await p.runDueRound();
    const second = state().round;
    assert.equal(second.number, 2);
    assert.ok(second.times[0] - first.times[9] >= 2 * HOUR && second.times[0] - first.times[9] <= 4 * HOUR);
    clock = second.times[0];
    await p.runDueRound();
    assert.match(asked[1].at(-1).content, /hasn't answered Mira's earlier follow-ups for hours either/);
    assert.match(asked[1].at(-1).content, /more anxious and insistent/);
    // 30 requests a day: the 31st doesn't go
    state().requests = { day: p.getDateKeyLocal(new Date(clock)), count: 30 };
    state().round = { number: 3, startedAt: clock, times: [clock + MIN], texts: null, sent: 0 };
    clock += MIN;
    await p.runDueRound();
    assert.equal(asked.length, 2);
    assert.equal(state().round, null);
    assert.equal(state().capped.reason, 'daily');
    env.temperament = 'clingy';
});

test('Daily Life: asleep or busy, the round waits for them', async () => {
    clock = T0;
    const { p, asked, state, talk, env } = setup();
    talk();
    const due = state().round.times[0];
    const later = state().round.times[1];
    clock = due;
    env.schedule = { phone: 'asleep', endsAt: due + 8 * HOUR };
    await p.runDueRound();
    assert.equal(asked.length, 0);
    assert.equal(state().round.times[0], due + 8 * HOUR);
    assert.equal(state().round.times[1], later + 8 * HOUR);
    // Awake: it goes
    clock = state().round.times[0];
    env.schedule = { phone: 'free', endsAt: clock + HOUR };
    await p.runDueRound();
    assert.equal(asked.length, 1);
});

test('aloof: sometimes nothing at all', () => {
    clock = T0;
    const realRandom = Math.random;
    Math.random = () => 0.1;
    const { state, talk } = setup({ temperament: 'aloof' });
    talk();
    Math.random = realRandom;
    assert.equal(state().round, null);
});

test('the insights panel: the round\'s next text and the day\'s limit', async () => {
    clock = T0;
    const { p, state, talk } = setup();
    talk();
    const due = state().round.times[0];
    clock = due - 5 * MIN;
    assert.equal(p.getProactiveInsightsSnapshot().next, 'Follow-up 1/4 in 5m');
    p.markProactiveUserActivity('mira.png', clock);
    state().requests = { day: p.getDateKeyLocal(new Date(clock)), count: 15 };
    assert.equal(p.getProactiveInsightsSnapshot().next, 'Daily limit reached');
});
