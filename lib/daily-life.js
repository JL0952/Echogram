(function () {
    'use strict';

    /**
     * EchoText Daily Life
     *
     * The character's week as plain data (docs/platform-plan.md 12a):
     *
     *   schedule (per character, kept across chats: settings.characterSchedules[k])
     *     { weekday: [block], saturday: [block], sunday: [block] }
     *     block = { from: 'HH:MM', to: 'HH:MM', place, doing, phone: 'free' | 'busy' | 'asleep' }
     *
     * A block whose end is not after its start runs past midnight (23:30–07:00) and
     * belongs to the day it starts on. Time between blocks is free, with no place.
     *
     *   life (per character's chat: settings.lifeState[k], reset with it, saved in archives; 12b)
     *     { start: { errands: [errand], log: [entry], today: { date, text } | null }, startAt: ms }
     *     errand = { id, text, progress, due: 'YYYY-MM-DD', feeling, from: 'you' | 'chat' | 'model' }
     *     entry  = { id, date: 'YYYY-MM-DD', text }   (something that happened)
     *   today is a change to the schedule for that date only. What happened is kept for a
     *   week, at most MAX_LOG entries; at most MAX_ERRANDS errands.
     *
     *   change of plan by hand (per character: settings.phoneOverrides[k])
     *     { phone, from: ms, until: ms }   (the phone state instead of the schedule's meanwhile)
     *
     * Dates are local calendar days. Pure: no settings, DOM or time of its own.
     */

    const DAYS = [
        { id: 'weekday', label: 'Weekdays' },
        { id: 'saturday', label: 'Saturday' },
        { id: 'sunday', label: 'Sunday' },
    ];
    const DAY_IDS = DAYS.map(d => d.id);

    const PHONES = [
        { id: 'free', label: 'Free', icon: 'fa-mobile-screen-button' },
        { id: 'busy', label: 'Busy', icon: 'fa-bell-slash' },
        { id: 'asleep', label: 'Asleep', icon: 'fa-moon' },
    ];
    const PHONE_IDS = PHONES.map(p => p.id);

    const MAX_BLOCKS = 24;
    // Only a guard against runaway text: what's written is kept whole, and the rows hide what doesn't fit
    const MAX_FIELD = 500;

    const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
    const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

    /** 'HH:MM' as minutes after midnight. */
    function minutesOf(time) {
        const [h, m] = String(time).split(':').map(Number);
        return h * 60 + m;
    }

    const pad = n => String(n).padStart(2, '0');
    const clip = (s, max = MAX_FIELD) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

    function normalizeBlock(raw) {
        if (!isObject(raw) || !TIME_RE.test(raw.from) || !TIME_RE.test(raw.to) || raw.from === raw.to) return null;
        return {
            from: raw.from,
            to: raw.to,
            place: clip(raw.place),
            doing: clip(raw.doing),
            phone: PHONE_IDS.includes(raw.phone) ? raw.phone : 'free',
        };
    }

    // ── Overlaps ────────────────────────────────────────────────────────────
    // A day's blocks never overlap: where two would, the one that began later in real time
    // keeps the time (a block edited by hand keeps all of it), and the other is cut back,
    // split in two around it, or dropped once nothing is left. Times are minutes on a line
    // from this day's midnight; a block past midnight runs on beyond 24:00. Weekdays repeat,
    // so a weekday night also meets the next weekday's morning; Saturday's and Sunday's
    // nights run into another list, met only when looking a time up (blockAt).

    const DAY_MIN = 24 * 60;
    // What's left of a cut block shorter than this goes too
    const MIN_PIECE = 5;

    const spanOf = block => {
        const s = minutesOf(block.from), t = minutesOf(block.to);
        return [s, t > s ? t : t + DAY_MIN];
    };
    const clockOf = m => `${pad(Math.floor((m % DAY_MIN) / 60))}:${pad(m % 60)}`;

    /** What's left of [s, e) once [ws, we) is taken out: none, one or two pieces. */
    function cutOut([s, e], [ws, we]) {
        if (we <= s || ws >= e) return [[s, e]];
        return [...(ws > s ? [[s, ws]] : []), ...(we < e ? [[we, e]] : [])];
    }

    /**
     * A block with the given times (on its own day's line) taken out: the blocks left, in
     * order. A piece starting after midnight stays only on a repeating list (weekdays).
     */
    function cutBlock(block, cuts, repeats) {
        let pieces = [spanOf(block)];
        for (const cut of cuts) pieces = pieces.flatMap(piece => cutOut(piece, cut));
        return pieces
            .filter(([s, e]) => e - s >= MIN_PIECE && (s < DAY_MIN || repeats))
            .map(([s, e]) => ({ ...block, from: clockOf(s), to: clockOf(e) }));
    }

    /**
     * A day's blocks without overlaps, the later-begun keeping the time: today's later
     * start beats an earlier one; on a repeating list, tomorrow's morning beats tonight.
     * Equal starts: the one further down the list.
     */
    function settleDay(blocks, repeats) {
        const spans = blocks.map(spanOf);
        return blocks.flatMap((block, i) => {
            const cuts = [];
            spans.forEach(([s, e], j) => {
                if (j === i) return;
                if (s > spans[i][0] || (s === spans[i][0] && j > i)) cuts.push([s, e]);
                if (repeats) cuts.push([s + DAY_MIN, e + DAY_MIN]);
            });
            return cutBlock(block, cuts, repeats);
        });
    }

    /** A schedule, filled in and cleaned up: every day a list, bad blocks dropped, overlaps settled, each day in time order. */
    function normalizeSchedule(raw) {
        const src = isObject(raw) ? raw : {};
        const out = {};
        for (const day of DAY_IDS) {
            const blocks = Array.isArray(src[day]) ? src[day].map(normalizeBlock).filter(Boolean) : [];
            out[day] = settleDay(blocks, day === 'weekday')
                .sort((a, b) => minutesOf(a.from) - minutesOf(b.from)).slice(0, MAX_BLOCKS);
        }
        return out;
    }

    function hasSchedule(schedule) {
        return !!schedule && DAY_IDS.some(day => Array.isArray(schedule[day]) && schedule[day].length > 0);
    }

    /** Which of the schedule's days a date falls on. */
    function dayOf(date) {
        const d = date.getDay();
        return d === 0 ? 'sunday' : d === 6 ? 'saturday' : 'weekday';
    }

    /**
     * The block the character is in at a date: { day, index, block }, or null between
     * blocks. Today's latest-starting block that has begun wins over last night's
     * that runs past midnight.
     */
    function blockAt(schedule, date) {
        const s = normalizeSchedule(schedule);
        const now = date.getHours() * 60 + date.getMinutes();
        const today = dayOf(date);
        let found = null;
        s[today].forEach((block, index) => {
            const from = minutesOf(block.from), to = minutesOf(block.to);
            const end = to > from ? to : 24 * 60;
            if (from <= now && now < end && (!found || from >= minutesOf(found.block.from))) found = { day: today, index, block };
        });
        if (found) return found;
        // Last night's, the latest-begun of them (a list's own overlaps are settled; this is the rest)
        const yesterday = dayOf(new Date(date.getTime() - 24 * 3600000));
        s[yesterday].forEach((block, index) => {
            const from = minutesOf(block.from), to = minutesOf(block.to);
            if (to <= from && now < to && (!found || from >= minutesOf(found.block.from))) found = { day: yesterday, index, block };
        });
        return found;
    }

    /**
     * The schedule with a day's block replaced (index -1: added), in time order. The block
     * keeps all its time: the others it overlaps are cut back, split around it or dropped.
     * The schedule as it was when the block isn't one (no time, or starting when it ends).
     */
    function withBlock(schedule, day, index, block) {
        const s = normalizeSchedule(schedule);
        const clean = normalizeBlock(block);
        if (!DAY_IDS.includes(day) || !clean) return s;
        const repeats = day === 'weekday';
        const [ws, we] = spanOf(clean);
        // Where its time falls on the others' lines: the same day, and on weekdays the day before and after
        const cuts = (repeats ? [-DAY_MIN, 0, DAY_MIN] : [0]).map(d => [ws + d, we + d]);
        const others = s[day].filter((_, i) => i !== index).flatMap(other => cutBlock(other, cuts, repeats));
        return normalizeSchedule({ ...s, [day]: [...others, clean] });
    }

    /** The schedule without a day's block. */
    function withoutBlock(schedule, day, index) {
        const s = normalizeSchedule(schedule);
        if (!DAY_IDS.includes(day)) return s;
        return { ...s, [day]: s[day].filter((_, i) => i !== index) };
    }

    // ── Unseen texts: busy or asleep, a text may wait (12a-2 follow-up) ─────

    // The chance a busy or sleeping character notices your texts: more unread ones, more likely
    const NOTICE = { busy: { base: 0.35, step: 0.2, max: 0.95 }, asleep: { base: 0.1, step: 0.15, max: 0.9 } };
    // Busy and not noticed: they look at the phone this many minutes later
    const LOOK_AGAIN_MINUTES = [3, 10];
    // Asleep and not woken: they look this many minutes after their sleep ends
    const AFTER_WAKING_MINUTES = [0, 15];

    /** The chance a character in a block with this phone state notices `unread` texts now (1 when free). */
    function noticeChance(phone, unread) {
        const n = NOTICE[phone];
        if (!n) return 1;
        return Math.min(n.max, n.base + n.step * Math.max(0, unread - 1));
    }

    /**
     * When the block a date is in ends, as a Date; null between blocks. A block that
     * begins before then ends it (a Friday night meeting Saturday's own morning).
     */
    function blockEndAt(schedule, date) {
        const current = blockAt(schedule, date);
        if (!current) return null;
        const to = minutesOf(current.block.to);
        let end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(to / 60), to % 60);
        if (end <= date) end = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1, end.getHours(), end.getMinutes());
        const next = nextStartAfter(schedule, date);
        return next && next < end ? next : end;
    }

    /** The start of the next block after a date, today's or tomorrow's, as a Date; null if none. */
    function nextStartAfter(schedule, date) {
        const s = normalizeSchedule(schedule);
        let best = null;
        for (const ahead of [0, 1]) {
            const day = new Date(date.getFullYear(), date.getMonth(), date.getDate() + ahead);
            for (const block of s[dayOf(day)]) {
                const m = minutesOf(block.from);
                const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(m / 60), m % 60);
                if (start > date && (!best || start < best)) best = start;
            }
        }
        return best;
    }

    /**
     * Whether the character sees `unread` texts now, and if not, when they will (ms): busy,
     * a few minutes later; asleep, after their sleep ends. Null: they see them now. Their
     * phone as phoneAt has it (a change of plan by hand, still texting, the schedule).
     */
    function unseenUntil({ schedule, override = null, date, unread, repliedAt = null, random = Math.random }) {
        const { phone } = phoneAt({ schedule, override, date, repliedAt });
        if (random() < noticeChance(phone, unread)) return null;
        const between = ([lo, hi]) => (lo + random() * (hi - lo)) * 60000;
        if (phone === 'busy') return date.getTime() + between(LOOK_AGAIN_MINUTES);
        return (phoneEndsAt({ schedule, override, date }) ?? date.getTime()) + between(AFTER_WAKING_MINUTES);
    }

    // ── The phone now: a change of plan by hand, still texting, the schedule ─

    // A character who answered within this many minutes is still up and free, whatever the schedule says
    const AWAKE_MINUTES = 10;

    /**
     * A change of plan by hand, { phone, from, until } (ms), that holds at a date, else
     * null: its phone state wins over the schedule from when it was made until then.
     */
    function activeOverride(override, date) {
        if (!isObject(override) || !PHONE_IDS.includes(override.phone) || !Number.isFinite(override.from) || !Number.isFinite(override.until)) return null;
        const t = date.getTime();
        return override.from <= t && t < override.until ? { phone: override.phone, from: override.from, until: override.until } : null;
    }

    /** A change of plan made at a date (or `from`), to a phone state until the next 'HH:MM'; null when it isn't one. */
    function makeOverride(phone, until, date, from = date.getTime()) {
        if (!PHONE_IDS.includes(phone) || !TIME_RE.test(until)) return null;
        const m = minutesOf(until);
        let end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(m / 60), m % 60);
        if (end <= date) end = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1, end.getHours(), end.getMinutes());
        return { phone, from, until: end.getTime() };
    }

    /** When the schedule next changes after a date: the end of the block it's in, or the next one's start; null if none. */
    function stretchEndAt(schedule, date) {
        return blockAt(schedule, date) ? blockEndAt(schedule, date) : nextStartAfter(schedule, date);
    }

    /**
     * The character's phone at a date: { phone, endsAt (ms; null: no change ahead), by }.
     * A change of plan by hand (`override`) wins while it holds (by 'plan'); then one who
     * answered within AWAKE_MINUTES (`repliedAt`) is up and free whatever the schedule
     * says (by 'texting'); else the schedule's block, free between blocks (by 'schedule').
     */
    function phoneAt({ schedule = null, override = null, date, repliedAt = null }) {
        const plan = activeOverride(override, date);
        if (plan) return { phone: plan.phone, endsAt: plan.until, by: 'plan' };
        const withSchedule = hasSchedule(schedule);
        const block = withSchedule ? blockAt(schedule, date) : null;
        const phone = block ? block.block.phone : 'free';
        const t = date.getTime();
        if (phone !== 'free' && Number.isFinite(repliedAt) && repliedAt <= t && t - repliedAt < AWAKE_MINUTES * 60000) {
            return { phone: 'free', endsAt: repliedAt + AWAKE_MINUTES * 60000, by: 'texting' };
        }
        const end = withSchedule ? stretchEndAt(schedule, date) : null;
        return { phone, endsAt: end ? end.getTime() : null, by: 'schedule' };
    }

    /**
     * When the phone state at a date gives way to another, as ms (a change of plan running
     * into more of the same goes on with it); null if none is ahead.
     */
    function phoneEndsAt({ schedule = null, override = null, date }) {
        const { phone } = phoneAt({ schedule, override, date });
        let at = date.getTime();
        for (let i = 0; i < 6; i++) {
            const now = phoneAt({ schedule, override, date: new Date(at) });
            if (now.phone !== phone) return at;
            if (now.endsAt === null) return null;
            at = now.endsAt;
        }
        return at;
    }

    /** When the character last answered: their latest message that isn't a text of their own (proactive), as ms; null if none. */
    function lastReplyAt(history) {
        for (let i = (history?.length || 0) - 1; i >= 0; i--) {
            const msg = history[i];
            if (!msg || msg.is_user || msg.meta?.proactive) continue;
            return sentAt(msg);
        }
        return null;
    }

    /**
     * Where a date sits in the week: the block it's in (or null between blocks), since
     * when (that block's start, or the end of the last one), and the block before then.
     * For telling when a character has just got free (lib/proactive-rounds.js).
     */
    function currentStretch(schedule, date) {
        const s = normalizeSchedule(schedule);
        const instances = [];
        for (const back of [2, 1, 0]) {
            const day = new Date(date.getFullYear(), date.getMonth(), date.getDate() - back);
            s[dayOf(day)].forEach(block => {
                const [from, end] = spanOf(block);
                const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, from);
                instances.push({ block, start, end: new Date(start.getTime() + (end - from) * 60000) });
            });
        }
        // The latest-begun instance around a time (today's beats last night's, as in blockAt)
        const around = t => instances.filter(i => i.start <= t && t < i.end).sort((a, b) => b.start - a.start)[0] || null;
        const now = around(date);
        let since = now ? now.start : null;
        if (!now) {
            const ended = instances.filter(i => i.end <= date).sort((a, b) => b.end - a.end)[0];
            since = ended ? ended.end : null;
        }
        const before = since ? around(new Date(since.getTime() - 60000)) : null;
        return { block: now ? now.block : null, since, prev: before ? before.block : null };
    }

    /** The next block that starts later the same day, or null. */
    function nextBlockAt(schedule, date) {
        const s = normalizeSchedule(schedule);
        const now = date.getHours() * 60 + date.getMinutes();
        return s[dayOf(date)].find(block => minutesOf(block.from) > now) || null;
    }

    // ── Life: errands, what happened, today's change (12b) ──────────────────

    const MAX_ERRANDS = 3;
    const MAX_LOG = 20;
    const LOG_DAYS = 7;
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    const FROMS = ['you', 'chat', 'model'];

    /** A date's local calendar day, 'YYYY-MM-DD'. */
    function dateKey(date) {
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    /** Whole days from one 'YYYY-MM-DD' to another (negative: earlier). */
    function daysBetween(from, to) {
        const ms = key => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, m - 1, d); };
        return Math.round((ms(to) - ms(from)) / 86400000);
    }

    const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

    function normalizeErrand(raw) {
        if (!isObject(raw) || !clip(raw.text) || !DATE_RE.test(raw.due)) return null;
        return {
            id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
            text: clip(raw.text),
            progress: clip(raw.progress),
            due: raw.due,
            feeling: clip(raw.feeling),
            from: FROMS.includes(raw.from) ? raw.from : 'you',
        };
    }

    function normalizeEntry(raw) {
        if (!isObject(raw) || !clip(raw.text) || !DATE_RE.test(raw.date)) return null;
        return { id: typeof raw.id === 'string' && raw.id ? raw.id : newId(), date: raw.date, text: clip(raw.text) };
    }

    /** The parts of a life, filled in and cleaned up: errands as they come, what happened oldest first. */
    function normalizeLifeParts(raw) {
        const src = isObject(raw) ? raw : {};
        const errands = (Array.isArray(src.errands) ? src.errands.map(normalizeErrand).filter(Boolean) : []).slice(0, MAX_ERRANDS);
        const log = (Array.isArray(src.log) ? src.log.map(normalizeEntry).filter(Boolean) : [])
            .map((entry, i) => [entry, i]).sort(([a, i], [b, j]) => a.date.localeCompare(b.date) || i - j).map(([entry]) => entry)
            .slice(-MAX_LOG);
        const today = isObject(src.today) && DATE_RE.test(src.today.date) && clip(src.today.text)
            ? { date: src.today.date, text: clip(src.today.text) } : null;
        return { errands, log, today };
    }

    /**
     * A chat's life state, filled in. Without one (nothing edited by hand yet) it is empty
     * and starts at 0, so every report in the chat counts.
     */
    function normalizeLife(raw) {
        if (!isObject(raw) || !isObject(raw.start)) return { start: normalizeLifeParts(null), startAt: 0 };
        return {
            start: normalizeLifeParts(raw.start), startAt: Number.isFinite(raw.startAt) ? raw.startAt : 0,
            // When a catch-up last settled it (lib/catch-up.js)
            ...(Number.isFinite(raw.settledAt) ? { settledAt: raw.settledAt } : {}),
        };
    }

    const sentAt = msg => {
        const time = typeof msg.send_date === 'number' ? msg.send_date : Date.parse(msg.send_date);
        return Number.isFinite(time) ? time : null;
    };

    // Errands named by the model: their words without case, spaces or punctuation
    const squash = s => String(s ?? '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
    const pairsOf = s => new Set(Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2)));

    /** The errand a report names: the same words, one inside the other, or most of the same pairs of letters. */
    function findErrand(errands, name) {
        const want = squash(name);
        if (!want) return -1;
        let at = errands.findIndex(e => squash(e.text) === want);
        if (at < 0) at = errands.findIndex(e => { const have = squash(e.text); return have && (have.includes(want) || want.includes(have)); });
        if (at >= 0) return at;
        const a = pairsOf(want);
        let best = -1, bestScore = 0.5;
        errands.forEach((e, i) => {
            const b = pairsOf(squash(e.text));
            if (!a.size || !b.size) return;
            const shared = [...a].filter(p => b.has(p)).length;
            const score = (2 * shared) / (a.size + b.size);
            if (score >= bestScore) { best = i; bestScore = score; }
        });
        return best;
    }

    /**
     * Replays the replies' <life> reports made since the state's start onto it. Each report
     * is a list of changes (parseLifeTag); a reply before `startAt` (the life was edited by
     * hand after it) no longer counts. Returns the replayed parts, the ids the latest
     * report touched and the errands reports marked done (as they stood, and when).
     */
    function replayLife(state, history) {
        const { start, startAt } = normalizeLife(state);
        let parts = { errands: start.errands.map(e => ({ ...e })), log: start.log.slice(), today: start.today };
        let touched = [];
        const done = [];
        for (const msg of history || []) {
            if (!msg || msg.is_user || !Array.isArray(msg.life) || !msg.life.length) continue;
            const time = sentAt(msg);
            if (time === null || time < startAt) continue;
            touched = [];
            msg.life.forEach((change, i) => {
                if (!isObject(change)) return;
                const id = `m${time.toString(36)}${i}`;
                if (change.op === 'new') {
                    const at = findErrand(parts.errands, change.text);
                    if (at >= 0) {
                        const errand = parts.errands[at];
                        parts.errands[at] = { ...errand, due: change.due || errand.due, feeling: change.feeling || errand.feeling };
                        touched.push(errand.id);
                    } else if (parts.errands.length < MAX_ERRANDS) {
                        const errand = normalizeErrand({ id, text: change.text, due: change.due, feeling: change.feeling, progress: '', from: 'model' });
                        if (errand) { parts.errands.push(errand); touched.push(id); }
                    }
                } else if (change.op === 'update') {
                    const at = findErrand(parts.errands, change.name);
                    if (at >= 0 && clip(change.progress)) {
                        parts.errands[at] = { ...parts.errands[at], progress: clip(change.progress) };
                        touched.push(parts.errands[at].id);
                    }
                } else if (change.op === 'done') {
                    const at = findErrand(parts.errands, change.name);
                    if (at >= 0) done.push({ ...parts.errands.splice(at, 1)[0], at: time });
                } else if (change.op === 'happened') {
                    const entry = normalizeEntry({ id, date: change.date, text: change.text });
                    if (entry) { parts = normalizeLifeParts({ ...parts, log: [...parts.log, entry] }); touched.push(id); }
                } else if (change.op === 'today' && DATE_RE.test(change.date)) {
                    const text = clip(change.text);
                    parts.today = text ? { date: change.date, text } : null;
                    if (text) touched.push('today');
                }
            });
        }
        return { parts: normalizeLifeParts(parts), touched, done };
    }

    /**
     * The life as it stands at a date: the replies' reports in `history` replayed onto the
     * state, then what happened in the last week only, and today's change only on its own day.
     */
    function currentLife(state, date, history = null) {
        const { parts } = replayLife(state, history);
        const today = dateKey(date);
        return {
            errands: parts.errands,
            log: parts.log.filter(entry => daysBetween(entry.date, today) < LOG_DAYS && entry.date <= today),
            today: parts.today && parts.today.date === today ? parts.today : null,
        };
    }

    /**
     * A catch-up's changes settled into the chat's life (lib/catch-up.js): the replies'
     * reports and these changes replayed, kept as the new start from `date` on (so they
     * aren't replayed again), with when it was settled.
     */
    function settleLife(state, history, changes, date) {
        const at = date.getTime();
        const { parts } = replayLife(state, [...(history || []), { is_user: false, send_date: at, life: changes || [] }]);
        return { start: parts, startAt: at + 1, settledAt: at };
    }

    // ── What the life lets go of, kept as memories (12e) ─────────────────────

    /**
     * What a chat's life has let go of, to keep as memories: the errands a reply's report
     * marked done before `settledBefore` (ms; a swipe can still take back a later one),
     * as they stood then, with the day; and what happened that's older than the week the
     * life keeps. A catch-up's `changes` count as one more report at `date`.
     */
    function lettingGo(state, history, date, { settledBefore = Infinity, changes = null } = {}) {
        const extra = changes?.length ? [{ is_user: false, send_date: date.getTime(), life: changes }] : [];
        const { parts, done } = replayLife(state, [...(history || []), ...extra]);
        const today = dateKey(date);
        return {
            done: done.filter(errand => errand.at < settledBefore).map(({ at, ...errand }) => ({ ...errand, date: dateKey(new Date(at)) })),
            expired: parts.log.filter(entry => daysBetween(entry.date, today) >= LOG_DAYS),
        };
    }

    /** The Monday of a day's week, 'YYYY-MM-DD'. */
    function weekOf(key) {
        const [y, m, d] = key.split('-').map(Number);
        const date = new Date(y, m - 1, d);
        return dateKey(new Date(y, m - 1, d - ((date.getDay() + 6) % 7)));
    }

    /** A finished errand as a memory: { label, content }. */
    function errandMemory(errand, charName = 'Character') {
        return {
            label: errand.text,
            content: `${charName}'s errand "${errand.text}" came to an end on ${errand.date}${errand.progress ? `: ${errand.progress}` : ''}.`,
        };
    }

    /** What happened in a week (from its Monday) as a memory, oldest first: { label, content }. */
    function weekMemory(monday, entries, charName = 'Character') {
        const sorted = entries.slice().sort((a, b) => a.date.localeCompare(b.date));
        return {
            label: `Week of ${monday}`,
            content: `What happened to ${charName} the week of ${monday}: ${sorted.map(e => `${e.text} (${e.date.slice(5)})`).join('; ')}.`,
        };
    }

    /** The ids the latest <life> report since the state's start touched ('today' for today's change). */
    function lastLifeChange(state, history) {
        return replayLife(state, history).touched;
    }

    /** Whether a life has anything in it. */
    function hasLife(life) {
        return !!life && (life.errands.length > 0 || life.log.length > 0 || !!life.today);
    }

    /** A life with an errand replaced (index -1: added, while there's room); as it was when the errand isn't one. */
    function withErrand(life, index, errand) {
        const parts = normalizeLifeParts(life);
        const clean = normalizeErrand(errand);
        if (!clean) return parts;
        const errands = parts.errands.slice();
        if (index >= 0 && index < errands.length) errands[index] = clean;
        else if (errands.length < MAX_ERRANDS) errands.push(clean);
        return { ...parts, errands };
    }

    function withoutErrand(life, index) {
        const parts = normalizeLifeParts(life);
        return { ...parts, errands: parts.errands.filter((_, i) => i !== index) };
    }

    /** A life with something that happened replaced or added (index -1), in date order; the oldest go past MAX_LOG. */
    function withEntry(life, index, entry) {
        const parts = normalizeLifeParts(life);
        const clean = normalizeEntry(entry);
        if (!clean) return parts;
        const log = parts.log.slice();
        if (index >= 0 && index < log.length) log[index] = clean;
        else log.push(clean);
        return normalizeLifeParts({ ...parts, log });
    }

    function withoutEntry(life, index) {
        const parts = normalizeLifeParts(life);
        return { ...parts, log: parts.log.filter((_, i) => i !== index) };
    }

    /** A life with today's change set (blank: none). */
    function withToday(life, date, text) {
        const parts = normalizeLifeParts(life);
        const t = clip(text);
        return { ...parts, today: t ? { date: dateKey(date), text: t } : null };
    }

    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    /** A day said from `today`: today, yesterday, tomorrow, Thursday (within the week either way), Nov 7. */
    function sayDay(key, today) {
        const diff = daysBetween(today, key);
        if (diff === 0) return 'today';
        if (diff === -1) return 'yesterday';
        if (diff === 1) return 'tomorrow';
        const [y, m, d] = key.split('-').map(Number);
        if (diff > 1 && diff < 7) return WEEKDAY_NAMES[new Date(y, m - 1, d).getDay()];
        if (diff < -1 && diff > -7) return `last ${WEEKDAY_NAMES[new Date(y, m - 1, d).getDay()]}`;
        return `${MONTHS[m - 1]} ${d}`;
    }

    // ── The model's <life> line (12b-2) ─────────────────────────────────────

    const LIFE_TAG_NAMES = ['life', 'life_update', 'lifeupdate', 'daily_life', 'life_changes', '近况', '生活'];
    const LIFE_TAG_GROUP = [...LIFE_TAG_NAMES].sort((a, b) => b.length - a.length).map(escapeRe).join('|');
    const ANY_LIFE_TAG_RE = new RegExp(`<\\s*\\/?\\s*(?:${LIFE_TAG_GROUP})(?=[\\s/>])`, 'i');
    const PAIRED_LIFE_RE = new RegExp(`<\\s*(?:${LIFE_TAG_GROUP})(?=[\\s/>])[^>]*>([\\s\\S]*?)<\\s*\\/\\s*(?:${LIFE_TAG_GROUP})\\s*>`, 'gi');
    // Unclosed: the rest of the reply (it ends the reply)
    const OPEN_LIFE_RE = new RegExp(`<\\s*(?:${LIFE_TAG_GROUP})(?=[\\s/>])[^>]*?(\\/?)\\s*>([\\s\\S]*)$`, 'i');
    const CLOSE_LIFE_RE = new RegExp(`<\\s*\\/\\s*(?:${LIFE_TAG_GROUP})\\s*>`, 'gi');
    const CUT = '\u0000';

    // What each change starts with, and the words models use for it
    const OPS = [
        ['new', ['new', 'add', 'added', 'errand', '新增', '新事务', '添加']],
        ['update', ['update', 'updated', 'progress', '更新', '进展', '进度', '推进']],
        ['done', ['done', 'finished', 'finish', 'ended', 'end', 'over', 'dropped', 'cancelled', 'canceled', '完成', '结束', '取消', '搞定']],
        ['happened', ['happened', 'happen', 'event', 'log', '发生', '发生了', '记录']],
        ['today', ['today', '今天', '今日']],
    ];
    const OP_WORDS = OPS.flatMap(([op, words]) => words.map(word => [word, op])).sort((a, b) => b[0].length - a[0].length);
    const OP_RE = new RegExp(`^(${OP_WORDS.map(([w]) => escapeRe(w)).join('|')})(?![a-z])\\s*[:：]?\\s*`, 'i');
    const opFor = word => OP_WORDS.find(([w]) => w === word.toLowerCase())?.[1];

    const WEEKDAY_WORDS = [
        ['sunday', 'sun', '周日', '周天', '星期日', '星期天', '礼拜日', '礼拜天'],
        ['monday', 'mon', '周一', '星期一', '礼拜一'],
        ['tuesday', 'tue', 'tues', '周二', '星期二', '礼拜二'],
        ['wednesday', 'wed', '周三', '星期三', '礼拜三'],
        ['thursday', 'thu', 'thur', 'thurs', '周四', '星期四', '礼拜四'],
        ['friday', 'fri', '周五', '星期五', '礼拜五'],
        ['saturday', 'sat', '周六', '星期六', '礼拜六'],
    ];
    const addDays = (date, n) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);

    /**
     * A day a report names, as 'YYYY-MM-DD', from the reply's date: 2026-11-07, 11-07, 11/7,
     * 11月7日; today, tomorrow, the day after tomorrow, yesterday; a weekday (the next one,
     * today included), "next Monday" / 下周一 (in the week after this one); next week, in N
     * days. Null when it reads as none of these.
     */
    function parseDay(text, date) {
        const s = String(text ?? '').trim().toLowerCase().replace(/^(on|by|due|截止|到)\s*/, '');
        if (!s) return null;
        let m = s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
        if (m) return dateKey(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
        m = s.match(/^(\d{1,2})[-/.月](\d{1,2})[日号]?$/);
        if (m) {
            let d = new Date(date.getFullYear(), Number(m[1]) - 1, Number(m[2]));
            if (daysBetween(dateKey(date), dateKey(d)) < -180) d = new Date(date.getFullYear() + 1, Number(m[1]) - 1, Number(m[2]));
            return dateKey(d);
        }
        const fixed = { today: 0, tonight: 0, '今天': 0, '今晚': 0, tomorrow: 1, '明天': 1, '明晚': 1, 'day after tomorrow': 2, '后天': 2, yesterday: -1, '昨天': -1, '昨晚': -1,
            'next week': 7, '下周': 7, '下星期': 7, '下礼拜': 7 };
        if (s in fixed) return dateKey(addDays(date, fixed[s]));
        m = s.match(/^in (\d+) days?$/) || s.match(/^(\d+)\s*天[后以]后?$/);
        if (m) return dateKey(addDays(date, Number(m[1])));
        const next = /^(next |下个?|下)/.test(s);
        const word = s.replace(/^(this |next |这个?|本|下个?|下)/, '');
        // The weekend: its Saturday
        const day = ['weekend', '周末'].includes(word) ? 6 : WEEKDAY_WORDS.findIndex(words => words.includes(word));
        if (day < 0) return null;
        let ahead = (day - date.getDay() + 7) % 7;
        if (next) {
            // The week after this one (weeks start on Monday)
            const toMonday = (8 - date.getDay()) % 7 || 7;
            ahead = toMonday + ((day + 6) % 7);
        }
        return dateKey(addDays(date, ahead));
    }

    /** A report's changes: split at semicolons and line breaks, but not inside brackets ("(due Friday; dreading it)"). */
    function splitChanges(content) {
        const parts = [];
        let depth = 0, current = '';
        for (const ch of content) {
            if (ch === '(' || ch === '（') depth++;
            else if ((ch === ')' || ch === '）') && depth > 0) depth--;
            if ((ch === ';' || ch === '；' || ch === '\n') && depth === 0) { parts.push(current); current = ''; continue; }
            if (ch === '\n') depth = 0;
            current += ch;
        }
        parts.push(current);
        return parts;
    }

    /** One change in a report, or null when it doesn't read as one. */
    function parseChange(raw, date) {
        let s = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim();
        const m = s.match(OP_RE);
        if (!m) return null;
        const op = opFor(m[1]);
        s = s.slice(m[0].length).trim();
        if (!s) return null;
        const today = dateKey(date);
        // A last "(…)" holds the day and maybe a feeling: "(due Saturday; dreading it)"
        let extra = '';
        const paren = s.match(/\s*[(（]([^()（）]*)[)）]\s*$/);
        if (paren) { extra = paren[1]; s = s.slice(0, paren.index).trim(); }
        if (op === 'new') {
            let due = null;
            const feelings = [];
            for (const part of extra.split(/[;；,，]/).map(p => p.trim()).filter(Boolean)) {
                const dm = part.match(/^(?:due|by|截止|到期|期限)\s*[:：]?\s*(.+)$/i);
                const day = dm ? parseDay(dm[1], date) : parseDay(part, date);
                if (day && !due) due = day;
                else if (!dm) feelings.push(part);
            }
            // "due …" written outside brackets
            const tail = s.match(/\s+(?:due|by|截止)\s*[:：]?\s*(.+)$/i);
            if (tail && !due) { due = parseDay(tail[1], date); if (due) s = s.slice(0, tail.index).trim(); }
            return s ? { op, text: s, due: due || dateKey(addDays(date, 7)), feeling: feelings.join('; ') } : null;
        }
        if (op === 'update') {
            const split = s.match(/^(.+?)\s*(?:[:：]|\s[-–—]\s|→|->)\s*(.+)$/);
            return split ? { op, name: split[1], progress: split[2] } : null;
        }
        if (op === 'done') return { op, name: s };
        if (op === 'happened') return { op, text: s, date: (extra && parseDay(extra, date)) || today };
        // today: "none" or a dash clears it
        return { op, date: today, text: /^(none|nothing|无|没有|-|—)$/i.test(s) ? '' : s };
    }

    /**
     * Takes a reply's <life> line out: the text without it, and the changes it reports
     * (null when there's no tag or nothing in it reads), their days resolved from the
     * reply's `date`. Lenient: other tag names, attributes, unclosed tags, changes split by
     * semicolons or lines, bullets, Chinese words.
     */
    function parseLifeTag(text, date) {
        const source = String(text ?? '');
        if (!ANY_LIFE_TAG_RE.test(source)) return { text: source, life: null };
        const changes = [];
        const read = content => {
            for (const part of splitChanges(String(content))) {
                const change = parseChange(part, date);
                if (change) changes.push(change);
            }
        };
        const cut = source
            .replace(PAIRED_LIFE_RE, (_, content) => { read(content); return CUT; })
            .replace(OPEN_LIFE_RE, (_, selfClosing, rest) => { if (!selfClosing) read(rest); return CUT + (selfClosing ? rest : ''); })
            .replace(CLOSE_LIFE_RE, CUT);
        const rest = cut.split('\n')
            .map(line => (line.includes(CUT) ? line.replaceAll(CUT, '').trimEnd() || CUT : line))
            .filter(line => line !== CUT)
            .join('\n').trim();
        return { text: rest, life: changes.length ? changes : null };
    }

    /**
     * The rule for the <life> line, for after the format rules. With `madeUp` the model may
     * add errands of the character's own; otherwise only ones that come up in the chat.
     */
    function lifeRules({ charName = 'Character', userName = 'User', date, madeUp = false }) {
        const N = charName, U = userName;
        return [
            `LIFE: Keep track of what is going on in ${N}'s life. When this reply changes it, end the reply with one more line: <life>…</life>, with the changes separated by semicolons:`,
            `- new <errand> (due <YYYY-MM-DD>): something ${N} has to do or is waiting for, and when`,
            `- update <errand>: <how it stands now>`,
            `- done <errand>: finished, or off`,
            `- happened <what>: something that happened to ${N}`,
            `- today <change>: a change to ${N}'s plans for today`,
            `Today is ${dateKey(date)} (${WEEKDAY_NAMES[date.getDay()]}). Name an errand the way <daily_life> lists it; ${N} has at most ${MAX_ERRANDS} at a time. `
            + (madeUp
                ? `Note errands that come up with ${U}, and now and then one of ${N}'s own that fits who ${N} is. `
                : `Only note errands that come up with ${U}; don't make up new ones. `)
            + `If nothing changed, leave the line out. Write the changes in the language of the conversation.`,
        ].join('\n');
    }

    // The time of day in words, in proactive messages' buckets (lib/proactive-messaging.js)
    function periodOf(date) {
        const hour = date.getHours();
        if (hour >= 4 && hour < 8) return 'early morning';
        if (hour >= 8 && hour < 12) return 'morning';
        if (hour >= 12 && hour < 14) return 'midday';
        if (hour >= 14 && hour < 17) return 'afternoon';
        if (hour >= 17 && hour < 21) return 'evening';
        if (hour >= 21) return 'late at night';
        return 'before dawn';
    }

    const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const whatAndWhere = block => `${block.doing || block.place}${block.doing && block.place ? `, at ${block.place}` : ''}`;

    // What happened, at most this many of the latest in the prompt
    const PROMPT_LOG = 6;

    /**
     * Where the character is in their life, for the system prompt: the day and time of
     * day; with a schedule the block they're in (or nothing planned), what that means for
     * their phone (or a change of plan by hand, `override`, instead) and what comes next
     * today; today's change; their errands and what
     * happened lately. '' when there is neither a schedule nor anything in the life.
     */
    function describeNow({ schedule, life = null, date, charName = 'Character', override = null }) {
        const withSchedule = hasSchedule(schedule);
        if (!withSchedule && !hasLife(life)) return '';
        const N = charName;
        const today = dateKey(date);
        const lines = [`It is ${WEEKDAY_NAMES[date.getDay()]}, ${periodOf(date)}.`];
        if (withSchedule) {
            const current = blockAt(schedule, date);
            const plan = activeOverride(override, date);
            if (current) {
                const { block } = current;
                lines.push(`Right now (${block.from}–${block.to}): ${whatAndWhere(block)}.`);
                if (!plan) {
                    lines.push({
                        free: `${N} is free to look at the phone and text.`,
                        busy: `${N} is busy and can only glance at the phone now and then: replies are short or late, and ${N} may say so.`,
                        asleep: `It is ${N}'s time to sleep: if ${N} is texting now, ${N} is drowsy or up later than planned.`,
                    }[block.phone]);
                }
            } else {
                lines.push(`Right now: nothing in particular.${plan ? '' : ` ${N} is free to look at the phone and text.`}`);
            }
            if (plan) {
                const until = new Date(plan.until);
                lines.push(`Until ${pad(until.getHours())}:${pad(until.getMinutes())}, a change of plan: ` + {
                    free: `${N} is up and free to look at the phone and text, whatever the schedule says.`,
                    busy: `${N} is busy and can only glance at the phone now and then: replies are short or late, and ${N} may say so.`,
                    asleep: `${N} is asleep: if ${N} is texting now, something woke ${N} up.`,
                }[plan.phone]);
            }
            const next = nextBlockAt(schedule, date);
            if (next) lines.push(`Next (from ${next.from}): ${whatAndWhere(next)}.`);
        }
        if (life?.today) lines.push(`Today, ${withSchedule ? 'unlike usual (this wins over the plan above)' : 'for a change'}: ${life.today.text}.`);
        if (life?.errands.length) {
            lines.push(`On ${N}'s mind lately:`);
            for (const errand of life.errands) {
                const late = errand.due < today;
                const notes = [errand.progress, `${late ? 'was due' : 'due'} ${sayDay(errand.due, today)}`, errand.feeling].filter(Boolean);
                lines.push(`- ${errand.text} (${notes.join('; ')})`);
            }
        }
        if (life?.log.length) {
            lines.push('What happened lately, oldest first:');
            for (const entry of life.log.slice(-PROMPT_LOG)) lines.push(`- ${sayDay(entry.date, today)}: ${entry.text}`);
        }
        lines.push(`This is where ${N} is in their life: treat it as true and let it show when it fits, without reciting it.`);
        return `<daily_life>\n${lines.join('\n')}\n</daily_life>`;
    }

    // ── The model's schedule ────────────────────────────────────────────────

    // What the model calls the days, and which of ours each means
    const DAY_WORDS = [
        [['weekday', 'weekdays', 'workday', 'workdays', 'mon-fri', 'monday-friday', 'monday to friday',
            '工作日', '平日', '平时', '周一至周五', '周一到周五', '星期一至星期五', '星期一到星期五'], ['weekday']],
        [['saturday', 'sat', '周六', '星期六', '礼拜六'], ['saturday']],
        [['sunday', 'sun', '周日', '周天', '星期日', '星期天', '礼拜日', '礼拜天'], ['sunday']],
        [['weekend', 'weekends', '周末'], ['saturday', 'sunday']],
        [['every day', 'everyday', 'daily', '每天', '每日'], ['weekday', 'saturday', 'sunday']],
    ];
    const DAY_ALTS = DAY_WORDS.flatMap(([words]) => words).sort((a, b) => b.length - a.length).map(escapeRe).join('|');
    // A line's day, at its start: "weekday", "Saturday:", "## 周六"
    const DAY_RE = new RegExp(`^(${DAY_ALTS})(?![a-z])\\s*[:：]?\\s*`, 'i');
    const daysFor = word => DAY_WORDS.find(([words]) => words.includes(word.toLowerCase()))?.[1] || null;

    const TIME_RANGE_RE = /(\d{1,2})(?:\s*[:：.]\s*(\d{2}))?\s*([ap]\.?m\.?)?\s*(?:-|–|—|~|～|to|至|到)\s*(\d{1,2})(?:\s*[:：.]\s*(\d{2}))?\s*([ap]\.?m\.?)?/i;

    // What the model calls the phone states
    const PHONE_WORDS = {
        free: ['free', 'available', 'idle', '有空', '空闲', '闲', '📱'],
        busy: ['busy', 'occupied', '忙', '忙碌', '没空', '不方便'],
        asleep: ['asleep', 'sleep', 'sleeping', '睡', '睡着', '睡觉', '睡眠', '💤'],
    };
    const phoneFor = field => {
        const word = field.replace(/^[(（[【]\s*|\s*[)）\]】]$/g, '').trim().toLowerCase();
        return PHONE_IDS.find(id => PHONE_WORDS[id].includes(word)) || null;
    };
    const SLEEP_RE = /sleep|asleep|\bbed\b|睡/i;

    /** 'HH:MM' from an hour, minutes and maybe am / pm; null when it's no time. */
    function timeOf(h, m, half) {
        let hour = Number(h);
        const minute = Number(m || 0);
        if (hour > 24 || minute > 59) return null;
        const ap = String(half || '').toLowerCase()[0];
        if (ap && hour > 12) return null;
        if (ap === 'p' && hour < 12) hour += 12;
        if (ap === 'a' && hour === 12) hour = 0;
        return `${pad(hour % 24)}:${pad(minute)}`;
    }

    /**
     * The schedule in a model's answer: one block a line, "weekday 09:00-18:00 | place |
     * doing | busy". Read leniently: a day on a line of its own covers the lines under it,
     * "weekend" and "every day" fill more than one day, the phone word can be missing
     * (sleeping means asleep, anything else free) or in brackets, and markdown is ignored.
     */
    function parseSchedule(text) {
        const out = { weekday: [], saturday: [], sunday: [] };
        let current = null;
        const lines = String(text ?? '').replace(/```[a-z]*\n?/gi, '').split('\n');
        for (const raw of lines) {
            let line = raw.replace(/\*\*|__/g, '').replace(/^\s*(?:#+|[-*•]|\d+[.)])\s*/, '').trim();
            if (!line) continue;
            const dayMatch = line.match(DAY_RE);
            let days = current;
            if (dayMatch) {
                days = daysFor(dayMatch[1]);
                line = line.slice(dayMatch[0].length).trim();
            }
            const time = line.match(TIME_RANGE_RE);
            if (!time) {
                // A heading: the day for the lines under it
                if (dayMatch && !line) current = days;
                continue;
            }
            if (dayMatch) current = days;
            if (!days) continue;
            const to = timeOf(time[4], time[5], time[6]);
            // "1-3pm": the end's am / pm goes for the start too, unless that puts it after the end ("9-6pm")
            let from = timeOf(time[1], time[2], time[3]);
            if (!time[3] && time[6] && to) {
                const shared = timeOf(time[1], time[2], time[6]);
                if (shared && minutesOf(shared) < minutesOf(to)) from = shared;
            }
            if (!from || !to || from === to) continue;

            const rest = line.slice(time.index + time[0].length).replace(/^\s*[|｜:：,，\-–—]\s*/, '');
            let fields = rest.split(/\s*[|｜]\s*/);
            if (fields.length === 1) fields = rest.split(/\s*[,，\t]\s*/);
            fields = fields.map(f => f.trim()).filter(Boolean);
            // The phone word ends the line; "home | sleeping" is a place and what they do
            let phone = fields.length > 1 ? phoneFor(fields[fields.length - 1]) : null;
            if (phone === 'asleep' && fields.length < 3 && !/^[(（[【]/.test(fields[fields.length - 1])) phone = null;
            if (phone) fields.pop();
            const [place, doing] = fields.length >= 2 ? fields : ['', fields[0] || ''];
            if (!phone) phone = SLEEP_RE.test(`${place} ${doing}`) ? 'asleep' : 'free';
            for (const day of days) out[day].push({ from, to, place, doing, phone });
        }
        return normalizeSchedule(out);
    }

    /**
     * The request that drafts a character's week from their card: who they are (the
     * card's text, as "Name's description: …" lines) and who the user is to them.
     * @returns {{ systemPrompt: string, prompt: string }}
     */
    function buildScheduleRequest({ charName = 'Character', userName = 'User', card = [], persona = '' }) {
        const systemPrompt = `You plan ${charName}'s typical week for a texting app, from the character card you are given. `
            + `Write where ${charName} is and what they are doing through a typical weekday, Saturday and Sunday, covering all 24 hours of each day, sleep included. `
            + `Fit who they are: their job or school, habits and the world and era they live in. `
            + 'One line per block of time, and nothing else:\n'
            + '<day> <HH:MM>-<HH:MM> | <place> | <what they are doing> | <free, busy or asleep>\n'
            + '<day> is weekday, saturday or sunday. Times are 24-hour; a block past midnight ends the next morning, like 23:30-07:00. '
            + 'free: they can look at their phone and text; busy: they can\'t, or only now and then; asleep: they are asleep. '
            + 'Places and activities in a few words, in the language the card is written in.';
        const parts = [...card];
        if (persona) parts.push(`${userName}'s persona: ${persona}`);
        const prompt = `<character_reference>\n${parts.join('\n\n')}\n</character_reference>`;
        return { systemPrompt, prompt };
    }

    window.EchoTextDailyLife = {
        DAYS, DAY_IDS, PHONES, PHONE_IDS,
        minutesOf, normalizeSchedule, hasSchedule, withBlock, withoutBlock, dayOf, blockAt, nextBlockAt, periodOf, describeNow,
        parseSchedule, buildScheduleRequest,
        MAX_ERRANDS, MAX_LOG, LOG_DAYS, dateKey, daysBetween, sayDay, normalizeLife, currentLife, lastLifeChange, settleLife, hasLife,
        withErrand, withoutErrand, withEntry, withoutEntry, withToday,
        parseDay, parseLifeTag, lifeRules, findErrand,
        noticeChance, blockEndAt, unseenUntil, currentStretch,
        AWAKE_MINUTES, activeOverride, makeOverride, stretchEndAt, phoneAt, phoneEndsAt, lastReplyAt,
        lettingGo, weekOf, errandMemory, weekMemory,
    };
})();
