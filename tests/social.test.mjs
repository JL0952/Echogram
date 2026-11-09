// Run: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = {};
new Function(readFileSync(new URL('../lib/social.js', import.meta.url), 'utf8'))();
const S = window.EchoTextSocial;

const marked = value => S.mentionsHtml(value, 'm').match(/<span class="m">[^<]*<\/span>/g)?.map(s => s.replace(/<[^>]+>/g, '')) || [];

test('what twitter-text calls a mention is one', () => {
    assert.deepEqual(marked('@mira hi'), ['@mira']);
    assert.deepEqual(marked('hi @mira_1, ok'), ['@mira_1']);
    assert.deepEqual(marked('@a @b\n@c'), ['@a', '@b', '@c']);
    assert.deepEqual(marked('你好@mira。'), ['@mira']);
    assert.deepEqual(marked('＠mira'), ['＠mira']);
    assert.deepEqual(marked('(@mira)'), ['@mira']);
    assert.deepEqual(marked('RT@mira'), ['@mira']);
    assert.deepEqual(marked('rt:@mira'), ['@mira']);
    assert.deepEqual(marked('@foo.bar'), ['@foo']);
    assert.deepEqual(marked(`@${'a'.repeat(25)}`), [`@${'a'.repeat(20)}`]);
});

test('and what it doesn\'t isn\'t', () => {
    for (const value of ['a@b.com', 'art@mira', '!@mira', '#@mira', '$@mira', '&@mira', '*@mira', '@@mira', '@', '@ mira', '@中文',
        '@mira@x', '@mira://x', '@miraé', 'https://x.com/@mira', 'see http://a.b/c@d ok']) {
        assert.deepEqual(marked(value), [], value);
    }
    assert.deepEqual(marked('https://x.com/@mira @real'), ['@real']);
});

test('the rest of the text is escaped', () => {
    assert.equal(S.mentionsHtml('<b>@a</b> & "x"', 'm'), '&lt;b&gt;<span class="m">@a</span>&lt;/b&gt; &amp; &quot;x&quot;');
    assert.equal(S.mentionsHtml('', 'm'), '');
});

const request = (settings, extra = {}) => S.buildPostsRequest({
    charName: 'Mira', userName: 'Me', platform: 'X', card: 'card',
    account: S.getAccount(settings, 'mira.png', { name: 'Mira' }), posts: [], count: 1, now: 1000, ...extra,
});

test('Posting style comes right after the system prompt, as written, and only when there is one', () => {
    const plain = request({}).systemPrompt;
    assert.ok(!plain.includes('posting_style'));
    const s = {};
    S.setAccountProfile(s, 'mira.png', { postingStyle: '  in English, about {{char}} and $& cats  ' });
    assert.equal(s.socialAccounts['mira.png'].postingStyle, 'in English, about {{char}} and $& cats');
    const styled = request(s).systemPrompt;
    assert.ok(styled.startsWith(`${plain}\n\n<posting_style>\n`));
    assert.ok(styled.endsWith('in English, about {{char}} and $& cats\n</posting_style>'));
    assert.ok(request(s, { outlines: [{ time: '', topic: 't' }] }).systemPrompt.includes('<posting_style>'));
    S.setAccountProfile(s, 'mira.png', { postingStyle: '   ' });
    assert.ok(!('postingStyle' in s.socialAccounts['mira.png']));
});

test('how people talk on the platform comes just before how to write, and nothing is there for a platform without it', () => {
    const plain = request({}).systemPrompt;
    assert.ok(plain.includes('\n\nHow to write:\n') && !plain.includes('{{culture}}'));
    const told = request({}, { culture: 'Everyone is sharp.' }).systemPrompt;
    assert.equal(told, plain.replace('\n\nHow to write:', '\n\nEveryone is sharp.\n\nHow to write:'));
});

const postsFor = () => ({
    socialAccounts: { k: { pinnedId: 'p', posts: [{ id: 'p', at: 10 }] } },
    socialPosts: { k: [{ id: 'a', at: 30 }, { id: 'b', at: 20 }] },
});
const order = s => S.getPosts(s, 'k').map(p => `${p.id}${p.kept ? '+' : ''}${p.pinned ? '!' : ''}`).join();

test('one post is pinned; pinning another leaves the last kept', () => {
    const s = postsFor();
    assert.equal(order(s), 'a,b,p+!');
    assert.equal(S.setPostPinned(s, 'k', 'a', true), true);
    assert.equal(order(s), 'a+!,b,p+');
    assert.equal(S.setPostPinned(s, 'k', 'a', true), false);
    assert.equal(S.setPostPinned(s, 'k', 'a', false), true);
    assert.equal(order(s), 'a+,b,p+');
    assert.equal(S.setPostPinned(s, 'k', 'a', false), false);
    assert.equal(S.setPostPinned(s, 'k', 'nobody', true), false);
});

test('any post can be kept in all chats, in time order, and go back', () => {
    const s = postsFor();
    assert.equal(S.setPostKept(s, 'k', 'b', true), true);
    assert.equal(order(s), 'a,b+,p+!');
    assert.deepEqual(s.socialPosts.k.map(p => p.id), ['a']);
    assert.equal(S.setPostKept(s, 'k', 'b', false), true);
    assert.equal(order(s), 'a,b,p+!');
    // Back to one chat, it can't be pinned any more; nor deleted
    S.setPostKept(s, 'k', 'p', false);
    assert.equal(order(s), 'a,b,p');
    assert.equal(s.socialAccounts.k.pinnedId, '');
    const d = postsFor();
    S.deletePost(d, 'k', 'p');
    assert.equal(d.socialAccounts.k.pinnedId, '');
});

test('an account from when every kept post was pinned keeps its newest pinned, once', () => {
    const s = { socialAccounts: { old: { posts: [{ id: 'x', at: 1 }, { id: 'y', at: 5 }, { id: 'z', at: 3 }] }, none: { posts: [] }, bare: { name: 'n' } } };
    S.pinNewestKept(s);
    assert.equal(s.socialAccounts.old.pinnedId, 'y');
    assert.ok(!('pinnedId' in s.socialAccounts.none) && !('pinnedId' in s.socialAccounts.bare));
    s.socialAccounts.old.pinnedId = '';
    S.pinNewestKept(s);
    assert.equal(s.socialAccounts.old.pinnedId, '');
    // The first post ever kept isn't taken for one of those
    const fresh = { socialPosts: { k: [{ id: 'a', at: 1 }] } };
    S.setPostKept(fresh, 'k', 'a', true);
    S.pinNewestKept(fresh);
    assert.equal(fresh.socialAccounts.k.pinnedId, '');
});

test('the user\'s words for a post, and its image only when given one', () => {
    const s = postsFor();
    s.socialPosts.k[0].photo = { path: 'a.jpg', width: 1, height: 1 };
    assert.equal(S.editPostContent(s, 'k', 'a', { text: ' new ', image: ' pic ' }), 'a.jpg');
    assert.equal(s.socialPosts.k[0].text, 'new');
    assert.equal(s.socialPosts.k[0].image, 'pic');
    assert.equal(s.socialPosts.k[0].photo.path, 'a.jpg');
    assert.equal(S.editPostContent(s, 'k', 'a', { text: 't', image: '', photo: { path: 'b.jpg', width: 2, height: 2 } }), 'a.jpg');
    assert.equal(s.socialPosts.k[0].photo.path, 'b.jpg');
    assert.equal(S.editPostContent(s, 'k', 'a', { text: 't', image: '', photo: null }), 'b.jpg');
    assert.ok(!('photo' in s.socialPosts.k[0]));
    assert.equal(S.editPostContent(s, 'k', 'p', { text: 'kept', image: '' }), '');
    assert.equal(s.socialAccounts.k.posts[0].text, 'kept');
    assert.equal(S.editPostContent(s, 'k', 'nobody', { text: 'x', image: '' }), null);
});

test('a post with only a real image still counts as having a photo for the model', () => {
    const posts = [{ text: 'hi', at: 500, image: '', photo: { path: 'a.jpg' } }];
    assert.ok(request({}, { posts }).systemPrompt.includes(', with a photo] hi'));
});

test('a reply is edited whole; a post\'s time and numbers only when given', () => {
    const s = postsFor();
    s.socialPosts.k[0].replies = [{ id: 'r0', name: 'n', handle: 'n', text: 'old', likes: 4, at: 1 }, { name: 'm', text: 'other' }];
    S.editPostContent(s, 'k', 'a', { text: 't', image: '', replies: { 0: { text: '  new  ', name: ' N2 ', handle: '@n 2', likes: 9, at: 7 }, 9: { text: 'nobody there' } } });
    assert.deepEqual(s.socialPosts.k[0].replies, [{ id: 'r0', name: 'N2', handle: 'n2', text: 'new', likes: 9, at: 7 }, { name: 'm', text: 'other' }]);
    assert.equal(s.socialPosts.k[0].at, 30);
    assert.ok(!('likes' in s.socialPosts.k[0]));
    S.editPostContent(s, 'k', 'a', { text: 't', image: '', at: 99, likes: 1200, reposts: 0, views: 5, replyCount: 900 });
    const { at, likes, reposts, views, replyCount } = s.socialPosts.k[0];
    assert.deepEqual({ at, likes, reposts, views, replyCount }, { at: 99, likes: 1200, reposts: 0, views: 5, replyCount: 900 });
});

test('freestyle: a repost with a comment, a plain one, words only, a photo only; a post without one has no repost', () => {
    const raw = `<post ago="5h"><text>look at this</text><repost name="Big Acct" handle="@big_acct"><text>a take</text><image>a chart</image></repost><reply name="a" handle="a">no</reply></post>
<post ago="4h"><repost name="Only Words" handle="w"><text>words</text></repost></post>
<post ago="3h"><text>hm</text><repost handle="pic"><image>a dog</image></repost></post>
<post ago="2h"><text>plain post</text></post>
<post ago="1h"><repost name="Empty"></repost></post>`;
    const posts = S.parsePosts(raw, { now: 10 * 3600000, count: 9 });
    assert.equal(posts.length, 4);
    assert.deepEqual(posts[0].repost, { name: 'Big Acct', handle: 'big_acct', text: 'a take', image: 'a chart' });
    assert.equal(posts[0].text, 'look at this');
    assert.equal(posts[0].image, '');
    assert.equal(posts[0].replies.length, 1);
    assert.equal(posts[1].text, '');
    assert.equal(posts[1].repost.text, 'words');
    assert.deepEqual(posts[2].repost, { name: 'pic', handle: 'pic', text: '', image: 'a dog' });
    assert.ok(!('repost' in posts[3]));
});

test('an unclosed <repost> stops at the replies', () => {
    const [post] = S.parsePosts('<post ago="1h"><text>x</text><repost name="N" handle="n"><text>y<reply name="r" handle="r">hi</reply></post>', { now: 7200000 });
    assert.equal(post.repost.text, 'y');
    assert.equal(post.replies.length, 1);
});

const scripted = (outline, raw) => {
    const { outlines, prompt } = S.buildPostsRequest({
        charName: 'Mira', userName: 'Me', platform: 'X', card: 'c', account: S.getAccount({}, 'k', { name: 'Mira' }), posts: [], now: 1000,
        outlines: [{ time: '', topic: 'mine', likes: '', reposts: '', views: '', replies: '', replyStyle: '', ...outline }],
    });
    return { prompt, posts: S.parseOutlinedPosts(raw, { outlines, now: 1000 }) };
};
const written = '<post n="1"><text>my words</text><image>my pic</image><repost name="N" handle="n"><text>their words</text><image>their pic</image></repost></post>';

test('scripted: the outline decides what the repost has and whether there is a comment', () => {
    const both = scripted({ repost: true, repostTopic: 'cats', repostText: true, repostPhoto: true, repostComment: true }, written);
    assert.ok(both.prompt.includes("Reposts someone else's post, with words and a photo, about: cats"));
    assert.ok(both.prompt.includes('Topic: mine'));
    assert.deepEqual(both.posts[0].repost, { name: 'N', handle: 'n', text: 'their words', image: 'their pic' });
    assert.equal(both.posts[0].text, 'my words');

    const words = scripted({ repost: true, repostText: true, repostPhoto: false, repostComment: true }, written);
    assert.equal(words.posts[0].repost.image, '');
    assert.ok(words.prompt.includes('with words and no photo, about: whatever Mira would repost'));

    const photo = scripted({ repost: true, repostText: false, repostPhoto: true, repostComment: true }, written);
    assert.equal(photo.posts[0].repost.text, '');
    assert.equal(photo.posts[0].repost.image, 'their pic');
    assert.ok(photo.prompt.includes('with a photo and no words'));

    const plain = scripted({ repost: true, repostText: true, repostPhoto: false, repostComment: false, photo: true }, written);
    assert.equal(plain.posts[0].text, '');
    assert.equal(plain.posts[0].image, '');
    assert.ok(plain.prompt.includes('Comment: none, a plain repost') && !plain.prompt.includes('Topic: mine') && plain.prompt.includes('Photo: no'));

    // Neither box ticked: words. Not a repost: anything the model adds is left out
    assert.equal(scripted({ repost: true, repostText: false, repostPhoto: false }, written).posts[0].repost.text, 'their words');
    assert.ok(!('repost' in scripted({ repost: false }, written).posts[0]));
    // A plain repost the model didn't write leaves nothing
    assert.deepEqual(scripted({ repost: true, repostComment: false }, '<post n="1"><text>only mine</text></post>').posts, []);
});

test('the prompt offers the repost form, and the model sees what was reposted', () => {
    const free = request({}).systemPrompt;
    assert.ok(free.includes('<repost name=') && free.includes("reposts someone else's post"));
    const posts = [{ text: 'lol', at: 500, image: '', repost: { handle: 'big', text: 'a  take' } }, { text: '', at: 400, image: '', repost: { handle: 'pic', text: '' } }];
    const sys = request({}, { posts }).systemPrompt;
    assert.ok(sys.includes('] lol [reposting @big: a take]'));
    assert.ok(sys.includes('ago] [reposting @pic: a photo]'));
});

test('a post from over a week ago reaches the model as a date, a newer one as time ago', () => {
    const now = new Date(2026, 10, 30, 12).getTime();
    const posts = [{ text: 'new', at: now - 2 * 3600000, image: '' }, { text: 'old', at: new Date(2026, 10, 15, 12).getTime(), image: '' }];
    const sys = request({}, { posts, now }).systemPrompt;
    assert.ok(sys.includes('[2h ago] new') && sys.includes('[Nov 15] old'));
    assert.ok(!sys.includes('Nov 15 ago'));
});

test('a new archive is empty, and loading it clears the chat\'s posts but not the ones kept in all chats', () => {
    const s = {
        socialPosts: { k: [{ id: 'a', at: 1, text: 'this chat' }] },
        socialAccounts: { k: { posts: [{ id: 'b', at: 2, text: 'kept' }] } },
    };
    const source = S.createArchiveSource({
        getSettings: () => s, saveSettings() {}, getCharacterKey: () => 'k', getCharacterName: () => 'M', now: () => 5, forgetPhoto() {}, onLoad() {},
    });
    const empty = source.createEmpty('fresh');
    assert.deepEqual([empty.name, empty.posts], ['fresh', []]);
    assert.equal(source.createEmpty('').name.startsWith('M — '), true);
    assert.equal(s.socialPosts.k.length, 1);
    source.load(empty.id);
    assert.deepEqual(s.socialPosts.k, []);
    assert.equal(s.socialAccounts.k.posts.length, 1);
});

test('a repost shows when it has anything, and its words and image can be edited away', () => {
    assert.equal(S.normalizePost({ repost: { name: 'n' } }, 0).repost, null);
    assert.equal(S.normalizePost({ repost: { image: 'a pic' } }, 0).repost.name, 'user');
    const s = postsFor();
    s.socialPosts.k[0].repost = { name: 'n', handle: 'n', text: 't', image: 'i', photo: { path: 'r.jpg', width: 1, height: 1 } };
    assert.deepEqual(S.photoPaths(s.socialPosts.k), ['r.jpg']);
    assert.equal(S.editRepostContent(s, 'k', 'a', { name: ' M ', handle: '@m x', text: ' w ', image: '' }), 'r.jpg');
    assert.deepEqual(s.socialPosts.k[0].repost, { name: 'M', handle: 'mx', text: 'w', image: '', photo: { path: 'r.jpg', width: 1, height: 1 } });
    assert.equal(S.editRepostContent(s, 'k', 'a', { name: 'M', handle: 'm', text: '', image: '', photo: null }), 'r.jpg');
    assert.ok(!('repost' in s.socialPosts.k[0]));
    assert.equal(S.editRepostContent(s, 'k', 'a', { name: 'M', handle: 'm', text: 'x', image: '' }), null);
});

test('an archive file carries a repost\'s image, and a path in one counts for nothing', async () => {
    const s = { socialArchives: { k: [{ id: 'one', name: 'n', savedAt: 1, posts: [
        { id: 'a', at: 1, text: 't', repost: { name: 'R', handle: 'r', text: '', image: '', photo: { path: 'r.jpg', width: 8, height: 6 } } },
        { id: 'b', at: 2, text: 't', repost: { name: 'L', handle: 'l', text: 'w', photo: { path: 'lost.jpg', width: 1, height: 1 } } },
    ] }] } };
    const uploaded = [];
    const source = S.createArchiveSource({
        getSettings: () => s, saveSettings() {}, getCharacterKey: () => 'k', getCharacterName: () => 'M', now: () => 5, forgetPhoto() {}, onLoad() {},
        readPhoto: async path => { if (path === 'lost.jpg') throw new Error('gone'); return 'data:image/jpeg;base64,AAA'; },
        uploadPhoto: async (data) => { uploaded.push(data); return 'user/images/new.jpg'; },
    });
    const file = await source.exportFile('one');
    const data = JSON.parse(file.content);
    assert.deepEqual(data.posts[0].repost.photo, { width: 8, height: 6, data: 'data:image/jpeg;base64,AAA' });
    assert.ok(!('photo' in data.posts[1].repost));
    assert.equal(s.socialArchives.k[0].posts[0].repost.photo.path, 'r.jpg');

    data.posts[1].repost.photo = { path: 'http://x/y.jpg' };
    const saved = await source.importFile({ name: 'f.json', text: async () => JSON.stringify(data) });
    assert.deepEqual(uploaded, ['data:image/jpeg;base64,AAA']);
    assert.deepEqual(saved.posts[0].repost.photo, { path: 'user/images/new.jpg', width: 8, height: 6 });
    assert.equal(saved.posts[1].repost.photo, null);
    assert.equal(saved.posts[1].repost.text, 'w');
});
