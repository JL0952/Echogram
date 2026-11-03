// Run: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = {};
for (const file of ['music-lookup.js', 'rich-messages.js', 'features.js', 'chat-view-model.js']) {
    new Function(readFileSync(new URL(`../lib/${file}`, import.meta.url), 'utf8'))();
}
const { createMusicLookup, coverColors, songKey, matchingSong, namedArtists } = window.EchoTextMusicLookup;

const ART = 'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/aa/cover.jpg/100x100bb.jpg';
const song = (trackName, artistName = 'x') => ({ trackName, artistName, artworkUrl100: ART, previewUrl: 'https://audio-ssl.itunes.apple.com/preview.m4a' });
// The store has whatever was asked for: the song named by the term's first word
const hit = term => [song(term.split(' ')[0])];

/**
 * A lookup on a fake network and clock. `answers` maps a store ('hk', 'us') to what its
 * song search answers, and 'hk:musicArtist' or 'us:lookup' to what its artist search or
 * artist lookup answers (nothing by default): results (an array, or a function of the
 * search term or artist id), 'fail' (the request errors) or 'hang' (no answer until the
 * timeout aborts it). Sleeping moves the clock instead of waiting.
 */
function setup(answers = {}, { cache = {}, timeoutMs = 20 } = {}) {
    const calls = [];
    let clock = 1_000_000;
    let saves = 0;
    const lookup = createMusicLookup({
        getCache: () => cache,
        saveCache: () => { saves++; },
        now: () => clock,
        sleep: ms => { clock += ms; return Promise.resolve(); },
        timeoutMs,
        gapMs: 3000,
        measureCover: async () => ({ r: 150, g: 138, b: 126 }),
        fetch: (url, { signal }) => {
            const params = new URL(url).searchParams;
            const country = params.get('country');
            const kind = new URL(url).pathname === '/lookup' ? 'lookup' : params.get('entity');
            const term = params.get('term') ?? params.get('id');
            calls.push({ country, kind, term, at: clock });
            const answer = answers[`${country}:${kind}`] ?? (kind === 'song' ? answers[country] : null) ?? [];
            if (answer === 'fail') return Promise.reject(new TypeError('Failed to fetch'));
            if (answer === 'hang') {
                return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
            }
            const results = typeof answer === 'function' ? answer(term) : answer;
            return Promise.resolve({ ok: true, json: async () => ({ results }) });
        },
    });
    return { lookup, calls, cache, advance: ms => { clock += ms; }, saves: () => saves };
}

test('a song found in the Hong Kong store keeps its cover (300 px), preview and colours', async () => {
    const { lookup, calls, saves } = setup({ hk: hit });
    assert.equal(lookup.cached('晴天', '周杰伦'), null);
    assert.equal(await lookup.request('晴天', '周杰伦'), true);
    assert.deepEqual(calls.map(c => [c.country, c.term]), [['hk', '晴天 周杰伦']]);
    assert.deepEqual(lookup.cached('晴天', '周杰伦'), {
        cover: 'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/aa/cover.jpg/300x300bb.jpg',
        color: '#968a7e', shade: '#968a7e', ink: '#121212',
        preview: 'https://audio-ssl.itunes.apple.com/preview.m4a',
    });
    assert.equal(saves(), 1);
    // Known now: no second request, and the same song however it's spaced or cased
    assert.equal(await lookup.request('晴天 ', '周杰伦'), true);
    assert.equal(calls.length, 1);
    assert.equal(songKey('Ur  Name', 'i9bonsai'), songKey('ur name', 'I9BONSAI'));
});

test('the US store is asked only when Hong Kong has no match', async () => {
    const { lookup, calls } = setup({ hk: [], us: hit });
    assert.equal(await lookup.request('Espresso', 'Sabrina Carpenter'), true);
    assert.deepEqual(calls.map(c => c.country), ['hk', 'us']);
});

test('a song neither store has is kept as missing and asked again after a week', async () => {
    const { lookup, calls, cache, advance } = setup({ hk: [], us: [] });
    assert.equal(await lookup.request('Made Up Song', 'Nobody'), false);
    // Both stores' song search, then their artist search, which finds no artist
    assert.deepEqual(calls.map(c => [c.country, c.kind]), [['hk', 'song'], ['us', 'song'], ['hk', 'musicArtist'], ['us', 'musicArtist']]);
    assert.equal(lookup.cached('Made Up Song', 'Nobody'), null);
    assert.ok(cache[songKey('Made Up Song', 'Nobody')]);
    assert.equal(await lookup.request('Made Up Song', 'Nobody'), false);
    assert.equal(calls.length, 4);
    advance(8 * 24 * 60 * 60 * 1000);
    await lookup.request('Made Up Song', 'Nobody');
    assert.equal(calls.length, 8);
});

test('a failed request keeps nothing and waits longer before each next try', async () => {
    const { lookup, calls, cache, advance } = setup({ hk: 'fail' });
    assert.equal(await lookup.request('晴天', '周杰伦'), false);
    assert.deepEqual(cache, {});
    // Waiting a minute: not asked again before then
    assert.equal(await lookup.request('晴天', '周杰伦'), false);
    assert.equal(calls.length, 1);
    advance(61_000);
    await lookup.request('晴天', '周杰伦');
    assert.equal(calls.length, 2);
    // Then two minutes
    advance(61_000);
    await lookup.request('晴天', '周杰伦');
    assert.equal(calls.length, 2);
    advance(60_000);
    await lookup.request('晴天', '周杰伦');
    assert.equal(calls.length, 3);
});

test('a request with no answer gives up at the timeout, and Hong Kong failing skips the US store', async () => {
    const { lookup, calls, cache } = setup({ hk: 'hang', us: hit }, { timeoutMs: 30 });
    const started = Date.now();
    assert.equal(await lookup.request('晴天', '周杰伦'), false);
    assert.ok(Date.now() - started < 1000);
    assert.deepEqual(calls.map(c => c.country), ['hk']);
    assert.deepEqual(cache, {});
});

test('after three failures in a row every song waits, and songs already queued are skipped, not counted', async () => {
    const { lookup, calls, advance } = setup({ hk: 'fail' });
    const songs = ['a', 'b', 'c', 'd', 'e'].map(title => lookup.request(title, 'x'));
    assert.deepEqual(await Promise.all(songs), [false, false, false, false, false]);
    assert.equal(calls.length, 3);
    // A new song waits too, for a minute (three failures, not five)
    assert.equal(await lookup.request('f', 'x'), false);
    assert.equal(calls.length, 3);
    advance(61_000);
    await lookup.request('f', 'x');
    assert.equal(calls.length, 4);
});

test('timeouts count the same: the song queued after the third one never goes out', async () => {
    const { lookup, calls } = setup({ hk: 'hang' }, { timeoutMs: 10 });
    const songs = ['a', 'b', 'c', 'd'].map(title => lookup.request(title, 'x'));
    assert.deepEqual(await Promise.all(songs), [false, false, false, false]);
    assert.equal(calls.length, 3);
});

test('the network coming back clears the wait', async () => {
    const answers = { hk: 'fail' };
    const { lookup, calls, advance } = setup(answers);
    for (const title of ['a', 'b', 'c']) await lookup.request(title, 'x');
    advance(61_000);
    answers.hk = hit;
    assert.equal(await lookup.request('d', 'x'), true);
    // The songs that failed before are asked again once their own wait is over
    advance(121_000);
    assert.equal(await lookup.request('a', 'x'), true);
    assert.equal(calls.length, 5);
});

test('one request per song at a time, and requests a few seconds apart', async () => {
    const { lookup, calls } = setup({ hk: hit });
    const [first, second, other] = await Promise.all([lookup.request('a', 'x'), lookup.request('a', 'x'), lookup.request('b', 'x')]);
    assert.deepEqual([first, second, other], [true, true, true]);
    assert.equal(calls.length, 2);
    assert.ok(calls[1].at - calls[0].at >= 3000);
});

test('at most 200 songs are kept, the oldest go first', async () => {
    const cache = {};
    for (let i = 0; i < 200; i++) cache[`old ${i}|x`] = { at: 1000 + i, cover: ART };
    const { lookup } = setup({ hk: hit }, { cache });
    await lookup.request('new', 'x');
    assert.equal(Object.keys(cache).length, 200);
    assert.equal(cache['old 0|x'], undefined);
    assert.ok(cache['old 1|x']);
    assert.ok(cache[songKey('new', 'x')]);
});

test('stored values are checked before they reach a template', () => {
    const cache = {
        [songKey('a', 'x')]: { at: 1, cover: 'javascript:alert(1)' },
        [songKey('b', 'x')]: { at: 1, cover: ART, color: 'red;background:url(x)', shade: '#123456', ink: '#fff', preview: 'http://plain.example/p.m4a' },
    };
    const { lookup } = setup({}, { cache });
    assert.equal(lookup.cached('a', 'x'), null);
    assert.deepEqual(lookup.cached('b', 'x'), { cover: ART, shade: '#123456' });
});

test('cover colours: the card shade keeps white text readable, the ink is whichever reads better', () => {
    // A mid tone like WeChat's own stays; a pale one is darkened
    assert.equal(coverColors({ r: 150, g: 138, b: 126 }).shade, '#968a7e');
    assert.equal(coverColors({ r: 240, g: 230, b: 200 }).shade, '#908a78');
    // Spotify's red takes black, a dark cover white
    assert.equal(coverColors({ r: 196, g: 92, b: 92 }).ink, '#121212');
    assert.equal(coverColors({ r: 20, g: 20, b: 40 }).ink, '#ffffff');
    assert.deepEqual(coverColors(null), {});
});

test('a result counts only when its title matches, or failing that its artist', () => {
    // iTunes answers a made-up song with some other song: that's no match
    assert.equal(matchingSong([song('On And On (Remastered 2026)', 'Utada')], 'A Very Long Song Title That Goes On And On', 'Some Band'), null);
    assert.equal(matchingSong([song('遠山如昨', '陳楚生')], '雨后的街', '某个乐队'), null);
    // The stores' additions, case and the other Chinese script don't stop a match
    assert.equal(matchingSong([song('Yesterday - Remastered 2009')], 'Yesterday', 'The Beatles')?.trackName, 'Yesterday - Remastered 2009');
    assert.equal(matchingSong([song('孤勇者 (《英雄聯盟:雙城之戰》動畫劇集中文主題曲)')], '孤勇者', '陈奕迅')?.trackName.slice(0, 3), '孤勇者');
    assert.equal(matchingSong([song('起風了')], '起风了', '')?.trackName, '起風了');
    assert.equal(matchingSong([song('Ur Name', '9bluecor3')], 'ur name', 'i9bonsai')?.trackName, 'Ur Name');
    // No character in common with the title, but the artist is theirs
    assert.equal(matchingSong([song('Other', 'Somebody'), song('後來', '劉若英')], '后来', '刘若英')?.trackName, '後來');
    // The title's match comes before an artist's
    assert.equal(matchingSong([song('Another', '周杰倫'), song('晴天', '周杰倫')], '晴天', '周杰伦')?.trackName, '晴天');
});

test('a made-up song finds no cover in either store and is kept as missing', async () => {
    const unrelated = () => [song('Something Else', 'Someone')];
    const { lookup, calls, cache } = setup({ hk: unrelated, us: unrelated });
    assert.equal(await lookup.request('Song A', 'Band B'), false);
    assert.deepEqual(calls.map(c => c.country), ['hk', 'us', 'hk', 'us']);
    assert.deepEqual(Object.keys(cache[songKey('Song A', 'Band B')]), ['at']);
});

test('a song the search leaves out is found among its artist\'s songs', async () => {
    const bones = { artistId: 1300793014, artistName: 'BONES' };
    const lyson = { artistId: 979934616, artistName: 'Lyson' };
    const { lookup, calls } = setup({
        hk: [song('Greatness in My Bones', 'Cali Dubb')],
        us: [],
        'hk:musicArtist': term => (term === 'BONES' ? [{ artistId: 1527334044, artistName: 'Gentle Bones' }, bones] : [lyson]),
        // Hong Kong's 200 don't hold it, the US store's do; Tonic is only among Lyson's
        'hk:lookup': id => (id === '1300793014' ? [bones, song('AirplaneMode', 'BONES')] : [lyson, song('Tonic', 'BONES & Lyson')]),
        'us:lookup': id => (id === '1300793014' ? [bones, song('Jansport', 'BONES')] : []),
    });
    assert.equal(await lookup.request('Jansport', 'BONES and Lyson'), true);
    assert.deepEqual(calls.map(c => [c.country, c.kind, c.term]), [
        ['hk', 'song', 'Jansport BONES and Lyson'], ['us', 'song', 'Jansport BONES and Lyson'],
        ['hk', 'musicArtist', 'BONES'], ['hk', 'lookup', '1300793014'], ['us', 'lookup', '1300793014'],
    ]);
    assert.ok(lookup.cached('Jansport', 'BONES and Lyson').cover);
    // Then Lyson, when BONES' songs don't hold it
    calls.length = 0;
    assert.equal(await lookup.request('Tonic', 'BONES and Lyson'), true);
    assert.deepEqual(calls.slice(2).map(c => [c.country, c.kind, c.term]), [
        ['hk', 'musicArtist', 'BONES'], ['hk', 'lookup', '1300793014'], ['us', 'lookup', '1300793014'],
        ['hk', 'musicArtist', 'Lyson'], ['hk', 'lookup', '979934616'],
    ]);
    // The artist's other songs aren't taken for one they don't have
    assert.equal(await lookup.request('Not Theirs', 'BONES'), false);
});

test('the artists named, at most three, and none without an artist', async () => {
    assert.deepEqual(namedArtists('BONES and Lyson'), ['BONES', 'Lyson']);
    assert.deepEqual(namedArtists('Full Tac, Lil Mariko & Rico Nasty'), ['Full Tac', 'Lil Mariko', 'Rico Nasty']);
    assert.deepEqual(namedArtists('Lil Mariko feat. Zheani'), ['Lil Mariko', 'Zheani']);
    assert.deepEqual(namedArtists('Lil Nas X'), ['Lil Nas X']);
    assert.deepEqual(namedArtists('周杰伦、费玉清'), ['周杰伦', '费玉清']);
    assert.deepEqual(namedArtists('A, B, C, D'), ['A', 'B', 'C']);
    const { lookup, calls } = setup({ hk: [], us: [] });
    assert.equal(await lookup.request('Lemon', ''), false);
    assert.deepEqual(calls.map(c => c.kind), ['song', 'song']);
});

test('the view model gives a song its cover and colours once found', () => {
    const { buildChatViewModel } = window.EchoTextChatViewModel;
    const history = [{ is_user: false, mes: '<music>晴天 | 周杰伦</music>\n<music>Lemon</music>', send_date: 1 }];
    const songArt = (title) => (title === '晴天' ? { cover: ART, color: '#c45c5c', shade: '#c45c5c', ink: '#121212' } : null);
    const [m] = buildChatViewModel(history, { charName: 'Mira', songArt }).messages;
    assert.deepEqual(m.parts[0], { type: 'music', title: '晴天', artist: '周杰伦', lyrics: [], cover: ART, color: '#c45c5c', shade: '#c45c5c', ink: '#121212' });
    assert.deepEqual(m.parts[1], { type: 'music', title: 'Lemon', artist: '', lyrics: [] });
    assert.equal(buildChatViewModel(history, { charName: 'Mira' }).messages[0].parts[0].cover, undefined);
});
