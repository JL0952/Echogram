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
     * Pure: no settings, DOM or time of its own.
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
        minutesOf, normalizeSchedule, hasSchedule, dayOf, blockAt, parseSchedule, buildScheduleRequest,
    };
})();
