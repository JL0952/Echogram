(function () {
    'use strict';

    /**
     * EchoText Features
     *
     * Each rich-message feature — photos, voice messages, tapback reactions, quoted replies, money
     * transfers, shared files and links — as a module: the canonical tags it owns,
     * what happens to those tags in the model's context when the current platform
     * doesn't support it, its part of the reply-format rules, and its entry in the
     * composer's "+" menu. A platform lists the features it supports; the chat
     * history itself never changes.
     *
     *   contextPolicy 'strip'    the tag is removed from the context
     *   contextPolicy 'degrade'  the tag becomes a plain-text note ("[Transfer: ¥52.00]")
     *
     * Context filtering works on canonical tags, so run it on text that has been
     * through RichMessages.normalizeMessageTags().
     */

    const RichMessages = window.EchoTextRichMessages;

    // The tapbacks of the react feature: the user's on character messages, and the
    // ids the model may write in <react>
    const REACTIONS = [
        { id: 'heart', icon: 'fa-solid fa-heart', label: 'Love', color: '#ff4d6d' },
        { id: 'haha', icon: 'fa-solid fa-face-laugh-squint', label: 'Haha', color: '#fbbf24' },
        { id: 'wow', icon: 'fa-solid fa-face-surprise', label: 'Wow', color: '#fb923c' },
        { id: 'sad', icon: 'fa-solid fa-face-sad-tear', label: 'Sad', color: '#60a5fa' },
        { id: 'fire', icon: 'fa-solid fa-fire', label: 'Fire', color: '#f97316' },
        { id: 'like', icon: 'fa-solid fa-thumbs-up', label: 'Like', color: 'var(--et-theme-color)' },
        { id: 'star', icon: 'fa-solid fa-star', label: 'Star', color: '#facc15' },
        { id: 'bolt', icon: 'fa-solid fa-bolt', label: 'Zap', color: '#a78bfa' },
    ];

    // Order is the order of the format rules
    const FEATURES = [
        {
            id: 'photo',
            tags: ['photo'],
            contextPolicy: 'degrade',
            composer: { label: 'Photo', icon: 'fa-image', placeholder: 'Describe the photo you\'re sending...' },
            prompt: ({ charName, userName }) =>
                `PHOTOS: ${charName} can send photos as <photo>what the photo shows</photo> — a short, concrete description of the picture — and ${userName} sees it as an actual picture. Write the description as a neutral caption of what is visible, with no first- or second-person pronouns: refer to people by name (${charName}, ${userName}) instead of I/me/my/you. Send one whenever ${charName} naturally would, such as when asked for a picture, but never use it to describe ${charName}'s own actions. A <photo> from ${userName} is a picture they sent: react to what it shows.`,
        },
        {
            id: 'voice',
            tags: ['voice'],
            contextPolicy: 'degrade',
            composer: { label: 'Voice', icon: 'fa-microphone', placeholder: 'What you say in the voice message...' },
            prompt: ({ charName, userName }) =>
                `VOICE MESSAGES: ${charName} can send a voice message as <voice>exactly what ${charName} says</voice> — natural speech, with fillers and sounds written the way they sound (haha, mm, ugh), never descriptions of actions or tone. It suits moments when typing is awkward (out and about, hands busy), when ${charName} wants to sound closer or more intimate, or when ${userName} asks to hear something (a song, a sound, a word said aloud). Outgoing, expressive characters send them often; reserved or shy ones rarely do. A <voice> from ${userName} is their recording: answer what they said.`,
        },
        {
            id: 'react',
            tags: ['react'],
            contextPolicy: 'strip',
            prompt: ({ charName, userName, reactionIds }) =>
                `REACTIONS: ${charName} can react to ${userName}'s latest message with a tapback as <react>name</react>, where name is one of: ${reactionIds.join(', ')}. Use one only now and then, when a quick reaction genuinely fits — most replies need none. A reaction usually comes with text messages, but occasionally it can be the whole reply. A <react> from ${userName} is their tapback on ${charName}'s message just before it, or on the text a <reply> right before the <react> quotes — ${charName} may notice it, but it doesn't need an answer of its own.`,
        },
        {
            id: 'reply',
            tags: ['reply'],
            contextPolicy: 'degrade',
            prompt: ({ charName, userName }) =>
                `REPLIES: ${charName} can quote an earlier message to answer it specifically, the way a reply works in a messaging app: <reply>name: the quoted words</reply>, right before the text that answers it, where name is whoever sent it (${userName} or ${charName}). Use it only now and then, for a message further back than the latest one — most replies need none. A <reply> in ${userName}'s message quotes the message they are answering with the text after it.`,
        },
        {
            id: 'transfer',
            tags: ['transfer', 'transfer_accept', 'transfer_decline'],
            contextPolicy: 'degrade',
            composer: { label: 'Transfer', icon: 'fa-money-bill-transfer', placeholder: 'Amount to transfer' },
            prompt: ({ charName, userName }) =>
                `TRANSFERS: ${charName} can send ${userName} money as <transfer>amount</transfer>, with the amount as a plain number. When ${userName} sends ${charName} a <transfer>, ${charName} can accept it with <transfer_accept/> or decline it with <transfer_decline/>, or leave it pending for now. A <transfer_accept> or <transfer_decline> from ${userName} means they accepted or declined ${charName}'s transfer. Only send or answer transfers when it fits the story.`,
        },
        {
            id: 'file',
            tags: ['file'],
            contextPolicy: 'degrade',
            composer: { label: 'File', icon: 'fa-file-lines', placeholder: 'Title | description' },
            // With links on too, one rule covers both
            prompt: ({ charName, userName, enabled }) => enabled.includes('link')
                ? `FILES AND LINKS: ${charName} can share a file as <file>name.ext | a short summary of what's in it</file>, or a web page as <link>page title | address | one line about it</link> — only when the story calls for it, such as a ticket, form, notes or article ${charName} would really send. A <file> or <link> from ${userName} is something they shared: respond to what it contains.`
                : `FILES: ${charName} can share a file as <file>name.ext | a short summary of what's in it</file> — only when the story calls for it, such as a ticket, form or notes ${charName} would really send. A <file> from ${userName} is something they shared: respond to what it contains.`,
        },
        {
            // A platform can have links without files (Instagram)
            id: 'link',
            tags: ['link'],
            contextPolicy: 'degrade',
            // Where files are on too, a link is shared from the file composer as its "Web page" kind
            composer: { label: 'Link', icon: 'fa-link', placeholder: 'Title | address | description' },
            // With files on too, the file rule covers links
            prompt: ({ charName, userName, enabled }) => enabled.includes('file')
                ? ''
                : `LINKS: ${charName} can share a web page as <link>page title | address | one line about it</link> — only when the story calls for it, such as an article, video or place ${charName} would really send. A <link> from ${userName} is something they shared: respond to what it contains.`,
        },
    ];

    const FEATURE_IDS = FEATURES.map(f => f.id);

    /**
     * Composer modes ("+" menu entries) of the enabled features, by feature id. Links
     * have their own only where files are off; otherwise they're a kind of file to share.
     */
    function getComposerModes(enabled) {
        return Object.fromEntries(FEATURES
            .filter(f => f.composer && enabled.includes(f.id) && !(f.id === 'link' && enabled.includes('file')))
            .map(f => [f.id, f.composer]));
    }

    /** The reply-format rules for the enabled features, one paragraph each (a feature may have none of its own). */
    function buildFeaturePrompts(enabled, ctx) {
        return FEATURES.filter(f => enabled.includes(f.id)).map(f => f.prompt({ ...ctx, enabled })).filter(Boolean);
    }

    /**
     * A message's canonical text with the tags of features not in `enabled`
     * stripped or turned into plain-text notes, per their contextPolicy.
     * @returns {string|null} the text, unchanged when nothing applies; null when
     *   the message held only unsupported content and should be left out
     */
    function filterContextText(text, enabled) {
        const source = String(text ?? '');
        const disabled = FEATURES.filter(f => !enabled.includes(f.id));
        if (!disabled.length) return source;

        // Stripped tags leave a marker so only their own lines get tidied
        const MARK = '\u0000';
        let out = source;
        for (const feature of disabled) {
            const re = new RegExp(`<(${feature.tags.join('|')})>[^<\\n]*<\\/\\1>`, 'g');
            out = out.replace(re, match => feature.contextPolicy === 'degrade' ? RichMessages.toPlainText(match) : MARK);
        }
        if (out === source) return source;

        // A line that held only stripped tags goes; elsewhere their gap closes up
        out = out.split('\n')
            .map(line => line.includes(MARK) ? line.replace(/[ \t]*\u0000+[ \t]*/g, ' ').trim() || null : line)
            .filter(line => line !== null)
            .join('\n');
        return out.trim() || !source.trim() ? out : null;
    }

    window.EchoTextFeatures = {
        REACTIONS,
        FEATURES,
        FEATURE_IDS,
        getComposerModes,
        buildFeaturePrompts,
        filterContextText,
    };
})();
