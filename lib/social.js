(function () {
    'use strict';

    /**
     * EchoText Social
     *
     * The character's anonymous social account (docs/platform-plan.md 17): their profile
     * and posts, watched from above. The user only looks: no liking, replying or following.
     *
     * Data, in the settings:
     *   socialAccounts[character] = { theme, name, handle, bio, banner, avatar, followers,
     *                                 following, posts }
     *       Set by the user, never by the model. `avatar` is an image only the account
     *       uses (none: the character's avatar in Echogram). `posts` are the pinned ones,
     *       which every chat with the character starts with, replies and all.
     *   socialPosts[character] = [post]
     *       The chat's own posts: kept, saved and cleared with the chat.
     *   post  = { id, at, text, image, likes, reposts, views, replyCount, replies }
     *       `at` a time in ms; `image` a description (shown as a photo card, like <photo>);
     *       `replyCount` what the post says it has, which can be far more than the
     *       replies there are (only the top MAX_REPLIES are kept).
     *   reply = { id, at, name, handle, text, likes }
     *
     * A theme (social/<id>/theme.js) is only templates and a stylesheet, as the chat's
     * looks are; this file draws them and handles their clicks (data-social-action).
     */

    const DEFAULT_THEME = 'x';
    // A post shows at most this many replies: the top ones, however many it has
    const MAX_REPLIES = 10;

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

    function normalizePost(post, i) {
        if (!isObject(post)) return null;
        const replies = (Array.isArray(post.replies) ? post.replies : []).map(normalizeReply).filter(Boolean).slice(0, MAX_REPLIES);
        return {
            id: text(post.id) || `p${i}`,
            at: Number(post.at) || 0,
            text: text(post.text),
            image: text(post.image),
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
            banner: text(stored.banner),
            avatar: text(stored.avatar),
            followers: count(stored.followers),
            following: count(stored.following),
        };
    }

    /** The pinned posts (the account's) and the chat's, newest first; pinned ones marked. */
    function getPosts(settings, key) {
        const pinned = Array.isArray(settings?.socialAccounts?.[key]?.posts) ? settings.socialAccounts[key].posts : [];
        const chat = Array.isArray(settings?.socialPosts?.[key]) ? settings.socialPosts[key] : [];
        return [
            ...pinned.map(normalizePost).filter(Boolean).map(post => ({ ...post, pinned: true })),
            ...chat.map(normalizePost).filter(Boolean).map(post => ({ ...post, pinned: false })),
        ].sort((a, b) => b.at - a.at);
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

    // ── The page ────────────────────────────────────────────────────────

    /**
     * The account's page over the chat panel. `api`:
     *   getSettings(), getCharacterKey(), getCharacterName(), getAvatarUrl() (Echogram's),
     *   getContainer() (the panel), stylesheetUrl(theme, file), now()
     */
    function createSocialView(api) {
        let root = null;
        let openPostId = null;

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
                document.head.appendChild(link);
            }
        }

        function postView(post, account, now) {
            return {
                id: post.id,
                text: post.text,
                image: post.image,
                pinned: post.pinned,
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
            const posts = getPosts(settings, key).map(post => postView(post, account, now));
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
                },
            };
        }

        function render() {
            if (!root) return;
            const { theme, view } = buildView();
            if (!theme) return;
            loadStylesheet(theme);
            const ctx = { esc: escapeHtml };
            root.setAttribute('data-social-theme', theme.id);
            if (openPostId && !view.post) openPostId = null;
            root.innerHTML = view.post ? theme.templates.detail(view, ctx) : theme.templates.profile(view, ctx);
            root.scrollTop = 0;
        }

        function onClick(e) {
            const el = e.target.closest('[data-social-action]');
            if (!el || !root.contains(el)) return;
            e.stopPropagation();
            const action = el.getAttribute('data-social-action');
            if (action === 'back') {
                if (openPostId) {
                    openPostId = null;
                    render();
                } else close();
            } else if (action === 'open-post') {
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
            render();
        }

        function close() {
            if (root) root.remove();
            root = null;
            openPostId = null;
        }

        return { open, close, render, isOpen: () => !!root };
    }

    window.EchoTextSocial = {
        DEFAULT_THEME,
        MAX_REPLIES,
        getAccount,
        getPosts,
        normalizePost,
        handleFrom,
        timeAgo,
        fullTime,
        shortCount,
        createSocialView,
    };
})();
