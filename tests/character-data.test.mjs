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

test('a rename takes the social account along: its pinned posts and the chat\'s', () => {
    const s = settings();
    s.socialAccounts = { 'mira.png': { name: 'm.', posts: [{ id: 'pin1', text: 'pinned', photo: { path: 'a.jpg' } }] } };
    s.socialPosts = { 'mira.png': [{ id: 'a', text: 'hello' }] };
    s.socialArchives = { 'mira.png': [{ id: 'sa1', name: 'one', posts: [] }] };
    D.moveCharacterData(s, 'mira.png', 'mira2.png');
    assert.deepEqual(s.socialArchives['mira2.png'].map(a => a.id), ['sa1']);
    assert.ok(!('mira.png' in s.socialArchives));
    assert.deepEqual(s.socialAccounts['mira2.png'].posts.map(p => p.id), ['pin1']);
    assert.equal(s.socialAccounts['mira2.png'].posts[0].photo.path, 'a.jpg');
    assert.deepEqual(s.socialPosts['mira2.png'].map(p => p.id), ['a']);
    assert.ok(!('mira.png' in s.socialAccounts) && !('mira.png' in s.socialPosts));
});

test('moved onto a character with posts of their own: the posts are joined, one with the same id once', () => {
    const s = settings();
    s.socialPosts = { 'mira.png': [{ id: 'a' }, { id: 'b' }], 'qi.png': [{ id: 'b' }, { id: 'c' }] };
    D.moveCharacterData(s, 'mira.png', 'qi.png');
    assert.deepEqual(s.socialPosts['qi.png'].map(p => p.id), ['b', 'c', 'a']);
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

test('a setup exports what the user set up, not what happened in chats, and imports onto another key', async () => {
    const s = settings();
    s.characterProfiles = { 'mira.png': { bigFive: { E: 'high' } } };
    s.avatarByCharacter = { 'mira.png': '/user/images/Mira/a.jpeg' };
    s.socialAccounts = { 'mira.png': { name: 'M', banner: '/user/images/Mira/b.jpeg', posts: [{ id: 'p1' }], pinnedId: 'p1' } };
    s.socialPosts = { 'mira.png': [{ id: 'p2' }] };
    const file = D.exportSetup(s, 'mira.png', 'Mira');
    assert.deepEqual(Object.keys(file.setup).sort(),
        ['avatarByCharacter', 'characterProfiles', 'characterSchedules', 'platformByCharacter', 'proactiveTemperament', 'socialAccounts']);
    assert.deepEqual(file.setup.socialAccounts, { name: 'M', banner: '/user/images/Mira/b.jpeg' });
    assert.equal(file.memories.length, 1);
    assert.deepEqual(D.setupImages(file.setup), ['/user/images/Mira/a.jpeg', '/user/images/Mira/b.jpeg']);

    // Images become data URLs in the file; one that can't be read is left out
    const out = await D.mapSetupImages(file.setup, async v => (v.endsWith('a.jpeg') ? 'data:image/jpeg;base64,AA' : ''));
    assert.equal(out.avatarByCharacter, 'data:image/jpeg;base64,AA');
    assert.ok(!('banner' in out.socialAccounts));
    assert.equal(file.setup.socialAccounts.banner, '/user/images/Mira/b.jpeg');

    const read = D.readSetup(JSON.stringify({ ...file, setup: { ...out, lifeState: { x: 1 } } }));
    assert.ok(!('lifeState' in read.setup));
    assert.throws(() => D.readSetup('{"a":1}'), /not an Echogram setup file/);
    assert.throws(() => D.readSetup('nope'), /not an Echogram setup file/);

    // Onto qi: their setup replaced (verbosity they had, the file hasn't: cleared), posts kept, memories joined
    s.verbosityByCharacter = { 'qi.png': 'long' };
    s.avatarByCharacter['qi.png'] = '/user/images/Qi/old.jpeg';
    s.socialAccounts['qi.png'] = { name: 'Q', posts: [{ id: 'q1' }] };
    s.characterMemories['qi.png'] = [{ id: 'm1', content: 'a' }, { id: 'm9', content: 'z' }];
    const unused = D.importSetup(s, 'qi.png', { ...read, setup: { ...read.setup, avatarByCharacter: '/user/images/Qi/new.jpeg' } });
    assert.deepEqual(unused, ['/user/images/Qi/old.jpeg']);
    assert.equal(s.proactiveTemperament['qi.png'], 'clingy');
    assert.equal(s.platformByCharacter['qi.png'], 'wechat');
    assert.ok(!('qi.png' in s.verbosityByCharacter));
    assert.deepEqual(s.socialAccounts['qi.png'], { name: 'M', posts: [{ id: 'q1' }] });
    assert.deepEqual(s.characterMemories['qi.png'].map(m => m.id), ['m1', 'm9']);
    assert.ok(!('qi.png' in (s.lifeState || {})));
    // Mira's own stays as it was
    assert.equal(s.socialAccounts['mira.png'].pinnedId, 'p1');
    assert.equal(s.avatarByCharacter['mira.png'], '/user/images/Mira/a.jpeg');
});
