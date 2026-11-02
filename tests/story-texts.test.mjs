// Run: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Loaded the way index.js loads its modules: each file sets a global on `window`
globalThis.window = {};
for (const file of ['rich-messages.js', 'features.js', 'chat-view-model.js', 'daily-life.js', 'story-texts.js']) {
    new Function(readFileSync(new URL(`../lib/${file}`, import.meta.url), 'utf8'))();
}
const { insertTexts, addToEnd } = window.EchoTextStoryTexts;

const T0 = new Date(2026, 9, 10, 14, 0, 0).getTime();
const at = min => T0 + min * 60000;
// Story messages carry ST's ISO send_date; EchoText messages a number
const story = (mes, min, is_user = false) => ({ mes, is_user, send_date: min === null ? undefined : new Date(at(min)).toISOString() });
const text = (mes, min, is_user = false) => ({ mes, is_user, send_date: at(min) });
const timeOf = msg => Date.parse(msg.send_date);
const options = { charName: '间谍', userName: '齐宁', timeOf };
const isTime = line => /^\[[^\]]*\d\d:\d\d\]$/.test(line);
const shape = chat => chat.map(m => (m.extra?.echotext ? m.mes.split('\n').slice(2, -1).filter(line => !isTime(line)).join(' | ') : m.mes));

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

test('texts from before the story began go first; texts after the last message go at the end', () => {
    const chat = [story('开场', 0), story('我来了', 5, true)];
    insertTexts(chat, [text('old story', -60, true), text('在吗', 6, true)], options);
    assert.deepEqual(shape(chat), ['齐宁: old story', '开场', '我来了', '齐宁: 在吗']);
    assert.match(chat[0].mes, /\[2026-10-10 Sat 13:00\]/);
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

test('each run says its date and time, and again when time moves on', () => {
    const chat = [story('开场', -60 * 24)];
    insertTexts(chat, [
        text('早', 0, true), text('早', 3),
        text('吃了吗', 11, true),
        text('昨晚的事', 60 * 7.5), text('别说了', 60 * 7.5 + 2, true),
    ], options);
    assert.deepEqual(chat[1].mes.split('\n').slice(1, -1), [
        '齐宁 and 间谍 texted each other by phone at this point in the story:',
        '[2026-10-10 Sat 14:00]',
        '齐宁: 早',
        '间谍: 早',
        '[2026-10-10 Sat 14:11]',
        '齐宁: 吃了吗',
        '[2026-10-10 Sat 21:30]',
        '间谍: 昨晚的事',
        '齐宁: 别说了',
    ]);
});

test('another day says so, however close, and each block says its own', () => {
    const chat = [story('开场', -60 * 24)];
    insertTexts(chat, [{ is_user: true, mes: '晚安', send_date: new Date(2026, 9, 11, 23, 59).getTime() },
        { is_user: false, mes: '晚安', send_date: new Date(2026, 9, 12, 0, 1).getTime() }], options);
    assert.deepEqual(chat[1].mes.split('\n').slice(2, -1), ['[2026-10-11 Sun 23:59]', '齐宁: 晚安', '[2026-10-12 Mon 00:01]', '间谍: 晚安']);
    const split = [story('开场', 0), story('中间', 10, true)];
    insertTexts(split, [text('前', 5, true), text('后', 11)], options);
    assert.match(split[1].mes, /\n\[2026-10-10 Sat 14:05\]\n齐宁: 前\n/);
    assert.match(split[3].mes, /\n\[2026-10-10 Sat 14:11\]\n间谍: 后\n/);
});

test('the time now, and the day if there is one, go at the very end', () => {
    const now = new Date(2026, 9, 12, 10, 0);
    const chat = [story('开场', 0), story('next', 10, true)];
    addToEnd(chat, { now });
    assert.equal(chat.at(-1).mes, '<current_time>\nIt is now 2026-10-12 Mon 10:00.\n</current_time>');
    assert.equal(chat.at(-1).extra.type, 'narrator');
    addToEnd(chat, { now, today: '<character_today>…</character_today>' });
    assert.equal(chat.at(-1).mes, '<current_time>\nIt is now 2026-10-12 Mon 10:00.\n</current_time>\n<character_today>…</character_today>');
    // Continue keeps the message being continued last
    const continued = [story('开场', 0), story('他说', 5)];
    addToEnd(continued, { now, keepLast: true });
    assert.equal(continued.at(-1).mes, '他说');
    assert.match(continued.at(-2).mes, /^<current_time>/);
});

test('what was there reads the same later: a prompt cache holds up to what is new', () => {
    const texts = [text('a', 1, true), text('b', 2)];
    const prompt = now => {
        const chat = [story('开场', 0), story('next', 10, true)];
        insertTexts(chat, texts, options);
        addToEnd(chat, { now });
        return chat.map(m => m.mes);
    };
    const first = prompt(new Date(2026, 9, 10, 15, 0));
    const days = prompt(new Date(2026, 9, 25, 9, 30));
    assert.deepEqual(first.slice(0, -1), days.slice(0, -1));
    assert.notEqual(first.at(-1), days.at(-1));
    // A new text goes after all of it
    const chat = [story('开场', 0), story('next', 10, true)];
    insertTexts(chat, [...texts, text('c', 20, true)], options);
    assert.deepEqual(chat.slice(0, 3).map(m => m.mes), first.slice(0, 3));
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

test('a shared place is written out as its name and address', () => {
    const chat = [story('开场', 0), story('next', 10, true)];
    insertTexts(chat, [text('<location>星巴克 | 建国门外大街1号</location>', 1), text('<location>家</location>', 2, true)], options);
    assert.deepEqual(shape(chat), ['开场', '间谍: [Location: 星巴克, 建国门外大街1号] | 齐宁: [Location: 家]', 'next']);
});

test('a shared song is written out as its title and artist', () => {
    const chat = [story('开场', 0), story('next', 10, true)];
    insertTexts(chat, [text('<music>晴天 | 周杰伦</music>', 1), text('<music>Lemon</music>', 2, true), text('<music>Song A | Band B | one; two</music>', 3)], options);
    assert.deepEqual(shape(chat), ['开场', '间谍: [Song: 晴天 — 周杰伦] | 齐宁: [Song: Lemon] | 间谍: [Song: Song A — Band B: one / two]', 'next']);
});

test('nothing to add leaves the chat alone', () => {
    const chat = [story('开场', 0)];
    assert.equal(insertTexts(chat, [], options), 0);
    assert.equal(insertTexts([], [text('a', 1, true)], options), 0);
    assert.deepEqual(shape(chat), ['开场']);
});

const { storyWindow, weaveStory } = window.EchoTextStoryTexts;
const said = (text, min) => ({ speaker: '男朋友', text, time: at(min) });
const turnAt = (role, content, min) => ({ role, content, time: at(min) });

test('the story goes between the texts by time, a run as one turn with its time', () => {
    const out = weaveStory(
        [turnAt('user', '帮我带可乐', 6), turnAt('assistant', '好', 7), turnAt('user', '嘿', 12)],
        [said('她出门了', -5), said('她进门，把可乐递给他', 9), said('他喝了一口', 10)],
    );
    assert.deepEqual(out.map(m => m.role), ['system', 'user', 'assistant', 'system', 'user']);
    assert.ok(out[3].content.startsWith('<story_events>\nThe roleplay went on here'));
    assert.ok(out[3].content.endsWith('\n[2026-10-10 Sat 14:09]\n男朋友: 她进门，把可乐递给他\n男朋友: 他喝了一口\n</story_events>'));
    assert.deepEqual(Object.keys(out[1]), ['role', 'content']);
});

test('story after the last text comes last, a tie goes first, and no time takes the one before it', () => {
    assert.equal(weaveStory([turnAt('user', 'a', 1)], [said('后来', 2)]).at(-1).role, 'system');
    assert.equal(weaveStory([turnAt('user', 'a', 1)], [said('同时', 1)])[0].role, 'system');
    const noTime = weaveStory([turnAt('user', 'a', 1), turnAt('user', 'b', 5)], [said('前', 2), { speaker: '男朋友', text: '没时间', time: NaN }]);
    assert.deepEqual(noTime.map(m => m.role), ['user', 'system', 'user']);
    assert.match(noTime[1].content, /前\n男朋友: 没时间/);
    // A turn with no time counts as the earliest; story with none at all says no time
    assert.equal(weaveStory([{ role: 'user', content: 'a' }], [said('后', 2)]).at(-1).role, 'system');
    const undated = weaveStory([turnAt('user', 'a', 1)], [{ speaker: '男朋友', text: '没时间', time: NaN }]);
    assert.equal(undated[0].role, 'system');
    assert.doesNotMatch(undated[0].content, /\[\d{4}/);
    assert.deepEqual(weaveStory([], []), []);
});

test('what was woven stays the same as the story and the chat go on', () => {
    const turns = [turnAt('user', 'a', 1), turnAt('assistant', 'b', 2)];
    const story = [said('一', 0), said('二', 3)];
    const before = weaveStory(turns, story);
    const after = weaveStory([...turns, turnAt('user', 'c', 5)], [...story, said('三', 6)]);
    assert.deepEqual(after.slice(0, 4), before);
});

test('old story leaves a chunk at a time, inside the limits', () => {
    const limits = { maxMessages: 20, maxChars: 6000, chunkMessages: 10, chunkChars: 2000 };
    const line = i => ({ speaker: 'a', text: `${i}`.padEnd(99, 'x'), time: i });
    const story = n => Array.from({ length: n }, (_, i) => line(i));
    assert.equal(storyWindow(story(5), limits).length, 5);
    assert.equal(storyWindow(story(20), limits).length, 20);
    // One more: the oldest chunk goes, and what's left stays put as more come
    const first = storyWindow(story(21), limits);
    assert.equal(first.length, 11);
    assert.equal(storyWindow(story(30), limits)[0].text, first[0].text);
    assert.notEqual(storyWindow(story(31), limits)[0].text, first[0].text);
    // Long messages: the characters bind, and a window's start holds as the story grows
    const long = n => Array.from({ length: n }, (_, i) => ({ speaker: 'a', text: `${i}`.padEnd(899, 'x'), time: i }));
    const sizes = s => s.reduce((sum, m) => sum + m.speaker.length + m.text.length, 0);
    for (const n of [5, 7, 9, 13, 20]) assert.ok(sizes(storyWindow(long(n), limits)) <= 6000, `${n}`);
    const starts = [8, 9, 10, 11, 12, 13, 14, 15].map(n => Number.parseInt(storyWindow(long(n), limits)[0].text, 10));
    assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
    assert.ok(new Set(starts).size < starts.length, 'in steps');
    // One message over the limits is still sent
    const huge = [{ speaker: 'a', text: 'x'.repeat(9000), time: 0 }];
    assert.equal(storyWindow(huge, limits).length, 1);
});
