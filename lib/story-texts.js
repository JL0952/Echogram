(function () {
    'use strict';

    /**
     * EchoText Story Texts
     *
     * Puts the Tethered EchoText conversation into SillyTavern's own roleplay
     * prompt (the "EchoText Messages" context toggle), from the generation
     * interceptor in index.js. Texts go into the story by time: each run of texts
     * sent between two story messages becomes one narrator message between them,
     * so the roleplay model knows what was texted and when. Pure: the chat it
     * changes is the interceptor's copy of the prompt messages, never the saved chat.
     *
     *     insertTexts(chat, history, options) → number of messages inserted
     */

    const ChatViewModel = window.EchoTextChatViewModel;

    // ST's narrator type (system-messages.js): sent with the system role and no name prefix
    const NARRATOR_TYPE = 'narrator';

    const labelled = (label, value) => (value ? `[${label}: ${value}]` : `[${label}]`);

    /** A bubble as one line of the transcript: its text, or rich content as "[Photo: …]", "[Voice message: …]" and so on. */
    function partText(part) {
        switch (part.type) {
            case 'text': return part.text;
            case 'photo': return labelled('Photo', part.desc);
            case 'voice': return labelled('Voice message', part.text);
            case 'transfer': return labelled('Transfer', part.displayAmount);
            case 'transfer_accept': return labelled('Accepted transfer', part.displayAmount);
            case 'transfer_decline': return labelled('Declined transfer', part.displayAmount);
            case 'reaction_note': return labelled('Reaction', part.reaction);
            default: return '';
        }
    }

    function textsMessage(lines, time, { charName, userName }) {
        return {
            name: 'System',
            is_user: false,
            is_system: false,
            send_date: new Date(time).toISOString(),
            mes: `<text_messages>\n${userName} and ${charName} texted each other by phone at this point in the story:\n${lines.join('\n')}\n</text_messages>`,
            extra: { type: NARRATOR_TYPE, echotext: true },
        };
    }

    /**
     * Inserts EchoText messages into a story's prompt messages. A text goes after
     * the last story message sent before it; texts older than the first story
     * message predate this story and are left out.
     * @param {object[]} chat - the story's prompt messages, oldest first; changed in place
     * @param {object[]} history - EchoText messages, oldest first
     * @param {object} options
     * @param {string} options.charName
     * @param {string} options.userName
     * @param {(message: object) => number} options.timeOf - a story message's time in ms, NaN when unknown
     * @param {boolean} [options.keepLast=false] - the last story message stays last (Continue extends it)
     * @returns {number} how many messages were inserted
     */
    function insertTexts(chat, history, { charName, userName, timeOf, keepLast = false }) {
        if (!Array.isArray(chat) || !chat.length || !Array.isArray(history) || !history.length) return 0;

        // Story times, never going back: an unknown or earlier time takes its predecessor's
        let latest = -Infinity;
        const times = chat.map(msg => {
            const time = timeOf(msg);
            if (Number.isFinite(time) && time > latest) latest = time;
            return latest;
        });
        const lastSlot = keepLast ? chat.length - 1 : chat.length;

        // Transcript lines by the position they go in (before chat[slot])
        const slots = new Map();
        const { messages } = ChatViewModel.buildChatViewModel(history, { charName, userName });
        for (const view of messages) {
            const time = Number(view.timestamp);
            if (!Number.isFinite(time) || time < times[0]) continue;
            const after = times.findIndex(t => t > time);
            const slot = Math.min(after === -1 ? chat.length : after, lastSlot);
            const lines = view.parts.map(partText).filter(Boolean).map(text => `${view.senderName}: ${text}`);
            if (!lines.length) continue;
            if (!slots.has(slot)) slots.set(slot, { time, lines: [] });
            slots.get(slot).lines.push(...lines);
        }

        // Last position first, so earlier positions don't move
        const entries = [...slots].sort((a, b) => b[0] - a[0]);
        for (const [slot, { time, lines }] of entries) {
            chat.splice(slot, 0, textsMessage(lines, time, { charName, userName }));
        }
        return entries.length;
    }

    window.EchoTextStoryTexts = {
        insertTexts,
    };
})();
