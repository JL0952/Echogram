// Run: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Loaded the way index.js loads its modules: each file sets a global on `window`
globalThis.window = {};
for (const file of ['rich-messages.js', 'features.js', 'chat-view-model.js']) {
    new Function(readFileSync(new URL(`../lib/${file}`, import.meta.url), 'utf8'))();
}
const { buildChatViewModel, getMessageDisplayParts, getUserTapbacks, getUserTapbackIds, normalizeReactionStore } = window.EchoTextChatViewModel;

const T0 = new Date(2026, 9, 8, 14, 0, 0).getTime();
const at = min => T0 + min * 60000;
const user = (mes, min, extra = {}) => ({ is_user: true, mes, send_date: at(min), ...extra });
const char = (mes, min, extra = {}) => ({ is_user: false, mes, send_date: at(min), ...extra });
const build = (history, options = {}) => buildChatViewModel(history, { charName: 'Mira', userName: 'Me', ...options }).messages;

test('character replies split into one bubble per line; user messages only around rich content', () => {
    const [u, c] = build([
        user('line one\nline two <photo>my lunch</photo> after', 0),
        char('hi\n\nhow are you\n<photo>a cat</photo>', 1),
    ]);
    assert.deepEqual(u.parts, [
        { type: 'text', text: 'line one\nline two' },
        { type: 'photo', desc: 'my lunch' },
        { type: 'text', text: 'after' },
    ]);
    assert.deepEqual(c.parts, [
        { type: 'text', text: 'hi' },
        { type: 'text', text: 'how are you' },
        { type: 'photo', desc: 'a cat' },
    ]);
});

test('script-style name prefixes are stripped from character lines', () => {
    const [c] = build([char('Mira: hey\nMira：you there?\nMiranda: not me', 0)]);
    assert.deepEqual(c.parts.map(p => p.text), ['hey', 'you there?', 'Miranda: not me']);
    const [g] = build([char('Joi: yo', 0, { charName: 'Joi' })]);
    assert.equal(g.parts[0].text, 'yo');
});

test('a reply that is only a reaction becomes a note; an empty message keeps one empty bubble', () => {
    const [, r, e] = build([user('hi', 0), char('<react>❤️</react>', 1), char('', 2)]);
    assert.deepEqual(r.parts, [{ type: 'reaction_note', reaction: 'heart' }]);
    assert.deepEqual(e.parts, [{ type: 'text', text: '' }]);
    assert.deepEqual(getMessageDisplayParts({ is_user: false, mes: 'Mira:' }, 'Mira'), [{ type: 'text', text: '' }]);
});

test('transfers are settled by later responses from the other side', () => {
    const view = build([
        char('<transfer>52</transfer>', 0),
        user('<transfer>$20</transfer>', 1),
        char('<transfer_accept></transfer_accept>', 2),
        user('<transfer_decline>52</transfer_decline>', 3),
        char('<transfer>8</transfer>', 4),
    ]);
    const [charTransfer, userTransfer, accept, decline, pending] = view.map(m => m.parts[0]);
    assert.deepEqual(charTransfer, { type: 'transfer', amount: '52.00', status: 'declined', displayAmount: '¥52.00', actionable: false });
    assert.deepEqual(userTransfer, { type: 'transfer', amount: '$20.00', status: 'accepted', displayAmount: '$20.00', actionable: false });
    // A response without an amount takes the transfer's
    assert.deepEqual(accept, { type: 'transfer_accept', amount: '', status: 'accepted', displayAmount: '$20.00' });
    assert.deepEqual(decline, { type: 'transfer_decline', amount: '52.00', status: 'declined', displayAmount: '¥52.00' });
    // Only a pending transfer from the character waits on the user; a bare amount uses the chat's last currency
    assert.deepEqual(pending, { type: 'transfer', amount: '8.00', status: 'pending', displayAmount: '$8.00', actionable: true });
});

test('a response settles the latest pending transfer with the same value, else the latest one', () => {
    const view = build([
        char('<transfer>10</transfer>\n<transfer>20</transfer>\n<transfer>30</transfer>', 0),
        user('<transfer_accept>20</transfer_accept>', 1),
        user('<transfer_decline>99</transfer_decline>', 2),
    ]);
    assert.deepEqual(view[0].parts.map(p => p.status), ['pending', 'accepted', 'declined']);
    assert.equal(view[2].parts[0].displayAmount, '¥99.00');
});

test('a user transfer is never actionable', () => {
    const [u] = build([user('<transfer>5</transfer>', 0)]);
    assert.equal(u.parts[0].status, 'pending');
    assert.equal(u.parts[0].actionable, false);
});

test("a character's <react> lands on the user's latest message before the reply", () => {
    const view = build([
        user('one', 0),
        user('two', 1),
        char('<react>haha</react>\nlol', 2),
        char('<react>fire</react>\n<react>wow</react>', 3),
        user('three', 4, { charReaction: 'like' }),
        user('four', 5, { charReaction: 'not-a-reaction' }),
    ]);
    assert.deepEqual(view.map(m => m.charReaction), [null, 'wow', null, null, 'like', null]);
    // <react> is not a bubble
    assert.deepEqual(view[2].parts, [{ type: 'text', text: 'lol' }]);
});

test('reactions outside the screen\'s reaction set are dropped everywhere', () => {
    const view = build([
        user('hi', 0, { charReaction: 'like' }),
        char('<react>heart</react>\nok', 1, { reactions: { heart: { count: 1, mine: true } } }),
    ], { reactionIds: [] });
    assert.equal(view[0].charReaction, null);
    assert.equal(view[1].parts[0].tapbacks, undefined);
});

test("the user's tapbacks are per bubble; the former whole-message ones count on the last bubble", () => {
    const reactions = { haha: { count: 1, mine: true }, unknown: { count: 2 }, fire: { count: 0 }, star: { count: '2', mine: 'yes' } };
    assert.deepEqual(normalizeReactionStore(reactions), {
        haha: { count: 1, mine: true }, unknown: { count: 2, mine: false }, star: { count: 2, mine: false },
    });
    assert.deepEqual(normalizeReactionStore([1, 2]), {});
    // Only the user's own former ones, known ids, on bubbles that exist
    const msg = { is_user: false, reactions, bubbleReactions: { 0: ['heart', 'nope'], 1: ['fire', 'fire'], 7: ['wow'], x: ['bolt'] } };
    assert.deepEqual(getUserTapbacks(msg, 3), { 0: ['heart'], 1: ['fire'], 2: ['haha'] });
    assert.deepEqual(getUserTapbacks(msg, 3, ['haha']), { 2: ['haha'] });
    assert.deepEqual(getUserTapbacks({ ...msg, is_user: true }, 3), {});
    assert.deepEqual(getUserTapbackIds(msg), ['heart', 'fire', 'wow', 'haha']);
    // On screen, each bubble carries its own
    const [u, c] = build([user('hi', 0), char('yo\nsup\nok', 1, { reactions, bubbleReactions: { 0: ['heart'] } })]);
    assert.ok(u.parts.every(p => !p.tapbacks));
    assert.deepEqual(c.parts.map(p => p.tapbacks || []), [['heart'], [], ['haha']]);
});

test('consecutive user messages within the window are grouped; only the last shows its footer', () => {
    const view = build([
        user('a', 0), user('b', 1), user('c', 2),
        user('d', 10),
        char('x', 11), char('y', 12),
        user('e', 13),
    ]);
    assert.deepEqual(view.map(m => m.groupedWithNext), [true, true, false, false, false, false, false]);
});

test('time dividers show at the start, after a gap since the last divider, and on a new day', () => {
    const view = build([
        user('a', 0), user('b', 3), char('c', 6), user('d', 7), user('e', 9), user('f', 9 + 60 * 24),
    ]);
    assert.deepEqual(view.map(m => m.showTimeDivider), [true, false, true, false, false, true]);
    const [late, early] = build([user('late', 23 * 60 - 14 * 60 + 59), user('early', 24 * 60 - 14 * 60 + 1)], { timeDividerGapMs: 60 * 60000 });
    assert.equal(late.showTimeDivider, true);
    assert.equal(early.showTimeDivider, true, 'crossing midnight starts a new divider');
});

test('receipts: user messages only, sent by default', () => {
    const view = build([
        user('a', 0),
        user('b', 1, { meta: { receipt: { state: 'ghosted', note: 'seen' } } }),
        char('c', 2),
    ]);
    assert.deepEqual(view.map(m => m.receipt), [{ state: 'sent', note: '' }, { state: 'ghosted', note: 'seen' }, null]);
});

test('swipe state shows only on the last character message, with swipes on', () => {
    const history = [
        char('a', 0, { swipes: [{}, {}], swipeIndex: 1 }),
        user('b', 1),
        char('c', 2, { swipes: [{}, {}, {}], swipeIndex: 9 }),
        user('d', 3),
    ];
    const view = build(history, { swipes: true });
    assert.deepEqual(view.map(m => m.swipe), [null, null, { index: 2, count: 3, isLast: true }, null]);
    assert.deepEqual(build(history).map(m => m.swipe), [null, null, null, null]);
    assert.deepEqual(build([char('x', 0)], { swipes: true })[0].swipe, { index: 0, count: 1, isLast: true });
    assert.deepEqual(build([char('x', 0, { swipes: [{}, {}], swipeIndex: 0 })], { swipes: true })[0].swipe, { index: 0, count: 2, isLast: false });
    assert.equal(buildChatViewModel(history).lastCharIndex, 2);
});

test('senders: combine mode keeps each message\'s own character', () => {
    const history = [user('hi', 0), char('hey', 1, { charName: 'Amy', charKey: 'amy.png' }), char('yo', 2)];
    const combined = build(history, { combineMode: true });
    assert.deepEqual(combined.map(m => [m.senderName, m.charKey]), [['Me', null], ['Amy', 'amy.png'], ['Mira', null]]);
    const single = build(history);
    assert.deepEqual(single.map(m => [m.senderName, m.charKey]), [['Me', null], ['Mira', null], ['Mira', null]]);
});

test('image attachments pass through; old memory highlights are dropped', () => {
    const attachment = { type: 'image', status: 'ready', url: 'x.png' };
    const history = [user('pizza', 0, { memoryHighlights: [{ text: 'pizza' }] }), char('look', 1, { imageAttachment: attachment })];
    const view = build(history);
    assert.deepEqual(view[1].imageAttachment, attachment);
    assert.equal(view[0].imageAttachment, null);
    assert.ok(!('memoryHighlights' in view[0]));
});

test('messages without a send_date have no timestamp and do not break grouping', () => {
    const view = build([{ is_user: true, mes: 'a' }, { is_user: true, mes: 'b' }], { now: at(0) });
    assert.equal(view[0].timestamp, null);
    assert.equal(view[0].groupedWithNext, true);
    assert.deepEqual(view.map(m => m.showTimeDivider), [true, false]);
});

test('the history is not modified', () => {
    const history = [
        user('<transfer>5</transfer>', 0),
        char('Mira: <transfer_accept/>\n<react>heart</react>', 1, { reactions: { heart: { count: '1', mine: true }, sad: { count: 0 } }, swipes: [{ mes: 'x' }], swipeIndex: 3 }),
    ];
    const before = JSON.stringify(history);
    build(history, { swipes: true, combineMode: true });
    assert.equal(JSON.stringify(history), before);
});

test('an empty or missing history gives an empty list', () => {
    assert.deepEqual(buildChatViewModel([]), { messages: [], lastCharIndex: -1 });
    assert.deepEqual(buildChatViewModel(null), { messages: [], lastCharIndex: -1 });
});

test('without reactions: reaction-only replies, tapbacks and character reactions disappear', () => {
    const history = [
        user('one', 0, { charReaction: 'like' }),
        char('<react>heart</react>', 1),
        user('two', 2),
        char('ok\n<react>haha</react>', 3, { reactions: { fire: { count: 1, mine: true } } }),
        char('<react>wow</react>', 4, { imageAttachment: { type: 'image', status: 'ready', url: 'x.png' } }),
    ];
    const view = build(history, { features: ['photo', 'transfer'] });
    assert.deepEqual(view.map(m => m.index), [0, 2, 3, 4]);
    assert.deepEqual(view.map(m => m.charReaction), [null, null, null, null]);
    assert.deepEqual(view[2].parts, [{ type: 'text', text: 'ok' }]);
    // A reply that was only a reaction still shows its image
    assert.deepEqual(view[3].parts, [{ type: 'text', text: '' }]);
    // The history keeps everything, and all features show it again
    assert.deepEqual(build(history).map(m => m.index), [0, 1, 2, 3, 4]);
    assert.equal(build(history)[0].charReaction, 'heart');
});

test('hidden messages do not split groups or time dividers', () => {
    const history = [user('a', 0), char('<react>heart</react>', 1), user('b', 2), char('c', 3)];
    const view = build(history, { features: ['photo', 'transfer'] });
    assert.deepEqual(view.map(m => [m.index, m.groupedWithNext, m.showTimeDivider]), [[0, true, true], [2, false, false], [3, false, false]]);
});

test('without photos or transfers, their cards become the same notes the model sees', () => {
    const history = [char('look\n<photo>a cat</photo>\n<transfer>52</transfer>', 0), user('<transfer_accept></transfer_accept>', 1)];
    const view = build(history, { features: ['react'] });
    assert.deepEqual(view[0].parts, [
        { type: 'text', text: 'look' },
        { type: 'text', text: '[Photo: a cat]' },
        { type: 'text', text: '[Transfer: ¥52.00]' },
    ]);
    assert.deepEqual(view[1].parts, [{ type: 'text', text: '[Accepted transfer]' }]);
});

test('voice messages: their words, length, place among the message\'s voices, and whether they wait to be opened', () => {
    const history = [
        char('好\n<voice>好，我现在在路上，我在扶着外公，在外面。我一会儿看一下，我仔细看一下，我再问他们。你先别管了啊，你先睡觉啊。</voice>\n<voice>see you soon okay</voice>', 0, { voiceHeard: [1] }),
        user('<voice>嗯</voice>', 1),
    ];
    const [c, u] = build(history);
    assert.deepEqual(c.parts.map(p => p.type), ['text', 'voice', 'voice']);
    assert.equal(c.parts[1].duration, 12);   // 45 characters, about 4 a second, rounded up
    assert.deepEqual([c.parts[1].voiceIndex, c.parts[1].unread], [0, true]);
    assert.deepEqual([c.parts[2].duration, c.parts[2].voiceIndex, c.parts[2].unread], [2, 1, false]);
    // The user's own voice messages are never unread
    assert.deepEqual(u.parts, [{ type: 'voice', text: '嗯', duration: 1, voiceIndex: 0, unread: false }]);
});

test('voice tags written the way models drift are still voice messages', () => {
    const [c] = build([char('<语音>在吗</语音>\n<voice_message>\nhello\nthere</voice_message>\n<audio text="la la"/>', 0)]);
    assert.deepEqual(c.parts.map(p => [p.type, p.text]), [['voice', '在吗'], ['voice', 'hello there'], ['voice', 'la la']]);
});

test('voice lengths stay between 1 second and a minute', () => {
    const { voiceDuration } = window.EchoTextRichMessages;
    assert.equal(voiceDuration(''), 1);
    assert.equal(voiceDuration('ok'), 1);
    assert.equal(voiceDuration('one two three four five'), 2);
    assert.equal(voiceDuration('字'.repeat(1000)), 60);
});

test('without voice, a voice message becomes the note the model sees', () => {
    const [c] = build([char('<voice>hi there</voice>', 0)], { features: ['photo'] });
    assert.deepEqual(c.parts, [{ type: 'text', text: '[Voice: hi there]' }]);
});

test('a voice part goes back to its tag when a message is rewritten from its parts', () => {
    const { parseMessageParts, serializeParts } = window.EchoTextRichMessages;
    assert.equal(serializeParts(parseMessageParts('a\n<voice>b c</voice>', { splitLines: true })), 'a\n<voice>b c</voice>');
});

test('files: name and summary, with the look and a made-up size from the name', () => {
    const [m] = build([char('看下\n<file>简历信息收集表.docx | 姓名、学校、实习经历</file>\n<file>Q3.xlsx</file>\n<file>notes.txt｜draft</file>', 0)]);
    const [, word, excel, other] = m.parts;
    assert.deepEqual([word.name, word.summary, word.ext, word.kind], ['简历信息收集表.docx', '姓名、学校、实习经历', 'DOCX', 'word']);
    assert.deepEqual([excel.summary, excel.kind], ['', 'excel']);
    assert.deepEqual([other.name, other.summary, other.ext, other.kind], ['notes.txt', 'draft', 'TXT', 'other']);
    // The same name always gets the same size, in its kind's range
    const { fileSize } = window.EchoTextRichMessages;
    assert.equal(word.size, fileSize('简历信息收集表.docx'));
    assert.ok(word.size >= 10 * 1024 && word.size <= 300 * 1024);
    assert.ok(fileSize('deck.pptx') >= 300 * 1024 && fileSize('deck.pptx') <= 8000 * 1024);
});

test('links: everything before the address is the title (titles often hold a |), after it the summary', () => {
    const [m] = build([user('<link>亚运会 | 举重——李雯雯获女子86公斤以上级冠军-新华网 | https://www.news.cn/s/1.htm</link>\n<link>Recipe | https://a.com/r?x=1 | quick and easy</link>\n<link>www.example.com</link>', 0)]);
    assert.deepEqual(m.parts.map(p => [p.title, p.url, p.summary, p.host]), [
        ['亚运会 | 举重——李雯雯获女子86公斤以上级冠军-新华网', 'https://www.news.cn/s/1.htm', '', 'www.news.cn'],
        ['Recipe', 'https://a.com/r?x=1', 'quick and easy', 'a.com'],
        ['', 'www.example.com', '', 'www.example.com'],
    ]);
});

test('files and links written as self-closing tags keep all their fields', () => {
    const [m] = build([char('<file name="【Nikki】.pdf" desc="简历"/>\n<网页 title="新闻" url="https://news.cn"/>', 0)]);
    assert.deepEqual(m.parts.map(p => p.type === 'file' ? [p.name, p.summary] : [p.title, p.url]), [['【Nikki】.pdf', '简历'], ['新闻', 'https://news.cn']]);
});

test('files and links go back to their tags when a message is rewritten from its parts', () => {
    const { parseMessageParts, serializeParts } = window.EchoTextRichMessages;
    for (const text of ['<file>a.pdf | b</file>', '<file>a.pdf</file>', '<link>T | https://x.io | s</link>', '<link>A | B | https://x.io</link>']) {
        assert.equal(serializeParts(parseMessageParts(text)), text);
    }
});

test('what the user shares from the composer: a link when it holds an address, else a file', () => {
    const { shareTag } = window.EchoTextRichMessages;
    assert.equal(shareTag('行程.pdf | 三天两夜'), '<file>行程.pdf | 三天两夜</file>');
    assert.equal(shareTag('看看这个 | https://www.news.cn/a'), '<link>看看这个 | https://www.news.cn/a</link>');
    assert.equal(shareTag('www.bilibili.com/video/1'), '<link>www.bilibili.com/video/1</link>');
    assert.equal(shareTag('报告.docx\n第二稿'), '<file>报告.docx 第二稿</file>');
    assert.equal(shareTag('  '), null);
});

test('without files, file and link cards become the notes the model sees', () => {
    const [m] = build([char('<file>a.pdf | notes</file>\n<link>News | https://a.cn</link>', 0)], { features: ['photo'] });
    assert.deepEqual(m.parts, [{ type: 'text', text: '[File: a.pdf | notes]' }, { type: 'text', text: '[Link: News | https://a.cn]' }]);
});

test('sharing a picked kind: the extension is added unless the title has one of that kind; a web page needs no address', () => {
    const { shareTag } = window.EchoTextRichMessages;
    assert.equal(shareTag('行程单 | 三天两夜', 'pdf'), '<file>行程单.pdf | 三天两夜</file>');
    assert.equal(shareTag('报告.PDF', 'pdf'), '<file>报告.PDF</file>');
    assert.equal(shareTag('简历 v2.0 | 第二稿', 'word'), '<file>简历 v2.0.docx | 第二稿</file>');
    assert.equal(shareTag('简历.doc', 'word'), '<file>简历.doc</file>');
    assert.equal(shareTag('Q3', 'excel'), '<file>Q3.xlsx</file>');
    assert.equal(shareTag('汇报', 'ppt'), '<file>汇报.pptx</file>');
    assert.equal(shareTag('西湖攻略 | 一天走完', 'link'), '<link>西湖攻略 | 一天走完</link>');
    assert.equal(shareTag('photos.zip', 'other'), '<file>photos.zip</file>');
    assert.equal(shareTag('  ', 'pdf'), null);
});

test('a web page shared without an address has a title and summary and no site', () => {
    const [m] = build([user('<link>西湖攻略 | 一天走完</link>', 0)]);
    assert.deepEqual([m.parts[0].title, m.parts[0].url, m.parts[0].summary, m.parts[0].host], ['西湖攻略', '', '一天走完', '']);
});

test('a quoted reply keeps its quote on the bubble; a platform without replies shows the plain note instead', () => {
    const history = [user('<reply>Mira: hi</reply>\nhello', 0), char('<reply>Me: hello</reply>\nyes\nno', 1)];
    const [u, c] = build(history, { features: ['reply'] });
    assert.deepEqual(u.parts, [{ type: 'text', text: 'hello', replyTo: { name: 'Mira', text: 'hi' } }]);
    assert.deepEqual(c.parts, [{ type: 'text', text: 'yes', replyTo: { name: 'Me', text: 'hello' } }, { type: 'text', text: 'no' }]);
    const [u2] = build(history, { features: [] });
    assert.deepEqual(u2.parts, [{ type: 'text', text: '[Replying to Mira: hi]' }, { type: 'text', text: 'hello' }]);
});
