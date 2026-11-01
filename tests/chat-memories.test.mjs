// Run: node --test tests/*.test.mjs
// The memories that go with a chat and the permanent ones (lib/memory-system.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = {};
for (const f of ['memory-recall.js', 'memory-system.js']) new Function(readFileSync(new URL(`../lib/${f}`, import.meta.url), 'utf8'))();
const { createMemorySystem, moveLifeMemories } = window.EchoTextMemorySystem;

function setup(s = {}) {
    const settings = { memoryEnabled: true, memoryScope: 'per-character', characterMemories: {}, globalMemories: [], chatMemories: {}, ...s };
    return { settings, memory: createMemorySystem({ getSettings: () => settings, saveSettings: () => {}, getCharacterKey: () => 'mira.png' }) };
}
const added = (memory, content = '搬家的事', extra = {}) => memory.addMemory({ category: 'life', label: 'x', content, keys: ['搬家'], scope: 'chat', ...extra });

test('a chat memory stays with the chat and goes into the prompt in either scope', () => {
    for (const memoryScope of ['per-character', 'global']) {
        const { settings, memory } = setup({ memoryScope });
        added(memory);
        assert.equal(settings.chatMemories['mira.png'].items.length, 1);
        assert.equal(memory.getMemories().length, 0, 'not among the permanent ones');
        assert.match(memory.buildMemoryContext(['周末搬家']), /搬家的事/, memoryScope);
    }
});

test('editing and deleting reach chat memories', () => {
    const { settings, memory } = setup();
    const m = added(memory);
    assert.equal(memory.editMemory(m.id, { content: '改了' }), true);
    assert.equal(settings.chatMemories['mira.png'].items[0].content, '改了');
    assert.equal(memory.deleteMemory(m.id), true);
    assert.equal(settings.chatMemories['mira.png'].items.length, 0);
});

test('moved to permanent it leaves the chat, in the scope you are in', () => {
    const { settings, memory } = setup();
    const m = added(memory);
    assert.equal(memory.moveToPermanent(m.id), true);
    assert.equal(settings.chatMemories['mira.png'].items.length, 0);
    assert.deepEqual(settings.characterMemories['mira.png'].map(x => x.id), [m.id]);
    assert.equal(memory.moveToPermanent(m.id), false, 'once');
    const global = setup({ memoryScope: 'global' });
    assert.equal(global.memory.moveToPermanent(added(global.memory).id), true);
    assert.equal(global.settings.globalMemories.length, 1);
});

test('a full permanent list keeps what is in it, and a week moved out can start again', () => {
    const full = Array.from({ length: 50 }, (_, i) => ({ id: `u${i}`, category: 'custom', label: 'x', content: 'x', keys: [] }));
    const { settings, memory } = setup({ characterMemories: { 'mira.png': full } });
    const m = added(memory);
    assert.equal(memory.permanentHasRoom(), false);
    assert.equal(memory.moveToPermanent(m.id), false);
    assert.equal(settings.chatMemories['mira.png'].items.length, 1);
    assert.equal(settings.characterMemories['mira.png'].length, 50);
    settings.characterMemories['mira.png'] = [];
    const { kept } = memory.getChatStore();
    kept['week:2026-10-19'] = { memory: m.id, entries: [] };
    kept['entry:a'] = 1;
    memory.moveToPermanent(m.id);
    assert.deepEqual(Object.keys(kept), ['entry:a']);
});

test('the chat list drops its oldest past the limit, the permanent one is not touched', () => {
    const { settings, memory } = setup();
    for (let i = 0; i < 55; i++) added(memory, `m${i}`);
    assert.equal(settings.chatMemories['mira.png'].items.length, 50);
    assert.equal(settings.chatMemories['mira.png'].items[0].content, 'm54');
});

test('Life memories filed with the character move to the chat, once', () => {
    const life = { id: 'l', category: 'life', label: 'x', content: 'x', keys: [] };
    const mine = { id: 'c', category: 'custom', label: 'x', content: 'x', keys: [] };
    const s = { characterMemories: { 'mira.png': [life, mine], 'a.png': [mine] }, lifeKept: { 'mira.png': { 'errand:e': 1 }, 'b.png': { 'entry:z': 1 } } };
    moveLifeMemories(s);
    assert.deepEqual(s.characterMemories['mira.png'], [mine]);
    assert.deepEqual(s.characterMemories['a.png'], [mine]);
    assert.deepEqual(s.chatMemories['mira.png'], { items: [life], kept: { 'errand:e': 1 } });
    assert.deepEqual(s.chatMemories['b.png'], { items: [], kept: { 'entry:z': 1 } });
    assert.equal(s.chatMemories['a.png'], undefined);
    assert.equal('lifeKept' in s, false);
    // One moved to permanent since stays there
    s.characterMemories['mira.png'].push(life);
    moveLifeMemories(s);
    assert.ok(s.characterMemories['mira.png'].includes(life));
});
