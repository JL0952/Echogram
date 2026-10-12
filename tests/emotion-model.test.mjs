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
