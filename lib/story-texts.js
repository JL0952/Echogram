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
     * prompt cache holds. What does change goes last of all (addToEnd): what time it is
     * now and how the character's day stands. Pure: the chat it changes is the
     * interceptor's copy of the prompt messages, never the saved chat.
     *
     * The other way round, the story goes between the texts of EchoText's own request,
     * so its model can tell what came first: the same order on both sides.
     *
     *     insertTexts(chat, history, options) → number of messages inserted
     *     addToEnd(chat, options)             → the time now and the character's day, last
     *     storyWindow(story, limits)          → the story messages to send
     *     weaveStory(turns, story)            → the chat turns with the story between them
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

    /** Adds `lines` to a run of messages sent at `time`, saying the time when it has moved on. */
    function addToRun(run, time, lines) {
        const sameDay = run.saidAt !== null && Life().dateKey(new Date(run.saidAt)) === Life().dateKey(new Date(time));
        if (!sameDay || time - run.saidAt >= TIME_GAP_MS) {
            run.lines.push(`[${sayWhen(time)}]`);
            run.saidAt = time;
        }
        run.lines.push(...lines);
    }

    /**
     * What goes after the story, so that it changing leaves all that before it the same:
     * what time it is now, so the dates on the texts mean something, and `today`, how the
     * character's day stands (lib/daily-life.js describeToday).
     * @param {boolean} [options.keepLast=false] - the last story message stays last (Continue extends it)
     */
    function addToEnd(chat, { now = new Date(), today = '', keepLast = false } = {}) {
        chat.splice(keepLast ? chat.length - 1 : chat.length, 0, {
            name: 'System',
            is_user: false,
            is_system: false,
            send_date: now.toISOString(),
            mes: `<current_time>\nIt is now ${sayWhen(now.getTime())}.\n</current_time>${today ? `\n${today}` : ''}`,
            extra: { type: NARRATOR_TYPE, echotext: true },
        });
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
            if (!slots.has(slot)) slots.set(slot, { time, lines: [], saidAt: null });
            addToRun(slots.get(slot), time, lines);
        }

        // Last position first, so earlier positions don't move
        const entries = [...slots].sort((a, b) => b[0] - a[0]);
        for (const [slot, { time, lines }] of entries) {
            chat.splice(slot, 0, textsMessage(lines, time, { charName, userName }));
        }
        return entries.length;
    }

    /**
     * The story messages to send, the latest ones within `maxMessages` and `maxChars`. Old
     * ones leave a chunk at a time, not one by one: a chunk's start depends only on what
     * came before it, so what's sent stays the same as the story goes on, and a prompt
     * cache holds until a chunk goes. A latest chunk over the limits is sent all the same.
     * @param {{ speaker: string, text: string }[]} story - oldest first
     */
    function storyWindow(story, { maxMessages, maxChars, chunkMessages, chunkChars }) {
        const sizes = story.map(m => m.speaker.length + m.text.length);
        const starts = [0];
        let count = 0, chars = 0;
        sizes.forEach((size, i) => {
            if (count >= chunkMessages || chars >= chunkChars) { starts.push(i); count = 0; chars = 0; }
            count++;
            chars += size;
        });
        const fits = start => story.length - start <= maxMessages && sizes.slice(start).reduce((a, b) => a + b, 0) <= maxChars;
        return story.slice(starts.find(fits) ?? starts[starts.length - 1]);
    }

    /** A run of story messages as one turn among the texts. */
    function storyMessage(run) {
        return {
            role: 'system',
            content: `<story_events>\nThe roleplay went on here, in person. Reference only, written as narrative prose: never continue it or copy its narration, and don't answer it as a text.\n${run.lines.join('\n')}\n</story_events>`,
        };
    }

    /**
     * The chat's turns with the story between them by time: each run of story messages
     * goes before the first turn sent after it. An unknown or earlier time takes the one
     * before it, on either side.
     * @param {{ role: string, content: string, time: number }[]} turns - oldest first
     * @param {{ speaker: string, text: string, time: number }[]} story - oldest first
     * @returns {{ role: string, content: string }[]}
     */
    function weaveStory(turns, story) {
        const out = [];
        let next = 0;
        let storyTime = -Infinity, turnTime = -Infinity;
        const flushUntil = limit => {
            const run = { lines: [], saidAt: null };
            for (; next < story.length; next++) {
                const time = Number.isFinite(story[next].time) && story[next].time > storyTime ? story[next].time : storyTime;
                if (time > limit) break;
                storyTime = time;
                const line = `${story[next].speaker}: ${story[next].text}`;
                if (Number.isFinite(time)) addToRun(run, time, [line]);
                else run.lines.push(line);
            }
            if (run.lines.length) out.push(storyMessage(run));
        };
        for (const turn of turns) {
            if (Number.isFinite(turn.time) && turn.time > turnTime) turnTime = turn.time;
            flushUntil(turnTime);
            out.push({ role: turn.role, content: turn.content });
        }
        flushUntil(Infinity);
        return out;
    }

    window.EchoTextStoryTexts = {
        insertTexts,
        addToEnd,
        storyWindow,
        weaveStory,
    };
})();
