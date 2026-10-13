// Run: node --test tests/*.test.mjs
// Summaries of a long chat's early messages (docs/platform-plan.md 10b): what they
// cover, what the model is sent word for word, when the next chunk is due, and the
// summaries in the prompt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = {};
for (const f of ['lib/memory-recall.js', 'lib/memory-system.js', 'lib/chat-summaries.js']) {
    new Function(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'))();
}
const S = window.EchoTextChatSummaries;

const chat = n => Array.from({ length: n }, (_, i) => ({ is_user: i % 2 === 0, mes: `m${i}` }));
const withMemo = (history, at, count, text = `summary to ${at}`) => {
    history[at] = { ...history[at], memo: { id: `s${at}`, text, count } };
    return history;
};
const indices = (history, list) => list.map(m => history.indexOf(m));

test('a summary covers its message and the ones before it, back to the previous summary', () => {
    const h = withMemo(withMemo(chat(10), 3, 4), 6, 5);
    assert.deepEqual(S.covered(h), [true, true, true, true, true, true, true, false, false, false]);
    assert.deepEqual(S.summaries(h).map(s => [s.id, s.from, s.to]), [['s3', 0, 3], ['s6', 4, 6]]);
    // An empty or missing text is no summary
    assert.deepEqual(S.covered(withMemo(chat(3), 2, 3, '  ')), [false, false, false]);
});

test('the model is sent the latest messages and any no summary covers', () => {
    const h = withMemo(chat(100), 29, 30);
    // 0–29 summarized: 30–99 in full
    assert.deepEqual(indices(h, S.toSend(h)), Array.from({ length: 70 }, (_, i) => 30 + i));
    // The latest 60 always go, summarized or not
    assert.equal(S.toSend(h, { keep: 80 }).length, 80);
    // Nothing summarized: everything
    assert.equal(S.toSend(chat(200)).length, 200);
});

test('deleting the message a summary sits on puts its messages back', () => {
    const h = withMemo(chat(100), 29, 30);
    h.splice(29, 1);
    assert.equal(S.toSend(h).length, 99);
    // 39 wait beyond the latest 60: the oldest 30 again
    assert.deepEqual(S.nextChunk(h), { start: 0, end: 29 });
    // Deleting one inside it shortens it, the rest stays summarized
    const g = withMemo(chat(100), 29, 30);
    g.splice(10, 1);
    assert.deepEqual(S.covered(g).slice(0, 30), [...Array(29).fill(true), false]);
});

test('the next chunk: the oldest 30 waiting, once 30 wait beyond the latest 60', () => {
    assert.equal(S.nextChunk(chat(89)), null);
    assert.deepEqual(S.nextChunk(chat(90)), { start: 0, end: 29 });
    assert.deepEqual(S.nextChunk(chat(500)), { start: 0, end: 29 });
    assert.equal(S.nextChunk(withMemo(chat(119), 29, 30)), null);
    assert.deepEqual(S.nextChunk(withMemo(chat(120), 29, 30)), { start: 30, end: 59 });
    assert.deepEqual(S.nextChunk(chat(50), { keep: 20 }), { start: 0, end: 29 });
    // A gap left by a deleted summary goes first, on its own
    const h = withMemo(withMemo(chat(200), 29, 30), 59, 30);
    delete h[29].memo;
    assert.deepEqual(S.nextChunk(h), { start: 0, end: 29 });
    const g = withMemo(withMemo(chat(200), 9, 10), 39, 30);
    delete g[9].memo;
    // 0–9 wait, then 40–139: one run of 10
    assert.deepEqual(S.nextChunk(g), { start: 0, end: 9 });
});

test('the request: the messages, the notes before them, the chat\'s language', () => {
    const { systemPrompt, prompt } = S.buildRequest({ lines: ['Mira: hi', 'Qi: 你好'], previous: 'They met.', charName: 'Mira', userName: 'Qi' });
    assert.match(systemPrompt, /between Mira and Qi/);
    assert.match(systemPrompt, /in the language they are written in/);
    assert.match(systemPrompt, /at most five short lines/);
    assert.equal(prompt, "Notes so far (for context, don't repeat them):\nThey met.\n\nMessages:\nMira: hi\nQi: 你好");
    assert.equal(S.buildRequest({ lines: ['a: b'] }).prompt, 'Messages:\na: b');
});

test('the notes as kept: no fence, no heading, no blank lines, at most 1000 characters', () => {
    assert.equal(S.cleanSummary('```\nSummary: 齐宁来了\n\n他们和好了\n```'), '齐宁来了\n他们和好了');
    assert.equal(S.cleanSummary('  '), '');
    assert.equal(S.cleanSummary('x'.repeat(1200)).length, 1001);
});

test('a refusal is not taken for notes', () => {
    for (const t of ["I'm sorry, but I can't help with that.", 'I cannot summarize this.', "I can't do that", 'As an AI, I…', '抱歉，我无法总结这段对话', '我不能提供这类内容']) {
        assert.ok(S.looksLikeRefusal(t), t);
    }
    for (const t of ['Mira said sorry to Qi', '齐宁向Mira道歉', 'I-95 trip planned', "Qi can't sleep without the lamp"]) {
        assert.ok(!S.looksLikeRefusal(t), t);
    }
});

test('in the prompt: the latest summary always, earlier ones when the chat brings them up, oldest first', () => {
    const settings = { memoryEnabled: true, characterMemories: { 'mira.png': [{ id: 'k', content: '团子是她的猫', keys: ['团子'] }] } };
    const memory = window.EchoTextMemorySystem.createMemorySystem({ getSettings: () => settings, saveSettings() {}, getCharacterKey: () => 'mira.png' });
    const summaries = [{ id: 'a', text: '他们在京都看了红叶' }, { id: 'b', text: '齐宁搬去了上海' }, { id: 'c', text: '两人吵了一架又和好' }];
    const only = memory.buildMemoryContext(['在干嘛'], summaries);
    assert.match(only, /<earlier_in_this_chat>[\s\S]*- 两人吵了一架又和好\n<\/earlier_in_this_chat>/);
    assert.doesNotMatch(only, /京都|上海|shared_memories/);
    const both = memory.buildMemoryContext(['还记得京都吗', '团子呢'], summaries);
    assert.match(both, /- 他们在京都看了红叶\n- 两人吵了一架又和好\n<\/earlier_in_this_chat>\n\n<shared_memories>[\s\S]*- 团子是她的猫/);
    assert.ok(memory.getRecalledIds().has('memo:a') && memory.getRecalledIds().has('k') && !memory.getRecalledIds().has('memo:b'));
    // No summaries: as before
    assert.doesNotMatch(memory.buildMemoryContext(['团子'], []), /earlier_in_this_chat/);
    settings.memoryEnabled = false;
    assert.equal(memory.buildMemoryContext(['京都'], summaries), '');
});
