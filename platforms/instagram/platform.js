(function () {
    'use strict';

    /**
     * Instagram DMs, as a platform pack. The look is ported from
     * dhellebaut-cloud/fakechat-studio (src/platforms/Instagram.jsx: the purple-pink
     * sent gradient, #262626 received bubbles, 22px corners, the emoji reaction
     * pill, the typing bubble beside the avatar), with the light scheme and "Seen"
     * from MockSocial's InstagramSkin; see platform.css.
     *
     * A message's bubbles join the way Instagram stacks one sender's texts: the
     * corners between them go tight, the character's avatar sits by the last one.
     * Tapbacks show as emoji. Templates follow the contract in
     * platforms/echotext/platform.js: pure functions, clickable elements carry
     * data-et-action, looked-up elements carry data-et-role.
     */

    // The tapbacks as Instagram's emoji (ids from lib/features.js REACTIONS)
    const EMOJI = { heart: '❤️', haha: '😂', wow: '😮', sad: '😢', fire: '🔥', like: '👍', star: '⭐', bolt: '⚡' };

    const PHOTO_GLYPH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 14H5l4.5-6 3.5 4.5 2.5-3L19 18zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/></svg>';
    const PLAY_GLYPH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';

    const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    /** "9:41 PM" */
    function clock(date) {
        const h = date.getHours();
        return `${h % 12 || 12}:${String(date.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
    }

    /** Instagram's time divider: "9:41 PM", "Yesterday 9:41 PM", "Tue 9:41 PM", "Oct 8, 9:41 PM", "Oct 8, 2025, 9:41 PM". */
    function dividerTime(date) {
        const now = new Date();
        const dayStart = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        const days = Math.round((dayStart(now) - dayStart(date)) / 86400000);
        if (days === 0) return clock(date);
        if (days === 1) return `Yesterday ${clock(date)}`;
        if (days > 1 && days < 7) return `${WEEKDAYS[date.getDay()]} ${clock(date)}`;
        const day = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
        return date.getFullYear() === now.getFullYear() ? `${day}, ${clock(date)}` : `${day}, ${date.getFullYear()}, ${clock(date)}`;
    }

    function avatar(m, ctx) {
        const a = ctx.avatar(m);
        // A missing image goes, showing the initial underneath (as EchoText's own avatars do)
        const img = a.url ? `<img src="${a.url}" alt="" onerror="this.remove()">` : '';
        // The character's avatar opens EchoText's avatar menu (view / change); not in group chats
        const action = !ctx.groupChat ? ' data-et-action="avatar" role="button" tabindex="0" title="Avatar"' : '';
        return `<div class="ig-avatar" style="background:${a.color}"${action}><span>${ctx.escapeHtml(a.initial)}</span>${img}</div>`;
    }

    /** Bar heights (%) for a voice message's waveform, drawn from its words so each one looks its own (as the native look). */
    function waveBars(text, count = 22) {
        let h = 2166136261;
        for (const c of String(text)) h = Math.imul(h ^ c.codePointAt(0), 16777619);
        const bars = [];
        for (let i = 0; i < count; i++) {
            h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
            bars.push(25 + ((h >>> 0) % 76));
        }
        return bars;
    }

    /** A photo is a picture frame; tapping it shows the description inside the frame. */
    function photo(p, ctx) {
        return `<div class="ig-photo" role="button" tabindex="0" aria-expanded="false" title="Tap to view" data-et-action="photo-toggle">${PHOTO_GLYPH}<div class="ig-photo-caption" data-et-role="caption"><span>${ctx.escapeHtml(p.desc) || 'Photo'}</span></div></div>`;
    }

    /**
     * A voice message: play button, waveform and length (with a dot until the user
     * first opens one of the character's); tapping it shows the words underneath.
     */
    function voice(p, ctx) {
        const time = `${Math.floor(p.duration / 60)}:${String(p.duration % 60).padStart(2, '0')}`;
        const bars = waveBars(p.text).map(height => `<i style="height:${height}%"></i>`).join('');
        const dot = p.unread ? '<span class="ig-voice-unread" data-et-role="unread" title="Not played yet"></span>' : '';
        return `<div class="ig-bubble ig-voice" role="button" tabindex="0" aria-expanded="false" title="Tap to read" data-et-action="voice-toggle" data-voice="${p.voiceIndex}"><span class="ig-voice-play">${PLAY_GLYPH}</span><span class="ig-voice-wave" aria-hidden="true">${bars}</span><span class="ig-voice-time">${time}</span>${dot}</div><div class="ig-transcript" data-et-role="transcript">${ctx.formatText(p.text)}</div>`;
    }

    /** One bubble's content: text, a photo or a voice message. */
    function part(p, ctx) {
        if (p.type === 'photo') return photo(p, ctx);
        if (p.type === 'voice') return voice(p, ctx);
        if (p.type !== 'text') return '';
        return `<div class="ig-bubble"><div class="ig-text" data-et-role="text">${ctx.formatText(p.text)}</div></div>`;
    }

    /**
     * The message a bubble answers (<reply>), above it: who replied to whom, the way
     * Instagram labels it ("You replied to Mira", "Mira replied to you"), and the
     * original as a faded bubble.
     */
    function replyQuote(p, m, ctx) {
        if (!p.replyTo) return '';
        const { name, text } = p.replyTo;
        const self = name === m.senderName;
        const who = m.isUser ? 'You' : ctx.escapeHtml(m.senderName);
        // In a group chat the one quoted may be another member, so they're named
        const whom = self ? (m.isUser ? 'yourself' : 'themself') : m.isUser || ctx.groupChat ? ctx.escapeHtml(name) : 'you';
        const label = name ? `<div class="ig-quote-label">${who} replied to ${whom}</div>` : '';
        return `<div class="ig-quote">${label}<div class="ig-quote-text">${ctx.escapeHtml(text)}</div></div>`;
    }

    /** A bubble's tapback ids: the user's on a character bubble, the character's on the user's last. */
    function bubbleTapbacks(m, p, j) {
        if (!m.isUser) return p.tapbacks || [];
        return j === m.parts.length - 1 && m.charReaction ? [m.charReaction] : [];
    }

    /**
     * Tapbacks as Instagram's emoji pill, on the bubble's bottom edge. The user's on
     * a character bubble open the picker for that bubble; the character's on the
     * user's can't be tapped.
     */
    function reactions(ids, m, j, ctx) {
        const known = ids.filter(id => EMOJI[id]);
        if (!known.length) return '';
        const isNew = (ctx.arrivingTapbacks || []).includes(j) ? ' ig-reactions-new' : '';
        const label = known.map(id => ctx.reaction(id)?.label || id).join(', ');
        const action = m.isUser ? '' : ` data-et-action="react" data-index="${m.index}" data-part="${j}" role="button" tabindex="0"`;
        return `<div class="ig-reactions${isNew}" data-et-role="tapback" title="${label}"${action}>${known.map(id => `<span>${EMOJI[id]}</span>`).join('')}</div>`;
    }

    /**
     * A bubble's own controls, shown once it's hovered or tapped: "⋯" (the main
     * bubble's covers the whole message), and on the character's bubbles the
     * tapback button. EchoText's own buttons (style.css .et-bubble-tool).
     */
    function tools(m, j, main, ctx) {
        const menu = main
            ? `data-et-action="menu" data-index="${m.index}"`
            : `data-et-action="part-menu" data-index="${m.index}" data-part="${j}"`;
        const react = !m.isUser && ctx.has('react')
            ? `<button class="et-bubble-tool" data-et-action="react" data-index="${m.index}" data-part="${j}" title="React"><i class="fa-regular fa-face-smile"></i></button>`
            : '';
        return `<div class="ig-tools"><button class="et-bubble-tool" ${menu} data-is-user="${m.isUser ? 1 : 0}" title="More options"><i class="fa-solid fa-ellipsis-vertical"></i></button>${react}</div>`;
    }

    function imageAttachment(attachment) {
        if (!attachment || attachment.type !== 'image') return '';
        if (attachment.status === 'error') return `<div class="ig-placeholder">${attachment.error || 'Couldn\'t send the photo'}</div>`;
        if (attachment.status !== 'ready' || !attachment.url) return '<div class="ig-placeholder">Loading photo…</div>';
        return `<div class="ig-image" role="button" tabindex="0" data-et-action="image-open"><img src="${attachment.url}" alt=""></div>`;
    }

    /**
     * Where a bubble sits among its message's: single, first, middle or last (the
     * corners between them go tight). Messages in a row from one side join up in
     * platform.css.
     */
    function position(j, count) {
        const first = j === 0, last = j === count - 1;
        return first && last ? 'single' : first ? 'first' : last ? 'last' : 'middle';
    }

    /** One message, from its view-model entry: a row per bubble, the last one the message's main row. */
    function message(m, ctx) {
        const side = m.isUser ? 'me' : 'them';
        const time = new Date(m.timestamp || Date.now());
        const tip = clock(time);
        const last = m.parts.length - 1;
        // Group chats name each character above their message
        const sender = ctx.groupChat && !m.isUser ? `<div class="ig-sender">${ctx.sanitize(m.senderName)}</div>` : '';

        const rows = m.parts.map((p, j) => {
            const main = j === last;
            const ids = bubbleTapbacks(m, p, j);
            const reacted = ids.some(id => EMOJI[id]) ? ' ig-row-reacted' : '';
            const face = m.isUser ? '' : `<div class="ig-avatar-slot">${main ? avatar(m, ctx) : ''}</div>`;
            const kind = p.type === 'photo' ? ' ig-col-photo' : '';
            return `<div class="ig-row ig-row-${side}${reacted}" data-pos="${position(j, m.parts.length)}" data-et-role="bubble${main ? ' main' : ''}" title="${tip}">${face}<div class="ig-col${kind}">${replyQuote(p, m, ctx)}${part(p, ctx)}${reactions(ids, m, j, ctx)}${main ? imageAttachment(m.imageAttachment) : ''}</div>${tools(m, j, main, ctx)}</div>`;
        }).join('');

        const swipe = m.swipe
            ? `<div class="ig-swipe"><button data-et-action="swipe-prev" data-index="${m.index}" title="Previous version"${m.swipe.index === 0 ? ' disabled' : ''}>‹</button><span>${m.swipe.index + 1} / ${m.swipe.count}</span><button data-et-action="swipe-next" data-index="${m.index}" title="${m.swipe.isLast ? 'Regenerate' : 'Next version'}">›</button></div>`
            : '';
        // "Seen" under the user's message, shown only while it's the last in the chat (platform.css)
        const seen = m.isUser && m.receipt
            ? `<div class="ig-seen" title="${ctx.sanitize(m.receipt.note || '')}">${m.receipt.state === 'read' || m.receipt.state === 'ghosted' ? 'Seen' : 'Sent'}</div>`
            : '';
        const divider = m.showTimeDivider ? `<div class="ig-time">${dividerTime(time)}</div>` : '';
        return `<div class="ig-message ig-message-${side}" data-et-role="message" data-index="${m.index}" data-is-user="${m.isUser ? 1 : 0}"${ctx.groupChat ? ' data-group' : ''}${divider ? ' data-divider' : ''}>${divider}${sender}${rows}${swipe}${seen}</div>`;
    }

    /**
     * An empty chat shows the other side's profile, as Instagram opens a new
     * conversation: the avatar large, the name, "You follow each other on Instagram".
     */
    function emptyChat(ctx) {
        const m = { isUser: false, senderName: ctx.charName };
        const a = ctx.avatar(m);
        const img = a.url ? `<img src="${a.url}" alt="" onerror="this.remove()">` : '';
        return `<div class="ig-profile"><div class="ig-profile-avatar" style="background:${a.color}"><span>${ctx.escapeHtml(a.initial)}</span>${img}</div><div class="ig-profile-name">${ctx.escapeHtml(ctx.charName)}</div><div class="ig-profile-line">You follow each other on Instagram</div></div>`;
    }

    /** The character is typing: three dots in a received bubble beside the avatar (fakechat-studio TypingIndicator). */
    function typing(ctx) {
        const m = { isUser: false, senderName: ctx.charName };
        return `<div class="ig-message ig-message-them" data-et-role="typing"><div class="ig-row ig-row-them" data-pos="single"><div class="ig-avatar-slot">${avatar(m, ctx)}</div><div class="ig-col"><div class="ig-bubble ig-typing"><span></span><span></span><span></span></div></div></div></div>`;
    }

    function imageGenerating(ctx) {
        const m = { isUser: false, senderName: ctx.charName };
        return `<div class="ig-message ig-message-them" data-et-role="image-generating"><div class="ig-row ig-row-them" data-pos="single"><div class="ig-avatar-slot">${avatar(m, ctx)}</div><div class="ig-col"><div class="ig-placeholder">Loading photo…</div></div></div></div>`;
    }

    /** Between the bubbles of a reply arriving one by one: the typing bubble, in the run. */
    function bubbleTyping() {
        return '<div class="ig-row ig-row-them" data-pos="middle"><div class="ig-avatar-slot"></div><div class="ig-col"><div class="ig-bubble ig-typing"><span></span><span></span><span></span></div></div></div>';
    }

    /** Cancel / Save under a message being edited, as text buttons. */
    function editToolbar() {
        return '<div class="ig-edit-bar"><button class="ig-edit-btn" data-et-role="edit-cancel">Cancel</button><button class="ig-edit-btn ig-edit-btn-primary" data-et-role="edit-save">Save</button></div>';
    }

    window.EchoTextPlatforms = window.EchoTextPlatforms || {};
    window.EchoTextPlatforms.instagram = {
        id: 'instagram',
        name: 'Instagram',
        features: ['photo', 'voice', 'react', 'reply'],
        stylesheet: 'platform.css',
        // Voice messages are typed from the mic in the input field, as Instagram records them
        voiceButton: { placeholder: 'Voice message…' },
        templates: {
            message,
            part,
            emptyChat,
            typing,
            imageGenerating,
            bubbleTyping,
            editToolbar,
        },
    };
})();
