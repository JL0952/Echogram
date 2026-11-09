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

test('a reply\'s words change, and nothing else about it', () => {
    const s = postsFor();
    s.socialPosts.k[0].replies = [{ name: 'n', text: 'old', likes: 4 }, { name: 'm', text: 'other' }];
    S.editPostContent(s, 'k', 'a', { text: 't', image: '', replies: { 0: '  new  ', 9: 'nobody there' } });
    assert.deepEqual(s.socialPosts.k[0].replies, [{ name: 'n', text: 'new', likes: 4 }, { name: 'm', text: 'other' }]);
});
