(function () {
    'use strict';

    /**
     * EchoText Proactive Rounds
     *
     * How a character follows up when you go quiet (docs/platform-plan.md 12d): the texts
     * come in rounds, each wait longer than the one before, until the round dies down.
     * How fast, how long and how many is the character's temperament, "When ignored":
     *
     *   settings.proactiveTemperament[k]  'aloof' | 'normal' | 'clingy' | 'obsessed'
     *                                      (none: from the Big Five, defaultTemperament)
     *
     * A round A starts when you go quiet in the middle of a conversation; its texts are
     * written in one request and let out one by one (lib/proactive-messaging.js). A round B
     * is the character starting something new after a while (a "topic"): with Daily Life,
     * from their own day; unanswered, each waits longer, up to a few in a row.
     * Pure: no settings, DOM or time of its own.
     */

    const MIN = 60000;
    const HOUR = 60 * MIN;

    // firstMinutes: when the round's first text comes, after the character's last one.
    // growth: each wait after that is the one before times this. max: texts in a round.
    // skip: the chance an aloof character lets it go without a word. againHours: an
    // obsessed character's next round, after the last one ran out. topicHours: how
    // often they start something new; topicCap: new topics in a row with no answer, each
    // waiting topicHours × growth per one unanswered. dailyRequests: proactive requests a
    // day, at most. partedChance, partedMinutes: how likely a text is after time together
    // ends, and how long after.
    const TEMPERAMENTS = [
        { id: 'aloof', label: 'Aloof', firstMinutes: [60, 180], growth: 1, max: 1, skip: 0.3, againHours: null, topicHours: [24, 48], topicCap: 1, dailyRequests: 3, partedChance: 0.3, partedMinutes: [20, 30] },
        { id: 'normal', label: 'Normal', firstMinutes: [20, 60], growth: 3, max: 2, skip: 0, againHours: null, topicHours: [6, 10], topicCap: 2, dailyRequests: 8, partedChance: 0.7, partedMinutes: [15, 30] },
        { id: 'clingy', label: 'Clingy', firstMinutes: [3, 10], growth: 2, max: 4, skip: 0, againHours: null, topicHours: [3, 5], topicCap: 3, dailyRequests: 15, partedChance: 1, partedMinutes: [10, 20] },
        { id: 'obsessed', label: 'Obsessed', firstMinutes: [0.5, 2], growth: 1.5, max: 10, skip: 0, againHours: [2, 4], topicHours: [1, 2], topicCap: 5, dailyRequests: 30, partedChance: 1, partedMinutes: [10, 15] },
    ];
    const TEMPERAMENT_IDS = TEMPERAMENTS.map(t => t.id);
    const temperamentOf = id => TEMPERAMENTS.find(t => t.id === id) || TEMPERAMENTS[1];

    // All characters together: proactive requests an hour, at most
    const HOURLY_REQUESTS = 20;
    // A character's texts are at least this far apart
    const MIN_GAP_MS = 30 * 1000;
    // You went quiet "in the middle of a conversation" when you had texted this soon before her last text
    const OPEN_CONVERSATION_MS = 30 * MIN;

    /** The temperament the Big Five suggest: outgoing and sensitive is clingy, reserved is aloof; obsessed only by choice. */
    function defaultTemperament(bigFive) {
        const E = bigFive?.E, N = bigFive?.N;
        if (E === 'high' && N === 'high') return 'clingy';
        if (E === 'low') return 'aloof';
        return 'normal';
    }

    const between = ([lo, hi], random) => lo + random() * (hi - lo);

    /**
     * When a round's texts come (ms), counted from `startAt` (the character's last text):
     * the first after the temperament's first wait (`firstHours` instead for an obsessed
     * character's later round), each next wait the one before times its growth, give or
     * take a fifth. Empty when an aloof character lets it go.
     */
    function planRound({ temperament, startAt, random = Math.random, firstHours = null }) {
        const t = temperamentOf(temperament);
        if (t.skip && random() < t.skip) return [];
        const base = between(t.firstMinutes, random) * MIN;
        let at = startAt + (firstHours ? between(firstHours, random) * HOUR : base);
        const times = [Math.round(at)];
        let wait = base;
        for (let i = 1; i < t.max; i++) {
            wait *= t.growth;
            at += Math.max(MIN_GAP_MS, wait * (0.8 + random() * 0.4));
            times.push(Math.round(at));
        }
        return times;
    }

    /**
     * Whether the chat's last message is the character's, sent while you two were talking:
     * you had texted no more than half an hour before it.
     */
    function isConversationOpen(history) {
        const list = Array.isArray(history) ? history : [];
        const last = list[list.length - 1];
        if (!last || last.is_user) return false;
        const lastAt = Number(last.send_date) || Date.parse(last.send_date);
        for (let i = list.length - 2; i >= 0; i--) {
            if (!list[i]?.is_user) continue;
            const at = Number(list[i].send_date) || Date.parse(list[i].send_date);
            return Number.isFinite(at) && Number.isFinite(lastAt) && lastAt - at <= OPEN_CONVERSATION_MS;
        }
        return false;
    }

    const sayMinutes = ms => {
        const m = Math.max(1, Math.round(ms / MIN));
        if (m < 60) return m === 1 ? 'a minute' : `${m} minutes`;
        const h = Math.round(m / 60);
        return h === 1 ? 'an hour' : `${h} hours`;
    };

    // How each temperament carries on when nobody answers
    const FLAVOR = {
        aloof: 'one short, cool nudge; nothing needy',
        normal: 'a light nudge, then letting it go',
        clingy: 'a little more needy with each one',
        obsessed: 'more anxious and insistent with each one: they can\'t let it go',
    };

    /**
     * What the model is told for a round: you went quiet, how many texts to write and when
     * each comes after the character's last one, how this temperament carries on, and to
     * separate the texts with a line holding only ---.
     */
    function roundInstruction({ charName = 'Character', userName = 'User', temperament, waits, round = 1 }) {
        const N = charName, U = userName;
        const count = waits.length;
        const when = waits.map((ms, i) => `${i === 0 ? 'the first' : i === count - 1 ? 'the last' : `text ${i + 1}`} ${sayMinutes(ms)} after ${N}'s last one`).join(', ');
        const before = round > 1 ? ` ${U} hasn't answered ${N}'s earlier follow-ups for hours either.` : '';
        return `${U} went quiet in the middle of your conversation and hasn't answered ${N}'s last text.${before} `
            + `Write the ${count === 1 ? 'text' : `${count} texts`} ${N} sends while still getting no answer, as ${N} would: ${FLAVOR[temperamentOf(temperament).id]}. `
            + (count > 1 ? `They come one after another: ${when}. ` : `It comes ${sayMinutes(waits[0])} after ${N}'s last one. `)
            + (count > 1 ? 'Put a line holding only --- between one text and the next; each text can be one or more lines, in the usual format.' : 'Write it in the usual format.');
    }

    /**
     * A round's texts in the model's answer: split at lines holding only --- (or ***, ———);
     * without them, one line each, the rest in the last. At most `count`.
     */
    function splitRound(text, count) {
        const lines = String(text ?? '').replace(/\r/g, '').split('\n');
        const parts = [];
        let current = [];
        let split = false;
        for (const line of lines) {
            if (/^\s*(?:-{3,}|\*{3,}|—{2,}|_{3,})\s*$/.test(line)) { split = true; parts.push(current.join('\n')); current = []; continue; }
            current.push(line);
        }
        parts.push(current.join('\n'));
        let texts = parts.map(p => p.trim()).filter(Boolean);
        if (!split && texts.length === 1 && count > 1) {
            const each = texts[0].split('\n').map(l => l.trim()).filter(Boolean);
            texts = [...each.slice(0, count - 1), each.slice(count - 1).join('\n')].filter(Boolean);
        }
        return texts.slice(0, count);
    }

    // ── Topics (round B) ────────────────────────────────────────────────────

    // With a schedule these give way to it: fixed clock times for every character
    const CLOCK_TRIGGERS = ['late_night', 'post_midnight_impulse', 'pre_dawn', 'morning_wave', 'commute_ping', 'quiet_productive',
        'lunch_nudge', 'afternoon_slump', 'post_work', 'evening_winddown', 'weekend_ping', 'monday_reboot', 'midweek_check',
        'friday_feeling', 'sunday_scaries', 'sunday_evening'];
    // The topics a character's own day gives
    const LIFE_TRIGGERS = ['block_change', 'errand', 'life_event', 'parted'];
    // Just got free: this long after a busy or sleeping stretch ends
    const JUST_FREE_MS = 30 * MIN;

    // A text after parting not out this long after its time is left unsent (the page wasn't running)
    const PARTED_LATE_MS = 60 * MIN;

    /** When a character texts after time together ended at `endedAt` (ms); null when their temperament lets it go. */
    function partedAt({ temperament, endedAt, random = Math.random }) {
        const t = temperamentOf(temperament);
        return random() < t.partedChance ? Math.round(endedAt + between(t.partedMinutes, random) * MIN) : null;
    }

    /** How long a character waits before a new topic: their topic gap times their growth once per unanswered one. */
    function topicWaitHours({ baseHours, temperament, unanswered = 0 }) {
        return baseHours * Math.pow(temperamentOf(temperament).growth, Math.max(0, unanswered));
    }

    /** Whether they've just got free: free now, after a busy or sleeping stretch that ended within half an hour. */
    function justGotFree({ phone, prevPhone, since, now }) {
        return phone !== 'busy' && phone !== 'asleep' && (prevPhone === 'busy' || prevPhone === 'asleep')
            && Number.isFinite(since) && now - since >= 0 && now - since <= JUST_FREE_MS;
    }

    /**
     * What the character's own day gives them to text about: having just got free (what
     * kept them busy, what they're doing now), an errand due by tomorrow (the soonest),
     * today's change of plans or something that happened today. Each { type, weight, detail }.
     * `sayDay(date, today)` words a due day.
     */
    function lifeTopics({ day, sayDay = d => d }) {
        if (!day) return [];
        const topics = [];
        const { life, today } = day;
        if (day.justFree) {
            const now = day.block ? day.block.doing || day.block.place : '';
            topics.push({ type: 'block_change', weight: 70, detail: `${day.prevDoing || 'what kept them busy'} is over${now ? `; now: ${now}` : ''}` });
        }
        const due = (life?.errands || []).filter(e => e.due <= sayTomorrow(today)).sort((a, b) => a.due.localeCompare(b.due))[0];
        if (due) topics.push({ type: 'errand', weight: 65, detail: `${due.text}${due.progress ? ` (${due.progress})` : ''}, ${due.due < today ? 'was due' : 'due'} ${sayDay(due.due, today)}` });
        const news = life?.today ? `today's change of plans: ${life.today.text}` : (life?.log || []).filter(e => e.date === today).map(e => e.text).pop();
        if (news) topics.push({ type: 'life_event', weight: 55, detail: news });
        return topics;
    }

    /** The day after a 'YYYY-MM-DD'. */
    function sayTomorrow(today) {
        const [y, m, d] = String(today).split('-').map(Number);
        const t = new Date(y, m - 1, d + 1);
        const p = n => String(n).padStart(2, '0');
        return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
    }

    /** What the model is told for a topic from the character's own day. */
    function topicInstruction({ type, detail, charName = 'Character', userName = 'User', timeSince }) {
        const N = charName, U = userName;
        if (type === 'parted') return `${N} and ${U} were together in person and have just parted. Text ${U} now that they're apart, the way ${N} would, without summing up what they did.`;
        const since = `It has been ${timeSince} since ${U} last texted.`;
        if (type === 'block_change') return `${N} just got free: ${detail}. ${since} Text ${U} about what ${N} just did or what's next.`;
        if (type === 'errand') return `On ${N}'s mind: ${detail}. ${since} Tell ${U} about it, the way ${N} would.`;
        return `Something from ${N}'s day: ${detail}. ${since} Share it with ${U}.`;
    }

    /** The hour a time falls in, for counting requests: 'YYYY-MM-DDTHH' (local). */
    function hourKey(date) {
        const p = n => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}`;
    }

    window.EchoTextProactiveRounds = {
        TEMPERAMENTS, TEMPERAMENT_IDS, HOURLY_REQUESTS, MIN_GAP_MS, OPEN_CONVERSATION_MS,
        temperamentOf, defaultTemperament, planRound, isConversationOpen, roundInstruction, splitRound, hourKey,
        CLOCK_TRIGGERS, LIFE_TRIGGERS, JUST_FREE_MS, PARTED_LATE_MS, partedAt, topicWaitHours, justGotFree, lifeTopics, topicInstruction,
    };
})();
