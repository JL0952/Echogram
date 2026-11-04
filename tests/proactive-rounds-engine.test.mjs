// Run: node --test tests/*.test.mjs
// Follow-up rounds (docs/platform-plan.md 12d-1) through the real engine in
// lib/proactive-messaging.js: a fake clock, the model stubbed, typing delays skipped.
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

function setup({ temperament = 'clingy', answer = '?\n---\n人呢\n---\n你去哪了\n---\n算了', schedule = null, group = false } = {}) {
    const settings = { enabled: true, proactiveMessagingEnabled: true, chatHistory: { 'mira.png': [] }, proactiveState: {} };
    const asked = [];
    const warnings = [];
    const env = { temperament, answer, schedule, group, open: 'mira.png', bars: [] };
    const p = window.EchoTextProactiveMessaging.createProactiveMessaging({
        getSettings: () => settings, saveSettings: () => {}, warn: (...a) => warnings.push(a.join(' ')),
        // The chat open now (index.js chatTarget): another one when a test sets env.open
        getCurrentCharacter: () => ({ name: env.open === 'mira.png' ? 'Mira' : 'Other', avatar: env.open }), getCharacterKey: () => env.open,
        chatTarget: () => ({ group: null, combine: false, key: env.open }), isViewing: t => !!t && t.key === env.open,
        getChatHistory: () => settings.chatHistory['mira.png'], getUserName: () => 'Qi',
        getTemperament: () => env.temperament, getStoryPauseUntil: () => env.storyUntil || 0,
        // Now, or at a time (ms) when a catch-up looks back: a test may give either as a function of the time
        getScheduleNow: at => (typeof env.schedule === 'function' ? env.schedule(at ?? Date.now()) : env.schedule),
        getDailyLife: at => (typeof env.day === 'function' ? env.day(at ?? Date.now()) : env.day || null),
        withYouAt: at => (env.together || []).some(span => span.from <= at && at < span.until),
        catchUpPending: () => !!env.pending,
        expandTimeDateMacros: t => t, replaceMacros: t => t, getActiveFeatures: () => [], getProactivePace: () => 1,
        isGroupSession: () => env.group, isPanelOpen: () => true, getIsGenerating: () => !!env.generating, getEmotionState: () => env.feelings || null,
        getMemories: () => env.memories || [],
        // The bar over the messages while texts gone by are written (index.js setRoundBar)
        setRoundBar: on => env.bars.push(on),
        buildApiMessagesFromHistoryForChar: async (history, extraSystem) => {
            env.onBuild?.();
            return { apiMessages: [{ role: 'system', content: extraSystem.join('\n') }], rawPrompt: '', systemPrompt: '' };
        },
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
    // That there's no reply is said once, in the turn
    assert.match(asked[0][0].content, /^FOLLOW-UP MODE: you are texting Qi again on your own\.\n<proactive_situation>\nIt is currently [^\n]+\.\n<\/proactive_situation>$/);
    assert.match(turn, /Qi hasn't replied since Mira's last text\. Write the 4 texts Mira sends meanwhile \(it is now \d\d:\d\d\):\n- text 1: \d\d:\d\d, \d+ minutes after Mira's last one\n/);
    assert.match(turn, /Each text is a fresh decision Mira makes at its own time/);
    assert.match(turn, /At most two of them mention that Qi hasn't replied\./);
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
    assert.match(asked[1].at(-1).content, /Qi hasn't replied since Mira's last text or the ones after it\./);
    assert.match(asked[1].at(-1).content, /Any of them may come back to Qi's silence\./);
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

test('with you in person: no round starts, and one under way stops', () => {
    const together = setup({ schedule: { phone: 'together', endsAt: clock + HOUR } });
    together.talk();
    assert.equal(together.state().round ?? null, null);
    const running = setup();
    running.talk();
    assert.ok(running.state().round);
    running.p.dropRound('mira.png');
    assert.equal(running.state().round, null);
});

test('the text after parting is planned by temperament and gone once you text', () => {
    clock = T0;
    const realRandom = Math.random;
    Math.random = () => 0.5;
    const { p, state, env } = setup({ temperament: 'clingy' });
    p.planParted('mira.png', clock);
    assert.equal(state().parted.at, clock + 15 * MIN);
    p.markProactiveUserActivity('mira.png', clock + MIN);
    assert.equal(state().parted, null);
    // Their proactive text says it too
    p.planParted('mira.png', clock);
    p.markProactiveCharacterActivity('mira.png', true, 'catch_up', clock + MIN);
    assert.equal(state().parted, null);
    // Noticed hours later: left unsent
    p.planParted('mira.png', clock - 3 * HOUR);
    assert.equal(state().parted, null);
    // Their temperament lets it go
    env.temperament = 'aloof';
    p.planParted('mira.png', clock);
    assert.equal(state().parted, null);
    Math.random = realRandom;
});

test('the scheduler sends the text after parting once, right after another text if need be', async () => {
    clock = T0;
    const realRandom = Math.random;
    const realInterval = globalThis.setInterval;
    const realClear = globalThis.clearInterval;
    const RealDate = globalThis.Date;
    // The tick asks new Date(): on the fake clock too
    globalThis.Date = class extends RealDate {
        constructor(...args) { if (args.length) super(...args); else super(clock); }
        static now() { return clock; }
    };
    let tick = null;
    globalThis.setInterval = fn => { tick = fn; return 1; };
    globalThis.clearInterval = () => {};
    Math.random = () => 0.5;
    const { p, settings, asked, chat, state, env, warnings } = setup({ temperament: 'clingy', answer: '到了' });
    env.day = { phone: 'free', block: null, since: null, prevPhone: 'free', prevDoing: '', today: '2026-10-31', life: { errands: [], log: [], today: null } };
    settings.proactiveCharacterConfig = {};
    chat().push({ is_user: true, mes: 'hey', send_date: clock - 2 * HOUR }, { is_user: false, mes: 'news', send_date: clock - 5 * MIN, meta: { proactive: true, proactiveType: 'random_thought' } });
    p.startProactiveScheduler();
    p.planParted('mira.png', clock);
    state().lastProactiveAt = clock - 5 * MIN;
    clock += 2 * MIN;
    await tick();
    await new Promise(resolve => queueMicrotask(resolve));
    assert.equal(asked.length, 0, 'not yet');
    clock += 14 * MIN;
    await tick();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(warnings, []);
    assert.equal(asked.length, 1);
    assert.match(JSON.stringify(asked[0]), /have just parted/);
    assert.equal(chat().at(-1).meta.proactiveType, 'parted');
    assert.equal(state().parted, null);
    clock += 2 * MIN;
    await tick();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(asked.length, 1, 'only once');
    p.stopProactiveScheduler();
    globalThis.setInterval = realInterval;
    globalThis.clearInterval = realClear;
    globalThis.Date = RealDate;
    Math.random = realRandom;
});

test('a follow-up waits while you play the main chat, the rest moved along with it', async () => {
    clock = T0;
    const { p, env, asked, chat, state, talk } = setup({ temperament: 'clingy' });
    talk();
    const before = state().round.times.slice();
    const pausedUntil = before[0] + 10 * MIN;
    env.storyUntil = pausedUntil;
    clock = before[0];
    assert.equal(await p.runDueRound(), true);
    assert.equal(asked.length, 0);
    assert.equal(state().round.times[0], pausedUntil);
    assert.equal(state().round.times[1] - state().round.times[0], before[1] - before[0]);
    // Once it's been quiet: the round goes on
    env.storyUntil = 0;
    clock = pausedUntil;
    await p.runDueRound();
    assert.equal(asked.length, 1);
    assert.equal(chat().at(-1).mes, '?');
});

test('a round is written for its own chat: another one open by then, nothing is sent till it\'s back', async () => {
    clock = T0;
    const { p, env, asked, chat, state, talk } = setup({ temperament: 'clingy' });
    talk();
    const round = state().round;
    clock = round.times[0];
    // You open another chat while its prompt is put together
    env.onBuild = () => { env.open = 'other.png'; };
    assert.equal(await p.runDueRound(), true);
    assert.equal(asked.length, 0);
    assert.equal(state().round, round);
    assert.equal(round.texts, null);
    assert.equal(chat().length, 2);
    // Back on her chat: written and let out then
    env.onBuild = null;
    env.open = 'mira.png';
    await p.runDueRound();
    assert.equal(asked.length, 1);
    assert.equal(chat().at(-1).mes, '?');
});

test('the chat a round followed cleared: the round ends and nothing lands in the new chat', async () => {
    clock = T0;
    const { p, settings, chat, state, talk } = setup({ temperament: 'clingy' });
    talk();
    const round = state().round;
    clock = round.times[0];
    await p.runDueRound();
    assert.equal(chat().at(-1).mes, '?');
    settings.chatHistory['mira.png'] = [];
    clock = round.times[1];
    assert.equal(await p.runDueRound(), false);
    assert.equal(state().round, null);
    assert.deepEqual(chat(), []);
});

test('a round whose texts have all gone by (the page wasn\'t running) is told them by the clock, with a bar up while it\'s written', async () => {
    clock = T0;
    const { p, env, asked, chat, state, talk } = setup({ temperament: 'clingy' });
    talk();
    const round = state().round;
    const hm = ms => new Date(ms).toTimeString().slice(0, 5);
    // Back an hour after the last of them, the same evening
    clock = round.times[3] + HOUR;
    await p.runDueRound();
    const turn = asked[0].at(-1).content;
    assert.match(turn, new RegExp(`Write the 4 texts Mira sent meanwhile, while Qi was away \\(it is now ${hm(clock)}\\):\\n- text 1: ${hm(round.times[0])}\\n- text 2: ${hm(round.times[1])}\\n.*\\n- text 4: ${hm(round.times[3])}\\n`));
    assert.doesNotMatch(turn, /after Mira's last one/);
    assert.deepEqual(env.bars, [true, false]);
    assert.deepEqual(chat().slice(-4).map(m => m.send_date), round.times);
});

test('with a schedule, each text of a round says what she is doing at its time', async () => {
    clock = T0;
    const { p, asked, env, state, talk } = setup({ temperament: 'clingy' });
    talk();
    const round = state().round;
    // Out until the third text's time, then on the way home
    env.day = at => ({ phone: 'free', block: at < round.times[2] ? { from: '18:00', to: '21:00', doing: '逛街', place: '城里', phone: 'free' }
        : { from: '21:00', to: '22:00', doing: '', place: '回家路上', phone: 'busy' } });
    clock = round.times[0];
    await p.runDueRound();
    // The schedule's line, as the schedule has it
    assert.match(asked[0].at(-1).content, /- text 1: [^\n]+ · 18:00–21:00 逛街 \(城里\)\n- text 2: [^\n]+ · 18:00–21:00 逛街 \(城里\)\n- text 3: [^\n]+ · 21:00–22:00 回家路上 \[busy\]\n- text 4: [^\n]+ · 21:00–22:00 回家路上 \[busy\]\n/);
});

test('a round only partly gone by keeps its waits (the first going in quietly, with the bar); one due now has no bar', async () => {
    clock = T0;
    const late = setup({ temperament: 'clingy' });
    late.talk();
    clock = late.state().round.times[0] + 2 * MIN;
    await late.p.runDueRound();
    assert.match(late.asked[0].at(-1).content, /Write the 4 texts Mira sends meanwhile \(it is now \d\d:\d\d\):\n- text 1: \d\d:\d\d, \d+ minutes after Mira's last one\n/);
    assert.deepEqual(late.env.bars, [true, false]);
    clock = T0;
    const due = setup({ temperament: 'clingy' });
    due.talk();
    clock = due.state().round.times[0];
    await due.p.runDueRound();
    assert.equal(due.asked.length, 1);
    assert.deepEqual(due.env.bars, []);
});

test('a round put off by another generation goes as soon as that\'s over and its timer is set again', async () => {
    clock = T0;
    const { p, env, asked, chat, state, talk } = setup({ temperament: 'clingy' });
    talk();
    const round = state().round;
    clock = round.times[0];
    // A catch-up, say, is running: it waits (its own retry is half a minute off)
    env.generating = true;
    assert.equal(await p.runDueRound(), true);
    assert.equal(asked.length, 0);
    // Over: setting the timer again (index.js onGenerationSettled) lets it go a second later
    env.generating = false;
    p.armRoundTimer();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(asked.length, 1);
    assert.equal(chat().at(-1).mes, '?');
});

// ── Catching up: what would have been sent while the page wasn't running, by the same rules (simulateAway) ──
const R = window.EchoTextProactiveRounds;
const morning = new Date(2026, 9, 31, 8, 0).getTime();
const dayKey = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fixedRandom = fn => async () => { const real = Math.random; Math.random = () => 0.5; try { await fn(); } finally { Math.random = real; } };
const follows = events => events.filter(e => e.kind === 'follow_up');

test('away during a round: the rest of it, then an obsessed character\'s next rounds, at the rules\' own times, one request a round', fixedRandom(async () => {
    clock = morning;
    const { p, state, talk } = setup({ temperament: 'obsessed' });
    talk();
    const first = state().round;
    const r1 = first.times.slice();
    const from = clock, to = clock + 10 * HOUR;
    const sim = p.simulateAway('mira.png', { name: 'Mira' }, { from, to });
    // The next round as the live engine plans it (runDueRound → nextRound → planRound)
    const r2 = R.planRound({ temperament: 'obsessed', startAt: r1.at(-1), firstHours: [2, 4], random: () => 0.5 });
    const r3 = R.planRound({ temperament: 'obsessed', startAt: r2.at(-1), firstHours: [2, 4], random: () => 0.5 });
    assert.deepEqual(sim.events.map(e => e.at), [...r1, ...r2].filter(t => t <= to));
    assert.ok(sim.events.every(e => e.kind === 'follow_up'));
    assert.deepEqual([...new Set(sim.events.map(e => e.round))], [1, 2]);
    // Numbered only; how they're written said once
    assert.equal(sim.events[0].note, 'follow-up 1');
    assert.equal(sim.events[10].note, 'follow-up 1 of round 2');
    assert.match(sim.followUps, /^Each follow-up is a fresh decision Mira makes at its own time.* Any of them may come back to Qi's silence\.$/);
    // Where it stands by then: the third round ahead, two requests counted today
    assert.equal(sim.state.round.number, 3);
    assert.deepEqual(sim.state.round.times, r3);
    assert.deepEqual(sim.state.requests, { day: dayKey(morning), count: 2 });
    // Worked out on copies: nothing changed yet
    assert.equal(state().round, first);
    assert.equal(first.sent, 0);
    // Adopted: the round goes on from there
    p.adoptSimulation('mira.png', sim.state);
    assert.equal(state().round.number, 3);
    assert.equal(state().requests.count, 2);
}));

test('catching up, asleep: a round\'s text waits till they\'re up, the rest moved along with it', fixedRandom(async () => {
    clock = morning;
    const { p, env, state, talk } = setup({ temperament: 'clingy' });
    talk();
    const times = state().round.times.slice();
    // Asleep from just after the first text until three hours on
    const sleep = [times[0] + MIN, clock + 3 * HOUR];
    env.schedule = at => (at >= sleep[0] && at < sleep[1] ? { phone: 'asleep', endsAt: sleep[1] } : { phone: 'free', endsAt: sleep[0] > at ? sleep[0] : 0 });
    const sim = p.simulateAway('mira.png', { name: 'Mira' }, { from: clock, to: clock + 8 * HOUR });
    const shift = sleep[1] - times[1];
    assert.deepEqual(follows(sim.events).map(e => e.at), [times[0], ...times.slice(1).map(t => t + shift)]);
}));

test('catching up, with you: the round stops when that began, and nothing new comes while you\'re together', fixedRandom(async () => {
    clock = morning;
    const { p, env, state, talk } = setup({ temperament: 'obsessed' });
    talk();
    const times = state().round.times.slice();
    env.together = [{ from: times[3] - 1000, until: clock + 6 * HOUR }];
    const sim = p.simulateAway('mira.png', { name: 'Mira' }, { from: clock, to: clock + 8 * HOUR });
    assert.deepEqual(follows(sim.events).map(e => e.at), times.slice(0, 3));
    assert.ok(sim.events.every(e => e.at < env.together[0].from || e.at >= env.together[0].until));
    assert.equal(sim.state.round, null);
}));

test('catching up: the day\'s requests run out and the next round doesn\'t come', fixedRandom(async () => {
    clock = morning;
    const { p, state, talk } = setup({ temperament: 'obsessed' });
    talk();
    state().requests = { day: dayKey(morning), count: 29 };
    const r1 = state().round.times.slice();
    const sim = p.simulateAway('mira.png', { name: 'Mira' }, { from: clock, to: clock + 10 * HOUR });
    assert.deepEqual(follows(sim.events).map(e => e.at), r1);
    assert.equal(sim.state.round, null);
    assert.equal(sim.state.capped.reason, 'daily');
}));

test('catching up: only the last three days are written, at most thirty texts, the latest kept', fixedRandom(async () => {
    clock = morning;
    const { p, talk } = setup({ temperament: 'obsessed' });
    talk();
    const from = clock, to = clock + 5 * 24 * HOUR;
    const all = p.simulateAway('mira.png', { name: 'Mira' }, { from, to, days: 99, max: Infinity });
    const kept = p.simulateAway('mira.png', { name: 'Mira' }, { from, to });
    assert.ok(all.events.length > 30);
    assert.equal(kept.events.length, 30);
    assert.deepEqual(kept.events, all.events.filter(e => e.at > to - 3 * 24 * HOUR).slice(-30));
    assert.deepEqual(kept.state.round, all.state.round);
}));

test('catching up, no round: new topics on the scheduler\'s ticks by the same triggers, each waiting longer with none answered, up to the temperament', fixedRandom(async () => {
    clock = morning;
    const { p, settings, state } = setup({ temperament: 'normal' });
    // A day ago you two talked; no round left
    settings.chatHistory['mira.png'].push({ is_user: true, mes: 'hey', send_date: clock - 24 * HOUR }, { is_user: false, mes: 'hi', send_date: clock - 24 * HOUR + MIN });
    p.syncProactiveStateWithHistory('mira.png', settings.chatHistory['mira.png']);
    assert.equal(state().round, undefined);
    const sim = p.simulateAway('mira.png', { name: 'Mira' }, { from: clock, to: clock + 3 * 24 * HOUR });
    const topics = sim.events.filter(e => e.kind === 'topic');
    // Normal: two in a row with no answer at most, the second after three times the wait (6–10 hours)
    assert.ok(topics.length >= 1 && topics.length <= 2, String(topics.length));
    assert.ok(topics.every(e => e.type && e.note && (e.at - clock) % (2 * MIN) === 0));
    if (topics.length === 2) assert.ok(topics[1].at - topics[0].at >= 18 * HOUR);
    // Each counted toward its own day's requests
    const lastDay = dayKey(topics.at(-1).at);
    assert.deepEqual(sim.state.requests, { day: lastDay, count: topics.filter(e => dayKey(e.at) === lastDay).length });
}));

test('catching up: a round written before you left comes back as it was written, with no request counted for it', fixedRandom(async () => {
    clock = morning;
    const { p, state, talk } = setup({ temperament: 'clingy' });
    talk();
    const round = state().round;
    round.texts = ['?', '人呢', '你去哪了', '算了'].map(mes => ({ mes, mood: null, life: null }));
    round.sent = 1;
    const sim = p.simulateAway('mira.png', { name: 'Mira' }, { from: clock, to: clock + 4 * HOUR });
    assert.deepEqual(follows(sim.events).map(e => e.text?.mes), ['人呢', '你去哪了', '算了']);
    assert.equal(sim.state.requests, undefined);
}));

test('a catch-up due holds the live round and new topics back; you texted while it ran: no round is left to adopt', fixedRandom(async () => {
    clock = morning;
    const { p, env, asked, state, talk } = setup({ temperament: 'obsessed' });
    talk();
    env.pending = true;
    clock = state().round.times[0];
    assert.equal(await p.runDueRound(), true);
    assert.equal(asked.length, 0);
    env.pending = false;
    const sim = p.simulateAway('mira.png', { name: 'Mira' }, { from: clock - 10 * MIN, to: clock + 10 * HOUR });
    p.markProactiveUserActivity('mira.png', clock + 10 * HOUR + MIN);
    p.adoptSimulation('mira.png', sim.state);
    assert.equal(state().round, null);
}));

test('catching up: a shared moment from the memories goes in once, then not again for a week', async () => {
    const real = Math.random;
    // The rolls: the second kind of four (Thinking of you), its one text, its one memory
    Math.random = () => 0.3;
    try {
        clock = morning;
        const { p, env, chat, state } = setup({ temperament: 'normal' });
        env.feelings = { rapport: 40 };
        env.memories = [{ id: 'm1', category: 'shared_moment', content: '第一次一起看烟花' }, { id: 'x', category: 'shared_moment', content: '  ' }];
        chat().push({ is_user: true, mes: 'hey', send_date: clock - 3 * HOUR }, { is_user: false, mes: 'hi', send_date: clock - 3 * HOUR + MIN });
        const sim = p.simulateAway('mira.png', { name: 'Mira' }, { from: clock, to: clock + 24 * HOUR });
        const topics = sim.events.filter(e => e.kind === 'topic');
        assert.ok(topics.length >= 2, String(topics.length));
        assert.equal(topics[0].type, 'memory_nudge');
        assert.match(topics[0].note, /Something reminded Mira of this: "第一次一起看烟花"$/);
        // Kept with when it went; the next ones don't bring it up (and an empty memory never does)
        assert.deepEqual(sim.state.recalled, { m1: topics[0].at });
        assert.ok(topics.slice(1).every(e => !e.note.includes('Something reminded')));
        // Adopted with the rest
        p.adoptSimulation('mira.png', sim.state);
        assert.deepEqual(state().recalled, { m1: topics[0].at });
    } finally {
        Math.random = real;
    }
});
