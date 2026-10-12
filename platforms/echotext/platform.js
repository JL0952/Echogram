(function () {
    'use strict';

    /**
     * EchoText's own look, as a platform pack: the templates for everything in
     * the message list. Its CSS is still style.css.
     *
     * Templates are pure — (view, ctx) → HTML string. A message's view is its
     * entry from lib/chat-view-model.js; ctx comes from index.js:
     *   verbosity ('short' | 'medium' | 'long' | null), charName
     *   has(featureId)        whether the platform's feature is on (lib/features.js)
     *   animateReaction       message(): pop the character's reaction in
     *   escapeHtml(text)      text for HTML
     *   sanitize(text)        plain text with any tags stripped
     *   formatText(text)      message text as safe HTML (markdown, emoticons)
     *   reaction(id)          { icon, color, label }, or null for an unknown id
     *   avatar(m)             a sender's avatar as data: { url (or null), initial, color }; the
     *                         character's may be one picked in EchoText. A template can give its
     *                         avatar data-et-action="avatar" to open the avatar menu (view / change)
     *   groupChat             a group chat in combine mode (show who sent what)
     *
     * No event code: clickable elements carry data-et-action, and the elements
     * core code looks up carry data-et-role (see docs/platform-plan.md).
     */

    const RECEIPT_STATES = {
        sent: { icon: 'fa-paper-plane', label: 'Sent' },
        delivered: { icon: 'fa-check', label: 'Delivered' },
        read: { icon: 'fa-check-double', label: 'Read' },
        ghosted: { icon: 'fa-eye-slash', label: 'Read, then paused (ghosting)' }
    };

    const VERBOSITY_BADGES = {
        short: { label: '📏', tip: 'Short: 1–2 texts per reply' },
        long: { label: '📜', tip: 'Long: 4–7 texts per reply' },
    };

    /** Stand-in for a reply that is only a reaction (the reaction itself shows on the user's message). */
    function reactionNote(reactionId, ctx) {
        const def = ctx.reaction(reactionId);
        const icon = def ? `<i class="${def.icon}" style="--react-color:${def.color}"></i>` : '';
        return `<div class="et-reaction-note">${icon}<span>Reacted to your message</span></div>`;
    }

    /** A photo shows only its frame; tapping it reveals the description inside. */
    function photoCard(desc, ctx) {
        const safeDesc = ctx.escapeHtml(desc);
        return `<div class="et-photo-card" role="button" tabindex="0" aria-expanded="false" title="Tap to view" data-et-action="photo-toggle"><div class="et-photo-card-frame"><i class="fa-regular fa-image et-photo-card-icon"></i><div class="et-photo-card-caption" data-et-role="caption"><span>${safeDesc || 'Photo'}</span></div></div></div>`;
    }

    /** Bar heights (%) for a voice message's waveform, drawn from its words so each one looks its own. */
    function waveBars(text, count = 16) {
        let h = 2166136261;
        for (const c of String(text)) h = Math.imul(h ^ c.codePointAt(0), 16777619);
        const bars = [];
        for (let i = 0; i < count; i++) {
            h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
            bars.push(28 + ((h >>> 0) % 73));
        }
        return bars;
    }

    /**
     * A voice message, as iMessage draws one: play button, waveform and length (with a
     * dot until the user first opens one of the character's). Tapping it shows the
     * words inside the bubble (style.css, while aria-expanded is true).
     */
    function voiceNote(p, ctx) {
        const time = `${Math.floor(p.duration / 60)}:${String(p.duration % 60).padStart(2, '0')}`;
        const bars = waveBars(p.text).map(height => `<i style="height:${height}%"></i>`).join('');
        const dot = p.unread ? '<span class="et-voice-unread" data-et-role="unread" title="Not played yet"></span>' : '';
        return `<div class="et-voice" role="button" tabindex="0" aria-expanded="false" title="Tap to read" data-et-action="voice-toggle" data-voice="${p.voiceIndex}"><div class="et-voice-row"><span class="et-voice-play"><i class="fa-solid fa-play"></i></span><span class="et-voice-wave" aria-hidden="true">${bars}</span><span class="et-voice-time">${time}</span>${dot}</div><div class="et-voice-transcript et-bubble-text" data-et-role="transcript">${ctx.formatText(p.text)}</div></div>`;
    }

    // Font Awesome's file icons by kind (lib/rich-messages.js fileKind)
    const FILE_ICONS = { word: 'fa-file-word', pdf: 'fa-file-pdf', excel: 'fa-file-excel', ppt: 'fa-file-powerpoint', other: 'fa-file-lines' };

    /** "17 KB", "1.2 MB". */
    function formatSize(bytes) {
        const kb = bytes / 1024;
        return kb < 1024 ? `${Math.max(1, Math.round(kb))} KB` : `${(kb / 1024).toFixed(1)} MB`;
    }

    /**
     * A shared file, laid out like the transfer card: icon by file type, name, type and
     * size, "File" underneath. With a summary, tapping it shows the summary in the card
     * (style.css, while aria-expanded is true).
     */
    function fileCard(p, ctx) {
        const tap = p.summary ? ' role="button" tabindex="0" aria-expanded="false" title="Tap to read" data-et-action="card-toggle"' : '';
        const meta = [p.ext, formatSize(p.size)].filter(Boolean).join(' · ');
        const summary = p.summary ? `<div class="et-share-summary" data-et-role="summary">${ctx.escapeHtml(p.summary)}</div>` : '';
        return `<div class="et-share-card et-file-card" data-kind="${p.kind}"${tap}><div class="et-share-body"><div class="et-share-icon"><i class="fa-solid ${FILE_ICONS[p.kind] || FILE_ICONS.other}"></i></div><div class="et-share-info"><div class="et-share-title">${ctx.escapeHtml(p.name || 'File')}</div><div class="et-share-meta">${ctx.escapeHtml(meta)}</div></div></div>${summary}<div class="et-share-footer">File</div></div>`;
    }

    /** A shared web page, the same card: title and its line, the site underneath. */
    function linkCard(p, ctx) {
        const line = p.summary ? `<div class="et-share-meta">${ctx.escapeHtml(p.summary)}</div>` : '';
        return `<div class="et-share-card et-link-card"><div class="et-share-body"><div class="et-share-icon"><i class="fa-solid fa-link"></i></div><div class="et-share-info"><div class="et-share-title">${ctx.escapeHtml(p.title || p.host || 'Link')}</div>${line}</div></div><div class="et-share-footer"><i class="fa-solid fa-globe"></i> ${ctx.escapeHtml(p.host || 'Web page')}</div></div>`;
    }

    /** A transfer or transfer-response card, from a view-model part (its status and display amount). */
    function transferCard(part, ctx) {
        const { status: state, actionable } = part;
        let icon, label;
        if (part.type === 'transfer') {
            icon = { accepted: 'fa-circle-check', declined: 'fa-arrow-rotate-left' }[state] || 'fa-money-bill-transfer';
            label = { accepted: 'Accepted', declined: 'Declined' }[state] || (actionable ? 'Tap to accept' : 'Pending');
        } else {
            const accepted = part.type === 'transfer_accept';
            icon = accepted ? 'fa-circle-check' : 'fa-arrow-rotate-left';
            label = accepted ? 'Received' : 'Declined';
        }
        const amountText = ctx.escapeHtml(part.displayAmount || 'Transfer');
        // The response tag names the currency explicitly ("$20.00")
        const actionAttrs = actionable ? ` data-et-action="transfer-respond" data-amount="${ctx.escapeHtml(part.displayAmount)}" role="button" tabindex="0"` : '';
        return `<div class="et-transfer-card et-transfer-${state}${actionable ? ' et-transfer-actionable' : ''}"${actionAttrs}><div class="et-transfer-body"><div class="et-transfer-icon"><i class="fa-solid ${icon}"></i></div><div class="et-transfer-info"><div class="et-transfer-amount">${amountText}</div><div class="et-transfer-status">${label}</div></div></div><div class="et-transfer-footer">Transfer</div></div>`;
    }

    /** Inner content of one bubble: formatted text, a photo card, a voice message, a file or link card, or a transfer card. */
    function part(p, ctx) {
        if (p.type === 'photo') return photoCard(p.desc, ctx);
        if (p.type === 'voice') return voiceNote(p, ctx);
        if (p.type === 'file') return fileCard(p, ctx);
        if (p.type === 'link') return linkCard(p, ctx);
        if (p.type === 'reaction_note') return reactionNote(p.reaction, ctx);
        if (p.type !== 'text') return transferCard(p, ctx);
        return `<div class="et-bubble-text" data-et-role="text">${ctx.formatText(p.text)}</div>`;
    }

    /** Extra bubble classes for a part: cards get a snug, card-hugging bubble; a voice message keeps the bubble. */
    function partBubbleClass(p) {
        if (p.type === 'text') return '';
        if (p.type === 'voice') return ' et-bubble-voice';
        // Transfers and their accept/decline responses share the standalone card style
        const kind = p.type.startsWith('transfer') ? 'transfer' : p.type === 'reaction_note' ? 'reaction' : p.type;
        return ` et-bubble-card et-bubble-${kind}`;
    }

    /**
     * Bubbles shown before a message's main (footer-bearing) bubble — one per part
     * except the last, which goes in the main bubble itself.
     */
    function leadingBubbles(m, sideClass, ctx) {
        return m.parts.slice(0, -1).map((p, j) =>
            `<div class="et-bubble ${sideClass} et-bubble-part${partBubbleClass(p)}" data-et-role="bubble">${part(p, ctx)}<button class="et-part-dots-btn" data-et-action="part-menu" data-index="${m.index}" data-part="${j}" data-is-user="${m.isUser ? 1 : 0}" title="More options"><i class="fa-solid fa-ellipsis-vertical"></i></button></div>`
        ).join('');
    }

    /** Read-receipt icon for a user message's view-model receipt ({ state, note }). */
    function receipt(r, ctx) {
        const def = RECEIPT_STATES[r.state] || RECEIPT_STATES.sent;
        const tip = ctx.sanitize(r.note || def.label);
        return `<span class="et-read-receipt et-read-receipt-${r.state}" title="${tip}"><i class="fa-solid ${def.icon}"></i></span>`;
    }

    function verbosityBadge(verbosity) {
        const badge = VERBOSITY_BADGES[verbosity];
        if (!verbosity || verbosity === 'medium') return '';
        return `<span class="et-verbosity-badge" title="${badge?.tip || 'Verbosity'}">${badge?.label || ''}</span>`;
    }

    /** The user's tapbacks under a character message. */
    function reactionPills(reactions, ctx) {
        return reactions.map((reaction) => {
            const def = ctx.reaction(reaction.id);
            if (!def) return '';
            return `<button class="et-reaction-pill${reaction.mine ? ' et-reaction-mine' : ''}" data-et-action="reaction-toggle" data-reaction="${reaction.id}" title="${def.label}" style="--react-color:${def.color}">
                    <i class="${def.icon} et-reaction-icon"></i>
                    <span class="et-reaction-count">${reaction.count}</span>
                </button>`;
        }).join('');
    }

    /** The character's reaction pill under a user message. */
    function charReaction(reactionId, ctx) {
        const def = ctx.reaction(reactionId);
        if (!def) return '';
        return `<div class="et-char-reaction-pill${ctx.animateReaction ? ' et-reaction-new' : ''}" style="--react-color:${def.color}" title="${def.label}">
                <i class="${def.icon} et-char-reaction-icon"></i>
            </div>`;
    }

    /** One message, from its view-model entry. */
    function message(m, ctx) {
        const index = m.index;
        const mainPart = m.parts[m.parts.length - 1];
        const mainCardClass = partBubbleClass(mainPart);
        const msgDate = new Date(m.timestamp || Date.now());
        const time = msgDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const fullDateToolip = msgDate.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

        if (m.isUser) {
            const safeUserName = ctx.sanitize(m.senderName);
            return `
            <div class="et-message et-message-user${m.groupedWithNext ? ' et-message-grouped' : ''}" data-et-role="message" data-index="${index}">
                ${leadingBubbles(m, 'et-bubble-user', ctx)}
                <div class="et-bubble et-bubble-user et-bubble-main${mainCardClass}" data-et-role="bubble main">
                    ${part(mainPart, ctx)}
                    ${m.groupedWithNext ? `<button class="et-part-dots-btn et-msg-dots-hover" data-et-action="menu" data-index="${index}" data-is-user="1" title="More options"><i class="fa-solid fa-ellipsis-vertical"></i></button>` : ''}
                </div>
                <div class="et-message-footer">
                    <span class="et-message-time" title="${fullDateToolip}">${time}</span>
                    <span class="et-user-name">${safeUserName}</span>
                    ${receipt(m.receipt, ctx)}
                    <div class="et-bubble-actions">
                        <button class="et-dots-btn" data-et-action="menu" data-index="${index}" data-is-user="1" title="More options"><i class="fa-solid fa-ellipsis-vertical"></i></button>
                    </div>
                </div>
                <div class="et-char-reaction-bar" id="et-char-reaction-${index}" data-et-role="char-reaction">${m.charReaction ? charReaction(m.charReaction, ctx) : ''}</div>
            </div>`;
        }

        // Combine mode: each character message carries its own name
        const safeCharName = ctx.sanitize(m.senderName);

        // Swipe navigation — only on the last character message
        const swipe = m.swipe;
        const swipeNavHtml = swipe ? `
                        <div class="et-swipe-nav">
                            <button class="et-swipe-btn et-swipe-prev" data-et-action="swipe-prev" data-index="${index}" title="Previous version"${swipe.index === 0 ? ' disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button>
                            <span class="et-swipe-counter">${swipe.index + 1} / ${swipe.count}</span>
                            <button class="et-swipe-btn et-swipe-next${swipe.isLast ? ' et-swipe-regen' : ''}" data-et-action="swipe-next" data-index="${index}" title="${swipe.isLast ? 'Regenerate (new version)' : 'Next version'}"><i class="fa-solid fa-chevron-right"></i></button>
                        </div>` : '';

        return `
            <div class="et-message et-message-char" data-et-role="message" data-index="${index}">
                <div class="et-message-body">
                    ${leadingBubbles(m, 'et-bubble-char', ctx)}
                    <div class="et-bubble et-bubble-char et-bubble-main${mainCardClass}" data-et-role="bubble main">
                        ${part(mainPart, ctx)}
                        ${swipeNavHtml}
                    </div>
                    <div class="et-message-footer">
                        <span class="et-footer-name" title="${safeCharName}">${safeCharName}</span>
                        <span class="et-message-time" title="${fullDateToolip}">${time}</span>
                        ${verbosityBadge(ctx.verbosity)}
                        <div class="et-bubble-actions">
                            ${ctx.has('react') ? `<button class="et-react-btn" data-et-action="react" data-index="${index}" title="React"><i class="fa-regular fa-face-smile"></i></button>` : ''}
                            <button class="et-dots-btn" data-et-action="menu" data-index="${index}" data-is-user="0" title="More options"><i class="fa-solid fa-ellipsis-vertical"></i></button>
                        </div>
                    </div>
                    <div class="et-bubble-reactions-bar" id="et-reactions-bar-${index}">
                        <div class="et-active-reactions" id="et-reactions-${index}" data-et-role="reactions">${reactionPills(m.reactions, ctx)}</div>
                    </div>
                </div>
            </div>`;
    }

    /** Shown in place of the message list when the chat is empty. */
    function emptyChat() {
        return '<div class="et-empty-chat"><i class="fa-regular fa-comment-dots"></i><p>Start a conversation!</p></div>';
    }

    /** The character is typing: a message at the end of the list. */
    function typing() {
        return `
            <div class="et-message et-message-char et-message-typing" id="et-typing-indicator-msg" data-et-role="typing">
                <div class="et-message-body">
                    <div class="et-bubble et-bubble-char et-typing-bubble" title="Character is typing">
                        <div class="et-typing-dots"><span></span><span></span><span></span></div>
                    </div>
                </div>
            </div>`;
    }

    function bubbleTyping() {
        return '<div class="et-bubble et-bubble-char et-typing-bubble"><div class="et-typing-dots"><span></span><span></span><span></span></div></div>';
    }

    /** Save / Cancel under a message being edited in place (edit-save / edit-cancel). */
    function editToolbar() {
        return '<div class="et-edit-toolbar"><button class="et-edit-save" data-et-role="edit-save"><i class="fa-solid fa-check"></i> Save</button><button class="et-edit-cancel" data-et-role="edit-cancel"><i class="fa-solid fa-xmark"></i> Cancel</button></div>';
    }

    window.EchoTextPlatforms = window.EchoTextPlatforms || {};
    window.EchoTextPlatforms.echotext = {
        id: 'echotext',
        name: 'EchoText',
        // Rich-message features this look supports (lib/features.js)
        features: ['photo', 'voice', 'react', 'transfer', 'file'],
        templates: {
            message,
            part,
            emptyChat,
            typing,
            bubbleTyping,
            editToolbar,
        },
    };
})();
