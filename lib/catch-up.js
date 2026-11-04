(function () {
    'use strict';

    /**
     * EchoText Catch-up (docs/platform-plan.md 12c, 12d-3)
     *
     * When you open a character's chat after a while nothing ran for them (the app was
     * closed or asleep, or you were on another character), Catch up fills the gap in one
     * request: how their life moved on (Daily Life: a <life> line, settled into the chat's
     * life) and the texts they sent you meanwhile. Which texts, and when, the proactive
     * engine works out by its own rules (lib/proactive-messaging.js simulateAway); the model
     * only writes them, one <text n="…"> each, and they go in at the engine's times.
     * Pure: no settings, DOM or time of its own (lib/daily-life.js is read when called).
     */

    const MIN = 60000;
    const HOUR = 60 * MIN;
    const DAY = 24 * HOUR;
    // Live is the page running with the character open (index.js markSeen, every minute);
    // a gap longer than AWAY_MS in that is time it didn't run, and what was due then is
    // caught up on. A browser tab in the background ticks once a minute at worst, so a few
    // minutes. Daily Life settles a gap only this long (settling is a request of its own)
    const AWAY_MS = 5 * MIN;
    const SETTLE_GAP_MS = 3 * HOUR;
    // Only these last days are filled in; texts at most this many, the latest kept
    const DAYS = 3;
    const MAX_TEXTS = 30;

    const Life = () => window.EchoTextDailyLife;

    const pad = n => String(n).padStart(2, '0');
    /** A time as 'YYYY-MM-DD HH:MM' (local), as the model reads and writes it. */
    const clockText = ms => {
        const d = new Date(ms);
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    /** The same with its weekday first: 'Fri 2026-10-30 19:00'. */
    const dayClockText = ms => `${WEEKDAYS[new Date(ms).getDay()]} ${clockText(ms)}`;

    /**
     * What the model is told: the gap (the week itself is in the system prompt's
     * <schedule>), then (settling) how many days of it are told, the errands and how to
     * write the <life> line, and (texting) the texts to write, each with its number, its
     * time, the line of the schedule it falls in and what may be on her mind then
     * (`texts`: { n, at, note }, from the engine's events), and how they're written
     * (`guidance`, lib/proactive-rounds.js catchUpGuidance).
     */
    function buildInstruction({ charName = 'Character', userName = 'User', from, now, settle = false, schedule = null, errands = [],
        madeUp = false, texts = [], guidance = null }) {
        const N = charName, U = userName;
        const parts = [`CATCH-UP: ${U} hasn't been around since ${dayClockText(from)}; it is now ${dayClockText(now)}. ${N}'s life went on meanwhile.`];
        const olderDays = Math.floor((now - DAYS * DAY - from) / DAY);
        const withSchedule = !!schedule && Life().hasSchedule(schedule);
        if (settle) {
            if (withSchedule) parts.push(`Those days went by as ${N}'s usual week in <schedule> has them, unless something changed them.`);
            if (olderDays > 0) parts.push(`Only the last ${DAYS} days are told in detail: ${olderDays} more ${olderDays === 1 ? 'day' : 'days'} went by before them.`);
            parts.push(errands.length
                ? `${N}'s errands now:\n${errands.map(e => `- ${e.text}${e.progress ? ` (${e.progress})` : ''}; due ${e.due}`).join('\n')}`
                : `${N} has no errands now.`);
            parts.push(`First write one <life> line with what happened to ${N} over this time and how the errands moved, the changes separated by semicolons: `
                + `happened <what> (YYYY-MM-DD HH:MM); update <errand>: <how it stands now>; done <errand>`
                + (madeUp ? `; new <errand> (due YYYY-MM-DD) for something that comes up, true to who ${N} is` : '')
                + `. An errand past its due day is done, or updated if it's dragging on. `
                + (olderDays > 0 ? `Sum up the days before in one happened entry. ` : '')
                + `A handful of entries, the ones that matter: what happened is ${Life().HAPPENED_BAR(N)}. ${Life().NOT_EVENTS(N, U, withSchedule)}. `
                + `Do not create duplicate entries for events already recorded in What happened lately. You may reference those events for continuity, but only add genuinely new developments.`);
        }
        if (texts.length) {
            const lines = texts.map(({ n, at, note }) => {
                const block = withSchedule ? Life().blockAt(schedule, new Date(at)) : null;
                return `- n=${n} · ${dayClockText(at)}${block ? ` · ${Life().blockLine(block.block)}` : ''}${note ? ` · on ${N}'s mind: ${note}` : ''}`;
            });
            parts.push(`${settle ? 'Then' : 'Write'} the texts ${N} sent ${U} meanwhile, in this order:\n${lines.join('\n')}\n`
                + `Write each as <text n="…">…</text> with its number, in the usual format, what ${N} would really send at that moment, one to three texts. `
                + `One for every number and no others: the times and the order are fixed.`
                + (guidance ? `\n${guidance}` : ''));
        }
        // Only what's asked for: settling alone wants no texts, though the chat may end with theirs unanswered
        parts.push(texts.length && settle ? 'Write the changes and the texts in the language of the conversation, and nothing else.'
            : texts.length ? 'Write the texts in the language of the conversation, and nothing else.'
            : `Write only the <life> line, in the language of the conversation: no texts this time, and nothing else.`);
        return parts.join('\n\n');
    }

    const TEXT_RE = /<\s*text\b([^>]*)>([\s\S]*?)<\s*\/\s*text\s*>/gi;
    const N_RE = /\bn\s*=\s*["']?(\d+)/i;

    /**
     * The model's answer: the <life> changes (dated from `now`) and the texts by their number
     * (`asked`: the numbers wanted). A text without one of those numbers, or written twice, is
     * left out: it stays missing, its time and place the engine's whatever is written.
     */
    function readAnswer(text, { now, asked = [] }) {
        const source = String(text ?? '');
        // Not "now": what happened over the gap happened before you came back
        const { life } = Life().parseLifeTag(source, new Date(now), { stampNow: false });
        const wanted = new Set(asked);
        const texts = [];
        for (const [, attrs, body] of source.matchAll(TEXT_RE)) {
            const n = Number(attrs.match(N_RE)?.[1]);
            const mes = body.trim();
            if (!wanted.has(n) || !mes) continue;
            wanted.delete(n);
            texts.push({ n, mes });
        }
        return { life, texts };
    }

    window.EchoTextCatchUp = { AWAY_MS, SETTLE_GAP_MS, DAYS, MAX_TEXTS, clockText, buildInstruction, readAnswer };
})();
