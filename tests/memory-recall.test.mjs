// Run: node --test tests/*.test.mjs
// Which memories go into the prompt (docs/platform-plan.md 10a): pinned ones,
// keyword hits and rare shared words, within the budget.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = {};
new Function(readFileSync(new URL('../lib/memory-recall.js', import.meta.url), 'utf8'))();
const { recall, words, parseKeys, hasKey } = window.EchoTextMemoryRecall;

const picked = (memories, texts, opts) => recall({ memories, texts, ...opts }).map(p => p.memory.content);
const why = (memories, texts) => recall({ memories, texts }).map(p => p.why);
// Small talk with nothing in it
const filler = n => Array.from({ length: n }, (_, i) => ['在干嘛', '刚下班', '好累啊', '早点休息', 'ok', 'haha same'][i % 6]);

test('words: pairs of characters for Chinese, without the grammar; words otherwise', () => {
    assert.deepEqual([...words('齐宁怕黑')], ['齐宁', '宁怕', '怕黑']);
    // 我们, 晚上, 什么 name no topic (pairs across two words stay; they rarely repeat)
    assert.deepEqual([...words('我们晚上吃什么')], ['上吃', '吃什']);
    assert.ok(!words('我们约好去京都').has('我们'));
    assert.ok(words('我们约好去京都').has('京都'));
    assert.deepEqual([...words('My sister loves cats and the guitar, okay?')], ['sister', 'cat', 'guitar']);
    assert.ok(words('my boss').has('boss'));
    // Japanese: particles and kana-only pairs drop out
    assert.deepEqual([...words('京都に行きたい')], ['京都', '行き']);
});

test('a name or a place in the recent messages brings its memory in; small talk does not', () => {
    const memories = [{ content: '齐宁是我高中同桌，现在在上海当律师' }, { content: '我们约好下个月去京都看红叶' }, { content: '她晚上不敢一个人走夜路' }];
    assert.deepEqual(picked(memories, [...filler(10), '对了你还记得齐宁吗']), ['齐宁是我高中同桌，现在在上海当律师']);
    assert.deepEqual(picked(memories, [...filler(10), '京都好玩吗']), ['我们约好下个月去京都看红叶']);
    // Only common words shared (我们, 晚上, 一个, 什么)
    assert.deepEqual(picked(memories, [...filler(10), '我们晚上吃什么', '一个人吃']), []);
    assert.deepEqual(picked(memories, []), []);
});

test('English: whole words, plurals as the word', () => {
    const memories = [{ content: 'Her cat Mochi hates thunderstorms' }, { content: 'He plays the guitar in a band' }];
    assert.deepEqual(picked(memories, ['how are the cats?']), ['Her cat Mochi hates thunderstorms']);
    assert.deepEqual(picked(memories, ['what are you doing tonight?', 'nothing much, you?']), []);
});

test('a word the whole chat keeps saying never counts; a topic hot right now does', () => {
    const memory = [{ content: '齐宁送过我一条围巾' }];
    // 齐宁 in a third of the earlier messages: the chat is about her, the name tells nothing
    const earlier = Array.from({ length: 60 }, (_, i) => (i % 3 ? '在干嘛' : `齐宁${i}号说`));
    assert.deepEqual(picked(memory, [...earlier, ...filler(5), '齐宁呢']), []);
    // The scarf, though, is rare
    assert.deepEqual(picked(memory, [...earlier, ...filler(5), '齐宁送的围巾找不到了']), ['齐宁送过我一条围巾']);
    // Said in every recent message and never before: still rare
    assert.deepEqual(picked([{ content: '团子是她的猫' }], [...filler(50), '团子', '团子呢', '团子在睡', '团子醒了', '团子饿了', '喂团子']), ['团子是她的猫']);
});

test('keywords: anywhere in the recent messages, Latin ones as whole words, either case', () => {
    const memory = [{ content: '异地恋的设定', keys: ['见面', 'Long Distance'] }];
    assert.deepEqual(why(memory, ['什么时候见面呀']), ['keyword']);
    assert.deepEqual(why(memory, ['this long distance thing is hard']), ['keyword']);
    assert.deepEqual(why([{ content: 'x', keys: ['cat'] }], ['which category?']), []);
    assert.deepEqual(why([{ content: 'x', keys: ['cat'] }], ['the cat!']), ['keyword']);
    assert.ok(hasKey('mochi', 'MOCHI'));
    assert.deepEqual(parseKeys('见面， 约会、 date;date\n'), ['见面', '约会', 'date']);
    assert.deepEqual(parseKeys(['a', ' ', 'b']), ['a', 'b']);
});

test('pinned ones always come first and outside the budget; keywords before matches', () => {
    const memories = [
        { content: '雨天她会想起那家咖啡馆' },
        { content: '两人是异地恋，'.repeat(200), pinned: true },
        { content: '设定', keys: ['咖啡'] },
    ];
    assert.deepEqual(why(memories, ['想喝咖啡馆的拿铁']), ['pinned', 'keyword', 'match']);
    assert.deepEqual(why(memories, []), ['pinned']);
});

test('the budget and the cap: six at most, about 1000 characters, the best one always', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ content: `团子第${i}件事` }));
    assert.equal(picked(many, ['团子']).length, 6);
    const long = Array.from({ length: 3 }, (_, i) => ({ content: `团子${i}`.padEnd(400, '。') }));
    assert.equal(picked(long, ['团子']).length, 2);
    assert.equal(picked([{ content: '团子'.padEnd(3000, '。') }], ['团子']).length, 1);
});

test('a memory stays in for about three exchanges after it came up, newest counting most', () => {
    const memory = [{ content: '团子是她的猫' }];
    assert.deepEqual(picked(memory, ['团子', ...filler(5)]), ['团子是她的猫']);
    assert.deepEqual(picked(memory, ['团子', ...filler(6)]), []);
    const two = [{ content: '团子是她的猫' }, { content: '京都的红叶' }];
    assert.deepEqual(picked(two, ['团子', '嗯', '京都']), ['京都的红叶', '团子是她的猫']);
});

test('a label of your own counts; the category names do not', () => {
    assert.deepEqual(picked([{ label: 'Mochi', content: '她的猫' }], ['mochi?']), ['她的猫']);
    assert.deepEqual(picked([{ label: 'Favorite Thing', content: '草莓蛋糕' }], ['my favorite thing']), []);
});
