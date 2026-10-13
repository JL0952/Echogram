// Run: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = {};
for (const file of ['rich-messages.js', 'features.js']) {
    new Function(readFileSync(new URL(`../lib/${file}`, import.meta.url), 'utf8'))();
}
const { FEATURE_IDS, buildFeaturePrompts, filterContextText } = window.EchoTextFeatures;

const ALL = FEATURE_IDS;
const NO_REACT = ['photo', 'transfer'];
const NONE = [];
const REACTIONS = ['heart', 'haha', 'wow', 'sad', 'fire', 'like', 'star', 'bolt'];

// The rules for the first three features as written since step 8c: "on its own line"
// and the language are said once, in index.js's MESSAGES line
const FORMAT_RULES = [
    "PHOTOS: Mira can send photos as <photo>what the photo shows</photo> — a short, concrete description of the picture — and Me sees it as an actual picture. Write the description as a neutral caption of what is visible, with no first- or second-person pronouns: refer to people by name (Mira, Me) instead of I/me/my/you. Send one whenever Mira naturally would, such as when asked for a picture, but never use it to describe Mira's own actions. A <photo> from Me is a picture they sent: react to what it shows.",
    "REACTIONS: Mira can react to Me's latest message with a tapback as <react>name</react>, where name is one of: heart, haha, wow, sad, fire, like, star, bolt. Use one only now and then, when a quick reaction genuinely fits — most replies need none. A reaction usually comes with text messages, but occasionally it can be the whole reply. A <react> from Me is their tapback on Mira's message just before it, or on the text a <reply> right before the <react> quotes — Mira may notice it, but it doesn't need an answer of its own.",
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
    assert.match(buildFeaturePrompts(['react'], ctx)[0], /one of: heart, like\./);
    assert.deepEqual(buildFeaturePrompts(NONE, ctx), []);
    assert.deepEqual(buildFeaturePrompts(['file', 'transfer', 'voice', 'reply', 'react', 'photo'], ctx).map(p => p.split(':')[0]),
        ['PHOTOS', 'VOICE MESSAGES', 'REACTIONS', 'REPLIES', 'TRANSFERS', 'FILES AND LINKS']);
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

test('a message that was only unsupported content is left out (null)', () => {
    assert.equal(filterContextText('<react>wow</react>', NO_REACT), null);
    assert.equal(filterContextText('<react>wow</react>\n<react>sad</react>', NO_REACT), null);
    assert.equal(filterContextText('   ', NO_REACT), '   ');
});

test('the file rule names both tags and keeps sharing to what the story calls for', () => {
    const [rule] = buildFeaturePrompts(['file'], { charName: 'Mira', userName: 'Me', reactionIds: REACTIONS });
    assert.match(rule, /<file>name\.ext \| a short summary of what's in it<\/file>/);
    assert.match(rule, /<link>page title \| address \| one line about it<\/link>/);
    assert.match(rule, /only when the story calls for it/);
    assert.match(rule, /A <file> or <link> from Me is something they shared/);
});

test('files and links degrade to plain-text notes', () => {
    assert.equal(filterContextText('<file>a.pdf | notes</file>', ['photo']), '[File: a.pdf | notes]');
    assert.equal(filterContextText('<link>News | https://a.cn</link>', ['photo']), '[Link: News | https://a.cn]');
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
    assert.match(rule, /most replies need none/);
});
