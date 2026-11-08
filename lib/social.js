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
     * Keeps what the user set on the profile, the theme and pinned posts as they were.
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
     *   getSettings(), saveSettings(), getCharacterKey(), getCharacterName(),
     *   getAvatarUrl() (Echogram's), getContainer() (the panel), stylesheetUrl(theme, file), now(),
     *   pickImage(kind) → a cropped image's data URL or null ('avatar' square, 'banner' 3:1;
     *       called within the tap, so a file dialog can open),
     *   uploadImage(dataUrl, kind) → its path in the user's images, deleteImage(path)
     */
    function createSocialView(api) {
        let root = null;
        let openPostId = null;
        // Edit profile, while it's open: the fields as typed, and the avatar and banner
        // (undefined: as they were; null: taken off; a data URL: a new one, uploaded on Save)
        let modal = null;
        let edit = null;

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
                    edit: edit ? editView(account) : null,
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
            const ctx = { esc: escapeHtml };
            root.setAttribute('data-social-theme', theme.id);
            if (openPostId && !view.post) openPostId = null;
            const scroll = root.scrollTop;
            root.innerHTML = view.post ? theme.templates.detail(view, ctx) : theme.templates.profile(view, ctx);
            root.scrollTop = keepScroll ? scroll : 0;
            if (view.edit) {
                if (!modal) {
                    modal = document.createElement('div');
                    modal.className = 'et-social-modal';
                    modal.addEventListener('click', onClick);
                    modal.addEventListener('input', onInput);
                    root.after(modal);
                }
                modal.setAttribute('data-social-theme', theme.id);
                modal.innerHTML = theme.templates.editProfile(view, ctx);
            } else if (modal) {
                modal.remove();
                modal = null;
            }
        }

        /** What's typed in the dialog now. */
        function readFields() {
            const fields = {};
            for (const el of modal.querySelectorAll('[data-social-field]')) fields[el.getAttribute('data-social-field')] = el.value;
            return fields;
        }

        // The counters under Name and Bio
        function onInput(e) {
            const field = e.target.getAttribute?.('data-social-field');
            const counter = field && modal.querySelector(`[data-social-count="${field}"]`);
            if (counter) counter.textContent = String(e.target.value.length);
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
            if (e.key === 'Escape' && edit && !edit.saving) {
                e.stopPropagation();
                closeEdit();
            }
        }

        function onClick(e) {
            const el = e.target.closest('[data-social-action]');
            if (!el || !(root?.contains(el) || modal?.contains(el))) return;
            e.stopPropagation();
            const action = el.getAttribute('data-social-action');
            if (action === 'edit') openEdit();
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
            document.addEventListener('keydown', onKeydown, true);
            render();
        }

        function close() {
            if (root) root.remove();
            if (modal) modal.remove();
            document.removeEventListener('keydown', onKeydown, true);
            root = null;
            modal = null;
            edit = null;
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
        cleanHandle,
        cleanCount,
        normalizePost,
        handleFrom,
        timeAgo,
        fullTime,
        shortCount,
        createSocialView,
    };
})();
