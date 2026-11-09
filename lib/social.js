(function () {
    'use strict';

    /**
     * EchoText Social
     *
     * The character's anonymous social account (docs/platform-plan.md 17): their profile
     * and posts, watched from above. The user only looks: no liking, replying or following.
     *
     * Data, in the settings:
     *   socialAccounts[character] = { theme, name, handle, bio, postingStyle, banner, avatar,
     *                                 followers, following, posts }
     *       Set by the user, never by the model. `avatar` is an image only the account
     *       uses (none: the character's avatar in Echogram). `posts` are the kept ones (`pinnedId` the one pinned),
     *       which every chat with the character starts with, replies and all.
     *   socialPosts[character] = [post]
     *       The chat's own posts: cleared with the chat, saved in archives of their own.
     *   socialArchives[character] = [{ id, name, savedAt, charName, posts }]
     *       The posts' archives, apart from the chat's; `posts` as socialPosts holds them.
     *   post  = { id, at, text, image, photo, repost, likes, reposts, views, replyCount, replies }
     *       `at` a time in ms; `image` a description (a photo card, as a <photo> bubble's: the
     *       words on a tap); `photo` a real image the user gave it, { path, width, height };
     *       `replyCount` what the post says it has, which can be far more than the
     *       replies there are (only the top MAX_REPLIES are kept).
     *   repost = { name, handle, text, image, photo }
     *       Someone else's post it reposts: words, a photo or both. A post with no `text`
     *       of its own is a plain repost, one with `text` a quote.
     *   reply = { id, at, name, handle, text, likes }
     *
     * A theme (social/<id>/theme.js) is only templates and a stylesheet, as the chat's
     * looks are; this file draws them and handles their clicks (data-social-action).
     */

    const DEFAULT_THEME = 'x';
    // A post shows at most this many replies: the top ones, however many it has (2026-11-08: 5)
    const MAX_REPLIES = 5;

    function isObject(value) {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    }

    function count(value) {
        const n = Math.round(Number(value));
        return Number.isFinite(n) && n > 0 ? n : 0;
    }

    function text(value) {
        return typeof value === 'string' ? value : '';
    }

    function hash(value) {
        let h = 5381;
        for (let i = 0; i < value.length; i++) h = ((h << 5) + h + value.charCodeAt(i)) >>> 0;
        return h;
    }

    /** A handle from the character's key (their card's file name) or name: letters, digits and _, up to 15. */
    function handleFrom(key, name) {
        for (const source of [String(key || '').replace(/\.[a-z0-9]+$/i, ''), String(name || '')]) {
            const handle = source.replace(/[^A-Za-z0-9_]/g, '').slice(0, 15);
            if (handle) return handle;
        }
        return 'user' + String(hash(String(key || name || ''))).slice(0, 8);
    }

    function normalizeReply(reply, i) {
        if (!isObject(reply)) return null;
        const name = text(reply.name).trim() || 'user';
        return {
            id: text(reply.id) || `r${i}`,
            at: Number(reply.at) || 0,
            name,
            handle: text(reply.handle).trim().replace(/^@/, '') || handleFrom('', name),
            text: text(reply.text),
            likes: count(reply.likes),
        };
    }

    function normalizePhoto(photo) {
        return isObject(photo) && text(photo.path) ? { path: text(photo.path), width: count(photo.width), height: count(photo.height) } : null;
    }

    // Which @s are mentions: twitter-text's rules (validMentionOrList, endMentionMatch).
    // A URL is matched first because a mention inside one isn't one.
    const MENTION = /(https?:\/\/\S+)|((?:^|[^a-z0-9_!#$%&*@＠]|(?:^|[^a-z0-9_+~.-])rt:?))([@＠])([a-z0-9_]{1,20})/gi;
    const MENTION_END = /^(?:[@＠]|[À-ÖØ-öø-ɏɓɔɖɗəɛɣɨɯɲʉʋʻ̀-ͯḀ-ỿ]|:\/\/)/;

    /** Text as HTML, escaped, each @mention in a span of class `cls`. */
    function mentionsHtml(value, cls) {
        const raw = text(value);
        let html = '';
        let done = 0;
        for (const match of raw.matchAll(MENTION)) {
            if (match[1]) continue;
            const start = match.index + match[2].length;
            const end = start + 1 + match[4].length;
            if (MENTION_END.test(raw.slice(end))) continue;
            html += `${escapeHtml(raw.slice(done, start))}<span class="${cls}">${escapeHtml(raw.slice(start, end))}</span>`;
            done = end;
        }
        return html + escapeHtml(raw.slice(done));
    }

    /** A kept image's address. */
    function photoUrl(path) {
        return /^(\/|[a-z][a-z0-9+.-]*:)/i.test(path) ? path : `/${path}`;
    }

    /** Someone else's post a post reposts, as shown; null when it has nothing to show. */
    function normalizeRepost(repost) {
        if (!isObject(repost)) return null;
        const words = text(repost.text);
        const image = text(repost.image);
        const photo = normalizePhoto(repost.photo);
        if (!words.trim() && !image.trim() && !photo) return null;
        const name = text(repost.name).trim() || 'user';
        return { name, handle: text(repost.handle).trim().replace(/^@/, '') || handleFrom('', name), text: words, image, photo };
    }

    function normalizePost(post, i) {
        if (!isObject(post)) return null;
        const replies = (Array.isArray(post.replies) ? post.replies : []).map(normalizeReply).filter(Boolean).slice(0, MAX_REPLIES);
        return {
            id: text(post.id) || `p${i}`,
            at: Number(post.at) || 0,
            text: text(post.text),
            image: text(post.image),
            photo: normalizePhoto(post.photo),
            repost: normalizeRepost(post.repost),
            likes: count(post.likes),
            reposts: count(post.reposts),
            views: count(post.views),
            replyCount: Math.max(count(post.replyCount), replies.length),
            replies,
        };
    }

    /** The character's account as the page shows it: what the user set, the rest filled in. */
    function getAccount(settings, key, { name = '' } = {}) {
        const stored = isObject(settings?.socialAccounts?.[key]) ? settings.socialAccounts[key] : {};
        return {
            theme: text(stored.theme) || DEFAULT_THEME,
            name: text(stored.name).trim() || name || 'Unknown',
            handle: text(stored.handle).trim().replace(/^@/, '') || handleFrom(key, name),
            bio: text(stored.bio),
            postingStyle: text(stored.postingStyle),
            banner: text(stored.banner),
            avatar: text(stored.avatar),
            followers: count(stored.followers),
            following: count(stored.following),
        };
    }

    // X's limits on a profile (vertsan's EditProfileModal: name 50, bio 160; a username 15)
    const MAX_NAME = 50;
    const MAX_BIO = 160;
    const MAX_HANDLE = 15;

    /** A username as X takes one: no @, only letters, digits and _, at most 15. */
    function cleanHandle(value) {
        return String(value ?? '').trim().replace(/^@+/, '').replace(/[^A-Za-z0-9_]/g, '').slice(0, MAX_HANDLE);
    }

    /** A follower count as typed ("23,800", "1 200"): its digits, 0 with none. */
    function cleanCount(value) {
        const digits = String(value ?? '').replace(/\D/g, '').slice(0, 12);
        return digits ? Number(digits) : 0;
    }

    /**
     * Keeps what the user set on the profile, the theme and kept posts as they were.
     * A blank name or username is left unset, so the defaults show (the character's name,
     * the handle from their card).
     */
    function setAccountProfile(settings, key, profile) {
        if (!isObject(settings.socialAccounts)) settings.socialAccounts = {};
        const stored = isObject(settings.socialAccounts[key]) ? settings.socialAccounts[key] : {};
        const next = { ...stored };
        const name = text(profile.name).trim().slice(0, MAX_NAME);
        const handle = cleanHandle(profile.handle);
        const fields = {
            name,
            handle,
            bio: text(profile.bio).slice(0, MAX_BIO),
            postingStyle: text(profile.postingStyle).trim(),
            banner: text(profile.banner),
            avatar: text(profile.avatar),
            followers: cleanCount(profile.followers),
            following: cleanCount(profile.following),
        };
        for (const [field, value] of Object.entries(fields)) {
            if (value === '' || value === 0) delete next[field];
            else next[field] = value;
        }
        settings.socialAccounts[key] = next;
        return next;
    }

    /** The posts every chat has (the account's) and the chat's, newest first; marked kept, and the pinned one. */
    function getPosts(settings, key) {
        const account = settings?.socialAccounts?.[key];
        const kept = Array.isArray(account?.posts) ? account.posts : [];
        const chat = Array.isArray(settings?.socialPosts?.[key]) ? settings.socialPosts[key] : [];
        return [
            ...kept.map(normalizePost).filter(Boolean).map(post => ({ ...post, kept: true, pinned: post.id === account.pinnedId })),
            ...chat.map(normalizePost).filter(Boolean).map(post => ({ ...post, kept: false, pinned: false })),
        ].sort((a, b) => b.at - a.at);
    }

    /** Where a post is: its list (the account's, every chat has them, or the chat's) and place, or null. */
    function locatePost(settings, key, postId) {
        for (const [list, kept] of [[settings?.socialAccounts?.[key]?.posts, true], [settings?.socialPosts?.[key], false]]) {
            const index = Array.isArray(list) ? list.findIndex(p => isObject(p) && p.id === postId) : -1;
            if (index >= 0) return { list, index, kept };
        }
        return null;
    }

    /**
     * Gives a post (kept or the chat's) a real image, or takes it off (`photo` null).
     * Returns the path it had ('' for none), or null when there's no such post.
     */
    function setPostPhoto(settings, key, postId, photo) {
        const found = locatePost(settings, key, postId);
        if (!found) return null;
        const post = found.list[found.index];
        const previous = text(post.photo?.path);
        if (photo) post.photo = photo;
        else delete post.photo;
        return previous;
    }

    /** Where the replies a post shows are in its stored list (normalizePost's choice of them). */
    function shownReplies(post) {
        return (Array.isArray(post?.replies) ? post.replies : []).map((reply, i) => [reply, i]).filter(([reply]) => isObject(reply))
            .slice(0, MAX_REPLIES).map(([, i]) => i);
    }

    /**
     * The user's own words for a post, kept or the chat's: its text and photo description,
     * `at` and its numbers (each undefined: left as it is), `replies` ({ place in its list:
     * { text, name, handle, likes, at } }), and `photo` as setPostPhoto takes it (undefined:
     * left as it is). Returns the image path it had ('' for none), or null when there's
     * no such post.
     */
    function editPostContent(settings, key, postId, { text: words, image, photo, replies = {}, at, likes, reposts, views, replyCount }) {
        const found = locatePost(settings, key, postId);
        if (!found) return null;
        const post = found.list[found.index];
        post.text = text(words).trim();
        post.image = text(image).trim();
        if (at !== undefined) post.at = at;
        for (const [name, value] of Object.entries({ likes, reposts, views, replyCount })) {
            if (value !== undefined) post[name] = count(value);
        }
        for (const [i, reply] of Object.entries(replies)) {
            if (!isObject(post.replies?.[i])) continue;
            Object.assign(post.replies[i], { text: text(reply.text).trim(), name: text(reply.name).trim(), handle: cleanHandle(reply.handle), likes: count(reply.likes), at: reply.at });
        }
        return photo === undefined ? text(post.photo?.path) : setPostPhoto(settings, key, postId, photo);
    }

    /**
     * The user's own words for what a post reposts; `photo` as in editPostContent. With
     * nothing left to show, the post isn't a repost any more. Returns the image path the
     * repost had ('' for none), or null when there's no such post or it reposts nothing.
     */
    function editRepostContent(settings, key, postId, { name, handle, text: words, image, photo }) {
        const found = locatePost(settings, key, postId);
        const post = found ? found.list[found.index] : null;
        if (!isObject(post?.repost)) return null;
        const repost = post.repost;
        const previous = text(repost.photo?.path);
        repost.name = text(name).trim();
        repost.handle = cleanHandle(handle);
        repost.text = text(words).trim();
        repost.image = text(image).trim();
        if (photo) repost.photo = photo;
        else if (photo === null) delete repost.photo;
        if (!repost.text && !repost.image && !repost.photo) delete post.repost;
        return previous;
    }

    /**
     * Keeping moves a post, replies and all, onto the character: every chat with them has
     * it. Back to this chat's only, it can't stay pinned. False when nothing changed.
     */
    function setPostKept(settings, key, postId, kept) {
        const found = locatePost(settings, key, postId);
        if (!found || found.kept === !!kept) return false;
        const [post] = found.list.splice(found.index, 1);
        if (kept) {
            if (!isObject(settings.socialAccounts)) settings.socialAccounts = {};
            if (!isObject(settings.socialAccounts[key])) settings.socialAccounts[key] = {};
            const account = settings.socialAccounts[key];
            if (!Array.isArray(account.posts)) account.posts = [];
            // Set, or pinNewestKept would take this for a post from before there was one pin
            if (!('pinnedId' in account)) account.pinnedId = '';
            account.posts.push(post);
        } else {
            if (settings.socialAccounts[key].pinnedId === postId) settings.socialAccounts[key].pinnedId = '';
            if (!isObject(settings.socialPosts)) settings.socialPosts = {};
            if (!Array.isArray(settings.socialPosts[key])) settings.socialPosts[key] = [];
            settings.socialPosts[key].push(post);
        }
        return true;
    }

    /**
     * One post can be pinned, as on X: pinning another takes the pin from the last, which
     * stays kept. Pinning keeps a post; unpinning leaves it kept. False when nothing changed.
     */
    function setPostPinned(settings, key, postId, pinned) {
        if (!locatePost(settings, key, postId)) return false;
        if (pinned) setPostKept(settings, key, postId, true);
        const account = settings.socialAccounts?.[key];
        if (!account || (pinned ? account.pinnedId === postId : account.pinnedId !== postId)) return false;
        account.pinnedId = pinned ? postId : '';
        return true;
    }

    /**
     * Every kept post used to show as pinned: an account from then keeps its newest one
     * pinned, the others kept. Runs on loading the settings; `pinnedId` set means done.
     */
    function pinNewestKept(settings) {
        for (const account of Object.values(isObject(settings?.socialAccounts) ? settings.socialAccounts : {})) {
            if (!isObject(account) || 'pinnedId' in account || !Array.isArray(account.posts) || !account.posts.length) continue;
            account.pinnedId = account.posts.filter(isObject).reduce((a, b) => (Number(b.at) > Number(a.at) ? b : a)).id || '';
        }
    }

    /** Takes a post away; returns it as it was, or null. */
    function deletePost(settings, key, postId) {
        const found = locatePost(settings, key, postId);
        if (!found) return null;
        if (settings.socialAccounts?.[key]?.pinnedId === postId) settings.socialAccounts[key].pinnedId = '';
        return found.list.splice(found.index, 1)[0];
    }

    /**
     * Puts back the chat's posts from an archive (null: it had none). One kept since
     * then is on the character now, so it isn't brought back a second time.
     */
    function restoreChatPosts(settings, key, snapshot) {
        if (!isObject(settings.socialPosts)) settings.socialPosts = {};
        if (!Array.isArray(snapshot)) {
            delete settings.socialPosts[key];
            return;
        }
        const kept = new Set((settings.socialAccounts?.[key]?.posts || []).map(post => post?.id));
        settings.socialPosts[key] = JSON.parse(JSON.stringify(snapshot)).filter(post => !kept.has(post?.id));
    }

    // ── Archives of the posts (the window is lib/saveload-modal.js's) ──

    const ARCHIVE_FORMAT = 'echogram-social-posts';
    // How many posts an archive shows before it's loaded (as a chat's shows its last messages)
    const ARCHIVE_PREVIEW = 5;

    function archivesOf(settings, key) {
        const list = settings?.socialArchives?.[key];
        return Array.isArray(list) ? list.filter(isObject) : [];
    }

    /** Every image file these posts show, their own and the ones they repost. */
    function photoPaths(posts) {
        return (Array.isArray(posts) ? posts : []).flatMap(post => [text(post?.photo?.path), text(post?.repost?.photo?.path)]).filter(Boolean);
    }

    /**
     * What the save window needs for the open character's posts. `api`:
     *   getSettings(), saveSettings(), getCharacterKey(), getCharacterName(), now(),
     *   forgetPhoto(path) (deletes the file if no post or archive has it any more),
     *   readPhoto(path) → the file's data URL (for an export),
     *   uploadPhoto(dataUrl) → its path in the user's images (for an import),
     *   onLoad() (the posts changed)
     */
    function createArchiveSource(api) {
        const settings = () => api.getSettings();
        const key = () => api.getCharacterKey();
        const find = id => archivesOf(settings(), key()).find(save => save.id === id) || null;

        function defaultName() {
            const date = new Date(api.now()).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            return `${api.getCharacterName() || 'Posts'} — ${date}`;
        }

        function add(charKey, save) {
            const s = settings();
            if (!isObject(s.socialArchives)) s.socialArchives = {};
            if (!Array.isArray(s.socialArchives[charKey])) s.socialArchives[charKey] = [];
            const entry = { id: `sa_${api.now()}_${Math.random().toString(36).slice(2, 7)}`, ...save };
            s.socialArchives[charKey].push(entry);
            api.saveSettings();
            return entry;
        }

        const postCount = save => (Array.isArray(save.posts) ? save.posts.length : 0);

        return {
            header: () => ({ title: 'Post Archives', badge: null, defaultName: defaultName() }),
            labels: { empty: 'No saved posts yet.', save: 'Save Current Posts', load: 'Load These Posts', loadShort: 'Load Posts', exportFull: 'Export Posts' },
            list: () => archivesOf(settings(), key()).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)),
            get: find,

            save(name) {
                if (!key()) return null;
                return add(key(), {
                    name: name || defaultName(),
                    savedAt: api.now(),
                    charName: api.getCharacterName(),
                    posts: JSON.parse(JSON.stringify(settings().socialPosts?.[key()] || [])),
                });
            },

            createEmpty(name) {
                if (!key()) return null;
                return add(key(), { name: name || defaultName(), savedAt: api.now(), charName: api.getCharacterName(), posts: [] });
            },

            load(id) {
                const save = find(id);
                if (!save) return;
                const replaced = photoPaths(settings().socialPosts?.[key()]);
                restoreChatPosts(settings(), key(), save.posts);
                api.saveSettings();
                replaced.forEach(api.forgetPhoto);
                api.onLoad();
            },

            rename(id, name) {
                const save = find(id);
                if (!save) return;
                save.name = name;
                api.saveSettings();
            },

            remove(id) {
                const list = settings().socialArchives?.[key()];
                const index = Array.isArray(list) ? list.findIndex(save => save?.id === id) : -1;
                if (index < 0) return;
                const [save] = list.splice(index, 1);
                api.saveSettings();
                photoPaths(save.posts).forEach(api.forgetPhoto);
            },

            /** The archive as a file, its images inside it: a path means nothing on another install. */
            async exportFile(id) {
                const save = find(id);
                if (!save) return null;
                const inFile = async (holder) => {
                    if (!holder?.photo?.path) return holder;
                    const { photo, ...rest } = holder;
                    const data = await api.readPhoto(photo.path).catch(() => null);
                    return data ? { ...rest, photo: { width: photo.width, height: photo.height, data } } : rest;
                };
                const posts = await Promise.all((save.posts || []).map(async (post) => {
                    const own = await inFile(post);
                    return own?.repost ? { ...own, repost: await inFile(own.repost) } : own;
                }));
                return {
                    name: `${String(save.name).replace(/[\\/:*?"<>|]/g, '_')}.json`,
                    type: 'application/json',
                    content: JSON.stringify({ format: ARCHIVE_FORMAT, version: 1, name: save.name, savedAt: save.savedAt, charName: save.charName, posts }),
                };
            },

            /** A file exported above, as a new archive of the open character's. Throws on any other file. */
            async importFile(file) {
                const charKey = key();
                const data = JSON.parse(await file.text());
                if (!charKey || data?.format !== ARCHIVE_FORMAT || !Array.isArray(data.posts)) throw new Error('not a post archive');
                const posts = [];
                for (const [i, raw] of data.posts.entries()) {
                    if (!isObject(raw)) continue;
                    const post = normalizePost({ ...raw, photo: null, repost: isObject(raw.repost) ? { ...raw.repost, photo: null } : null }, i);
                    // An image that won't upload: the post keeps its description
                    const fromFile = async (source) => {
                        if (typeof source?.photo?.data !== 'string' || !source.photo.data.startsWith('data:image/')) return null;
                        const path = await api.uploadPhoto(source.photo.data).catch(() => '');
                        return path ? { path, width: count(source.photo.width), height: count(source.photo.height) } : null;
                    };
                    post.photo = await fromFile(raw);
                    if (isObject(raw.repost)) {
                        const photo = await fromFile(raw.repost);
                        // A repost that's only an image: normalizePost had nothing to show yet
                        if (photo) post.repost = normalizeRepost({ ...raw.repost, photo });
                    }
                    posts.push(post);
                }
                return add(charKey, { name: text(data.name).trim() || file.name.replace(/\.json$/i, ''), savedAt: api.now(), charName: text(data.charName), posts });
            },

            chips: (save) => {
                const n = postCount(save);
                return `<span class="et-sl-item-chip" title="${n} post${n === 1 ? '' : 's'}"><i class="fa-solid fa-message"></i> ${n}</span>`;
            },
            countText: (save) => {
                const n = postCount(save);
                return `${n} post${n === 1 ? '' : 's'}`;
            },
            preview: (save) => {
                const posts = (save.posts || []).map(normalizePost).filter(Boolean).sort((a, b) => b.at - a.at).slice(0, ARCHIVE_PREVIEW);
                return `<div class="et-sl-prev-msgs">${posts.length ? posts.map(post => `
                    <div class="et-sl-prev-msg et-sl-prev-char">
                        <span class="et-sl-prev-sender">${escapeHtml(fullTime(post.at))}</span>
                        <span class="et-sl-prev-text">${escapeHtml(post.text || post.repost?.text || post.image || 'Photo')}</span>
                    </div>`).join('') : '<p class="et-sl-prev-nomsg">No posts</p>'}</div>`;
            },
        };
    }

    // ── Formatting (vertsan/x-clone-ui-freeapi's timeAgo and formatDateTime) ──

    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    /** "5m", "3h", "2d", then "Nov 15" (with the year when it isn't this one). */
    function timeAgo(at, now) {
        const mins = Math.max(1, Math.floor((now - at) / 60000));
        if (mins < 60) return `${mins}m`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}h`;
        const days = Math.floor(hours / 24);
        if (days < 7) return `${days}d`;
        const date = new Date(at);
        const day = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
        return date.getFullYear() === new Date(now).getFullYear() ? day : `${day}, ${date.getFullYear()}`;
    }

    /** "3:04 PM · Nov 15, 2026", as X writes it under a post. */
    function fullTime(at) {
        const date = new Date(at);
        const hours = date.getHours();
        const time = `${hours % 12 || 12}:${String(date.getMinutes()).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
        return `${time} · ${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
    }

    /** 980, 2.4K, 12K, 1.3M (a post's numbers); `from` is where K starts (a profile's are 1,574 below 10,000). */
    function shortCount(n, from = 1000) {
        if (n < from) return n.toLocaleString('en-US');
        const [unit, size] = n >= 1e6 ? ['M', 1e6] : ['K', 1e3];
        const value = n / size;
        return (value < 100 ? value.toFixed(1).replace(/\.0$/, '') : String(Math.floor(value))) + unit;
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]);
    }

    // A reply's avatar is its first letter on one of these (v0's AvatarFallback)
    const FALLBACK_COLORS = ['#1d9bf0', '#00ba7c', '#f91880', '#7856ff', '#ff7a00', '#ffd400'];

    function fallbackAvatar(name) {
        return { initial: Array.from(name.trim())[0]?.toUpperCase() || '?', color: FALLBACK_COLORS[hash(name) % FALLBACK_COLORS.length] };
    }

    // ── Writing posts (17c) ─────────────────────────────────────────────

    // At most this many posts a request (the prompt and the answer stay a sane length)
    const MAX_NEW_POSTS = 3;
    // The account's latest posts the model reads, so it doesn't repeat itself
    const POSTS_IN_CONTEXT = 20;

    /**
     * The social account's system prompt: one fixed text, its {{placeholders}} filled in by
     * buildPostsRequest. Freestyle and scripted posts differ in {{rules}} and {{format}};
     * what a request asks for (how many, the user's outlines) is the user message.
     */
    const SYSTEM_PROMPT = `You write the posts on {{char}}'s anonymous {{platform}} account.

Nobody in {{char}}'s life knows this account is theirs, {{user}} included, and {{char}} doesn't know anyone is watching. It is who {{char}} really is when no one they know is looking: things they would never say to {{user}}'s face, feelings they hide, or another face entirely if {{char}} is a public figure. The appeal is the contrast with the {{char}} {{user}} knows, so write the {{char}} the card implies underneath, not the one they show.

What {{char}} posts about, only as the card supports it:
- their core interests: what they actually spend their time and money on
- their political views, as bluntly as {{char}} would put them anonymously
- sex: sexual topics and expressions of their personal fetishes, more on adult platforms, but not unheard of anywhere
- their private life, only if {{char}} is the kind of person who shares it
- their public persona, only if {{char}} is an internet celebrity or public figure: then this can be the account people know, kept up for them

{{char}} may post about {{user}} without naming them, the way people post about someone they know.

Character card:
{{card}}

The account:
{{account}}

Its latest posts, oldest first:
{{posts}}

{{culture}}How to write:
- In {{char}}'s own voice online: the length, slang, typos, emoji and language they would really use there (usually the language of their card).
{{rules}}

{{format}}`;

    // Freestyle: the model decides everything
    const FREESTYLE_RULES = `- New posts come after the latest ones above, and don't repeat them.
- Now and then {{char}} reposts someone else's post, with a comment or without one: something they agree with, mock or are furious at. Make up that account, and leave the post's own <text> out for a plain repost.
- Likes, reposts, views and the number of replies fit an account with {{followers}} followers: a small account gets a handful of likes and few or no replies, a big one thousands.
- Replies are strangers on the platform, each in their own voice: fans, haters, trolls, people who disagree, people who don't get it. They react to that post.`;

    const FREESTYLE_FORMAT = `Answer with the posts only, oldest first, each in this form:
<post ago="5h" likes="120" reposts="4" views="3100" replies="12">
<text>what {{char}} wrote</text>
<image>what the attached photo shows (leave this out when there's no photo)</image>
<repost name="their display name" handle="their handle">
<text>what the reposted post says (leave this out if it's only a photo)</text>
<image>what its photo shows (leave this out if it's only words)</image>
</repost>
<reply name="display name" handle="handle" likes="3">a reply</reply>
</post>
- <repost>: only on a post that reposts someone else's; leave it out on all the others.
- ago: how long before now it was posted, like 20m, 5h or 2d.
- replies: how many replies the post has in all; write out only the top ones, at most ${MAX_REPLIES}, as <reply>.`;

    // Scripted: the user's outlines fix the rest; the model writes the words and who replied
    const OUTLINE_RULES = `- Write each post to its outline in the request, and don't repeat the latest posts above.
- Replies are strangers on the platform, each in their own voice, in the reply style the outline gives. They react to that post.
- Make up a display name and handle for each replier: different people, the kind of names real accounts have, none used twice.
- A reply's likes fit its post's.`;

    const OUTLINE_FORMAT = `Answer with the posts only, in the order of the outlines, each in this form:
<post n="1">
<text>what {{char}} wrote</text>
<image>what the attached photo shows (only where the outline has a photo)</image>
<repost name="their display name" handle="their handle">
<text>what the reposted post says (only where the outline's reposted post has words)</text>
<image>what its photo shows (only where the outline's reposted post has a photo)</image>
</repost>
<reply name="display name" handle="handle" likes="3">a reply</reply>
</post>
- n: the outline's number.
- <repost>: only where the outline has one. Make up the account being reposted. Leave the post's own <text> out where the outline says no comment.
- Write as many <reply> as the outline says, and none where it says none.`;

    /** A time as a datetime-local field writes it, in the viewer's own zone. */
    function localTime(at) {
        return new Date(at - new Date(at).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }

    /** A time typed in a datetime-local field; not touched or not a time: `was`. Never past `now`. */
    function editedTime(typed, was, now) {
        if (typed === localTime(was)) return was;
        const at = new Date(text(typed)).getTime();
        return Number.isFinite(at) ? Math.min(at, now) : was;
    }

    /** "1.2K", "3万", "1,200" → a number; 0 for anything else. */
    function parseCount(value) {
        const m = String(value ?? '').replace(/[,\s]/g, '').match(/^(\d+(?:\.\d+)?)(k|m|万|w|千)?/i);
        if (!m) return 0;
        const unit = { k: 1e3, m: 1e6, 万: 1e4, w: 1e4, 千: 1e3 }[(m[2] || '').toLowerCase()] || 1;
        return Math.round(Number(m[1]) * unit);
    }

    /** "20m", "5h", "2d", "3 hours", "2天" → ms; null when it isn't a time. */
    function parseAgo(value) {
        const m = String(value ?? '').trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(months?|mo|个?月|minutes?|mins?|分钟?|m|seconds?|secs?|秒|s|hours?|hrs?|小时|h|days?|天|d|weeks?|wk|周|w|years?|yr|年|y)?/);
        if (!m) return null;
        const unit = (m[2] || 'm').replace(/^个/, '');
        const ms = /^(s|sec|secs|second|seconds|秒)$/.test(unit) ? 1000
            : /^(m|min|mins|minute|minutes|分|分钟)$/.test(unit) ? 60000
                : /^(h|hr|hrs|hour|hours|小时)$/.test(unit) ? 3600000
                    : /^(d|day|days|天)$/.test(unit) ? 86400000
                        : /^(w|wk|week|weeks|周)$/.test(unit) ? 7 * 86400000
                            : /^(mo|month|months|月|个月)$/.test(unit) ? 30 * 86400000 : 365 * 86400000;
        return Number(m[1]) * ms;
    }

    function attributes(tag) {
        const attrs = {};
        for (const m of String(tag).matchAll(/([a-z_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/gi)) {
            attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
        }
        return attrs;
    }

    function inner(body, tag) {
        const m = body.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)(?:</${tag}>|(?=<(?:text|image|repost|reply|post)\\b)|$)`, 'i'));
        return m ? m[1].trim() : null;
    }

    function postLine(post, now) {
        const flat = value => value.replace(/\s+/g, ' ').trim();
        const reposted = post.repost ? `[reposting @${post.repost.handle}: ${flat(post.repost.text) || 'a photo'}]` : '';
        return `[${agoText(post.at, now)}${post.image || post.photo ? ', with a photo' : ''}] ${[flat(post.text), reposted].filter(Boolean).join(' ')}`;
    }

    /** A time as the model reads it: "5h ago", then a date ("Nov 15"). */
    function agoText(at, now) {
        const ago = timeAgo(at, now);
        return /^\d/.test(ago) ? `${ago} ago` : ago;
    }

    /**
     * The request for new posts: the fixed system prompt filled in, and the user message.
     * `card` is the <character_reference> block; `account` and `posts` as getAccount and
     * getPosts give them. With `outlines` (the dialog's, for scripted posts) the request
     * is for those; its `outlines` are them as kept, oldest first.
     */
    /** The user's Posting style, right after the system prompt and over what it says of these; '' for none. */
    function postingStyleBlock(style, charName) {
        const words = text(style).trim();
        return words ? `\n\n<posting_style>\n${charName} posts in this style. It overrides anything above about language, tone, length and topics:\n${words}\n</posting_style>` : '';
    }

    function buildPostsRequest({ charName, userName, platform, culture = '', card, account, posts, count, outlines = null, now }) {
        const plan = outlines ? cleanOutlines(outlines, now) : null;
        const n = plan ? plan.length : Math.max(1, Math.min(MAX_NEW_POSTS, Math.round(Number(count)) || 1));
        const latest = posts.slice(0, POSTS_IN_CONTEXT).reverse();
        const accountLines = [
            `Name: ${account.name}`,
            `Handle: @${account.handle}`,
            account.bio ? `Bio: ${account.bio.replace(/\s*\n\s*/g, ' / ')}` : '',
            `Followers: ${account.followers.toLocaleString('en-US')}`,
            `Following: ${account.following.toLocaleString('en-US')}`,
        ].filter(Boolean).join('\n');
        const fill = {
            char: charName,
            user: userName,
            platform,
            culture: culture ? `${culture}\n\n` : '',
            card: card || '(none)',
            account: accountLines,
            posts: latest.length ? latest.map(post => postLine(post, now)).join('\n') : '(none yet)',
            followers: account.followers.toLocaleString('en-US'),
        };
        const systemPrompt = SYSTEM_PROMPT
            .replace('{{rules}}', () => (plan ? OUTLINE_RULES : FREESTYLE_RULES))
            .replace('{{format}}', () => (plan ? OUTLINE_FORMAT : FREESTYLE_FORMAT))
            .replace(/\{\{(\w+)\}\}/g, (all, key) => (key in fill ? fill[key] : all))
            + postingStyleBlock(account.postingStyle, charName);
        const prompt = plan
            ? `Write ${n} new ${n === 1 ? 'post' : 'posts'} to ${n === 1 ? 'this outline' : 'these outlines'}.\n\n${plan.map((outline, i) => outlineLines(outline, i, charName, now)).join('\n\n')}`
            : `Write ${n} new ${n === 1 ? 'post' : 'posts'}. Choose everything yourself: what ${n === 1 ? 'it is' : 'they are'} about, when, whether there's a photo, the numbers and the replies.`;
        return { systemPrompt, prompt, count: n, outlines: plan };
    }

    /** The dialog's outlines as kept, oldest first: a time past now is now, a blank number 0. */
    function cleanOutlines(outlines, now) {
        return outlines.slice(0, MAX_NEW_POSTS).map((outline) => {
            const at = new Date(text(outline.time)).getTime();
            return {
                at: Math.min(now, Number.isFinite(at) ? at : now),
                topic: text(outline.topic).trim(),
                photo: !!outline.photo && (!outline.repost || outline.repostComment !== false),
                repost: outline.repost ? {
                    topic: text(outline.repostTopic).trim(),
                    words: outline.repostText !== false || !outline.repostPhoto,
                    photo: !!outline.repostPhoto,
                    comment: outline.repostComment !== false,
                } : null,
                likes: parseCount(outline.likes),
                reposts: parseCount(outline.reposts),
                views: parseCount(outline.views),
                replyCount: parseCount(outline.replies),
                replyStyle: text(outline.replyStyle).trim(),
            };
        }).sort((a, b) => a.at - b.at);
    }

    function outlineLines(outline, i, charName, now) {
        const written = Math.min(outline.replyCount, MAX_REPLIES);
        return [
            `<outline n="${i + 1}">`,
            `Posted: ${agoText(outline.at, now)}`,
            outline.repost && !outline.repost.comment ? 'Comment: none, a plain repost' : `Topic: ${outline.topic || `whatever ${charName} would post`}`,
            `Photo: ${outline.photo ? 'yes' : 'no'}`,
            outline.repost ? `Reposts someone else's post, with ${outline.repost.words && outline.repost.photo ? 'words and a photo' : outline.repost.photo ? 'a photo and no words' : 'words and no photo'}, about: ${outline.repost.topic || `whatever ${charName} would repost`}` : '',
            `Numbers: ${outline.likes.toLocaleString('en-US')} likes, ${outline.reposts.toLocaleString('en-US')} reposts, ${outline.views.toLocaleString('en-US')} views`,
            `Replies: ${written ? `write ${written}${outline.replyCount > written ? ` (of ${outline.replyCount.toLocaleString('en-US')} in all)` : ''}` : 'none'}`,
            written && outline.replyStyle ? `Reply style: ${outline.replyStyle}` : '',
            '</outline>',
        ].filter(Boolean).join('\n');
    }

    /**
     * The posts in the model's answer, at most `count`, oldest first, as kept: times from
     * their "ago", put after the account's latest post (`after`) and no later than `now`;
     * replies after their post. Lenient: missing closing tags and attributes are allowed,
     * and a post with no <text> takes whatever words it has.
     */
    function parsePosts(raw, { now, after = 0, count = MAX_NEW_POSTS, idPrefix = 'p' }) {
        const floor = Math.min(Math.max(after + 60000, now - 30 * 86400000), now);
        const found = readPosts(raw).slice(0, count);
        // Times: as the model said where it can, else spread evenly from the latest post to now
        const posts = found.map((post, i) => {
            const spread = floor + ((now - floor) * (i + 1)) / (found.length + 1);
            const at = Math.round(Math.min(now, Math.max(floor, post.ago == null ? spread : now - post.ago)));
            return { ...post, at };
        }).sort((a, b) => a.at - b.at);
        return posts.map((post, i) => ({
            id: `${idPrefix}${i}`,
            at: post.at,
            text: post.text,
            image: post.image,
            ...(post.repost ? { repost: post.repost } : {}),
            likes: post.likes,
            reposts: post.reposts,
            views: Math.max(post.views, post.likes),
            replyCount: Math.max(post.replyCount, post.replies.length),
            replies: keptReplies(post.replies, post.at, now),
        }));
    }

    /**
     * The scripted posts in the model's answer: its words and repliers, everything else as
     * the outlines (cleanOutlines) say. A post goes to the outline its `n` names, else the
     * next one free; an outline it didn't write is left out.
     */
    function parseOutlinedPosts(raw, { outlines, now, idPrefix = 'p' }) {
        const free = outlines.map((outline, i) => i);
        const placed = [];
        for (const post of readPosts(raw)) {
            if (!free.length) break;
            const named = Number(post.n) - 1;
            const slot = free.includes(named) ? named : free[0];
            free.splice(free.indexOf(slot), 1);
            placed.push({ post, slot });
        }
        return placed.sort((a, b) => a.slot - b.slot).flatMap(({ post, slot }, i) => {
            const outline = outlines[slot];
            const repost = outlinedRepost(post.repost, outline.repost);
            const words = outline.repost && !outline.repost.comment ? '' : post.text;
            // Nothing the outline asked for came back: nothing to show
            if (!words && !repost) return [];
            return [{
                id: `${idPrefix}${i}`,
                at: outline.at,
                text: words,
                image: outline.photo ? post.image || 'Photo' : '',
                ...(repost ? { repost } : {}),
                likes: outline.likes,
                reposts: outline.reposts,
                views: outline.views,
                replyCount: outline.replyCount,
                replies: keptReplies(post.replies.slice(0, outline.replyCount), outline.at, now),
            }];
        });
    }

    /** What a scripted post reposts: the model's account and words, only the parts its outline has. */
    function outlinedRepost(written, wanted) {
        if (!written || !wanted) return null;
        const words = wanted.words ? written.text : '';
        const image = wanted.photo ? written.image || 'Photo' : '';
        return words || image ? { name: written.name, handle: written.handle, text: words, image } : null;
    }

    /** A post's replies as kept: after it, no later than now, each with a usable name and handle. */
    function keptReplies(replies, postAt, now) {
        return replies.map((reply, j) => {
            const spread = postAt + ((now - postAt) * (j + 1)) / (replies.length + 1);
            const at = Math.round(Math.min(now, Math.max(postAt + 60000, reply.ago == null ? spread : now - reply.ago)));
            const name = reply.name || reply.handle || 'user';
            return { id: `r${j}`, at: Math.min(at, now), name, handle: reply.handle.replace(/[^A-Za-z0-9_]/g, '').slice(0, MAX_HANDLE) || handleFrom('', name), text: reply.text, likes: reply.likes };
        });
    }

    /** A <repost> as written: whose it is, its words and photo; null with neither. */
    function readRepost(match) {
        const attrs = attributes(match[1]);
        const words = inner(match[2], 'text') ?? match[2].replace(/<image\b[^>]*>[\s\S]*?(<\/image>|$)/gi, '').replace(/<[^>]+>/g, '').trim();
        const image = inner(match[2], 'image') || '';
        if (!words && !image) return null;
        const name = (attrs.name || attrs.handle || 'user').trim();
        return { name, handle: (attrs.handle || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, MAX_HANDLE) || handleFrom('', name), text: words, image };
    }

    /** Every <post> in an answer, as written. */
    function readPosts(raw) {
        const answer = String(raw ?? '');
        const found = [];
        for (const m of answer.matchAll(/<post\b([^>]*)>([\s\S]*?)(?=<\/post>|<post\b|$)/gi)) {
            const attrs = attributes(m[1]);
            const reposted = m[2].match(/<repost\b([^>]*)>([\s\S]*?)(?:<\/repost>|(?=<reply\b)|$)/i);
            const repost = reposted ? readRepost(reposted) : null;
            const body = reposted ? m[2].replace(reposted[0], '') : m[2];
            const text = inner(body, 'text') ?? body.replace(/<image\b[^>]*>[\s\S]*?(<\/image>|$)/gi, '').replace(/<reply\b[\s\S]*$/i, '').replace(/<[^>]+>/g, '').trim();
            if (!text && !repost) continue;
            const replies = [];
            for (const r of body.matchAll(/<reply\b([^>]*)>([\s\S]*?)(?=<\/reply>|<reply\b|<\/post>|$)/gi)) {
                const ra = attributes(r[1]);
                const replyText = r[2].replace(/<[^>]+>/g, '').trim();
                if (!replyText) continue;
                replies.push({ name: (ra.name || '').trim(), handle: (ra.handle || '').trim().replace(/^@/, ''), text: replyText, likes: parseCount(ra.likes), ago: parseAgo(ra.ago) });
            }
            found.push({
                n: attrs.n,
                ago: parseAgo(attrs.ago),
                text,
                image: inner(body, 'image') || (attrs.image || '').trim(),
                repost,
                likes: parseCount(attrs.likes),
                reposts: parseCount(attrs.reposts),
                views: parseCount(attrs.views),
                replyCount: parseCount(attrs.replies),
                replies: replies.slice(0, MAX_REPLIES),
            });
        }
        return found;
    }

    /** Keeps new posts with the chat's own (socialPosts), given ids of their own. */
    function addChatPosts(settings, key, posts, stamp) {
        if (!isObject(settings.socialPosts)) settings.socialPosts = {};
        const list = Array.isArray(settings.socialPosts[key]) ? settings.socialPosts[key] : [];
        const added = posts.map((post, i) => ({ ...post, id: `${stamp}-${i}` }));
        settings.socialPosts[key] = [...list, ...added];
        return added;
    }

    // ── The page ────────────────────────────────────────────────────────

    /**
     * The account's page over the chat panel. `api`:
     *   getSettings(), saveSettings(), getCharacterKey(), getCharacterName(),
     *   getAvatarUrl() (Echogram's), getContainer() (the panel), stylesheetUrl(theme, file), now(),
     *   pickImage(kind) → a cropped image's data URL or null ('avatar' square, 'banner' 3:1;
     *       called within the tap, so a file dialog can open),
     *   uploadImage(dataUrl, kind) → its path in the user's images, deleteImage(path),
     *   pickPhoto() → an image for a post, saved: { path, width, height }, or null (called
     *       within the tap, so a file dialog can open),
     *   forgetPhoto(path) deletes an image no post or archive has any more,
     *   openArchives() the posts' save window,
     *   generatePosts({ count, outlines, signal }) → new posts kept with the chat (how many);
     *       `outlines` for scripted posts, null for freestyle
     */
    function createSocialView(api) {
        let root = null;
        let openPostId = null;
        // Edit profile, while it's open: the fields as typed, and the avatar and banner
        // (undefined: as they were; null: taken off; a data URL: a new one, uploaded on Save)
        let modal = null;
        let edit = null;
        // New posts, while the dialog's open: how many, freestyle or scripted, what's typed
        // in the outlines, and the request while it runs
        let compose = null;
        // Edit post, while it's open: which post, what's typed, and its image (undefined: as
        // it was; null: taken off; else one picked now, saved already and deleted on Cancel)
        let postEdit = null;

        function themes() {
            return window.EchoTextSocialThemes || {};
        }

        function themeFor(account) {
            return themes()[account.theme] || themes()[DEFAULT_THEME];
        }

        function loadStylesheet(theme) {
            const href = theme.stylesheet ? api.stylesheetUrl(theme.id, theme.stylesheet) : null;
            let link = document.getElementById('et-social-css');
            if (link && link.getAttribute('href') !== href) {
                link.remove();
                link = null;
            }
            if (href && !link) {
                link = document.createElement('link');
                link.id = 'et-social-css';
                link.rel = 'stylesheet';
                link.href = href;
                // Unseen until it's in: drawn without it first, its buttons would fade in from the browser's own
                link.dataset.loading = '';
                const shown = () => {
                    delete link.dataset.loading;
                    if (root) root.style.visibility = '';
                };
                link.addEventListener('load', shown, { once: true });
                link.addEventListener('error', shown, { once: true });
                document.head.appendChild(link);
            }
            if (root) root.style.visibility = link && 'loading' in link.dataset ? 'hidden' : '';
        }

        /** A post's own image as its frame shows it (as a photo bubble's): its address and shape. */
        function photoView(photo) {
            if (!photo) return null;
            const ratio = photo.width > 0 && photo.height > 0 ? photo.width / photo.height : 1;
            return { url: photoUrl(photo.path), ratio: Math.round(Math.min(2, Math.max(0.5, ratio)) * 1000) / 1000 };
        }

        function postView(post, account, now) {
            return {
                id: post.id,
                text: post.text,
                image: post.image,
                photo: photoView(post.photo),
                repost: post.repost ? {
                    name: post.repost.name,
                    handle: post.repost.handle,
                    avatar: fallbackAvatar(post.repost.name),
                    text: post.repost.text,
                    image: post.repost.image,
                    photo: photoView(post.repost.photo),
                } : null,
                pinned: post.pinned,
                kept: post.kept,
                time: timeAgo(post.at, now),
                fullTime: fullTime(post.at),
                counts: {
                    replies: post.replyCount ? shortCount(post.replyCount) : '',
                    reposts: post.reposts ? shortCount(post.reposts) : '',
                    likes: post.likes ? shortCount(post.likes) : '',
                    views: post.views ? shortCount(post.views) : '',
                },
                replies: post.replies.map(reply => ({
                    name: reply.name,
                    handle: reply.handle,
                    avatar: fallbackAvatar(reply.name),
                    text: reply.text,
                    time: timeAgo(reply.at || post.at, now),
                    likes: reply.likes ? shortCount(reply.likes) : '',
                    replyingTo: account.handle,
                })),
            };
        }

        /** What the templates get: the account, its posts, and the open post (or null). */
        function buildView() {
            const settings = api.getSettings();
            const key = api.getCharacterKey();
            const account = getAccount(settings, key, { name: api.getCharacterName() });
            const now = api.now();
            // The pinned one on top, as X has it; the rest by time
            const inOrder = getPosts(settings, key).map(post => postView(post, account, now));
            const posts = [...inOrder.filter(post => post.pinned), ...inOrder.filter(post => !post.pinned)];
            return {
                theme: themeFor(account),
                view: {
                    account: {
                        name: account.name,
                        handle: account.handle,
                        bio: account.bio,
                        bannerUrl: account.banner,
                        avatarUrl: account.avatar || api.getAvatarUrl() || '',
                        avatarFallback: fallbackAvatar(account.name),
                        followers: shortCount(account.followers, 10000),
                        following: shortCount(account.following, 10000),
                        postCount: `${posts.length.toLocaleString('en-US')} ${posts.length === 1 ? 'post' : 'posts'}`,
                    },
                    posts,
                    post: openPostId ? posts.find(post => post.id === openPostId) || null : null,
                    edit: edit ? editView(account) : null,
                    editPost: postEdit ? postEditView(posts) : null,
                    compose: compose ? {
                        count: compose.count,
                        max: MAX_NEW_POSTS,
                        mode: compose.mode,
                        outlines: compose.outlines.slice(0, compose.count),
                        latestTime: localTime(now),
                        generating: !!compose.controller,
                        error: compose.error || '',
                    } : null,
                },
            };
        }

        /** The dialog's fields: as typed, else the account's own (blank where it shows a default). */
        function editView(account) {
            const stored = isObject(api.getSettings()?.socialAccounts?.[api.getCharacterKey()]) ? api.getSettings().socialAccounts[api.getCharacterKey()] : {};
            const fields = edit.fields || {
                name: text(stored.name) || account.name,
                handle: text(stored.handle) || account.handle,
                bio: account.bio,
                postingStyle: account.postingStyle,
                followers: account.followers ? String(account.followers) : '',
                following: account.following ? String(account.following) : '',
            };
            const avatar = edit.avatar === undefined ? account.avatar : edit.avatar || '';
            const banner = edit.banner === undefined ? account.banner : edit.banner || '';
            return {
                ...fields,
                maxName: MAX_NAME,
                maxBio: MAX_BIO,
                maxHandle: MAX_HANDLE,
                avatarUrl: avatar || api.getAvatarUrl() || '',
                avatarFallback: fallbackAvatar(fields.name || account.name),
                ownAvatar: !!avatar,
                bannerUrl: banner,
                error: edit.error || '',
                saving: !!edit.saving,
            };
        }

        /** Draws the page (back at its top when `page` changed) and the dialog over it. */
        function render({ keepScroll = false } = {}) {
            if (!root) return;
            const { theme, view } = buildView();
            if (!theme) return;
            loadStylesheet(theme);
            const ctx = { esc: escapeHtml, mentions: mentionsHtml };
            root.setAttribute('data-social-theme', theme.id);
            if (openPostId && !view.post) openPostId = null;
            const scroll = root.scrollTop;
            const dialogScroll = modal?.querySelector('[data-social-scroll]')?.scrollTop || 0;
            root.innerHTML = view.post ? theme.templates.detail(view, ctx) : theme.templates.profile(view, ctx);
            root.scrollTop = keepScroll ? scroll : 0;
            const dialog = view.edit ? 'editProfile' : view.editPost ? 'editPost' : view.compose ? 'compose' : null;
            if (dialog) {
                if (!modal) {
                    modal = document.createElement('div');
                    modal.className = 'et-social-modal';
                    modal.addEventListener('click', onClick);
                    modal.addEventListener('input', onInput);
                    root.after(modal);
                }
                modal.setAttribute('data-social-theme', theme.id);
                modal.innerHTML = theme.templates[dialog](view, ctx);
                const scroller = modal.querySelector('[data-social-scroll]');
                if (scroller) scroller.scrollTop = dialogScroll;
            } else if (modal) {
                modal.remove();
                modal = null;
            }
        }

        /** What's typed in the dialog now. */
        function readFields() {
            const fields = {};
            for (const el of modal.querySelectorAll('[data-social-field]')) fields[el.getAttribute('data-social-field')] = el.type === 'checkbox' ? el.checked : el.value;
            return fields;
        }

        // The counters under Name and Bio
        function onInput(e) {
            const field = e.target.getAttribute?.('data-social-field');
            const counter = field && modal.querySelector(`[data-social-count="${field}"]`);
            if (counter) counter.textContent = String(e.target.value.length);
            // These two change which of a scripted post's fields there are
            if (compose && /^outline-\d+-(repost|repostComment)$/.test(field || '')) {
                keepOutlines();
                render({ keepScroll: true });
            }
        }

        function openEdit() {
            edit = {};
            render({ keepScroll: true });
            modal?.querySelector('[data-social-field="name"]')?.focus({ preventScroll: true });
        }

        function closeEdit() {
            edit = null;
            render({ keepScroll: true });
        }

        /** The post dialog's fields: as typed, else the post's own; its image as it stands. */
        function postEditView(posts) {
            const post = posts.find(p => p.id === postEdit.id);
            const stored = locatePost(api.getSettings(), api.getCharacterKey(), postEdit.id);
            const saved = stored ? stored.list[stored.index] : null;
            return {
                text: postEdit.fields ? postEdit.fields.text : text(saved?.text),
                image: postEdit.fields ? postEdit.fields.image : text(saved?.image),
                photo: postEdit.photo === undefined ? post?.photo || null : photoView(postEdit.photo),
                ...numberFields(saved),
                latest: localTime(api.now()),
                repost: repostEditView(post, saved),
                replies: shownReplies(saved).map((i) => {
                    const reply = normalizeReply(saved.replies[i], i);
                    const typed = name => postEdit.fields?.[`${name}-${i}`];
                    return {
                        i,
                        text: typed('reply') ?? reply.text,
                        name: typed('replyName') ?? reply.name,
                        handle: typed('replyHandle') ?? reply.handle,
                        likes: typed('replyLikes') ?? (reply.likes ? String(reply.likes) : ''),
                        time: typed('replyTime') ?? localTime(reply.at || saved.at),
                    };
                }),
                error: postEdit.error || '',
            };
        }

        /** The post's time and numbers in the dialog: as typed, else its own (blank for none). */
        function numberFields(saved) {
            if (postEdit.fields) {
                const { time, likes, reposts, views, replyCount } = postEdit.fields;
                return { time, likes, reposts, views, replyCount };
            }
            const post = normalizePost(saved, 0);
            const shown = value => (value ? String(value) : '');
            return { time: localTime(post.at), likes: shown(post.likes), reposts: shown(post.reposts), views: shown(post.views), replyCount: shown(post.replyCount) };
        }

        /** What the post reposts, in the dialog; null for a post that doesn't. */
        function repostEditView(post, saved) {
            if (!isObject(saved?.repost)) return null;
            const stored = saved.repost;
            const typed = postEdit.fields;
            return {
                name: typed ? typed.repostName : text(stored.name),
                handle: typed ? typed.repostHandle : text(stored.handle),
                text: typed ? typed.repostText : text(stored.text),
                image: typed ? typed.repostImage : text(stored.image),
                photo: postEdit.repostPhoto === undefined ? post?.repost?.photo || null : photoView(postEdit.repostPhoto),
            };
        }

        function openPostEdit(postId) {
            postEdit = { id: postId };
            render({ keepScroll: true });
            modal?.querySelector('[data-social-field="text"]')?.focus({ preventScroll: true });
        }

        /** Closed without saving: an image picked just now has no post, so its file goes. */
        function closePostEdit() {
            dropPickedPhotos();
            postEdit = null;
            render({ keepScroll: true });
        }

        function dropPickedPhotos() {
            for (const photo of [postEdit?.photo, postEdit?.repostPhoto]) {
                if (photo) api.deleteImage(photo.path);
            }
        }

        /** `slot`: which image in the dialog, 'photo' (the post's) or 'repostPhoto'. */
        async function pickPostPhoto(slot) {
            const session = postEdit;
            const picked = await api.pickPhoto();
            if (!picked) return;
            if (postEdit !== session) {
                api.deleteImage(picked.path);
                return;
            }
            if (session[slot]) api.deleteImage(session[slot].path);
            session.fields = readFields();
            session[slot] = picked;
            render({ keepScroll: true });
        }

        function dropPostPhoto(slot) {
            if (postEdit[slot]) api.deleteImage(postEdit[slot].path);
            postEdit.fields = readFields();
            postEdit[slot] = null;
            render({ keepScroll: true });
        }

        function savePostEdit() {
            const settings = api.getSettings();
            const key = api.getCharacterKey();
            const fields = readFields();
            const found = locatePost(settings, key, postEdit.id);
            const stored = found?.list[found.index];
            const photo = postEdit.photo === undefined ? stored?.photo : postEdit.photo;
            const hasRepost = isObject(stored?.repost);
            const repostPhoto = postEdit.repostPhoto === undefined ? stored?.repost?.photo : postEdit.repostPhoto;
            const repostLeft = hasRepost && (fields.repostText.trim() || fields.repostImage.trim() || repostPhoto);
            if (!fields.text.trim() && !fields.image.trim() && !photo && !repostLeft) {
                postEdit.fields = fields;
                postEdit.error = 'A post can\'t be empty.';
                render({ keepScroll: true });
                return;
            }
            const now = api.now();
            const replies = {};
            for (const i of shownReplies(stored)) {
                replies[i] = {
                    text: fields[`reply-${i}`],
                    name: fields[`replyName-${i}`],
                    handle: fields[`replyHandle-${i}`],
                    likes: parseCount(fields[`replyLikes-${i}`]),
                    at: editedTime(fields[`replyTime-${i}`], Number(stored.replies[i].at) || stored.at, now),
                };
            }
            if (Object.values(replies).some(reply => !reply.text.trim())) {
                postEdit.fields = fields;
                postEdit.error = 'A reply can\'t be empty.';
                render({ keepScroll: true });
                return;
            }
            const previous = editPostContent(settings, key, postEdit.id, {
                text: fields.text,
                image: fields.image,
                at: editedTime(fields.time, stored.at, now),
                likes: parseCount(fields.likes),
                reposts: parseCount(fields.reposts),
                views: parseCount(fields.views),
                replyCount: parseCount(fields.replyCount),
                replies,
                photo: postEdit.photo,
            });
            const previousRepost = hasRepost ? editRepostContent(settings, key, postEdit.id, {
                name: fields.repostName, handle: fields.repostHandle, text: fields.repostText, image: fields.repostImage, photo: postEdit.repostPhoto,
            }) : '';
            api.saveSettings();
            if (previous && previous !== text(postEdit.photo?.path) && postEdit.photo !== undefined) forgetPhoto(previous);
            if (previousRepost && previousRepost !== text(postEdit.repostPhoto?.path) && postEdit.repostPhoto !== undefined) forgetPhoto(previousRepost);
            postEdit = null;
            render({ keepScroll: true });
        }

        // Picking a new avatar or banner: the dialog redrawn with it, what's typed kept
        function pickImage(kind) {
            const picking = api.pickImage(kind);
            Promise.resolve(picking).then((dataUrl) => {
                if (!edit || !dataUrl) return;
                edit.fields = readFields();
                edit[kind] = dataUrl;
                edit.error = '';
                render({ keepScroll: true });
            }).catch((err) => {
                if (!edit) return;
                edit.fields = readFields();
                edit.error = `Could not read the image: ${err.message}`;
                render({ keepScroll: true });
            });
        }

        function dropImage(kind) {
            edit.fields = readFields();
            edit[kind] = null;
            render({ keepScroll: true });
        }

        /** Save: new images uploaded first, so a failed upload changes nothing; replaced ones deleted after. */
        async function saveEdit() {
            if (!edit || edit.saving) return;
            const settings = api.getSettings();
            const key = api.getCharacterKey();
            const stored = isObject(settings.socialAccounts?.[key]) ? settings.socialAccounts[key] : {};
            edit.fields = readFields();
            edit.saving = true;
            edit.error = '';
            render({ keepScroll: true });
            const images = { avatar: text(stored.avatar), banner: text(stored.banner) };
            const uploaded = [];
            try {
                for (const kind of ['avatar', 'banner']) {
                    if (edit[kind] === null) images[kind] = '';
                    else if (edit[kind]) {
                        images[kind] = await api.uploadImage(edit[kind], kind);
                        uploaded.push(images[kind]);
                    }
                }
            } catch (err) {
                for (const path of uploaded) api.deleteImage(path);
                if (!edit) return;
                edit.saving = false;
                edit.error = `Could not save the image: ${err.message}`;
                render({ keepScroll: true });
                return;
            }
            // Closed meanwhile, or another character's page now: nothing kept
            if (!edit || api.getCharacterKey() !== key) {
                for (const path of uploaded) api.deleteImage(path);
                return;
            }
            // A name or username left as the default stays unset, so it follows the character
            const defaults = getAccount({}, key, { name: api.getCharacterName() });
            const fields = { ...edit.fields };
            if (!stored.name && text(fields.name).trim() === defaults.name) fields.name = '';
            if (!stored.handle && cleanHandle(fields.handle) === defaults.handle) fields.handle = '';
            setAccountProfile(settings, key, { ...fields, ...images });
            api.saveSettings();
            for (const kind of ['avatar', 'banner']) {
                const before = text(stored[kind]);
                if (before && before !== images[kind]) api.deleteImage(before);
            }
            edit = null;
            render({ keepScroll: true });
        }

        function onKeydown(e) {
            if (e.key !== 'Escape') return;
            if (root?.querySelector('[data-social-menu][data-open]')) {
                e.stopPropagation();
                closePostMenus();
            } else if (edit && !edit.saving) {
                e.stopPropagation();
                closeEdit();
            } else if (postEdit) {
                e.stopPropagation();
                closePostEdit();
            } else if (compose) {
                e.stopPropagation();
                closeCompose();
            }
        }

        function openCompose() {
            const time = localTime(api.now());
            compose = {
                count: 1,
                mode: 'freestyle',
                outlines: Array.from({ length: MAX_NEW_POSTS }, () => ({ topic: '', time, photo: false, repost: false, repostTopic: '', repostText: true, repostPhoto: false, repostComment: true, likes: '', reposts: '', views: '', replies: '', replyStyle: '' })),
            };
            render({ keepScroll: true });
        }

        /** Keeps what's typed in the outlines, for a redraw of the dialog. */
        function keepOutlines() {
            if (compose?.mode !== 'scripted' || compose.controller || !modal) return;
            for (const [name, value] of Object.entries(readFields())) {
                const m = name.match(/^outline-(\d+)-(\w+)$/);
                if (m) compose.outlines[Number(m[1])][m[2]] = value;
            }
        }

        /** Closing while it's writing stops the request: nothing it sends back is kept. */
        function closeCompose() {
            compose?.controller?.abort();
            compose = null;
            render({ keepScroll: true });
        }

        /**
         * Writes the posts. Every failure ends here: said in the dialog, which stays open to
         * try again; a cancelled or closed one says nothing, and what comes back after isn't kept.
         */
        async function generate() {
            if (!compose || compose.controller) return;
            keepOutlines();
            const mine = compose;
            const controller = new AbortController();
            mine.controller = controller;
            mine.error = '';
            try {
                render({ keepScroll: true });
                await api.generatePosts({
                    count: mine.count,
                    outlines: mine.mode === 'scripted' ? mine.outlines.slice(0, mine.count) : null,
                    signal: controller.signal,
                });
                if (compose !== mine || controller.signal.aborted) return;
                compose = null;
                openPostId = null;
                // At the top, where the new posts are
                render();
            } catch (err) {
                if (compose !== mine || controller.signal.aborted) return;
                console.warn('[EchoText] Could not write the posts:', err);
                mine.controller = null;
                mine.error = `Could not write the posts: ${err?.message || err}`;
                try { render({ keepScroll: true }); } catch (e) { console.error('[EchoText] Social page:', e); }
            }
        }

        /** Stops the posts being written; the dialog stays, to try again. */
        function cancelGenerate() {
            if (!compose?.controller) return;
            compose.controller.abort();
            compose.controller = null;
            compose.error = '';
            render({ keepScroll: true });
        }

        /** A new image for a post's photo; the one it replaces is deleted. */
        async function addPhoto(postId) {
            const key = api.getCharacterKey();
            const photo = await api.pickPhoto();
            if (!photo) return;
            const previous = api.getCharacterKey() === key ? setPostPhoto(api.getSettings(), key, postId, photo) : null;
            // Another character's page now, or the post is gone: the image has nowhere to go
            if (previous === null) {
                api.deleteImage(photo.path);
                return;
            }
            api.saveSettings();
            if (previous !== photo.path) forgetPhoto(previous);
            render({ keepScroll: true });
        }

        function forgetPhoto(path) {
            if (path) api.forgetPhoto(path);
        }

        function dropPhoto(postId) {
            const previous = setPostPhoto(api.getSettings(), api.getCharacterKey(), postId, null);
            if (!previous) return;
            api.saveSettings();
            forgetPhoto(previous);
            render({ keepScroll: true });
        }

        /** Closes a post's ⋯ menus, all but `except`; a Delete waiting for its second tap goes back. */
        function closePostMenus(except = null) {
            root?.querySelectorAll('[data-social-menu][data-open]').forEach((menu) => {
                if (menu === except) return;
                menu.removeAttribute('data-open');
                menu.removeAttribute('data-up');
                const armed = menu.querySelector('[data-armed]');
                if (armed) {
                    armed.removeAttribute('data-armed');
                    armed.querySelector('span').textContent = armed.getAttribute('data-label');
                }
            });
        }

        // A click anywhere else closes the menu, wherever it lands (capture: before anything stops it)
        function onDocumentClick(e) {
            closePostMenus(e.target.closest?.('[data-social-menu]') || null);
        }

        /** A post's ⋯: under the button, or above it when the page has no room below. */
        function togglePostMenu(button) {
            const menu = button.closest('[data-social-menu]');
            if (menu.hasAttribute('data-open')) {
                closePostMenus();
                return;
            }
            menu.setAttribute('data-open', '');
            const list = menu.querySelector('[data-social-action="post-menu-list"]').getBoundingClientRect();
            if (list.bottom > root.getBoundingClientRect().bottom - 8) menu.setAttribute('data-up', '');
        }

        function keepPost(postId, kept) {
            if (!setPostKept(api.getSettings(), api.getCharacterKey(), postId, kept)) return;
            api.saveSettings();
            render({ keepScroll: true });
        }

        function pinPost(postId, pinned) {
            if (!setPostPinned(api.getSettings(), api.getCharacterKey(), postId, pinned)) return;
            api.saveSettings();
            render({ keepScroll: true });
        }

        /** Delete takes a second tap (as Clear History does); a post's page goes with its post. */
        function removePost(button) {
            if (!button.hasAttribute('data-armed')) {
                button.setAttribute('data-armed', '');
                button.querySelector('span').textContent = button.getAttribute('data-confirm');
                return;
            }
            const postId = button.getAttribute('data-post-id');
            const post = deletePost(api.getSettings(), api.getCharacterKey(), postId);
            if (!post) return;
            api.saveSettings();
            photoPaths([post]).forEach(forgetPhoto);
            const onItsPage = openPostId === postId;
            if (onItsPage) openPostId = null;
            render(onItsPage ? {} : { keepScroll: true });
        }

        function onClick(e) {
            const el = e.target.closest('[data-social-action]');
            if (!el || !(root?.contains(el) || modal?.contains(el))) return;
            e.stopPropagation();
            const action = el.getAttribute('data-social-action');
            if (action === 'compose') openCompose();
            else if (action === 'compose-close') closeCompose();
            else if (action === 'compose-count') {
                if (compose && !compose.controller) {
                    keepOutlines();
                    compose.count = Math.max(1, Math.min(MAX_NEW_POSTS, Number(el.getAttribute('data-count')) || 1));
                    render({ keepScroll: true });
                }
            } else if (action === 'compose-mode') {
                if (compose && !compose.controller) {
                    keepOutlines();
                    compose.mode = el.getAttribute('data-mode') === 'scripted' ? 'scripted' : 'freestyle';
                    render({ keepScroll: true });
                }
            } else if (action === 'compose-go') generate();
            else if (action === 'compose-cancel') cancelGenerate();
            else if (action === 'compose-backdrop') {
                if (e.target === el) closeCompose();
            } else if (action === 'edit') openEdit();
            else if (action === 'archives') api.openArchives();
            else if (action === 'edit-close') {
                if (!edit?.saving) closeEdit();
            } else if (action === 'edit-save') saveEdit();
            else if (action === 'edit-avatar' || action === 'edit-banner') {
                if (!edit?.saving) pickImage(action.slice(5));
            } else if (action === 'edit-avatar-drop' || action === 'edit-banner-drop') {
                if (!edit?.saving) dropImage(action.slice(5, -5));
            } else if (action === 'edit-backdrop') {
                if (e.target === el && !edit?.saving) closeEdit();
            } else if (action === 'back') {
                if (openPostId) {
                    openPostId = null;
                    render();
                } else close();
            } else if (action === 'photo-toggle') {
                el.setAttribute('aria-expanded', String(el.getAttribute('aria-expanded') !== 'true'));
            } else if (action === 'post-menu') togglePostMenu(el);
            else if (action === 'post-pin') pinPost(el.getAttribute('data-post-id'), el.getAttribute('data-pinned') !== 'true');
            else if (action === 'post-keep') keepPost(el.getAttribute('data-post-id'), el.getAttribute('data-kept') !== 'true');
            else if (action === 'post-delete') removePost(el);
            else if (action === 'post-edit') openPostEdit(el.getAttribute('data-post-id'));
            else if (action === 'post-edit-close') closePostEdit();
            else if (action === 'post-edit-save') savePostEdit();
            else if (action === 'post-edit-photo') pickPostPhoto(el.getAttribute('data-slot'));
            else if (action === 'post-edit-photo-drop') dropPostPhoto(el.getAttribute('data-slot'));
            else if (action === 'post-edit-backdrop') {
                if (e.target === el) closePostEdit();
            }
            else if (action === 'photo-add') addPhoto(el.getAttribute('data-post-id'));
            else if (action === 'photo-drop') dropPhoto(el.getAttribute('data-post-id'));
            else if (action === 'open-post') {
                openPostId = el.getAttribute('data-post-id');
                render();
            }
        }

        function open() {
            const container = api.getContainer();
            if (!container || !api.getCharacterKey()) return;
            close();
            openPostId = null;
            root = document.createElement('div');
            root.className = 'et-social';
            root.addEventListener('click', onClick);
            container.appendChild(root);
            document.addEventListener('keydown', onKeydown, true);
            document.addEventListener('click', onDocumentClick, true);
            render();
        }

        function close() {
            if (root) root.remove();
            if (modal) modal.remove();
            document.removeEventListener('keydown', onKeydown, true);
            document.removeEventListener('click', onDocumentClick, true);
            compose?.controller?.abort();
            dropPickedPhotos();
            postEdit = null;
            root = null;
            modal = null;
            edit = null;
            compose = null;
            openPostId = null;
        }

        return { open, close, render, isOpen: () => !!root };
    }

    window.EchoTextSocial = {
        DEFAULT_THEME,
        MAX_REPLIES,
        getAccount,
        getPosts,
        setAccountProfile,
        setPostPhoto,
        setPostPinned,
        setPostKept,
        editPostContent,
        editRepostContent,
        photoPaths,
        pinNewestKept,
        deletePost,
        restoreChatPosts,
        createArchiveSource,
        mentionsHtml,
        photoUrl,
        cleanHandle,
        cleanCount,
        normalizePost,
        handleFrom,
        MAX_NEW_POSTS,
        SYSTEM_PROMPT,
        buildPostsRequest,
        parsePosts,
        parseOutlinedPosts,
        parseCount,
        parseAgo,
        addChatPosts,
        timeAgo,
        fullTime,
        shortCount,
        createSocialView,
    };
})();
