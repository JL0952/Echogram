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
    const MAX_PLACE = 40;
    const MAX_DOING = 60;

    const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
    const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

    /** 'HH:MM' as minutes after midnight. */
    function minutesOf(time) {
        const [h, m] = String(time).split(':').map(Number);
        return h * 60 + m;
    }

    const pad = n => String(n).padStart(2, '0');
    const clip = (s, max) => {
        const t = String(s ?? '').replace(/\s+/g, ' ').trim();
        return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
    };

    function normalizeBlock(raw) {
        if (!isObject(raw) || !TIME_RE.test(raw.from) || !TIME_RE.test(raw.to) || raw.from === raw.to) return null;
        return {
            from: raw.from,
            to: raw.to,
            place: clip(raw.place, MAX_PLACE),
            doing: clip(raw.doing, MAX_DOING),
            phone: PHONE_IDS.includes(raw.phone) ? raw.phone : 'free',
        };
    }

    /** A schedule, filled in and cleaned up: every day a list, bad blocks dropped, each day in time order. */
    function normalizeSchedule(raw) {
        const src = isObject(raw) ? raw : {};
        const out = {};
        for (const day of DAY_IDS) {
            const blocks = Array.isArray(src[day]) ? src[day].map(normalizeBlock).filter(Boolean) : [];
            out[day] = blocks.sort((a, b) => minutesOf(a.from) - minutesOf(b.from)).slice(0, MAX_BLOCKS);
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
        const yesterday = dayOf(new Date(date.getTime() - 24 * 3600000));
        s[yesterday].forEach((block, index) => {
            const from = minutesOf(block.from), to = minutesOf(block.to);
            if (to <= from && now < to && !found) found = { day: yesterday, index, block };
        });
        return found;
    }

    /**
     * The schedule with a day's block replaced (index -1: added), in time order; the
     * schedule as it was when the block isn't one (no time, or starting when it ends).
     */
    function withBlock(schedule, day, index, block) {
        const s = normalizeSchedule(schedule);
        const clean = normalizeBlock(block);
        if (!DAY_IDS.includes(day) || !clean) return s;
        const blocks = s[day].slice();
        if (index >= 0 && index < blocks.length) blocks[index] = clean;
        else blocks.push(clean);
        return normalizeSchedule({ ...s, [day]: blocks });
    }

    /** The schedule without a day's block. */
    function withoutBlock(schedule, day, index) {
        const s = normalizeSchedule(schedule);
        if (!DAY_IDS.includes(day)) return s;
        return { ...s, [day]: s[day].filter((_, i) => i !== index) };
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
    const MAX_TEXT = 120;
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
        if (!isObject(raw) || !clip(raw.text, MAX_TEXT) || !DATE_RE.test(raw.due)) return null;
        return {
            id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
            text: clip(raw.text, MAX_TEXT),
            progress: clip(raw.progress, MAX_TEXT),
            due: raw.due,
            feeling: clip(raw.feeling, MAX_TEXT),
            from: FROMS.includes(raw.from) ? raw.from : 'you',
        };
    }

    function normalizeEntry(raw) {
        if (!isObject(raw) || !clip(raw.text, MAX_TEXT) || !DATE_RE.test(raw.date)) return null;
        return { id: typeof raw.id === 'string' && raw.id ? raw.id : newId(), date: raw.date, text: clip(raw.text, MAX_TEXT) };
    }

    /** The parts of a life, filled in and cleaned up: errands as they come, what happened oldest first. */
    function normalizeLifeParts(raw) {
        const src = isObject(raw) ? raw : {};
        const errands = (Array.isArray(src.errands) ? src.errands.map(normalizeErrand).filter(Boolean) : []).slice(0, MAX_ERRANDS);
        const log = (Array.isArray(src.log) ? src.log.map(normalizeEntry).filter(Boolean) : [])
            .map((entry, i) => [entry, i]).sort(([a, i], [b, j]) => a.date.localeCompare(b.date) || i - j).map(([entry]) => entry)
            .slice(-MAX_LOG);
        const today = isObject(src.today) && DATE_RE.test(src.today.date) && clip(src.today.text, MAX_TEXT)
            ? { date: src.today.date, text: clip(src.today.text, MAX_TEXT) } : null;
        return { errands, log, today };
    }

    /** A chat's life state, filled in; anything else is a fresh one starting at `now`. */
    function normalizeLife(raw, now) {
        if (!isObject(raw) || !isObject(raw.start)) return { start: normalizeLifeParts(null), startAt: now };
        return { start: normalizeLifeParts(raw.start), startAt: Number.isFinite(raw.startAt) ? raw.startAt : now };
    }

    /**
     * The life as it stands at a date: what happened in the last week only, and today's
     * change only on its own day. (12b-2 replays the replies' reports on top of it.)
     */
    function currentLife(state, date) {
        const { start } = normalizeLife(state, date.getTime());
        const today = dateKey(date);
        return {
            errands: start.errands,
            log: start.log.filter(entry => daysBetween(entry.date, today) < LOG_DAYS && entry.date <= today),
            today: start.today && start.today.date === today ? start.today : null,
        };
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
        const t = clip(text, MAX_TEXT);
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
     * their phone and what comes next today; today's change; their errands and what
     * happened lately. '' when there is neither a schedule nor anything in the life.
     */
    function describeNow({ schedule, life = null, date, charName = 'Character' }) {
        const withSchedule = hasSchedule(schedule);
        if (!withSchedule && !hasLife(life)) return '';
        const N = charName;
        const today = dateKey(date);
        const lines = [`It is ${WEEKDAY_NAMES[date.getDay()]}, ${periodOf(date)}.`];
        if (withSchedule) {
            const current = blockAt(schedule, date);
            if (current) {
                const { block } = current;
                lines.push(`Right now (${block.from}–${block.to}): ${whatAndWhere(block)}.`);
                lines.push({
                    free: `${N} is free to look at the phone and text.`,
                    busy: `${N} is busy and can only glance at the phone now and then: replies are short or late, and ${N} may say so.`,
                    asleep: `It is ${N}'s time to sleep: if ${N} is texting now, ${N} is drowsy or up later than planned.`,
                }[block.phone]);
            } else {
                lines.push(`Right now: nothing in particular. ${N} is free to look at the phone and text.`);
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
    const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
        MAX_ERRANDS, MAX_LOG, LOG_DAYS, dateKey, daysBetween, sayDay, normalizeLife, currentLife, hasLife,
        withErrand, withoutErrand, withEntry, withoutEntry, withToday,
    };
})();
