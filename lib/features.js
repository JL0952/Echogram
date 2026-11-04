(function () {
    'use strict';

    /**
     * EchoText Features
     *
     * Each rich-message feature — photos, voice messages, shared places, tapback reactions, quoted
     * replies, money transfers, shared files, links and songs — as a module: the canonical tags it owns,
     * what happens to those tags in the model's context when the current platform
     * doesn't support it, its part of the reply-format rules, and its entry in the
     * composer's "+" menu. A platform lists the features it supports; the chat
     * history itself never changes.
     *
     *   contextPolicy 'strip'    the tag is removed from the context
     *   contextPolicy 'degrade'  the tag becomes a plain-text note ("[Transfer: ¥52.00]")
     *   withReply                a <reply> right before the tag belongs to it and goes with it
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
                `- <photo>what the photo shows</photo>: ${userName} sees it as an actual picture. A short, neutral caption of what is visible, people by name (${charName}, ${userName}), with no I/me/my/you; never ${charName}'s own actions. Send one when asked for a picture.`,
        },
        {
            id: 'voice',
            tags: ['voice'],
            contextPolicy: 'degrade',
            composer: { label: 'Voice', icon: 'fa-microphone', placeholder: 'What you say in the voice message...' },
            prompt: ({ charName, userName }) =>
                `- <voice>exactly what ${charName} says</voice>: natural speech, fillers and sounds written as they sound (haha, mm, ugh), never actions or tone. For when typing is awkward, to sound closer or more intimate, or when ${userName} asks to hear something; outgoing, expressive characters send them often, reserved or shy ones rarely.`,
        },
        {
            id: 'location',
            tags: ['location'],
            contextPolicy: 'degrade',
            composer: { label: 'Location', icon: 'fa-location-dot', placeholder: 'Place | address' },
            prompt: ({ charName }) =>
                `- <location>place name | address</location>: where ${charName} is, or where to meet.`,
        },
        {
            id: 'react',
            tags: ['react'],
            contextPolicy: 'strip',
            // A <reply> right before a <react> says which message the tapback is on: they go together
            withReply: true,
            prompt: ({ userName, reactionIds }) =>
                `- <react>name</react>, name one of: ${reactionIds.join(', ')}: a tapback, right after a <reply> quoting the message of ${userName}'s it is on, even the latest — always both: <reply>${userName}: the quoted words</reply> (a photo by its note), then <react>${reactionIds[0]}</react>. ${userName}'s <react> is on the message their <reply> right before it quotes.`,
        },
        {
            id: 'reply',
            tags: ['reply'],
            contextPolicy: 'degrade',
            prompt: ({ charName, userName }) =>
                `- <reply>name: the quoted words</reply>, name being whoever sent it (${userName} or ${charName}): right before the text that answers it, for a message further back than the latest. A photo or card is quoted by its note in square brackets, as [Photo: what it shows], never with its tag. ${userName}'s <reply> quotes the message the text after it answers.`,
        },
        {
            id: 'transfer',
            tags: ['transfer', 'transfer_accept', 'transfer_decline'],
            contextPolicy: 'degrade',
            composer: { label: 'Transfer', icon: 'fa-money-bill-transfer', placeholder: 'Amount to transfer' },
            prompt: ({ charName, userName }) =>
                `- <transfer>amount</transfer>, the amount a plain number: money to ${userName}. To ${userName}'s <transfer>, ${charName} can answer <transfer_accept/> or <transfer_decline/>, or leave it pending for now; theirs mean they accepted or declined ${charName}'s.`,
        },
        {
            id: 'file',
            tags: ['file'],
            contextPolicy: 'degrade',
            composer: { label: 'File', icon: 'fa-file-lines', placeholder: 'Title | description' },
            prompt: ({ charName }) =>
                `- <file>name.ext | a short summary of what's in it</file>: a ticket, form or notes ${charName} would really send.`,
        },
        {
            // A platform can have links without files (Instagram)
            id: 'link',
            tags: ['link'],
            contextPolicy: 'degrade',
            // Where files are on too, a link is shared from the file composer as its "Web page" kind
            composer: { label: 'Link', icon: 'fa-link', placeholder: 'Title | address | description' },
            prompt: ({ charName }) =>
                `- <link>page title | address | one line about it</link>: an article, video or place ${charName} would really send.`,
        },
        {
            id: 'music',
            tags: ['music'],
            contextPolicy: 'degrade',
            composer: { label: 'Music', icon: 'fa-music', placeholder: 'Song | artist | lyrics' },
            // A real title and artist, as released, so the song can be looked up
            prompt: () =>
                `- <music>song title | artist</music>, or with a few of its lines <music>song title | artist | a line; the next line</music>: a real song that exists, title and artist as released, never translated.`,
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

    /** The reply-format rules for the enabled features, a line each: the tag and what it needs (what they share is index.js's MESSAGES line). */
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
            const reply = feature.withReply ? '(?:<reply>[^<\\n]*<\\/reply>\\s*)?' : '';
            const re = new RegExp(`${reply}<(${feature.tags.join('|')})>[^<\\n]*<\\/\\1>`, 'g');
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
