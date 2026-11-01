(function () {
    'use strict';

    /**
     * EchoText Story Texts
     *
     * Puts the EchoText conversation into SillyTavern's own roleplay
     * prompt (the "Echogram Messages" context toggle), from the generation
     * interceptor in index.js. Texts go into the story by time: each run of texts
     * sent between two story messages becomes one narrator message between them,
     * so the roleplay model knows what was texted and when: the date and time
     * ("[2026-10-31 Sat 21:40]") wherever it moves on, which never change, so a
     * prompt cache holds, and last of all what time it is now, which only makes sense
     * at the end. Pure: the chat it changes is the interceptor's copy of the prompt
     * messages, never the saved chat.
     *
     *     insertTexts(chat, history, options) → number of messages inserted
     */

    const ChatViewModel = window.EchoTextChatViewModel;
    const Life = () => window.EchoTextDailyLife;

    // ST's narrator type (system-messages.js): sent with the system role and no name prefix
    const NARRATOR_TYPE = 'narrator';
    // Within a run of texts the time is said again after a gap this long, or on another day
    const TIME_GAP_MS = 5 * 60000;

    const labelled = (label, value) => (value ? `[${label}: ${value}]` : `[${label}]`);

    /** A bubble as one line of the transcript: its text, or rich content as "[Photo: …]", "[Voice message: …]" and so on. */
    function partText(part) {
        switch (part.type) {
            case 'text': return part.text;
            case 'photo': return labelled('Photo', part.desc);
            case 'voice': return labelled('Voice message', part.text);
            case 'location': return labelled('Location', [part.name, part.address].filter(Boolean).join(', '));
            case 'file': return labelled('File', [part.name, part.summary].filter(Boolean).join(': '));
            case 'music': return labelled('Song', [part.title, part.artist].filter(Boolean).join(' — ') + (part.lyrics?.length ? `: ${part.lyrics.join(' / ')}` : ''));
            case 'link': return labelled('Link', [part.title, part.url].filter(Boolean).join(' — ') + (part.summary ? `: ${part.summary}` : ''));
            case 'transfer': return labelled('Transfer', part.displayAmount);
            case 'transfer_accept': return labelled('Accepted transfer', part.displayAmount);
            case 'transfer_decline': return labelled('Declined transfer', part.displayAmount);
            case 'reaction_note': return labelled('Reaction', part.reaction);
            default: return '';
        }
    }

    const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    /** A time as the model reads it: "2026-10-31 Sat 21:40". */
    function sayWhen(time) {
        const date = new Date(time);
        return `${Life().dateKey(date)} ${WEEKDAYS[date.getDay()]} ${date.toTimeString().slice(0, 5)}`;
    }

    /** What time it is now, so the dates on the texts mean something. */
    function nowMessage(now) {
        return {
            name: 'System',
            is_user: false,
            is_system: false,
            send_date: now.toISOString(),
            mes: `<current_time>\nIt is now ${sayWhen(now.getTime())}.\n</current_time>`,
            extra: { type: NARRATOR_TYPE, echotext: true },
        };
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
     * @param {Date} [options.now] - the time said after them
     * @returns {number} how many messages were inserted
     */
    function insertTexts(chat, history, { charName, userName, timeOf, keepLast = false, now = new Date() }) {
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
            if (!slots.has(slot)) slots.set(slot, { time, lines: [], saidAt: null });
            const run = slots.get(slot);
            const sameDay = run.saidAt !== null && Life().dateKey(new Date(run.saidAt)) === Life().dateKey(new Date(time));
            if (!sameDay || time - run.saidAt >= TIME_GAP_MS) {
                run.lines.push(`[${sayWhen(time)}]`);
                run.saidAt = time;
            }
            run.lines.push(...lines);
        }

        // Last position first, so earlier positions don't move
        const entries = [...slots].sort((a, b) => b[0] - a[0]);
        for (const [slot, { time, lines }] of entries) {
            chat.splice(slot, 0, textsMessage(lines, time, { charName, userName }));
        }
        if (entries.length) chat.splice(keepLast ? chat.length - 1 : chat.length, 0, nowMessage(now));
        return entries.length;
    }

    window.EchoTextStoryTexts = {
        insertTexts,
    };
})();
