(function () {
    'use strict';

    /**
     * X (Twitter), dark. The profile header and tabs follow the v0 template "X (Twitter)
     * Profile Page Clone" (components/profile-main.tsx, its phone sizes); posts, a post's
     * page and its replies follow vertsan/x-clone-ui-freeapi (Post.tsx, Comments.tsx,
     * PostInteractions.tsx), with its icons, which are X's own. Templates only: lib/social.js
     * builds the view and handles data-social-action.
     */

    const ICONS = {
        pencil: 'M14.06 3.94a2.5 2.5 0 0 1 3.54 0l2.46 2.46a2.5 2.5 0 0 1 0 3.54L9.41 20.59 3 21l.41-6.41L14.06 3.94zm2.12 1.42a.5.5 0 0 0-.7 0L13.6 7.24l3.16 3.16 1.88-1.88a.5.5 0 0 0 0-.7l-2.46-2.46zm-.84 6.46l-3.16-3.16-6.8 6.8-.24 3.4 3.4-.24 6.8-6.8z',
        layers: 'M12 2L1.5 8 12 14l10.5-6L12 2zM12 4.3L18.5 8 12 11.7 5.5 8 12 4.3zM3.2 11.9L1.5 13 12 19l10.5-6-1.7-1.1-8.8 4.8-8.8-4.8z',
        posts: 'M5.5 3h13A2.5 2.5 0 0 1 21 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5v-13A2.5 2.5 0 0 1 5.5 3zm0 2a.5.5 0 0 0-.5.5v13a.5.5 0 0 0 .5.5h13a.5.5 0 0 0 .5-.5v-13a.5.5 0 0 0-.5-.5h-13zM8 9h8v2H8V9zm0 4h5v2H8v-2z',
        chevron: 'M3.543 8.96l1.414-1.42L12 14.59l7.043-7.05 1.414 1.42L12 17.41 3.543 8.96z',
        bookmark: 'M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5zM6.5 4c-.276 0-.5.22-.5.5v14.56l6-4.29 6 4.29V4.5c0-.28-.224-.5-.5-.5h-11z',
        back: 'M7.414 13l5.043 5.04-1.414 1.42L3.586 12l7.457-7.46 1.414 1.42L7.414 11H21v2H7.414z',
        reply: 'M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z',
        repost: 'M4.75 3.79l4.603 4.3-1.706 1.82L6 8.38v7.37c0 .97.784 1.75 1.75 1.75H13V20H7.75c-2.347 0-4.25-1.9-4.25-4.25V8.38L1.853 9.91.147 8.09l4.603-4.3zm11.5 2.71H11V4h5.25c2.347 0 4.25 1.9 4.25 4.25v7.37l1.647-1.53 1.706 1.82-4.603 4.3-4.603-4.3 1.706-1.82L18 15.62V8.25c0-.97-.784-1.75-1.75-1.75z',
        like: 'M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91zm4.187 7.69c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z',
        views: 'M8.75 21V3h2v18h-2zM18 21V8.5h2V21h-2zM4 21l.004-10h2L6 21H4zm9.248 0v-7h2v7h-2z',
        bookmark: 'M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5zM6.5 4c-.276 0-.5.22-.5.5v14.56l6-4.29 6 4.29V4.5c0-.28-.224-.5-.5-.5h-11z',
        share: 'M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.3 3.3-1.41-1.42L12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z',
        retry: 'M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z',
        pin: 'M7 4.5C7 3.12 8.12 2 9.5 2h5C15.88 2 17 3.12 17 4.5v5.26L20.12 16H13v5l-1 2-1-2v-5H3.88L7 9.76V4.5z',
        // X's own ⋯ and delete
        more: 'M3 12c0-1.1.9-2 2-2s2 .9 2 2-.9 2-2 2-2-.9-2-2zm9 2c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm7 0c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z',
        trash: 'M16 6V4.5C16 3.12 14.88 2 13.5 2h-3C9.11 2 8 3.12 8 4.5V6H3v2h1.06l.81 11.21C4.98 20.78 6.28 22 7.86 22h8.27c1.58 0 2.88-1.22 3-2.79L19.93 8H21V6h-5zm-6-1.5c0-.28.22-.5.5-.5h3c.28 0 .5.22.5.5V6h-4V4.5zm7.13 14.57c-.04.52-.47.93-1 .93H7.86c-.53 0-.96-.41-1-.93L6.07 8h11.85l-.79 11.07zM9 17v-6h2v6H9zm4 0v-6h2v6h-2z',
        // X's own "post" (vertsan's icons/post.svg) and close
        compose: 'M23 3c-6.62-.1-10.38 2.421-13.05 6.03C7.29 12.61 6 17.331 6 22h2c0-1.007.07-2.012.19-3H12c4.1 0 7.48-3.082 7.94-7.054C22.79 10.147 23.17 6.359 23 3zm-7 8h-1.5v2H16c.63-.016 1.2-.08 1.72-.188C16.95 15.24 14.68 17 12 17H8.55c.57-2.512 1.57-4.851 3-6.78 2.16-2.912 5.29-4.911 9.45-5.187C20.95 8.079 19.9 11 16 11zM4 9V6H1V4h3V1h2v3h3v2H6v3H4z',
        close: 'M10.59 12L4.54 5.96l1.42-1.42L12 10.59l6.04-6.05 1.42 1.42L13.41 12l6.05 6.04-1.42 1.42L12 13.41l-6.04 6.05-1.42-1.42L10.59 12z',
        image: 'M3 5.5C3 4.119 4.119 3 5.5 3h13C19.881 3 21 4.119 21 5.5v13c0 1.381-1.119 2.5-2.5 2.5h-13C4.119 21 3 19.881 3 18.5v-13zM5.5 5c-.276 0-.5.224-.5.5v9.086l3-3 3 3 5-5 3 3V5.5c0-.276-.224-.5-.5-.5h-13zM19 15.414l-3-3-5 5-3-3-3 3V18.5c0 .276.224.5.5.5h13c.276 0 .5-.224.5-.5v-3.086zM9.75 7C8.784 7 8 7.784 8 8.75s.784 1.75 1.75 1.75 1.75-.784 1.75-1.75S10.716 7 9.75 7z',
    };

    function icon(name, cls = '') {
        return `<svg class="x-icon ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;
    }

    function avatar(url, fallback, cls, ctx) {
        return url
            ? `<img class="${cls}" src="${ctx.esc(url)}" alt="">`
            : `<span class="${cls} x-avatar-fallback" style="background:${fallback.color}">${ctx.esc(fallback.initial)}</span>`;
    }

    function topBar(title, subtitle, ctx) {
        return `<div class="x-topbar" data-et-drag>
            <button class="x-topbar-back" type="button" data-social-action="back" aria-label="Back">${icon('back')}</button>
            <div class="x-topbar-title">
                <span class="x-topbar-name">${ctx.esc(title)}</span>
                ${subtitle ? `<span class="x-topbar-sub">${ctx.esc(subtitle)}</span>` : ''}
            </div>
        </div>`;
    }

    function action(name, value, cls) {
        return `<span class="x-action x-action-${cls}"><span class="x-action-icon">${icon(name)}</span>${value ? `<span class="x-action-count">${value}</span>` : ''}</span>`;
    }

    function actions(counts) {
        return `<div class="x-actions">
            <div class="x-actions-main">
                ${action('reply', counts.replies, 'reply')}
                ${action('repost', counts.reposts, 'repost')}
                ${action('like', counts.likes, 'like')}
                ${action('views', counts.views, 'views')}
            </div>
            <div class="x-actions-side">
                ${action('bookmark', '', 'bookmark')}
                ${action('share', '', 'share')}
            </div>
        </div>`;
    }

    /** A photo as a photo bubble is: a blank frame or the real image; a tap shows the words and its image buttons. */
    function media(post, ctx, { tools = true } = {}) {
        if (!post.image && !post.photo) return '';
        const photo = post.photo;
        const id = ctx.esc(post.id);
        return `<div class="x-media" role="button" tabindex="0" aria-expanded="false" data-social-action="photo-toggle"${photo ? ` style="aspect-ratio:${photo.ratio}"` : ''}>
            ${photo ? `<img class="x-media-img" src="${ctx.esc(photo.url)}" alt="" draggable="false" onerror="this.remove()">` : ''}
            ${icon('image', 'x-media-icon')}
            <div class="x-media-text"><span>${ctx.esc(post.image)}</span></div>
            ${tools ? `<div class="x-media-tools">
                <button class="x-media-btn" type="button" data-social-action="photo-add" data-post-id="${id}" aria-label="${photo ? 'Change photo' : 'Add photo'}">${icon('image')}</button>
                ${photo ? `<button class="x-media-btn x-media-drop" type="button" data-social-action="photo-drop" data-post-id="${id}" aria-label="Remove photo">×</button>` : ''}
            </div>` : ''}
        </div>`;
    }

    /** The post a post reposts, in a box of its own under the post's words. */
    function repostCard(repost, ctx) {
        if (!repost) return '';
        return `<div class="x-quote">
            <div class="x-quote-head">
                ${avatar('', repost.avatar, 'x-quote-avatar', ctx)}
                <span class="x-post-name">${ctx.esc(repost.name)}</span>
                <span class="x-post-meta">@${ctx.esc(repost.handle)}</span>
            </div>
            ${repost.text ? `<div class="x-quote-text">${ctx.mentions(repost.text, 'x-link')}</div>` : ''}
            ${media(repost, ctx, { tools: false })}
        </div>`;
    }

    /** "m. reposted", over a post with no words of its own. */
    function repostedLine(post, account, ctx) {
        return post.repost && !post.text ? `<div class="x-post-pinned x-post-reposted">${icon('repost')}<span>${ctx.esc(account.name)} reposted</span></div>` : '';
    }

    /** A post's ⋯: edit, retry, pin, keep or delete it, the menu scrolling with the post; only Stop while it's retried. */
    function postMenu(post, ctx) {
        const id = ctx.esc(post.id);
        if (post.retrying) {
            return `<div class="x-more" data-social-menu>
            <button class="x-more-btn" type="button" data-social-action="post-menu" aria-label="More">${icon('more')}</button>
            <div class="x-more-list" data-social-action="post-menu-list">
                <button class="x-more-item" type="button" data-social-action="post-retry-stop" data-post-id="${id}">${icon('close')}<span>Stop</span></button>
            </div>
        </div>`;
        }
        return `<div class="x-more" data-social-menu>
            <button class="x-more-btn" type="button" data-social-action="post-menu" aria-label="More">${icon('more')}</button>
            <div class="x-more-list" data-social-action="post-menu-list">
                <button class="x-more-item" type="button" data-social-action="post-edit" data-post-id="${id}">${icon('pencil')}<span>Edit</span></button>
                <button class="x-more-item" type="button" data-social-action="post-retry" data-post-id="${id}">${icon('retry')}<span>Retry</span></button>
                <button class="x-more-item" type="button" data-social-action="post-pin" data-post-id="${id}" data-pinned="${post.pinned ? 'true' : 'false'}">${icon('pin')}<span>${post.pinned ? 'Unpin from profile' : 'Pin to your profile'}</span></button>
                <button class="x-more-item" type="button" data-social-action="post-keep" data-post-id="${id}" data-kept="${post.kept ? 'true' : 'false'}">${icon('layers')}<span>${post.kept ? 'Only in this chat' : 'Keep in all chats'}</span></button>
                <button class="x-more-item x-more-delete" type="button" data-social-action="post-delete" data-post-id="${id}" data-label="Delete" data-confirm="Tap Again to Confirm">${icon('trash')}<span>Delete</span></button>
            </div>
        </div>`;
    }

    /** A post in the list (vertsan's Post): the avatar beside it, the name, handle and time on one line. */
    function postCard(post, account, ctx) {
        return `<article class="x-post" data-social-action="open-post" data-post-id="${ctx.esc(post.id)}"${post.retrying ? ' data-retrying' : ''}>
            ${post.pinned ? `<div class="x-post-pinned">${icon('pin')}<span>Pinned</span></div>` : ''}
            ${repostedLine(post, account, ctx)}
            <div class="x-post-row">
                ${avatar(account.avatarUrl, account.avatarFallback, 'x-post-avatar', ctx)}
                <div class="x-post-body">
                    <div class="x-post-head">
                        <span class="x-post-name">${ctx.esc(account.name)}</span>
                        <span class="x-post-meta">@${ctx.esc(account.handle)} · ${ctx.esc(post.time)}</span>
                        ${postMenu(post, ctx)}
                    </div>
                    <div class="x-post-text">${ctx.mentions(post.text, 'x-link')}</div>
                    ${media(post, ctx)}
                    ${repostCard(post.repost, ctx)}
                    ${actions(post.counts)}
                </div>
            </div>
        </article>`;
    }

    /** A reply under a post (vertsan's Post type="comment"). */
    function replyCard(reply, ctx) {
        return `<article class="x-post x-reply">
            <div class="x-post-row">
                ${avatar('', reply.avatar, 'x-post-avatar', ctx)}
                <div class="x-post-body">
                    <div class="x-post-head">
                        <span class="x-post-name">${ctx.esc(reply.name)}</span>
                        <span class="x-post-meta">@${ctx.esc(reply.handle)} · ${ctx.esc(reply.time)}</span>
                    </div>
                    <div class="x-reply-to">Replying to <span class="x-link">@${ctx.esc(reply.replyingTo)}</span></div>
                    <div class="x-post-text">${ctx.mentions(reply.text, 'x-link')}</div>
                    ${actions({ replies: '', reposts: '', likes: reply.likes, views: '' })}
                </div>
            </div>
        </article>`;
    }

    // As X's app has them: the open one's name beside its icon, the others only their icons
    const TABS = [['Posts', 'posts'], ['Replies', 'reply'], ['Reposts', 'repost'], ['Likes', 'like']];

    function profile(view, ctx) {
        const a = view.account;
        const posts = view.posts.length
            ? view.posts.map(post => postCard(post, a, ctx)).join('')
            : `<div class="x-empty"><div class="x-empty-title">@${ctx.esc(a.handle)} hasn’t posted</div><div class="x-empty-text">When they do, their posts will show up here.</div></div>`;
        return `<div class="x-page">${topBar(a.name, a.postCount, ctx)}
        <div class="x-banner">
            ${a.bannerUrl ? `<img src="${ctx.esc(a.bannerUrl)}" alt="">` : ''}
            <button class="x-banner-more" type="button" data-social-action="edit" aria-label="More">${icon('more')}</button>
        </div>
        <div class="x-profile">
            <div class="x-profile-top">
                ${avatar(a.avatarUrl, a.avatarFallback, 'x-profile-avatar', ctx)}
                <button class="x-archive-btn" type="button" data-social-action="archives" aria-label="Archives" title="Archives">${icon('bookmark')}</button>
            </div>
            <div class="x-profile-name">${ctx.esc(a.name)}</div>
            <div class="x-profile-handle">@${ctx.esc(a.handle)}</div>
            ${a.bio ? `<div class="x-profile-bio">${ctx.mentions(a.bio, 'x-link')}</div>` : ''}
            <div class="x-profile-follows">
                <span><b>${a.following}</b> Following</span>
                <span><b>${a.followers}</b> Followers</span>
            </div>
        </div>
        <div class="x-tabs">${TABS.map(([tab, name], i) => `<span class="x-tab${i === 0 ? ' x-tab-active' : ''}" aria-label="${tab}"><span>${icon(name)}${i === 0 ? `${tab}${icon('chevron', 'x-tab-chevron')}` : ''}</span></span>`).join('')}</div>
        <div class="x-feed">${posts}</div>
        <div class="x-fab-row"><button class="x-fab" type="button" data-social-action="compose" aria-label="New posts">${icon('compose')}</button></div>
        </div>`;
    }

    /** One scripted post: what the user fixes, the model writing only its words and replies. */
    function outlineCard(outline, i, c, ctx) {
        const opts = { disabled: c.generating };
        const name = key => `outline-${i}-${key}`;
        const check = (label, key, on, cls = '') => `<label class="x-field x-field-check ${cls}">
                    <span class="x-field-label">${label}</span>
                    <input type="checkbox" data-social-field="${name(key)}"${on ? ' checked' : ''}${c.generating ? ' disabled' : ''}>
                </label>`;
        // A plain repost has no words or photo of its own for the outline to set
        const plain = outline.repost && !outline.repostComment;
        return `<section class="x-outline">
            ${c.count > 1 ? `<div class="x-outline-title">Post ${i + 1}</div>` : ''}
            ${plain ? '' : field('Topic', name('topic'), outline.topic, ctx, { ...opts, area: true, rows: 2 })}
            <div class="x-outline-row x-outline-when">
                ${field('Time', name('time'), outline.time, ctx, { ...opts, type: 'datetime-local', latest: c.latestTime })}
                ${plain ? '' : check('Photo', 'photo', outline.photo)}
            </div>
            ${check('Repost', 'repost', outline.repost, 'x-field-check-wide')}
            ${outline.repost ? `${field('Repost topic', name('repostTopic'), outline.repostTopic, ctx, { ...opts, area: true, rows: 2 })}
            <div class="x-outline-row x-outline-repost">
                ${check('Text', 'repostText', outline.repostText)}
                ${check('Photo', 'repostPhoto', outline.repostPhoto)}
                ${check('Comment', 'repostComment', outline.repostComment)}
            </div>` : ''}
            <div class="x-outline-row x-outline-numbers">
                ${field('Likes', name('likes'), outline.likes, ctx, { ...opts, numeric: true })}
                ${field('Reposts', name('reposts'), outline.reposts, ctx, { ...opts, numeric: true })}
                ${field('Views', name('views'), outline.views, ctx, { ...opts, numeric: true })}
            </div>
            <div class="x-outline-row x-outline-replies">
                ${field('Replies', name('replies'), outline.replies, ctx, { ...opts, numeric: true })}
                ${field('Reply style', name('replyStyle'), outline.replyStyle, ctx, opts)}
            </div>
        </section>`;
    }

    /** New posts (vertsan's compose modal): freestyle or scripted, how many, then Generate; while it writes, Cancel. */
    function compose(view, ctx) {
        const a = view.account;
        const c = view.compose;
        const counts = Array.from({ length: c.max }, (_, i) => i + 1).map(n =>
            `<button class="x-count${n === c.count ? ' x-count-on' : ''}" type="button" data-social-action="compose-count" data-count="${n}"${c.generating ? ' disabled' : ''}>${n}</button>`).join('');
        return `<div class="x-compose-backdrop" data-social-action="compose-backdrop">
            <div class="x-compose" role="dialog" aria-label="New posts">
                <div class="x-compose-top" data-et-drag>
                    <button class="x-compose-close" type="button" data-social-action="compose-close" aria-label="Close">${icon('close')}</button>
                </div>
                <div class="x-compose-center">
                    ${avatar(a.avatarUrl, a.avatarFallback, 'x-post-avatar', ctx)}
                    ${c.generating
                        ? '<div class="x-compose-what">Generating...</div>'
                        : c.fromChat
                        ? `<div class="x-compose-what">From ${c.fromChat} ${c.fromChat === 1 ? 'message' : 'messages'}</div>`
                        : `<div class="x-modes">${[['freestyle', 'Freestyle'], ['scripted', 'Scripted']].map(([id, label]) =>
                            `<button class="x-mode${c.mode === id ? ' x-mode-on' : ''}" type="button" data-social-action="compose-mode" data-mode="${id}">${label}</button>`).join('')}</div>`}
                </div>
                ${c.mode === 'scripted' && !c.fromChat ? `<div class="x-compose-body" data-social-scroll>${c.outlines.map((outline, i) => outlineCard(outline, i, c, ctx)).join('')}</div>` : ''}
                ${c.error ? `<p class="x-edit-error">${ctx.esc(c.error)}</p>` : ''}
                <div class="x-compose-bottom">
                    <div class="x-counts">${counts}</div>
                    ${c.generating
                        ? '<button class="x-compose-cancel" type="button" data-social-action="compose-cancel">Cancel</button>'
                        : '<button class="x-compose-go" type="button" data-social-action="compose-go">Generate</button>'}
                </div>
            </div>
        </div>`;
    }

    /** A post's page (vertsan's status page): the post large, its time in full, then its replies. */
    function detail(view, ctx) {
        const a = view.account;
        const post = view.post;
        return `${topBar('Post', '', ctx)}
        <article class="x-status"${post.retrying ? ' data-retrying' : ''}>
            ${repostedLine(post, a, ctx)}
            <div class="x-status-author">
                ${avatar(a.avatarUrl, a.avatarFallback, 'x-post-avatar', ctx)}
                <div class="x-status-names">
                    <span class="x-post-name">${ctx.esc(a.name)}</span>
                    <span class="x-status-handle">@${ctx.esc(a.handle)}</span>
                </div>
                ${postMenu(post, ctx)}
            </div>
            <div class="x-status-text">${ctx.mentions(post.text, 'x-link')}</div>
            ${media(post, ctx)}
            ${repostCard(post.repost, ctx)}
            <div class="x-status-time">${ctx.esc(post.fullTime)}</div>
            ${actions(post.counts)}
        </article>
        <div class="x-replies">${post.replies.map(reply => replyCard(reply, ctx)).join('')}</div>`;
    }

    function field(label, name, value, ctx, { max = 0, area = false, rows = 3, numeric = false, prefix = '', type = 'text', latest = '', disabled = false, placeholder = '' } = {}) {
        const attrs = `data-social-field="${name}"${max ? ` maxlength="${max}"` : ''}${numeric ? ' inputmode="numeric"' : ''}${latest ? ` max="${latest}"` : ''}${placeholder ? ` placeholder="${ctx.esc(placeholder)}"` : ''}${disabled ? ' disabled' : ''} autocomplete="off" spellcheck="false"`;
        const input = area
            ? `<textarea class="x-field-input" rows="${rows}" ${attrs}>${ctx.esc(value)}</textarea>`
            : `<span class="x-field-row">${prefix ? `<span class="x-field-prefix">${prefix}</span>` : ''}<input class="x-field-input" type="${type}" value="${ctx.esc(value)}" ${attrs}></span>`;
        return `<label class="x-field">
            <span class="x-field-label">${label}</span>
            ${input}
            ${max && name !== 'handle' ? `<span class="x-field-count"><span data-social-count="${name}">${String(value).length}</span>/${max}</span>` : ''}
        </label>`;
    }

    /** Edit post, in Edit profile's dialog: the post's image, then its words. */
    function editPost(view, ctx) {
        const e = view.editPost;
        const photoSlot = (photo, slot) => `<div class="x-edit-post-photo"${photo ? ` style="aspect-ratio:${photo.ratio}"` : ''}>
                        ${photo ? `<img src="${ctx.esc(photo.url)}" alt="" draggable="false">` : ''}
                        <div class="x-edit-image-veil">
                            <button class="x-edit-image-btn" type="button" data-social-action="post-edit-photo" data-slot="${slot}" aria-label="${photo ? 'Change photo' : 'Add photo'}">${icon('image')}</button>
                            ${photo ? `<button class="x-edit-image-btn x-edit-image-drop" type="button" data-social-action="post-edit-photo-drop" data-slot="${slot}" aria-label="Remove photo">×</button>` : ''}
                        </div>
                    </div>`;
        return `<div class="x-modal-backdrop" data-social-action="post-edit-backdrop">
            <div class="x-modal x-edit-post" role="dialog" aria-label="Edit post">
                <header class="x-modal-head" data-et-drag>
                    <div class="x-modal-title">
                        <button class="x-topbar-back" type="button" data-social-action="post-edit-close" aria-label="Close">${icon('back')}</button>
                        <span>Edit post</span>
                    </div>
                    <button class="x-save-btn" type="button" data-social-action="post-edit-save">Save</button>
                </header>
                <div class="x-modal-body">
                    ${photoSlot(e.photo, 'photo')}
                    <div class="x-edit-fields">
                        ${e.error ? `<p class="x-edit-error">${ctx.esc(e.error)}</p>` : ''}
                        ${field('Text', 'text', e.text, ctx, { area: true, rows: 5 })}
                        ${field('Photo description', 'image', e.image, ctx, { area: true })}
                        <div class="x-outline-row x-edit-when">
                            ${field('Time', 'time', e.time, ctx, { type: 'datetime-local', latest: e.latest })}
                            ${field('Replies', 'replyCount', e.replyCount, ctx, { numeric: true })}
                        </div>
                        <div class="x-outline-row x-outline-numbers">
                            ${field('Likes', 'likes', e.likes, ctx, { numeric: true })}
                            ${field('Reposts', 'reposts', e.reposts, ctx, { numeric: true })}
                            ${field('Views', 'views', e.views, ctx, { numeric: true })}
                        </div>
                        ${e.repost ? `<div class="x-outline-title x-edit-section">Repost</div>
                        ${photoSlot(e.repost.photo, 'repostPhoto')}
                        ${field('Name', 'repostName', e.repost.name, ctx)}
                        ${field('Username', 'repostHandle', e.repost.handle, ctx, { prefix: '@' })}
                        ${field('Text', 'repostText', e.repost.text, ctx, { area: true })}
                        ${field('Photo description', 'repostImage', e.repost.image, ctx, { area: true })}` : ''}
                        ${e.replies.length ? '<div class="x-outline-title x-edit-section">Replies</div>' : ''}
                        ${e.replies.map(reply => `<section class="x-outline">
                            ${field('Text', `reply-${reply.i}`, reply.text, ctx, { area: true, rows: 2 })}
                            <div class="x-outline-row x-edit-two">
                                ${field('Name', `replyName-${reply.i}`, reply.name, ctx)}
                                ${field('Username', `replyHandle-${reply.i}`, reply.handle, ctx, { prefix: '@' })}
                            </div>
                            <div class="x-outline-row x-edit-when">
                                ${field('Time', `replyTime-${reply.i}`, reply.time, ctx, { type: 'datetime-local', latest: e.latest })}
                                ${field('Likes', `replyLikes-${reply.i}`, reply.likes, ctx, { numeric: true })}
                            </div>
                        </section>`).join('')}
                    </div>
                </div>
            </div>
        </div>`;
    }

    /** Edit profile (vertsan's EditProfileModal): banner and avatar to change, then the fields. */
    function editProfile(view, ctx) {
        const e = view.edit;
        const imageButton = (action, label) => `<button class="x-edit-image-btn" type="button" data-social-action="${action}" aria-label="${label}">${icon('image')}</button>`;
        const dropButton = (action, label) => `<button class="x-edit-image-btn x-edit-image-drop" type="button" data-social-action="${action}" aria-label="${label}">×</button>`;
        return `<div class="x-modal-backdrop" data-social-action="edit-backdrop">
            <div class="x-modal" role="dialog" aria-label="Edit profile">
                <header class="x-modal-head" data-et-drag>
                    <div class="x-modal-title">
                        <button class="x-topbar-back" type="button" data-social-action="edit-close" aria-label="Close">${icon('back')}</button>
                        <span>Edit profile</span>
                    </div>
                    <button class="x-save-btn" type="button" data-social-action="edit-save"${e.saving ? ' disabled' : ''}>${e.saving ? 'Saving...' : 'Save'}</button>
                </header>
                <div class="x-modal-body">
                    <div class="x-edit-images">
                        <div class="x-edit-banner">
                            ${e.bannerUrl ? `<img src="${ctx.esc(e.bannerUrl)}" alt="">` : ''}
                            <div class="x-edit-image-veil">
                                ${imageButton('edit-banner', 'Change banner')}
                                ${e.bannerUrl ? dropButton('edit-banner-drop', 'Remove banner') : ''}
                            </div>
                        </div>
                        <div class="x-edit-avatar">
                            ${avatar(e.avatarUrl, e.avatarFallback, 'x-edit-avatar-img', ctx)}
                            <div class="x-edit-image-veil">
                                ${imageButton('edit-avatar', 'Change avatar')}
                                ${e.ownAvatar ? dropButton('edit-avatar-drop', 'Use Echogram avatar') : ''}
                            </div>
                        </div>
                    </div>
                    <div class="x-edit-fields">
                        ${e.error ? `<p class="x-edit-error">${ctx.esc(e.error)}</p>` : ''}
                        ${field('Name', 'name', e.name, ctx, { max: e.maxName })}
                        ${field('Username', 'handle', e.handle, ctx, { max: e.maxHandle, prefix: '@' })}
                        ${field('Bio', 'bio', e.bio, ctx, { max: e.maxBio, area: true })}
                        ${field('Followers', 'followers', e.followers, ctx, { numeric: true })}
                        ${field('Following', 'following', e.following, ctx, { numeric: true })}
                        ${field('Posting style', 'postingStyle', e.postingStyle, ctx, { area: true, placeholder: 'e.g. posts in English, deadpan, mostly about work' })}
                    </div>
                </div>
            </div>
        </div>`;
    }

    window.EchoTextSocialThemes = window.EchoTextSocialThemes || {};
    window.EchoTextSocialThemes.x = {
        id: 'x',
        label: 'X',
        // How people talk here, for the system prompt
        culture: 'On X everyone talks sharp and shows no mercy. Politics comes up constantly. Personal attacks, abuse and extreme opinions are normal there, in posts and replies alike.',
        icon: 'fa-brands fa-x-twitter',
        stylesheet: 'theme.css',
        templates: { profile, detail, editProfile, editPost, compose },
    };
})();
