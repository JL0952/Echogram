// Run: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

// Loaded the way index.js loads its modules: each file sets a global on `window`
globalThis.window = {};
for (const file of ['rich-messages.js', 'features.js', 'chat-view-model.js', 'stickers.js']) {
    new Function(readFileSync(new URL(`../lib/${file}`, import.meta.url), 'utf8'))();
}
const RichMessages = window.EchoTextRichMessages;
const { buildFeaturePrompts, filterContextText, getComposerModes, FEATURE_IDS } = window.EchoTextFeatures;
const { buildChatViewModel } = window.EchoTextChatViewModel;
const { presetSets, characterNames, findSticker } = window.EchoTextStickers;

const BASE = 'https://st.example/ext';
const presets = presetSets(BASE);
// A second set, the way an imported one will look (6c)
const cats = { id: 'cats', name: 'cats', stickers: [{ name: '小猫摸摸头', url: '/u/1.gif' }, { name: '小猫摸摸头2', url: '/u/2.gif' }, { name: '上班累死猫', url: '/u/3.jpg' }] };
const library = [...presets, cats];

test('月薪喵 is the built-in set: 23 stickers, each one\'s file named after it in the extension\'s folder', () => {
    assert.equal(presets.length, 1);
    const [set] = presets;
    assert.deepEqual([set.id, set.name, set.builtIn, set.stickers.length], ['yuexinmiao', '月薪喵', true, 23]);
    assert.equal(set.stickers[0].url, `${BASE}/assets/stickers/yuexinmiao/${encodeURIComponent('安慰')}.gif`);
    for (const { name } of set.stickers) {
        assert.ok(existsSync(new URL(`../assets/stickers/yuexinmiao/${name}.gif`, import.meta.url)), name);
    }
    assert.equal(new Set(set.stickers.map(s => s.name)).size, 23);
});

test('the character can use the stickers of the sets not turned off for them, in tab order', () => {
    const all = characterNames(library);
    assert.equal(all.length, 26);
    assert.deepEqual(all.slice(0, 2), ['安慰', '不想干']);
    assert.deepEqual(all.slice(-3), ['小猫摸摸头', '小猫摸摸头2', '上班累死猫']);
    assert.deepEqual(characterNames(library, ['yuexinmiao']), ['小猫摸摸头', '小猫摸摸头2', '上班累死猫']);
    assert.deepEqual(characterNames(library, ['yuexinmiao', 'cats']), []);
});

test('a written name finds its sticker: the same, the same without extension and punctuation, or the closest one inside or around it', () => {
    const name = written => findSticker(library, written)?.name ?? null;
    assert.equal(name('安慰'), '安慰');
    assert.equal(name(' 安慰 '), '安慰');
    assert.equal(name('安慰.gif'), '安慰');
    assert.equal(name('「被迫上班」'), '被迫上班');
    assert.equal(name('角落 画圈圈'), '角落画圈圈');
    assert.equal(name('安慰你'), '安慰');
    assert.equal(name('月薪喵 被迫上班'), '被迫上班');
    assert.equal(name('摸摸头'), '小猫摸摸头');
    assert.equal(name('小猫摸摸头2'), '小猫摸摸头2');
    // A name of one character only matches whole
    assert.equal(name('对'), '对');
    assert.equal(name('对不起'), null);
    assert.equal(name('错了'), null);
    assert.equal(name('不想上班'), null);
    assert.equal(name(''), null);
    assert.equal(name('!!'), null);
});

test('the model is sent its stickers by the names they were found under; one with nothing close stays as written', () => {
    const { canonicalNames } = window.EchoTextStickers;
    assert.equal(canonicalNames(library, '好\n<sticker>发射爱心.gif</sticker>\n<sticker>安慰你</sticker>\n<sticker>不存在的</sticker>'),
        '好\n<sticker>发射爱心</sticker>\n<sticker>安慰</sticker>\n<sticker>不存在的</sticker>');
    assert.equal(canonicalNames(library, 'no stickers here'), 'no stickers here');
});

test('sticker tags, however the model writes them, read as stickers with their name', () => {
    const text = '<表情包>安慰</表情包>\n<sticker name="害羞"/>\n<STICKER>\n心动\n</STICKER>\n<表情>完了';
    assert.equal(RichMessages.normalizeMessageTags(text), '<sticker>安慰</sticker>\n<sticker>害羞</sticker>\n<sticker>心动</sticker>\n<sticker>完了</sticker>');
    assert.deepEqual(RichMessages.parseMessageParts('好的\n<sticker>安慰</sticker>', { splitLines: true }),
        [{ type: 'text', text: '好的' }, { type: 'sticker', name: '安慰' }]);
    assert.equal(RichMessages.serializeParts([{ type: 'sticker', name: '安慰' }]), '<sticker>安慰</sticker>');
    assert.equal(RichMessages.toPlainText('<sticker>安慰</sticker>'), '[Sticker: 安慰]');
    // A tapback alias that starts the same way is still a tapback
    assert.equal(RichMessages.normalizeMessageTags('<表情回应>❤️</表情回应>'), '<react>heart</react>');
});

test('the sticker rule lists the names the character can use; with none it says nothing', () => {
    const ctx = { charName: 'Mira', userName: 'Me', reactionIds: [], stickerNames: ['安慰', '害羞'] };
    assert.deepEqual(buildFeaturePrompts(['sticker'], ctx), [
        "- <sticker>name</sticker>: a sticker, its name copied exactly from this list whatever language the chat is in: 安慰, 害羞. Me's can have other names: a name says what the sticker shows.",
    ]);
    assert.deepEqual(buildFeaturePrompts(['sticker'], { ...ctx, stickerNames: [] }), []);
    assert.deepEqual(buildFeaturePrompts(['photo', 'sticker', 'voice'], ctx).map(rule => rule.match(/^- <(\w+)>/)[1]), ['photo', 'voice', 'sticker']);
    // Nothing to send it from the "+" menu
    assert.ok(!('sticker' in getComposerModes(FEATURE_IDS)));
});

test('without stickers, a sticker reaches the model as a plain-text note', () => {
    assert.equal(filterContextText('好的\n<sticker>安慰</sticker>', ['sticker']), '好的\n<sticker>安慰</sticker>');
    assert.equal(filterContextText('好的\n<sticker>安慰</sticker>', ['photo']), '好的\n[Sticker: 安慰]');
    assert.equal(filterContextText('<sticker>安慰</sticker>', []), '[Sticker: 安慰]');
});

test('a sticker shows its image where the platform has stickers, the note where it doesn\'t', () => {
    const history = [
        { is_user: true, mes: '<sticker>小猫摸摸头</sticker>', send_date: 0 },
        { is_user: false, mes: '乖\n<sticker>安慰你</sticker>\n<sticker>不存在的</sticker>', send_date: 1 },
    ];
    const findSticker = name => window.EchoTextStickers.findSticker(library, name);
    const [u, c] = buildChatViewModel(history, { charName: 'Mira', userName: 'Me', features: ['sticker'], findSticker }).messages;
    assert.deepEqual(u.parts, [{ type: 'sticker', name: '小猫摸摸头', url: '/u/1.gif' }]);
    assert.deepEqual(c.parts, [
        { type: 'text', text: '乖' },
        { type: 'sticker', name: '安慰你', url: presets[0].stickers[0].url },
        { type: 'sticker', name: '不存在的', url: null },
    ]);
    const [u2, c2] = buildChatViewModel(history, { charName: 'Mira', userName: 'Me', features: ['photo'], findSticker }).messages;
    assert.deepEqual(u2.parts, [{ type: 'text', text: '[Sticker: 小猫摸摸头]' }]);
    assert.deepEqual(c2.parts.map(p => p.text), ['乖', '[Sticker: 安慰你]', '[Sticker: 不存在的]']);
});
