(function () {
    'use strict';

    /**
     * EchoText Catch-up (docs/platform-plan.md 12c, 12d-3)
     *
     * When you open a character's chat after a while nothing ran for them (the app was
     * closed or asleep, or you were on another character), Catch up fills the gap in one
     * request: how their life moved on (Daily Life: a <life> line, settled into the chat's
     * life) and the texts they sent you meanwhile (Proactive: a few <text at="…"> ones, put
     * in the chat with their own times). Only the last few days count, whatever the gap.
     * Pure: no settings, DOM or time of its own (lib/daily-life.js and
     * lib/proactive-rounds.js are read when called).
     */

    const MIN = 60000;
    const HOUR = 60 * MIN;
    const DAY = 24 * HOUR;
    // A gap shorter than this needs no catching up
    const GAP_MS = 3 * HOUR;
    // Only these last days are filled in; texts at most this many
    const DAYS = 3;
    const MAX_TEXTS = 6;
    // Without a schedule, texts keep to the day: none before 09:00 or from 23:00
    const DAY_STARTS = 9;
    const DAY_ENDS = 23;

    const Life = () => window.EchoTextDailyLife;
    const Rounds = () => window.EchoTextProactiveRounds;

    const pad = n => String(n).padStart(2, '0');
    /** A time as 'YYYY-MM-DD HH:MM' (local), as the model reads and writes it. */
    const clockText = ms => {
        const d = new Date(ms);
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    const startOfDay = ms => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };

    /**
     * Where a text at `ms` can go: with a schedule, out of sleep and busy stretches (to
     * when they end; a change of plan by hand, `override`, counts); without, into the day
     * (09:00–23:00).
     */
    function placeText(ms, schedule, override = null) {
        if (schedule && Life().hasSchedule(schedule)) {
            let at = ms;
            for (let i = 0; i < 6; i++) {
                const now = Life().phoneAt({ schedule, override, date: new Date(at) });
                if (now.phone === 'free') return at;
                at = now.endsAt + 5 * MIN;
            }
            return at;
        }
        const d = new Date(ms);
        if (d.getHours() < DAY_STARTS) return new Date(d.getFullYear(), d.getMonth(), d.getDate(), DAY_STARTS).getTime();
        if (d.getHours() >= DAY_ENDS) return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, DAY_STARTS).getTime();
        return ms;
    }

    /**
     * When the character would have texted over a gap: from `from` to `to`, only the last
     * DAYS of it, one text a day at most, each after their topic wait (longer for every
     * one unanswered), as many as their temperament allows in a row with no answer (less
     * the `unanswered` ones already), at most MAX_TEXTS and `left` (the day's requests).
     * Sleep and busy stretches (or the night, without a schedule) push a text on.
     */
    function planTexts({ from, to, temperament, unanswered = 0, baseHours, schedule = null, override = null, left = Infinity }) {
        const t = Rounds().temperamentOf(temperament);
        let room = Math.min(t.topicCap - unanswered, MAX_TEXTS, left);
        const start = Math.max(from, to - DAYS * DAY);
        const texts = [];
        const days = new Set();
        let u = unanswered;
        let at = start + Rounds().topicWaitHours({ baseHours, temperament, unanswered: u }) * HOUR;
        for (let guard = 0; room > 0 && guard < 40; guard++) {
            const when = placeText(at, schedule, override);
            if (when > to) break;
            const day = startOfDay(when);
            if (days.has(day)) { at = day + DAY + DAY_STARTS * HOUR; continue; }
            texts.push(when);
            days.add(day);
            room--;
            u++;
            at = when + Rounds().topicWaitHours({ baseHours, temperament, unanswered: u }) * HOUR;
        }
        return texts;
    }

    /** The schedule over the days a gap's last part covers, a line a day: "Thu 2026-10-29: 09:00–18:00 work (office); …". */
    function scheduleLines({ schedule, from, to }) {
        if (!schedule || !Life().hasSchedule(schedule)) return [];
        const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const lines = [];
        for (let day = startOfDay(Math.max(from, to - DAYS * DAY)); day <= to; day += DAY) {
            const d = new Date(day + 12 * HOUR);
            const blocks = Life().normalizeSchedule(schedule)[Life().dayOf(d)];
            if (!blocks.length) continue;
            const items = blocks.map(b => `${b.from}–${b.to} ${b.doing || b.place}${b.doing && b.place ? ` (${b.place})` : ''}${b.phone === 'asleep' ? ' [asleep]' : ''}`);
            lines.push(`${names[d.getDay()]} ${clockText(day).slice(0, 10)}: ${items.join('; ')}`);
        }
        return lines;
    }

    /**
     * What the model is told: the gap and the time in it the two were together (`together`:
     * { from, until }), then (settling) the schedule over its last days, the errands and
     * how to write the <life> line, and (texting) the moments to write a text for, each
     * with what the character was doing then.
     */
    function buildInstruction({ charName = 'Character', userName = 'User', from, now, settle = false, schedule = null, errands = [],
        madeUp = false, texts = [], together = null }) {
        const N = charName, U = userName;
        const parts = [`CATCH-UP: ${U} hasn't been around since ${clockText(from)}; it is now ${clockText(now)}. ${N}'s life went on meanwhile.`];
        if (together && together.from < now && together.until > from) {
            parts.push(`${N} was with ${U} in person from ${clockText(Math.max(together.from, from))} to ${clockText(Math.min(together.until, now))}; that's noted already, so leave it out.`);
        }
        const olderDays = Math.floor((now - DAYS * DAY - from) / DAY);
        if (settle) {
            const lines = scheduleLines({ schedule, from, to: now });
            if (lines.length) parts.push(`${N}'s days lately, from the schedule:\n${lines.map(l => `- ${l}`).join('\n')}`);
            if (olderDays > 0) parts.push(`Before those days, ${olderDays} more ${olderDays === 1 ? 'day' : 'days'} went by.`);
            parts.push(errands.length
                ? `${N}'s errands now:\n${errands.map(e => `- ${e.text}${e.progress ? ` (${e.progress})` : ''}; due ${e.due}`).join('\n')}`
                : `${N} has no errands now.`);
            parts.push(`First write one <life> line with what happened to ${N} over this time and how the errands moved, the changes separated by semicolons: `
                + `happened <what> (YYYY-MM-DD HH:MM); update <errand>: <how it stands now>; done <errand>`
                + (madeUp ? `; new <errand> (due YYYY-MM-DD) for something that comes up, true to who ${N} is` : '')
                + `. An errand past its due day is done, or updated if it's dragging on. `
                + (olderDays > 0 ? `Sum up the days before in one happened entry. ` : '')
                + `A handful of entries, the ones that matter.`);
        }
        if (texts.length) {
            const moments = texts.map(ms => {
                const block = schedule && Life().hasSchedule(schedule) ? Life().blockAt(schedule, new Date(ms)) : null;
                const doing = block ? ` (${block.block.doing || block.block.place})` : '';
                return `- ${clockText(ms)}${doing}`;
            });
            parts.push(`${settle ? 'Then' : 'Write'} the texts ${N} sent ${U} meanwhile, each still unanswered when the next came, one at each of these moments:\n${moments.join('\n')}\n`
                + `Write each as <text at="YYYY-MM-DD HH:MM">…</text>, in the usual format, what ${N} would really send then.`);
        }
        parts.push('Write the changes and the texts in the language of the conversation, and nothing else.');
        return parts.join('\n\n');
    }

    const TEXT_RE = /<\s*text\b([^>]*)>([\s\S]*?)<\s*\/\s*text\s*>/gi;
    const AT_RE = /(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})/;

    /**
     * The model's answer: the <life> changes (dated from `now`) and the texts, each kept
     * at its own time when that's in the gap and after the one before, else at the
     * planned moment; no more than were asked for.
     */
    function readAnswer(text, { from, now, planned = [] }) {
        const source = String(text ?? '');
        // Not "now": what happened over the gap happened before you came back
        const { life } = Life().parseLifeTag(source, new Date(now), { stampNow: false });
        const texts = [];
        let last = from;
        for (const [, attrs, body] of source.matchAll(TEXT_RE)) {
            if (texts.length >= planned.length) break;
            const mes = body.trim();
            if (!mes) continue;
            const m = attrs.match(AT_RE);
            let at = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime() : NaN;
            if (!(at > last && at <= now)) at = planned[texts.length];
            if (!(at > last && at <= now)) at = Math.min(now, last + MIN);
            texts.push({ at, mes });
            last = at;
        }
        return { life, texts };
    }

    window.EchoTextCatchUp = { GAP_MS, DAYS, MAX_TEXTS, clockText, placeText, planTexts, scheduleLines, buildInstruction, readAnswer };
})();
