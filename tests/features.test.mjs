// Run: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = {};
for (const file of ['rich-messages.js', 'features.js']) {
    new Function(readFileSync(new URL(`../lib/${file}`, import.meta.url), 'utf8'))();
}
const { FEATURE_IDS, buildFeaturePrompts, filterContextText, getComposerModes } = window.EchoTextFeatures;

const ALL = FEATURE_IDS;
const NO_REACT = ['photo', 'transfer'];
const NONE = [];
const REACTIONS = ['heart', 'haha', 'wow', 'sad', 'fire', 'like', 'star', 'bolt'];

// The rules for the first three features as written since step 8c: "on its own line"
// and the language are said once, in index.js's MESSAGES line
const FORMAT_RULES = [
    "PHOTOS: Mira can send photos as <photo>what the photo shows</photo> — a short, concrete description of the picture — and Me sees it as an actual picture. Write the description as a neutral caption of what is visible, with no first- or second-person pronouns: refer to people by name (Mira, Me) instead of I/me/my/you. Send one whenever Mira naturally would, such as when asked for a picture, but never use it to describe Mira's own actions. A <photo> from Me is a picture they sent: react to what it shows.",
    "REACTIONS: Mira can react to a message of Me's with a tapback: a <reply> quoting that message, then <react>name</react> right after it, where name is one of: heart, haha, wow, sad, fire, like, star, bolt — always both, even for Me's latest message: <reply>Me: the quoted words</reply> (a photo by its note: <reply>Me: [Photo: what it shows]</reply>), then <react>heart</react>. Use one only now and then, when a quick reaction genuinely fits — most replies need none. A <react> from Me is their tapback on the message the <reply> right before it quotes.",
    "TRANSFERS: Mira can send Me money as <transfer>amount</transfer>, with the amount as a plain number. When Me sends Mira a <transfer>, Mira can accept it with <transfer_accept/> or decline it with <transfer_decline/>, or leave it pending for now. A <transfer_accept> or <transfer_decline> from Me means they accepted or declined Mira's transfer. Only send or answer transfers when it fits the story.",
];

test('the format rules read exactly as written', () => {
    assert.deepEqual(buildFeaturePrompts(['photo', 'react', 'transfer'], { charName: 'Mira', userName: 'Me', reactionIds: REACTIONS }), FORMAT_RULES);
});

test('no rule repeats what the MESSAGES line says once', () => {
    for (const rule of buildFeaturePrompts(ALL, { charName: 'Mira', userName: 'Me', reactionIds: REACTIONS })) {
        assert.doesNotMatch(rule, /on its own line|language of the conversation|same language/, rule.split(':')[0]);
    }
});

test('format rules list only the enabled features, in a fixed order', () => {
    const ctx = { charName: 'Mira', userName: 'Me', reactionIds: ['heart', 'like'] };
    assert.deepEqual(buildFeaturePrompts(NO_REACT, ctx).map(p => p.split(':')[0]), ['PHOTOS', 'TRANSFERS']);
    assert.deepEqual(buildFeaturePrompts(['transfer', 'photo'], ctx).map(p => p.split(':')[0]), ['PHOTOS', 'TRANSFERS']);
    assert.match(buildFeaturePrompts(['react'], ctx)[0], /one of: heart, like —/);
    assert.deepEqual(buildFeaturePrompts(NONE, ctx), []);
    assert.deepEqual(buildFeaturePrompts(['music', 'link', 'file', 'transfer', 'location', 'voice', 'reply', 'react', 'photo'], ctx).map(p => p.split(':')[0]),
        ['PHOTOS', 'VOICE MESSAGES', 'LOCATIONS', 'REACTIONS', 'REPLIES', 'TRANSFERS', 'FILES AND LINKS', 'MUSIC']);
});

test('the voice rule names the tag, when to use it, and how a character\'s temperament changes that', () => {
    const [rule] = buildFeaturePrompts(['voice'], { charName: 'Mira', userName: 'Me', reactionIds: REACTIONS });
    assert.match(rule, /<voice>exactly what Mira says<\/voice>/);
    assert.match(rule, /typing is awkward/);
    assert.match(rule, /closer or more intimate/);
    assert.match(rule, /asks to hear something/);
    assert.match(rule, /Outgoing, expressive characters send them often; reserved or shy ones rarely do/);
    assert.match(rule, /A <voice> from Me is their recording/);
});

test('text is untouched when every feature is on or no tag applies', () => {
    const text = 'hi\n<react>heart</react>\n<photo>cat</photo>';
    assert.equal(filterContextText(text, ALL), text);
    assert.equal(filterContextText('plain\n  indented line', NO_REACT), 'plain\n  indented line');
    assert.equal(filterContextText('', NO_REACT), '');
});

test('reactions are stripped: their lines go, inline gaps close up', () => {
    assert.equal(filterContextText('lol\n<react>haha</react>\nok', NO_REACT), 'lol\nok');
    assert.equal(filterContextText('<react>heart</react>\nsee you', NO_REACT), 'see you');
    assert.equal(filterContextText('see you\n<react>heart</react>', NO_REACT), 'see you');
    assert.equal(filterContextText('nice <react>fire</react> one', NO_REACT), 'nice one');
    // Lines without a stripped tag keep their spacing
    assert.equal(filterContextText('```\n  code\n```\n<react>like</react>', NO_REACT), '```\n  code\n```');
});

test('without reactions, a quote saying which message a tapback is on goes with it', () => {
    // WeChat: replies, no reactions
    const wechat = ['photo', 'voice', 'reply', 'transfer'];
    assert.equal(filterContextText('<reply>Me: [Photo: lunch]</reply>\n<react>heart</react>\nlooks good', wechat), 'looks good');
    assert.equal(filterContextText('looks good\n<reply>Me: look</reply>\n<react>heart</react>', wechat), 'looks good');
    // A quote answered by text stays
    assert.equal(filterContextText('<reply>Me: look</reply>\nnice', wechat), '<reply>Me: look</reply>\nnice');
    assert.equal(filterContextText('<reply>Me: look</reply>\n<react>heart</react>', wechat), null);
});

test('a message that was only unsupported content is left out (null)', () => {
    assert.equal(filterContextText('<react>wow</react>', NO_REACT), null);
    assert.equal(filterContextText('<react>wow</react>\n<react>sad</react>', NO_REACT), null);
    assert.equal(filterContextText('   ', NO_REACT), '   ');
});

test('files and links: one rule for both where both are on, each its own where only one is', () => {
    const ctx = { charName: 'Mira', userName: 'Me', reactionIds: REACTIONS };
    const [files] = buildFeaturePrompts(['file'], ctx);
    assert.match(files, /^FILES: .*<file>name\.ext/);
    assert.doesNotMatch(files, /<link>|web page/);
    const [links] = buildFeaturePrompts(['link'], ctx);
    assert.match(links, /^LINKS: Mira can share a web page as <link>page title \| address \| one line about it<\/link>/);
    assert.match(links, /A <link> from Me is something they shared/);
    assert.doesNotMatch(links, /<file>/);
    assert.equal(buildFeaturePrompts(['file', 'link'], ctx).length, 1);
    // The "+" menu: links are a kind of file where files are on, their own entry where not
    assert.deepEqual(Object.keys(getComposerModes(['photo', 'file', 'link'])), ['photo', 'file']);
    assert.deepEqual(Object.keys(getComposerModes(['photo', 'link'])), ['photo', 'link']);
    // A platform with links only keeps links and turns files into notes
    assert.equal(filterContextText('<link>News | https://a.cn</link>\n<file>a.pdf | notes</file>', ['link']), '<link>News | https://a.cn</link>\n[File: a.pdf | notes]');
});

test('the file rule names both tags and keeps sharing to what the story calls for', () => {
    const [rule] = buildFeaturePrompts(['file', 'link'], { charName: 'Mira', userName: 'Me', reactionIds: REACTIONS });
    assert.match(rule, /<file>name\.ext \| a short summary of what's in it<\/file>/);
    assert.match(rule, /<link>page title \| address \| one line about it<\/link>/);
    assert.match(rule, /only when the story calls for it/);
    assert.match(rule, /A <file> or <link> from Me is something they shared/);
});

test('files and links degrade to plain-text notes', () => {
    assert.equal(filterContextText('<file>a.pdf | notes</file>', ['photo']), '[File: a.pdf | notes]');
    assert.equal(filterContextText('<link>News | https://a.cn</link>', ['photo']), '[Link: News | https://a.cn]');
});

test('the location rule names the tag, what it is for, and that the story has to call for it', () => {
    const [rule] = buildFeaturePrompts(['location'], { charName: 'Mira', userName: 'Me', reactionIds: REACTIONS });
    assert.equal(rule, 'LOCATIONS: Mira can share a place as <location>place name | address</location> — where Mira is, or where to meet — only when the story calls for it. A <location> from Me is a place they shared: respond to it.');
    // The "+" menu has it after voice, the way WeChat's panel orders 位置 after 照片
    assert.deepEqual(Object.keys(getComposerModes(['transfer', 'location', 'photo', 'file'])), ['photo', 'location', 'transfer', 'file']);
});

test('places degrade to a plain-text note', () => {
    assert.equal(filterContextText('<location>星巴克 | 建国门外大街1号</location>\n到了', ['photo']), '[Location: 星巴克 | 建国门外大街1号]\n到了');
    assert.equal(filterContextText('<location>home</location>', ['location']), '<location>home</location>');
});

test('the music rule asks for a real song, its title and artist as released', () => {
    const [rule] = buildFeaturePrompts(['music'], { charName: 'Mira', userName: 'Me', reactionIds: REACTIONS });
    assert.equal(rule, 'MUSIC: Mira can share a song as <music>song title | artist</music>, or with a few of its lines as <music>song title | artist | a line; the next line</music> — a real song that exists, with its title and artist as released, never translated — now and then, when a song fits the moment or comes up. A <music> from Me is a song they shared: respond to it.');
    // The "+" menu has it last, the way WeChat's panel ends with 音乐
    assert.deepEqual(Object.keys(getComposerModes(['music', 'file', 'location', 'photo', 'transfer'])), ['photo', 'location', 'transfer', 'file', 'music']);
});

test('songs degrade to a plain-text note', () => {
    assert.equal(filterContextText('<music>晴天 | 周杰伦</music>\n听这个', ['photo']), '[Music: 晴天 | 周杰伦]\n听这个');
    assert.equal(filterContextText('<music>Song A | Band B | one line; two</music>', ['photo']), '[Music: Song A | Band B | one line; two]');
    assert.equal(filterContextText('<music>Lemon</music>', ['music']), '<music>Lemon</music>');
});

test('voice messages degrade to a plain-text note', () => {
    assert.equal(filterContextText('<voice>到家了吗</voice>\nok', ['photo', 'transfer']), '[Voice: 到家了吗]\nok');
    assert.equal(filterContextText('<voice>hi</voice>', ALL), '<voice>hi</voice>');
});

test('photos and transfers degrade to plain-text notes', () => {
    assert.equal(filterContextText('look\n<photo>a cat on the sofa</photo>', ['react', 'transfer']), 'look\n[Photo: a cat on the sofa]');
    assert.equal(filterContextText('<transfer>52.00</transfer>\nfor dinner', NONE), '[Transfer: ¥52.00]\nfor dinner');
    assert.equal(filterContextText('<transfer>$20.00</transfer>', NONE), '[Transfer: $20.00]');
    assert.equal(filterContextText('<transfer_accept></transfer_accept>\nthanks', NONE), '[Accepted transfer]\nthanks');
    assert.equal(filterContextText('<transfer_decline>8.80</transfer_decline>', NONE), '[Declined transfer: ¥8.80]');
    assert.equal(filterContextText('<photo>x</photo>\n<react>heart</react>', NONE), '[Photo: x]');
});

test('only the disabled features are touched', () => {
    const text = '<photo>x</photo>\n<transfer>5.00</transfer>\n<react>heart</react>';
    assert.equal(filterContextText(text, ['photo', 'transfer']), '<photo>x</photo>\n<transfer>5.00</transfer>');
    assert.equal(filterContextText(text, ['react']), '[Photo: x]\n[Transfer: ¥5.00]\n<react>heart</react>');
});

// ── Quoted replies (docs/platform-plan.md 9b) ──────────────────────────────

const Rich = window.EchoTextRichMessages;

test('a <reply> quotes for the bubble after it, read leniently and written back canonically', () => {
    assert.deepEqual(Rich.parseMessageParts('<reply>Qi: are you free?</reply>\nyeah\nwhat time', { splitLines: true }), [
        { type: 'text', text: 'yeah', replyTo: { name: 'Qi', text: 'are you free?' } },
        { type: 'text', text: 'what time' },
    ]);
    // Other tag names, "replying to", a full-width colon, the reply on the same line
    assert.deepEqual(Rich.parseMessageParts('<quote>replying to Qi：你在干嘛</quote> 刚醒'),
        [{ type: 'text', text: '刚醒', replyTo: { name: 'Qi', text: '你在干嘛' } }]);
    assert.equal(Rich.normalizeMessageTags('<回复>回复 齐宁：吃了吗</回复>\n吃了'), '<reply>齐宁: 吃了吗</reply>\n吃了');
    // Nothing after it: the bubble before it; no name: only words
    assert.deepEqual(Rich.parseMessageParts('ok\n<reply>Mira: hi</reply>', { splitLines: true }),
        [{ type: 'text', text: 'ok', replyTo: { name: 'Mira', text: 'hi' } }]);
    assert.deepEqual(Rich.parseMessageParts('<reply>just words</reply>\n<photo>a cat</photo>'),
        [{ type: 'photo', desc: 'a cat', replyTo: { name: '', text: 'just words' } }]);
    // Written back as it came (deleting another bubble keeps the quote)
    const text = '<reply>Qi: are you free?</reply>\nyeah\n<reply>Mira: hm</reply>\n<photo>a ticket</photo>';
    assert.equal(Rich.serializeParts(Rich.parseMessageParts(text, { splitLines: true })), text);
    assert.equal(Rich.toPlainText('<reply>Qi: hey</reply>\nok'), '[Replying to Qi: hey]\nok');
});

test('a tag inside a quote is quoted by its note; a quote with no words is dropped', () => {
    // The model copied the user's photo tag into its quote, to react to the photo
    const mes = '<reply>齐宁: <photo>selfie</photo></reply>\n<react>like</react>\n\nThere.';
    assert.equal(Rich.normalizeMessageTags(mes), '<reply>齐宁: [Photo: selfie]</reply>\n<react>like</react>\n\nThere.');
    assert.deepEqual(Rich.parseMessageParts(mes, { splitLines: true }), [
        { type: 'react', reaction: 'like', replyTo: { name: '齐宁', text: '[Photo: selfie]' } },
        { type: 'text', text: 'There.' },
    ]);
    // Unclosed inside, other tag names
    assert.equal(Rich.normalizeMessageTags('<reply>Qi: <photo>selfie</reply>'), '<reply>Qi: [Photo: selfie]</reply>');
    assert.equal(Rich.normalizeMessageTags('<回复>齐宁：<照片>自拍</照片></回复>\n好看'), '<reply>齐宁: [Photo: 自拍]</reply>\n好看');
    // A quote of nothing: the bubble after it is just itself
    assert.deepEqual(Rich.parseMessageParts('<reply>齐宁: </reply>\nhi', { splitLines: true }), [{ type: 'text', text: 'hi' }]);
});

test('the model sees replies as they are; without them, as a plain note', () => {
    const text = '<reply>Mira: [Photo: a ticket]</reply>\nfor us?';
    assert.equal(filterContextText(text, ALL), text);
    assert.equal(filterContextText(text, ['photo']), '[Replying to Mira: [Photo: a ticket]]\nfor us?');
});

test('the reply rule names the tag, who the name is, and that most replies need none', () => {
    const [rule] = buildFeaturePrompts(['reply'], { charName: 'Mira', userName: 'Me', reactionIds: REACTIONS });
    assert.match(rule, /^REPLIES: /);
    assert.match(rule, /<reply>name: the quoted words<\/reply>/);
    assert.match(rule, /whoever sent it \(Me or Mira\)/);
    assert.match(rule, /quoted by its note in square brackets, as \[Photo: what it shows\], never with its tag/);
    assert.match(rule, /most replies need none/);
});

test('a reply is cut to its most bubbles; tapbacks are not bubbles and stay', () => {
    const { capTexts } = window.EchoTextRichMessages;
    assert.equal(capTexts('a\nb\n<reply>Me: hi</reply>\n<react>heart</react>\nc\n<photo>cat</photo>\nd', 3), 'a\nb\n<reply>Me: hi</reply>\n<react>heart</react>\nc');
    assert.equal(capTexts('a\n<photo>cat</photo>\nb\nc', 2), 'a\n<photo>cat</photo>');
    // Within it: as it was
    assert.equal(capTexts('a\n\nb', 2), 'a\n\nb');
});

test('a follow-up written over several lines is one bubble; a card keeps its own', () => {
    const { oneText } = window.EchoTextRichMessages;
    assert.equal(oneText("Josie.\nI'll stop after this.\n<photo>phone</photo>\nok"), "Josie. I'll stop after this.\n<photo>phone</photo>\nok");
    assert.equal(oneText('就一句'), '就一句');
});
