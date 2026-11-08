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

test('月薪喵 is the built-in set: 37 stickers, each one\'s file named after it in the extension\'s folder', () => {
    assert.equal(presets.length, 1);
    const [set] = presets;
    assert.deepEqual([set.id, set.name, set.builtIn, set.stickers.length], ['yuexinmiao', '月薪喵', true, 37]);
    assert.equal(set.stickers[0].url, `${BASE}/assets/stickers/yuexinmiao/${encodeURIComponent('安慰')}.gif`);
    for (const { name } of set.stickers) {
        assert.ok(existsSync(new URL(`../assets/stickers/yuexinmiao/${name}.gif`, import.meta.url)), name);
    }
    assert.equal(new Set(set.stickers.map(s => s.name)).size, 37);
});

test('the character can use the stickers of the sets turned on for them, in tab order; none at first', () => {
    assert.deepEqual(characterNames(library), []);
    assert.deepEqual(characterNames(library, ['cats']), ['小猫摸摸头', '小猫摸摸头2', '上班累死猫']);
    const both = characterNames(library, ['cats', 'yuexinmiao']);
    assert.equal(both.length, 40);
    assert.deepEqual(both.slice(0, 2), ['安慰', '好的']);
    assert.deepEqual(both.slice(-3), ['小猫摸摸头', '小猫摸摸头2', '上班累死猫']);
    assert.deepEqual(characterNames(library, ['gone']), []);
});

test('a written name finds its sticker: the same, the same without extension and punctuation, or the closest one inside or around it', () => {
    const name = written => findSticker(library, written)?.name ?? null;
    assert.equal(name('安慰'), '安慰');
    assert.equal(name(' 安慰 '), '安慰');
    assert.equal(name('安慰.gif'), '安慰');
    assert.equal(name('「被迫上班」'), '被迫上班');
    assert.equal(name('角落 画圈'), '角落画圈');
    // A chat from before 2026-11-08, when it was 角落画圈圈
    assert.equal(name('角落画圈圈'), '角落画圈');
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
        "- <sticker>name</sticker>: a sticker, its name copied exactly from this list whatever language the chat is in: 安慰, 害羞.",
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

test('a name already in the library gets the first number that makes it new', () => {
    const { uniqueName } = window.EchoTextStickers;
    assert.equal(uniqueName(new Set(['安慰']), '害羞'), '害羞');
    assert.equal(uniqueName(new Set(['害羞']), '害羞'), '害羞2');
    assert.equal(uniqueName(new Set(['害羞', '害羞2', '害羞3']), '害羞'), '害羞4');
});

test('a ZIP\'s names read as UTF-8, or as GBK when they aren\'t', () => {
    const { decodeZipName } = window.EchoTextStickers;
    assert.equal(decodeZipName(new TextEncoder().encode('表情包/小猫无奈.gif')), '表情包/小猫无奈.gif');
    // 小猫 in GBK
    assert.equal(decodeZipName(new Uint8Array([0xd0, 0xa1, 0xc3, 0xa8, 0x2e, 0x67, 0x69, 0x66])), '小猫.gif');
    // GBK that happens to be valid UTF-8 too ("Сè") is still read as GBK; accented UTF-8 stays
    assert.equal(decodeZipName(new TextEncoder().encode('Сè.gif')), '小猫.gif');
    assert.equal(decodeZipName(new TextEncoder().encode('café ☕.gif')), 'café ☕.gif');
    // JSZip hands over a binary string where it can't give bytes
    assert.equal(decodeZipName(String.fromCharCode(...new TextEncoder().encode('害羞.png'))), '害羞.png');
});

test('a ZIP\'s stickers: its images named after their files, made unique, the rest skipped', () => {
    const { zipStickerFiles } = window.EchoTextStickers;
    const { files, skipped } = zipStickerFiles([
        '表情包/', '表情包/小猫摸摸头.gif', '表情包/小猫摸摸头2.gif', '表情包/sub/小猫摸摸头.PNG', '表情包/安慰.jpeg',
        '表情包/readme.txt', '__MACOSX/表情包/._小猫摸摸头.gif', '表情包/.DS_Store', '表情包/.gif',
    ], new Set(['安慰']));
    assert.deepEqual(files, [
        { path: '表情包/小猫摸摸头.gif', name: '小猫摸摸头', format: 'gif' },
        { path: '表情包/小猫摸摸头2.gif', name: '小猫摸摸头2', format: 'gif' },
        { path: '表情包/sub/小猫摸摸头.PNG', name: '小猫摸摸头3', format: 'png' },
        { path: '表情包/安慰.jpeg', name: '安慰2', format: 'jpeg' },
    ]);
    assert.equal(skipped, 1);
});

test('imported sets come after the built-in ones, their images where the upload put them', () => {
    const { importedSets, findSticker: find, characterNames: names } = window.EchoTextStickers;
    const sets = importedSets([{ id: 'sx', name: '猫', stickers: [{ name: '小猫无奈', path: 'user/images/Echogram stickers sx/000.gif' }] }]);
    assert.deepEqual(sets, [{ id: 'sx', name: '猫', stickers: [{ name: '小猫无奈', path: 'user/images/Echogram stickers sx/000.gif', url: '/user/images/Echogram stickers sx/000.gif' }] }]);
    const lib = [...presets, ...sets];
    assert.equal(find(lib, '无奈')?.url, '/user/images/Echogram stickers sx/000.gif');
    assert.deepEqual(names(lib, ['sx']), ['小猫无奈']);
    assert.deepEqual(importedSets(undefined), []);
});
