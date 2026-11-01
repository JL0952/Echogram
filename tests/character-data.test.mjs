// Run: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = {};
new Function(readFileSync(new URL('../lib/character-data.js', import.meta.url), 'utf8'))();
const D = window.EchoTextCharacterData;

const settings = () => ({
    chatHistory: { 'mira.png': [{ is_user: true, mes: 'hi', send_date: 1 }, { is_user: false, mes: 'yo', send_date: 3 }], 'qi.png': [] },
    characterMemories: { 'mira.png': [{ id: 'm1', content: 'a' }] },
    characterGalleries: { 'mira.png': [{ id: 'g1' }] },
    characterSchedules: { 'mira.png': { weekday: [{ from: '09:00', to: '18:00' }], saturday: [], sunday: [] } },
    lifeState: { 'mira.png': { start: { errands: [{ id: 'e1' }], log: [], today: null }, startAt: 0 } },
    emotionState: { 'mira.png': { values: { joy: 40 } } },
    proactiveTemperament: { 'mira.png': 'clingy' },
    platformByCharacter: { 'mira.png': 'wechat' },
    groupChatHistory: { g1: { 'mira.png': [{ mes: 'group', send_date: 2 }] } },
    groupCombineHistory: { g1: [{ mes: 'combined', charKey: 'mira.png' }, { mes: 'other', charKey: 'qi.png' }] },
    savedChats: { tethered: { s1: { charKey: 'mira.png', history: [] } }, group_combine: { s2: { groupId: 'g1', history: [{ charKey: 'mira.png' }] } } },
    pickerFavorites: ['mira.png', 'qi.png'],
    lastCharacterKey: 'mira.png',
});

test('a rename moves everything filed under the old key', () => {
    const s = settings();
    assert.equal(D.moveCharacterData(s, 'mira.png', 'mira2.png'), true);
    assert.equal(s.chatHistory['mira2.png'].length, 2);
    assert.ok(!('mira.png' in s.chatHistory));
    assert.deepEqual(s.characterMemories['mira2.png'], [{ id: 'm1', content: 'a' }]);
    assert.equal(s.characterSchedules['mira2.png'].weekday.length, 1);
    assert.equal(s.proactiveTemperament['mira2.png'], 'clingy');
    assert.equal(s.platformByCharacter['mira2.png'], 'wechat');
    assert.ok(!('mira.png' in s.lifeState) && !!s.lifeState['mira2.png']);
    assert.equal(s.groupChatHistory.g1['mira2.png'][0].mes, 'group');
    assert.deepEqual(s.groupCombineHistory.g1.map(m => m.charKey), ['mira2.png', 'qi.png']);
    assert.equal(s.savedChats.tethered.s1.charKey, 'mira2.png');
    assert.equal(s.savedChats.group_combine.s2.history[0].charKey, 'mira2.png');
    assert.deepEqual(s.pickerFavorites, ['mira2.png', 'qi.png']);
    assert.equal(s.lastCharacterKey, 'mira2.png');
    // Nothing there, or the same key: nothing moves
    assert.equal(D.moveCharacterData(settings(), 'nobody.png', 'x.png'), false);
    assert.equal(D.moveCharacterData(settings(), 'mira.png', 'mira.png'), false);
});

test('moved onto a character with data of their own: chats by time, lists joined, the rest replaced', () => {
    const s = settings();
    s.chatHistory['mira2.png'] = [{ is_user: true, mes: 'after the rename', send_date: 5 }, { is_user: false, mes: 'same time', send_date: 1 }];
    s.characterMemories['mira2.png'] = [{ id: 'm2' }, { id: 'm1', content: 'already here' }];
    s.characterSchedules['mira2.png'] = { weekday: [], saturday: [], sunday: [] };
    s.pickerFavorites = ['mira.png', 'mira2.png'];
    D.moveCharacterData(s, 'mira.png', 'mira2.png');
    assert.deepEqual(s.chatHistory['mira2.png'].map(m => m.mes), ['hi', 'same time', 'yo', 'after the rename']);
    assert.deepEqual(s.characterMemories['mira2.png'].map(m => m.id), ['m2', 'm1']);
    assert.equal(s.characterMemories['mira2.png'][1].content, 'already here');
    assert.equal(s.characterSchedules['mira2.png'].weekday.length, 1);
    assert.deepEqual(s.pickerFavorites, ['mira2.png']);
});

test('data no card has any more, and what it holds', () => {
    const s = settings();
    s.chatHistory['gone.png'] = [];
    s.proactiveState = { 'stale.png': { lastProactiveAt: 1 } };
    s.characterMemories['old name.png'] = [{ id: 'x' }];
    // Mira and Qi have cards; an empty chat or only engine state isn't worth listing
    assert.deepEqual(D.orphanedKeys(s, ['mira.png', 'qi.png']).map(o => o.key), ['old name.png']);
    const all = D.orphanedKeys(s, []);
    assert.deepEqual(all.map(o => o.key), ['mira.png', 'old name.png']);
    assert.deepEqual(all[0], { key: 'mira.png', name: 'mira', messages: 2, memories: 1, schedule: true, life: true });
    assert.equal(D.describeOrphan(all[0]), '2 messages, schedule, life, 1 memory');
    assert.equal(D.describeOrphan({ messages: 1, memories: 3 }), '1 message, 3 memories');
    assert.deepEqual(D.orphanedKeys(null, []), []);
});

test('deleting what\'s filed under a key', () => {
    const s = settings();
    assert.equal(D.deleteCharacterData(s, 'mira.png'), true);
    for (const name of ['chatHistory', 'characterMemories', 'characterGalleries', 'characterSchedules', 'lifeState', 'emotionState', 'proactiveTemperament', 'platformByCharacter']) {
        assert.ok(!('mira.png' in s[name]), name);
    }
    assert.ok(!('mira.png' in s.groupChatHistory.g1));
    assert.deepEqual(Object.keys(s.savedChats.tethered), []);
    // A combined group chat keeps what was said, and Qi keeps everything
    assert.deepEqual(s.groupCombineHistory.g1.map(m => m.mes), ['combined', 'other']);
    assert.deepEqual(s.pickerFavorites, ['qi.png']);
    assert.equal(s.lastCharacterKey, '');
    assert.deepEqual(s.chatHistory['qi.png'], []);
    assert.equal(D.deleteCharacterData(s, 'mira.png'), false);
    assert.deepEqual(D.orphanedKeys(s, []), []);
});

test('the names cards had, for naming their data once they\'re gone', () => {
    const s = settings();
    assert.equal(D.rememberNames(s, [{ avatar: 'mira.png', name: 'Mira' }, { avatar: 'tavern-sync-b92a.png', name: '丹尼尔' }, { avatar: 'x.png', name: ' ' }]), true);
    assert.equal(D.rememberNames(s, [{ avatar: 'mira.png', name: 'Mira' }]), false);
    assert.deepEqual(s.characterNames, { 'mira.png': 'Mira', 'tavern-sync-b92a.png': '丹尼尔' });
    // 丹尼尔 renamed (by hand, before Echogram moved data): the old file shows under the old name
    s.characterSchedules['tavern-sync-b92a.png'] = { weekday: [{ from: '09:00', to: '18:00' }], saturday: [], sunday: [] };
    const gone = D.orphanedKeys(s, ['mira.png', 'qi.png']);
    assert.deepEqual(gone.map(o => o.name), ['丹尼尔']);
    // Moved or deleted, the name goes with it; a key never named shows its file
    D.moveCharacterData(s, 'tavern-sync-b92a.png', 'mira.png');
    assert.ok(!('tavern-sync-b92a.png' in s.characterNames) && s.characterNames['mira.png'] === 'Mira');
    D.deleteCharacterData(s, 'mira.png');
    assert.ok(!('mira.png' in s.characterNames));
    s.chatHistory['unnamed.png'] = [{ mes: 'x' }];
    assert.equal(D.orphanedKeys(s, [])[0].name, 'unnamed');
});
