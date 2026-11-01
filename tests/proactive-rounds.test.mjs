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
