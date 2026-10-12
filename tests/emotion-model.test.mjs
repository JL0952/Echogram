// Run: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = {};
new Function(readFileSync(new URL('../lib/emotion-model.js', import.meta.url), 'utf8'))();
const Model = window.EchoTextEmotionModel;

const NOW = 1760000000000;
const chatWith = values => ({ start: { ...Model.zeroValues(), ...values }, startAt: NOW });

test('eleven feelings, desire only with NSFW on', () => {
    assert.equal(Model.DIMENSIONS.length, 11);
    assert.deepEqual(Model.activeDimensions().map(d => d.id),
        ['rapport', 'romance', 'joy', 'anticipation', 'eagerness', 'shock', 'sadness', 'anxiety', 'anger', 'disgust']);
    assert.ok(Model.activeDimensions({ nsfw: true }).some(d => d.id === 'desire'));
    for (const dim of Model.DIMENSIONS) assert.ok(Model.GROUPS.some(g => g.id === dim.group), dim.id);
});

test('a profile is filled in and cleaned up', () => {
    assert.deepEqual(Model.normalizeProfile(undefined), {
        bigFive: { E: 'mid', A: 'mid', C: 'mid', O: 'mid', N: 'mid' },
        morality: 'mid',
        locks: {},
        textingStyle: { type: 'instruction', text: '' },
    });
    const profile = Model.normalizeProfile({
        bigFive: { E: 'high', A: 'very', N: 'low' },
        locks: { romance: 140, trust: 50, joy: '35' },
        textingStyle: { type: 'example', text: 'lol ok' },
        mbtiType: 'INTJ',
    });
    assert.deepEqual(profile.bigFive, { E: 'high', A: 'mid', C: 'mid', O: 'mid', N: 'low' });
    assert.equal(Model.normalizeProfile({ morality: 'low' }).morality, 'low');
    assert.equal(Model.normalizeProfile({ morality: 'evil' }).morality, 'mid');
    assert.deepEqual(profile.locks, { romance: 100, joy: 35 });
    assert.deepEqual(profile.textingStyle, { type: 'example', text: 'lol ok' });
    assert.equal(profile.mbtiType, undefined);
});

test('the old emotion state is replaced by a fresh one', () => {
    const old = { joy: 40, trust: 20, love: 70, personalityAnchor: {}, mbtiType: 'ISFP', lastUpdated: 5 };
    assert.deepEqual(Model.normalizeChatState(old, NOW), { start: Model.zeroValues(), startAt: NOW });
    assert.deepEqual(Model.normalizeChatState(null, NOW), { start: Model.zeroValues(), startAt: NOW });
});

test('a chat state keeps its values, clamped, and its start time', () => {
    const state = Model.normalizeChatState({ start: { joy: 55.4, anger: -3, shock: 300, trust: 9 }, startAt: 123 }, NOW);
    assert.equal(state.startAt, 123);
    assert.deepEqual(state.start, { ...Model.zeroValues(), joy: 55, anger: 0, shock: 100 });
    assert.equal(Model.normalizeChatState({ start: {} }, NOW).startAt, NOW);
});

test('locks win over the chat, and desire counts only with NSFW on', () => {
    const chat = chatWith({ romance: 20, joy: 60, desire: 50 });
    const profile = Model.normalizeProfile({ locks: { romance: 100, desire: 90 } });
    const off = Model.computeState({ chat, profile });
    assert.equal(off.romance, 100);
    assert.equal(off.joy, 60);
    assert.equal(off.desire, 0);
    assert.equal(Model.computeState({ chat, profile, nsfw: true }).desire, 90);
    // The chat's own values are left alone
    assert.equal(chat.start.romance, 20);
});

test('rapport goes down to -100, the rest stop at 0', () => {
    assert.equal(Model.clampValue(-40, 'rapport'), -40);
    assert.equal(Model.clampValue(-140, 'rapport'), -100);
    assert.equal(Model.clampValue(-40, 'joy'), 0);
    assert.equal(Model.clampValue(-40), 0);
    assert.equal(Model.normalizeChatState({ start: { rapport: -60, anger: -10 } }, NOW).start.rapport, -60);
    assert.equal(Model.normalizeProfile({ locks: { rapport: -250 } }).locks.rapport, -100);
});

test('the strongest feeling, or none when everything is at 0', () => {
    assert.equal(Model.strongest(Model.zeroValues()), null);
    const values = { ...Model.zeroValues(), joy: 40, anger: 65, desire: 90 };
    assert.equal(Model.strongest(values).dim.id, 'anger');
    assert.equal(Model.strongest(values).value, 65);
    assert.equal(Model.strongest(values, { nsfw: true }).dim.id, 'desire');
    // A strained relationship counts by how far it is from 0
    assert.deepEqual(Model.strongest({ ...values, rapport: -80 }).value, -80);
});

// ── Auto mode (docs/emotion-plan.md 3.8) ───────────────────────────────────

const HOUR = 3600000;
const reply = (mood, at = NOW, extra = {}) => ({ is_user: false, mes: 'ok', send_date: at, mood, ...extra });
const auto = (start, history, { now = NOW, locks = {}, N = 'mid', nsfw = false, startAt = NOW } = {}) => {
    const args = { chat: { start: { ...Model.zeroValues(), ...start }, startAt }, profile: Model.normalizeProfile({ locks, bigFive: { N } }), history, now, nsfw };
    return { values: Model.computeState(args), change: Model.lastChange(args) };
};

test('a <mood> line is taken out of the reply and read', () => {
    assert.deepEqual(Model.parseMoodTag('hey\nwhat\n<mood>anticipation 70, shock 10</mood>'),
        { text: 'hey\nwhat', mood: { anticipation: 70, shock: 10 } });
    // Across lines, with colons
    assert.deepEqual(Model.parseMoodTag('ok\n<mood>\njoy: 60\nanger: 10\n</mood>').mood, { joy: 60, anger: 10 });
    // Inside a line, the rest of the line stays
    assert.deepEqual(Model.parseMoodTag('see you <mood>joy 60</mood>'), { text: 'see you', mood: { joy: 60 } });
    // Without a tag the text is left exactly as it was
    assert.deepEqual(Model.parseMoodTag('a  b\n<photo>cat</photo> '), { text: 'a  b\n<photo>cat</photo> ', mood: null });
});

test('<mood> is read leniently: other tag names, Chinese names, aliases, attributes, unclosed', () => {
    assert.deepEqual(Model.parseMoodTag('好呀\n<情绪>开心：60，生气 10</情绪>'), { text: '好呀', mood: { joy: 60, anger: 10 } });
    assert.deepEqual(Model.parseMoodTag('ok <emotion happy="80" fear="20"/>'), { text: 'ok', mood: { joy: 80, anxiety: 20 } });
    assert.deepEqual(Model.parseMoodTag('<Mood>{"rapport": -30, "romance": 45}</Mood>').mood, { rapport: -30, romance: 45 });
    assert.deepEqual(Model.parseMoodTag('sure\n<mood>joy 60, sadness 5'), { text: 'sure', mood: { joy: 60, sadness: 5 } });
    assert.deepEqual(Model.parseMoodTag('<feelings>trust=55; crush 30; impatient 40</feelings>').mood, { rapport: 55, romance: 30, eagerness: 40 });
    // A stray closer goes; a later tag wins
    assert.equal(Model.parseMoodTag('hi</mood>').text, 'hi');
    assert.deepEqual(Model.parseMoodTag('<mood>joy 20</mood>\nhm\n<mood>joy 50, anger 5</mood>'), { text: 'hm', mood: { joy: 50, anger: 5 } });
});

test('a garbled <mood> line is still taken out; only what reads is kept', () => {
    assert.deepEqual(Model.parseMoodTag('lol\n<mood>feeling great</mood>'), { text: 'lol', mood: null });
    // A change ("+10") and an unknown name are left out; values are clamped
    assert.deepEqual(Model.parseMoodTag('<mood>joy +10, anger 30, bliss 90</mood>').mood, { anger: 30 });
    assert.deepEqual(Model.parseMoodTag('<mood>joy 150, rapport −300, anger -5, shock 62.6</mood>').mood, { joy: 100, rapport: -100, anger: 0, shock: 63 });
});

test('Auto mode: each report moves a feeling at most a step; the chat\'s first sets unset ones straight away', () => {
    const history = [
        { is_user: true, mes: 'hi', send_date: NOW },
        reply({ joy: 90, anger: 50, rapport: 60 }),
        reply({ anger: 0, rapport: 100 }),
    ];
    // First report: joy was set (20), so it moves 25; anger and rapport were at 0 and go straight there.
    // Second: anger −25, rapport +10.
    const { values, change } = auto({ joy: 20 }, history);
    assert.equal(values.joy, 45);
    assert.equal(values.anger, 25);
    assert.equal(values.rapport, 70);
    assert.deepEqual(change, { anger: -25, rapport: 10 });
    // Rapport and Romance always move 10 at most; the rest by Neuroticism
    const second = reply({ joy: 100, romance: 100 });
    assert.equal(auto({}, [reply({ shock: 5 }), second], { N: 'high' }).values.joy, 40);
    assert.equal(auto({}, [reply({ shock: 5 }), second], { N: 'low' }).values.joy, 15);
    assert.equal(auto({}, [reply({ shock: 5 }), second], { N: 'high' }).values.romance, 10);
});

test('Auto mode: feelings fade by their half-life, between reports and up to now', () => {
    assert.equal(auto({}, [reply({ joy: 60, rapport: 50 })], { now: NOW + 6 * HOUR }).values.joy, 30);
    assert.equal(auto({}, [reply({ joy: 60, rapport: 50 })], { now: NOW + 6 * HOUR }).values.rapport, 50);
    assert.equal(auto({}, [reply({ shock: 80 })], { now: NOW + HOUR / 2 }).values.shock, 40);
    // Joy has halved by the second report, which then moves anger only
    const later = auto({}, [reply({ joy: 60 }), reply({ anger: 40 }, NOW + 6 * HOUR)], { now: NOW + 6 * HOUR });
    assert.equal(later.values.joy, 30);
    assert.equal(later.values.anger, 25);
    // A value set by hand fades too; send_date may be a date string
    assert.equal(auto({ joy: 40 }, [], { now: NOW + 6 * HOUR }).values.joy, 20);
    assert.equal(auto({}, [reply({ joy: 60 }, new Date(NOW).toISOString())], { now: NOW + 6 * HOUR }).values.joy, 30);
    // Manual mode (no history given) doesn't fade
    assert.equal(Model.computeState({ chat: chatWith({ joy: 40 }), profile: Model.normalizeProfile() }).joy, 40);
});

test('Auto mode: locks and Desire with NSFW off ignore reports; reports before startAt stay out', () => {
    const locked = auto({}, [reply({ romance: 0, joy: 30 })], { locks: { romance: 100 } });
    assert.equal(locked.values.romance, 100);
    assert.deepEqual(locked.change, { joy: 30 });
    assert.equal(auto({}, [reply({ desire: 60 })]).values.desire, 0);
    assert.equal(auto({}, [reply({ desire: 60 })], { nsfw: true }).values.desire, 60);
    assert.equal(auto({}, [reply({ desire: 60 })]).change, null);
    // Reported before startAt (the user set the sliders since): not replayed, and the next report is capped
    const since = auto({ joy: 10 }, [reply({ joy: 80 }, NOW - 1000), reply({ anger: 90 }, NOW + 1)], { now: NOW + 1 });
    assert.equal(since.values.joy, 10);
    assert.equal(since.values.anger, 25);
    // User messages don't report
    assert.equal(auto({}, [{ is_user: true, mes: 'x', send_date: NOW, mood: { joy: 90 } }]).values.joy, 0);
});

test('Auto mode: a deleted or swiped reply takes its report back', () => {
    const history = [reply({ joy: 40 }), reply({ joy: 60, anger: 20 })];
    assert.equal(auto({}, history).values.joy, 60);
    assert.equal(auto({}, history.slice(0, 1)).values.joy, 40);
    assert.deepEqual(auto({}, history.slice(0, 1)).change, { joy: 40 });
    // Another swipe of the last reply, without a report: the change shown is the one before
    assert.deepEqual(auto({}, [history[0], reply(undefined)]).change, { joy: 40 });
    assert.ok(Model.hasReport(history));
    assert.ok(!Model.hasReport([{ is_user: true, mood: { joy: 1 } }, reply(undefined)]));
    assert.ok(!Model.hasReport(undefined));
});
