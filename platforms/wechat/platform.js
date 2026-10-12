(function () {
    'use strict';

    /**
     * WeChat, as a platform pack. Markup and look are ported from
     * soloshow-labs/chat-screenshot-generator (MessageBubble, ImageMessage,
     * VoiceMessage, PaymentCard, FileCard and the link card, TimeDivider,
     * SystemMessage); see platform.css.
     *
     * Every message part is its own row with the sender's avatar, the way WeChat
     * shows consecutive texts. No reactions and no read receipts. Templates follow
     * the contract in platforms/echotext/platform.js: pure functions, clickable
     * elements carry data-et-action, looked-up elements carry data-et-role.
     *
     * The header and input bar are EchoText's own elements restyled by
     * platform.css (ChatHeader, InputBar, ChatGlyphs), so all their behaviour
     * stays EchoText's.
     */

    const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

    // Transfer-card glyph for the refunded state (the others are images in platform.css)
    const REFUNDED_GLYPH = 'M7.26862907,9.20000005 L8.6769553,10.6083263 L7.82842712,11.4568544 L5.84852817,9.47695549 L5.35355339,8.98198071 C5.15829124,8.78671856 5.15829124,8.47013607 5.35355339,8.27487392 L7.82842712,5.80000019 L8.6769553,6.64852836 L7.32548366,8 L12,8 C13.6568542,8 15,9.34314575 15,11 C15,12.6568542 13.6568542,14 12,14 L10,14.0000002 L10,12.8000002 L12,12.8000002 C12.9941125,12.8 13.8,11.9941125 13.8,11 C13.8,10.0058875 12.9941125,9.2 12,9.2 L7.26862907,9.20000005 Z M10,20 C4.4771525,20 0,15.5228475 0,10 C0,4.4771525 4.4771525,0 10,0 C15.5228475,0 20,4.4771525 20,10 C20,15.5228475 15.5228475,20 10,20 Z M10,18.8 C14.8601058,18.8 18.8,14.8601058 18.8,10 C18.8,5.1398942 14.8601058,1.2 10,1.2 C5.1398942,1.2 1.2,5.1398942 1.2,10 C1.2,14.8601058 5.1398942,18.8 10,18.8 Z';

    const PHOTO_GLYPH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 14H5l4.5-6 3.5 4.5 2.5-3L19 18zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/></svg>';

    // soloshow VoiceMessage: three arcs, mirrored on the sender's own bubbles (platform.css)
    const VOICE_GLYPH = '<svg class="wx-voice-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M5.4 9.4a3.7 3.7 0 0 1 0 5.2M9 6a8.5 8.5 0 0 1 0 12M12.7 3a12.7 12.7 0 0 1 0 18"/></svg>';

    // The file icon's lettering by kind (WeChat's Word / PDF / Excel / PowerPoint icons);
    // other files show their extension, as soloshow's FileCard does
    const FILE_ICON_TEXT = { word: 'W', pdf: 'PDF', excel: 'X', ppt: 'P' };

    // A link card's picture placeholder and its site line's link glyph
    const IMAGE_GLYPH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 14H5l4.5-6 3.5 4.5 2.5-3L19 18zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/></svg>';
    const LINK_GLYPH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.66 0l3.17-3.17a4 4 0 0 0-5.66-5.66L11.5 6.84M14 10a4 4 0 0 0-5.66 0l-3.17 3.17a4 4 0 0 0 5.66 5.66l1.67-1.67" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

    const pad = n => String(n).padStart(2, '0');

    /** "17KB", "1.2MB": sizes the way WeChat writes them. */
    function formatSize(bytes) {
        const kb = bytes / 1024;
        return kb < 1024 ? `${Math.max(1, Math.round(kb))}KB` : `${(kb / 1024).toFixed(1)}MB`;
    }

    /**
     * A voice bubble's width: soloshow's ends (82px at a second, 220px at a minute),
     * growing fast over the first ten seconds and slowly after, so 12″ is 158px as
     * in WeChat itself (measured from a screenshot).
     */
    function voiceWidth(seconds) {
        const s = Math.min(60, Math.max(1, seconds));
        const width = s <= 10 ? 82 + (s - 1) * 8.16 : 155.4 + (s - 10) * 1.29;
        return Math.round(Math.min(220, width));
    }

    /** WeChat's time-divider text: "14:32", "昨天 14:32", "星期二 14:32", "10月8日 14:32", "2025年10月8日 14:32". */
    function dividerTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const hm = `${date.getHours()}:${pad(date.getMinutes())}`;
        const dayStart = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        const days = Math.round((dayStart(now) - dayStart(date)) / 86400000);
        if (days === 0) return hm;
        if (days === 1) return `昨天 ${hm}`;
        if (days > 1 && days < 7) return `${WEEKDAYS[date.getDay()]} ${hm}`;
        if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日 ${hm}`;
        return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${hm}`;
    }

    function avatar(m, ctx) {
        const a = ctx.avatar(m);
        // A missing image goes, showing the initial underneath (as EchoText's own avatars do)
        const img = a.url ? `<img src="${a.url}" alt="" onerror="this.remove()">` : '';
        // The character's avatar opens EchoText's avatar menu (view / change); not in group chats
        const action = !m.isUser && !ctx.groupChat ? ' data-et-action="avatar" role="button" tabindex="0" title="头像"' : '';
        return `<div class="wx-avatar" style="background:${a.color}"${action}><span>${ctx.escapeHtml(a.initial)}</span>${img}</div>`;
    }

    /** A transfer or its accept / decline receipt, as WeChat's orange card. */
    function transferCard(p, m, ctx) {
        const side = m.isUser ? 'right' : 'left';
        const original = p.type === 'transfer';
        const status = original ? p.status : p.type === 'transfer_accept' ? 'accepted' : 'declined';
        let note;
        if (!original) note = status === 'accepted' ? '已收款' : '已退还';
        else if (status === 'accepted') note = '已被接受';
        else if (status === 'declined') note = '已被退还';
        else note = m.isUser ? '你发起了一笔转账' : '转账给你';

        const glyph = status === 'declined'
            ? `<svg class="wx-pay-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="${REFUNDED_GLYPH}" transform="translate(2 2)" fill="#fff" fill-rule="evenodd"/></svg>`
            : `<span class="wx-pay-glyph wx-pay-glyph-${status === 'accepted' ? 'received' : 'pending'}"></span>`;
        // Handled cards go pale; a refunded one is also terminal (its own shade)
        const stateClass = status === 'accepted' ? ' wx-pay-handled' : status === 'declined' ? ' wx-pay-handled wx-pay-terminal' : '';
        // Only a pending transfer from the character waits on the user
        const actionAttrs = p.actionable
            ? ` data-et-action="transfer-respond" data-amount="${ctx.escapeHtml(p.displayAmount)}" role="button" tabindex="0"`
            : '';
        return `<div class="wx-pay${stateClass}" data-side="${side}"${actionAttrs}><span class="wx-pay-tail"></span><div class="wx-pay-body">${glyph}<div class="wx-pay-text"><div class="wx-pay-title">${ctx.escapeHtml(p.displayAmount || '¥')}</div><div class="wx-pay-note">${note}</div></div></div><div class="wx-pay-footer">转账</div></div>`;
    }

    /** A photo is a picture frame; tapping it shows the description inside the frame. */
    function photo(p, ctx) {
        const desc = ctx.escapeHtml(p.desc);
        return `<div class="wx-photo" role="button" tabindex="0" aria-expanded="false" title="点击查看" data-et-action="photo-toggle">${PHOTO_GLYPH}<div class="wx-photo-caption" data-et-role="caption"><span>${desc || '图片'}</span></div></div>`;
    }

    /**
     * A voice message: the bubble shows its length (and a red dot until the user first
     * opens one of the character's); tapping it shows the words underneath, as WeChat's
     * 转文字 does (platform.css shows the transcript while aria-expanded is true).
     */
    function voice(p, ctx, side) {
        const length = `<span>${p.duration}″</span>`;
        const dot = p.unread ? '<span class="wx-voice-unread" data-et-role="unread" aria-label="未读"></span>' : '';
        return `<div class="wx-bubble wx-bubble-${side} wx-voice" style="width:${voiceWidth(p.duration)}px" role="button" tabindex="0" aria-expanded="false" title="转文字" data-et-action="voice-toggle" data-voice="${p.voiceIndex}">${side === 'right' ? length + VOICE_GLYPH : VOICE_GLYPH + length}${dot}</div><div class="wx-transcript" data-et-role="transcript"><div class="wx-text">${ctx.formatText(p.text)}</div></div>`;
    }

    /**
     * A shared file (soloshow FileCard): name, size and the file-type icon. With a
     * summary, tapping it shows the summary underneath, as a voice message's words.
     */
    function fileCard(p, ctx, side) {
        const icon = FILE_ICON_TEXT[p.kind] || p.ext || 'FILE';
        const tap = p.summary ? ' role="button" tabindex="0" aria-expanded="false" title="查看内容" data-et-action="card-toggle"' : '';
        const summary = p.summary ? `<div class="wx-transcript" data-et-role="summary">${ctx.escapeHtml(p.summary)}</div>` : '';
        return `<div class="wx-file" data-side="${side}"${tap}><span class="wx-card-tail"></span><div class="wx-file-body"><div class="wx-file-text"><span class="wx-file-name">${ctx.escapeHtml(p.name || '文件')}</span><span class="wx-file-size">${formatSize(p.size)}</span></div><span class="wx-file-icon" data-kind="${p.kind}">${ctx.escapeHtml(icon)}</span></div></div>${summary}`;
    }

    /** A shared web page (soloshow's link card): title, its line beside a picture, the site underneath. */
    function linkCard(p, ctx, side) {
        const title = ctx.escapeHtml(p.title || p.host || '链接');
        const site = p.host ? `<div class="wx-link-site">${LINK_GLYPH}<span>${ctx.escapeHtml(p.host)}</span></div>` : '';
        return `<div class="wx-link" data-side="${side}"><span class="wx-card-tail"></span><div class="wx-link-title">${title}</div><div class="wx-link-row"><p class="wx-link-desc">${ctx.escapeHtml(p.summary)}</p><span class="wx-link-thumb">${IMAGE_GLYPH}</span></div>${site}</div>`;
    }

    /** Inner content of one row: a text bubble, a photo, a voice message, a file or link card, or a transfer card. */
    function part(p, ctx, m) {
        const side = m.isUser ? 'right' : 'left';
        if (p.type === 'photo') return photo(p, ctx);
        if (p.type === 'voice') return voice(p, ctx, side);
        if (p.type === 'file') return fileCard(p, ctx, side);
        if (p.type === 'link') return linkCard(p, ctx, side);
        if (p.type.startsWith('transfer')) return transferCard(p, m, ctx);
        if (p.type !== 'text') return '';
        return `<div class="wx-bubble wx-bubble-${side}"><div class="wx-text" data-et-role="text">${ctx.formatText(p.text)}</div></div>`;
    }

    function imageAttachment(attachment) {
        if (!attachment || attachment.type !== 'image') return '';
        if (attachment.status === 'error') {
            return `<div class="wx-placeholder">${attachment.error || '图片发送失败'}</div>`;
        }
        if (attachment.status !== 'ready' || !attachment.url) {
            return '<div class="wx-placeholder">图片加载中…</div>';
        }
        return `<div class="wx-image" role="button" tabindex="0" data-et-action="image-open"><img src="${attachment.url}" alt=""></div>`;
    }

    /** One message, from its view-model entry: a row per part, the last one the message's main row. */
    function message(m, ctx) {
        const side = m.isUser ? 'right' : 'left';
        const time = new Date(m.timestamp || Date.now());
        const tip = `${time.getMonth() + 1}月${time.getDate()}日 ${time.getHours()}:${pad(time.getMinutes())}`;
        const avatarHtml = avatar(m, ctx);
        // WeChat names senders only in group chats
        const senderHtml = ctx.groupChat && !m.isUser ? `<div class="wx-sender">${ctx.sanitize(m.senderName)}</div>` : '';
        const last = m.parts.length - 1;

        const rows = m.parts.map((p, j) => {
            // A bubble's own menu, except the last row, whose menu covers the whole message
            const menu = j === last
                ? `data-et-action="menu" data-index="${m.index}"`
                : `data-et-action="part-menu" data-index="${m.index}" data-part="${j}"`;
            return `<div class="wx-row wx-row-${side}" data-et-role="bubble${j === last ? ' main' : ''}" title="${tip}">${avatarHtml}<div class="wx-bubble-wrap">${senderHtml}${part(p, ctx, m)}${j === last ? imageAttachment(m.imageAttachment) : ''}</div><button class="wx-more" ${menu} data-is-user="${m.isUser ? 1 : 0}" title="更多">⋯</button></div>`;
        }).join('');

        const swipe = m.swipe
            ? `<div class="wx-swipe"><button data-et-action="swipe-prev" data-index="${m.index}" title="上一版"${m.swipe.index === 0 ? ' disabled' : ''}>‹</button><span>${m.swipe.index + 1} / ${m.swipe.count}</span><button data-et-action="swipe-next" data-index="${m.index}" title="${m.swipe.isLast ? '重新生成' : '下一版'}">›</button></div>`
            : '';

        const divider = m.showTimeDivider ? `<div class="wx-time">${dividerTime(time)}</div>` : '';
        return `<div class="wx-message" data-et-role="message" data-index="${m.index}" data-is-user="${m.isUser ? 1 : 0}">${divider}${rows}${swipe}</div>`;
    }

    /** WeChat shows nothing in an empty chat. */
    function emptyChat() {
        return '';
    }

    /** WeChat says the other side is typing in the title (platform.css, on data-et-typing), not in the list. */
    function typing() {
        return '';
    }

    function imageGenerating(ctx) {
        const m = { isUser: false, senderName: ctx.charName };
        return `<div class="wx-message" data-et-role="image-generating"><div class="wx-row wx-row-left">${avatar(m, ctx)}<div class="wx-bubble-wrap"><div class="wx-placeholder">图片加载中…</div></div></div></div>`;
    }

    /** Between the texts of a reply arriving one by one, WeChat shows nothing. */
    function bubbleTyping() {
        return '';
    }

    /** Cancel / Done under a message being edited, as WeUI's small buttons (cancel first, as WeChat orders them). */
    function editToolbar() {
        return '<div class="wx-edit-bar"><button class="wx-edit-btn" data-et-role="edit-cancel">取消</button><button class="wx-edit-btn wx-edit-btn-primary" data-et-role="edit-save">完成</button></div>';
    }

    window.EchoTextPlatforms = window.EchoTextPlatforms || {};
    window.EchoTextPlatforms.wechat = {
        id: 'wechat',
        name: '微信 WeChat',
        features: ['photo', 'voice', 'transfer', 'file'],
        stylesheet: 'platform.css',
        // Voice messages are typed from the input bar's voice button, as WeChat records them
        voiceButton: { placeholder: '输入要说的话，作为语音发出' },
        // "+" raises a panel of these tiles (lib/features.js composer entries), labelled the WeChat way
        composerPanel: {
            photo: { label: '照片', icon: 'fa-image', placeholder: '描述你要发的照片' },
            transfer: { label: '转账', icon: 'fa-right-left', placeholder: '转账金额' },
            file: { label: '文件', icon: 'fa-folder', placeholder: '标题 | 描述', typeLabels: { link: '网页', other: '其他' } },
        },
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
