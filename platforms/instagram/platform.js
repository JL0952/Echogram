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
    // lucide link and external-link, for a shared page's card
    const LINK_GLYPH = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
    const EXTERNAL_GLYPH = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>';
    // lucide music, for a song without its cover
    const NOTE_GLYPH = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
    // Spotify's mark, for a lyrics card: a disc with its waves cut out in the card's colour (platform.css)
    const SPOTIFY_GLYPH = '<svg class="ig-lyrics-mark" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12"/><path d="M6.2 9.3c3.9-1.2 8.3-.9 11.6 1.1M6.8 12.6c3.2-1 6.8-.7 9.6.9M7.4 15.6c2.6-.7 5.2-.5 7.4.7"/></svg>';
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

    /**
     * A photo is a picture frame, or the image added to it in its shape; tapping it
     * shows the description inside the frame.
     */
    function photo(p, ctx) {
        const shape = p.image ? ` style="aspect-ratio:${p.image.ratio}"` : '';
        const img = p.image ? `<img class="ig-photo-img" src="${ctx.escapeHtml(p.image.url)}" alt="" draggable="false" onerror="this.remove()">` : '';
        return `<div class="ig-photo" role="button" tabindex="0" aria-expanded="false" title="Tap to view" data-et-action="photo-toggle"${shape}>${img}${PHOTO_GLYPH}<div class="ig-photo-caption" data-et-role="caption"><span>${ctx.escapeHtml(p.desc) || 'Photo'}</span></div></div>`;
    }

    /**
     * A voice message as Instagram shows one with its transcription: play button, waveform
     * and length (with a dot until the user first taps one of the character's); a tap shows
     * the words under them in the same bubble, another hides them.
     */
    function voice(p, ctx) {
        const time = `${Math.floor(p.duration / 60)}:${String(p.duration % 60).padStart(2, '0')}`;
        const bars = waveBars(p.text).map(height => `<i style="height:${height}%"></i>`).join('');
        const dot = p.unread ? '<span class="ig-voice-unread" data-et-role="unread" title="Not played yet"></span>' : '';
        return `<div class="ig-bubble ig-voice" role="button" tabindex="0" aria-expanded="false" title="Tap to read" data-et-action="voice-toggle" data-voice="${p.voiceIndex}"><span class="ig-voice-row"><span class="ig-voice-play">${PLAY_GLYPH}</span><span class="ig-voice-wave" aria-hidden="true">${bars}</span><span class="ig-voice-time">${time}</span>${dot}</span><span class="ig-transcript" data-et-role="transcript">${ctx.formatText(p.text)}</span></div>`;
    }

    /**
     * A shared web page, as Instagram's link preview: the page's picture (a
     * placeholder, there is none), its title, one line about it, and the site with
     * the external-link mark.
     */
    function linkCard(p, ctx) {
        const title = ctx.escapeHtml(p.title || p.host || 'Link');
        const desc = p.summary ? `<div class="ig-link-desc">${ctx.escapeHtml(p.summary)}</div>` : '';
        const site = p.host ? `<div class="ig-link-site"><span>${ctx.escapeHtml(p.host)}</span>${EXTERNAL_GLYPH}</div>` : '';
        return `<div class="ig-link"><div class="ig-link-image">${LINK_GLYPH}</div><div class="ig-link-body"><div class="ig-link-title">${title}</div>${desc}${site}</div></div>`;
    }

    /**
     * A shared place's made-up map (the view's `map`), cropped from its middle to the
     * frame: houses along the streets (a verge of open ground between), the streets, a
     * park, water, the main roads.
     */
    function mapArt(map) {
        const layer = (name, d) => d ? `<path class="ig-map-${name}" d="${d}"/>` : '';
        return `<svg class="ig-map-art" viewBox="0 0 ${map.width} ${map.height}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${layer('houses', map.streets)}${layer('verge', map.streets)}${layer('streets', map.streets)}${layer('park', map.park)}${layer('water', map.water)}${layer('roads', map.roads)}</svg>`;
    }

    /**
     * A shared place, as Instagram's location card without the live part: the map with
     * a pin in the middle, the name and address, and View (only drawn, as the header's
     * call buttons are).
     */
    function locationCard(p, ctx) {
        const address = p.address ? `<div class="ig-location-address">${ctx.escapeHtml(p.address)}</div>` : '';
        return `<div class="ig-location"><div class="ig-location-map">${mapArt(p.map)}<span class="ig-map-pin"></span></div><div class="ig-location-body"><div class="ig-location-name">${ctx.escapeHtml(p.name || 'Location')}</div>${address}<div class="ig-location-view">View</div></div></div>`;
    }

    /** A song's cover image, once it's found; an image that fails to load goes. */
    function coverImage(p, ctx) {
        return p.cover ? `<img src="${ctx.escapeHtml(p.cover)}" alt="" onerror="this.remove()">` : '';
    }

    /**
     * A shared song, as Instagram shows one: the cover with a record sliding out from
     * behind it, the title and artist over the cover's foot and a play mark at its top
     * (only drawn).
     */
    function musicCard(p, ctx) {
        const artist = p.artist ? `<div class="ig-music-artist">${ctx.escapeHtml(p.artist)}</div>` : '';
        return `<div class="ig-music"><span class="ig-music-disc"><span class="ig-music-label">${coverImage(p, ctx)}</span></span><div class="ig-music-cover"><span class="ig-music-note">${NOTE_GLYPH}</span>${coverImage(p, ctx)}<span class="ig-music-play">${PLAY_GLYPH}</span><div class="ig-music-text"><div class="ig-music-title">${ctx.escapeHtml(p.title || 'Music')}</div>${artist}</div></div></div>`;
    }

    /**
     * A shared song with some of its lines, as the Spotify lyrics card people share to
     * Instagram: the cover, title and artist small at the top, the lines large and bold
     * (core code fits their size to the card), Spotify's mark at the foot.
     */
    function lyricsCard(p, ctx) {
        const artist = p.artist ? `<div class="ig-lyrics-artist">${ctx.escapeHtml(p.artist)}</div>` : '';
        const lines = p.lyrics.map(line => `<div>${ctx.escapeHtml(line)}</div>`).join('');
        // The card takes its cover's colour, with the ink that reads on it (Spotify's red and black until then)
        const tint = p.color ? ` style="--ig-lyrics-bg:${p.color};--ig-lyrics-ink:${p.ink || '#121212'}"` : '';
        return `<div class="ig-lyrics"${tint}><div class="ig-lyrics-head"><span class="ig-lyrics-cover">${NOTE_GLYPH}${coverImage(p, ctx)}</span><div class="ig-lyrics-song"><div class="ig-lyrics-title">${ctx.escapeHtml(p.title || 'Music')}</div>${artist}</div></div><div class="ig-lyrics-lines" data-et-role="lyrics">${lines}</div><div class="ig-lyrics-brand">${SPOTIFY_GLYPH}<span>Spotify</span></div></div>`;
    }

    /** One bubble's content: text, a photo, a voice message, a place, a link card or a song. */
    /**
     * A sticker, as Instagram sends one: the image on its own, no bubble; the name in
     * brackets when there's no image for it (platform.css).
     */
    function sticker(p, ctx) {
        const name = ctx.escapeHtml(p.name);
        const img = p.url ? `<img src="${ctx.escapeHtml(p.url)}" alt="${name}" draggable="false" onerror="this.remove()">` : '';
        return `<div class="ig-sticker" data-name="[${name}]">${img}</div>`;
    }

    function part(p, ctx) {
        if (p.type === 'photo') return photo(p, ctx);
        if (p.type === 'voice') return voice(p, ctx);
        if (p.type === 'sticker') return sticker(p, ctx);
        if (p.type === 'location') return locationCard(p, ctx);
        if (p.type === 'link') return linkCard(p, ctx);
        if (p.type === 'music') return p.lyrics?.length ? lyricsCard(p, ctx) : musicCard(p, ctx);
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

    /** A bubble's tapback ids: the user's on a character bubble, the character's on the user's. */
    function bubbleTapbacks(p) {
        return p.tapbacks || [];
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
            const ids = bubbleTapbacks(p);
            const reacted = ids.some(id => EMOJI[id]) ? ' ig-row-reacted' : '';
            const face = m.isUser ? '' : `<div class="ig-avatar-slot">${main ? avatar(m, ctx) : ''}</div>`;
            const kind = p.type === 'photo' ? ' ig-col-photo' : '';
            return `<div class="ig-row ig-row-${side}${reacted}" data-pos="${position(j, m.parts.length)}" data-et-role="bubble${main ? ' main' : ''}" title="${tip}">${face}<div class="ig-col${kind}">${replyQuote(p, m, ctx)}${part(p, ctx)}${reactions(ids, m, j, ctx)}${main ? imageAttachment(m.imageAttachment) : ''}</div></div>`;
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
     * The other side's profile at the top of the chat, as Instagram keeps it above
     * the first message (and alone in an empty chat): the avatar large, the name, the
     * username when one is set ("teresalai_ · Instagram"), "You follow each other on
     * Instagram".
     */
    function chatHead(ctx) {
        const m = { isUser: false, senderName: ctx.charName };
        const a = ctx.avatar(m);
        const img = a.url ? `<img src="${a.url}" alt="" onerror="this.remove()">` : '';
        return `<div class="ig-profile" data-et-role="chat-head"><div class="ig-profile-avatar" style="background:${a.color}"><span>${ctx.escapeHtml(a.initial)}</span>${img}</div><div class="ig-profile-name">${ctx.escapeHtml(ctx.charName)}</div>${ctx.username ? `<div class="ig-profile-handle">${ctx.escapeHtml(ctx.username)} · Instagram</div>` : ''}<div class="ig-profile-line">You follow each other on Instagram</div></div>`;
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
        // Links show as a preview card; Instagram has no files or transfers
        features: ['photo', 'voice', 'sticker', 'location', 'react', 'reply', 'link', 'music'],
        // A photo starts from the picture in the field, not from the camera's menu
        photoButton: true,
        stylesheet: 'platform.css',
        // Your bubbles share one gradient across the visible list (index.js updateSharedFill)
        sharedFill: '.ig-row-me .ig-bubble',
        // Voice messages are typed from the mic in the input field, as Instagram records them
        voiceButton: { placeholder: 'Voice message…' },
        // The input says this, whoever you're texting
        inputPlaceholder: 'Message...',
        // A character can have a username (set from the avatar menu), shown under the header's name and on the profile
        username: true,
        templates: {
            message,
            part,
            emptyChat: chatHead,
            chatHead,
            typing,
            imageGenerating,
            bubbleTyping,
            editToolbar,
        },
    };
})();
