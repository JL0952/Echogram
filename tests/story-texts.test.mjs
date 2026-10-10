// Run: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Loaded the way index.js loads its modules: each file sets a global on `window`
globalThis.window = {};
for (const file of ['rich-messages.js', 'features.js', 'chat-view-model.js', 'story-texts.js']) {
    new Function(readFileSync(new URL(`../lib/${file}`, import.meta.url), 'utf8'))();
}
const { insertTexts } = window.EchoTextStoryTexts;

const T0 = new Date(2026, 9, 10, 14, 0, 0).getTime();
const at = min => T0 + min * 60000;
// Story messages carry ST's ISO send_date; EchoText messages a number
const story = (mes, min, is_user = false) => ({ mes, is_user, send_date: min === null ? undefined : new Date(at(min)).toISOString() });
const text = (mes, min, is_user = false) => ({ mes, is_user, send_date: at(min) });
const timeOf = msg => Date.parse(msg.send_date);
const options = { charName: '间谍', userName: '齐宁', timeOf };
const shape = chat => chat.map(m => (m.extra?.echotext ? m.mes.split('\n').slice(2, -1).join(' | ') : m.mes));

test('texts go between the story messages they were sent between, each run as one narrator message', () => {
    const chat = [story('他在便利店买水。', 0), story('“你...”', 10, true), story('他转过身。', 11)];
    const inserted = insertTexts(chat, [
        text('嘿。', 2, true),
        text('嗯\n在便利店买水\n你呢', 3),
        text('我知道你是谁！！！！', 4, true),
        text('哈？', 10.5),
    ], options);
    assert.equal(inserted, 2);
    assert.deepEqual(shape(chat), [
        '他在便利店买水。',
        '齐宁: 嘿。 | 间谍: 嗯 | 间谍: 在便利店买水 | 间谍: 你呢 | 齐宁: 我知道你是谁！！！！',
        '“你...”',
        '间谍: 哈？',
        '他转过身。',
    ]);
    const block = chat[1];
    assert.equal(block.extra.type, 'narrator');
    assert.equal(block.is_user, false);
    assert.equal(block.send_date, new Date(at(2)).toISOString());
    assert.match(block.mes, /^<text_messages>\n齐宁 and 间谍 texted each other by phone at this point in the story:\n/);
    assert.match(block.mes, /\n<\/text_messages>$/);
});

test('texts from before the story began are left out; texts after the last message go at the end', () => {
    const chat = [story('开场', 0), story('我来了', 5, true)];
    insertTexts(chat, [text('old story', -60, true), text('在吗', 6, true)], options);
    assert.deepEqual(shape(chat), ['开场', '我来了', '齐宁: 在吗']);
});

test('Continue keeps the message being continued last', () => {
    const chat = [story('开场', 0), story('他说', 5)];
    insertTexts(chat, [text('在吗', 6, true)], { ...options, keepLast: true });
    assert.deepEqual(shape(chat), ['开场', '齐宁: 在吗', '他说']);
});

test('a story message without a time, or with an earlier one, takes the time before it', () => {
    const chat = [story('开场', 0), story('no date', null, true), story('later', 10), story('clock went back', 5, true)];
    insertTexts(chat, [text('a', 1, true), text('b', 12, true)], options);
    assert.deepEqual(shape(chat), ['开场', 'no date', '齐宁: a', 'later', 'clock went back', '齐宁: b']);
});

test('photos, transfers and their answers are written out', () => {
    const chat = [story('开场', 0), story('next', 10, true)];
    insertTexts(chat, [
        text('看<photo>a cat on a wall</photo>', 1),
        text('<transfer>52</transfer>', 2),
        text('<transfer_accept>52</transfer_accept>', 3, true),
    ], options);
    assert.deepEqual(shape(chat), [
        '开场',
        '间谍: 看 | 间谍: [Photo: a cat on a wall] | 间谍: [Transfer: ¥52.00] | 齐宁: [Accepted transfer: ¥52.00]',
        'next',
    ]);
});

test('nothing to add leaves the chat alone', () => {
    const chat = [story('开场', 0)];
    assert.equal(insertTexts(chat, [], options), 0);
    assert.equal(insertTexts(chat, [text('old', -5, true)], options), 0);
    assert.equal(insertTexts([], [text('a', 1, true)], options), 0);
    assert.deepEqual(shape(chat), ['开场']);
});
