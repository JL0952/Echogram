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
    const DAY = 24 * HOUR;

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

    // How much each temperament makes of not hearing back
    const FLAVOR = {
        aloof: 'not a word about not hearing back',
        normal: 'mentioning not hearing back once at most',
        clingy: 'the waiting shows, but they talk about their own day too',
        obsessed: 'they keep coming back to not hearing back',
    };

    const pad = n => String(n).padStart(2, '0');
    /** A time as 'HH:MM' on the day of `now`, else 'YYYY-MM-DD HH:MM' (local). */
    const sayClock = (ms, now) => {
        const d = new Date(ms), n = new Date(now);
        const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
        return d.toDateString() === n.toDateString() ? clock : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${clock}`;
    };

    /**
     * What the model is told for a round: no answer yet, how many texts to write (a line
     * each, what the character would send meanwhile) and when each comes after the
     * character's last one, how much this temperament makes of the wait, and to separate
     * them with a line holding only ---. With `sentAt` (their times, all gone by: the page
     * wasn't running) and `now`, they're the texts sent then, by the clock.
     */
    function roundInstruction({ charName = 'Character', userName = 'User', temperament, waits, round = 1, sentAt = null, now = null }) {
        const N = charName, U = userName;
        const count = waits.length;
        const nth = i => (i === 0 ? 'the first' : i === count - 1 ? 'the last' : `text ${i + 1}`);
        const when = sentAt
            ? (count > 1 ? `They were sent one after another while ${U} was away: ${sentAt.map((ms, i) => `${nth(i)} at ${sayClock(ms, now)}`).join(', ')}; it is now ${sayClock(now, now)}. `
                : `It was sent while ${U} was away, at ${sayClock(sentAt[0], now)}; it is now ${sayClock(now, now)}. `)
            : (count > 1 ? `They come one after another: ${waits.map((ms, i) => `${nth(i)} ${sayMinutes(ms)} after ${N}'s last one`).join(', ')}. `
                : `It comes ${sayMinutes(waits[0])} after ${N}'s last one. `);
        const before = round > 1 ? ` Nor the ones ${N} sent after it.` : '';
        return `${U} hasn't answered ${N}'s last text yet.${before} `
            + `Write the ${count === 1 ? 'text' : `${count} texts`} ${N} sends meanwhile, one line each: what ${N} would really send — going on with what they were saying, something from what ${N} is doing now, a thought, a photo. `
            + `As ${N} would: ${FLAVOR[temperamentOf(temperament).id]}. `
            + when
            + (count > 1 ? 'Put a line holding only --- between one text and the next, in the usual format.' : 'Write it in the usual format.');
    }

    /** One follow-up as a catch-up lists it: which one it is, a line sent meanwhile, how much this temperament makes of the wait. */
    function followUpNote({ charName = 'Character', userName = 'User', temperament, round = 1, index = 0 }) {
        const N = charName, U = userName;
        return `follow-up ${index + 1}${round > 1 ? ` of round ${round}` : ''}: no answer from ${U} yet; one line ${N} sends meanwhile, `
            + `as ${N} would: ${FLAVOR[temperamentOf(temperament).id]}`;
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

    // A topic's texts: one to three
    const TOPIC_MAX_TEXTS = 3;

    // Without a schedule, the times of day the clock texts are for (minutes; a window may
    // run past midnight), on these days (none: every day). With one, the schedule is her now.
    const WEEKDAYS = [1, 2, 3, 4, 5];
    const CLOCK_WINDOWS = {
        late_night:            { windows: [[23 * 60, 2 * 60 + 30]] },
        post_midnight_impulse: { windows: [[0, 90]] },
        pre_dawn:              { windows: [[4 * 60, 5 * 60 + 30]] },
        morning_wave:          { windows: [[6 * 60, 9 * 60 + 30]] },
        commute_ping:          { days: WEEKDAYS, windows: [[7 * 60 + 30, 9 * 60], [17 * 60, 18 * 60 + 30]] },
        quiet_productive:      { days: WEEKDAYS, windows: [[9 * 60, 12 * 60]] },
        lunch_nudge:           { windows: [[11 * 60 + 15, 13 * 60 + 45]] },
        afternoon_slump:       { days: WEEKDAYS, windows: [[14 * 60, 16 * 60 + 30]] },
        post_work:             { days: WEEKDAYS, windows: [[17 * 60 + 30, 19 * 60 + 30]] },
        evening_winddown:      { windows: [[19 * 60, 22 * 60 + 30]] },
        weekend_ping:          { days: [0, 6] },
        monday_reboot:         { days: [1], windows: [[7 * 60, 11 * 60]] },
        midweek_check:         { days: [3], windows: [[10 * 60, 20 * 60]] },
        friday_feeling:        { days: [5], windows: [[12 * 60, 18 * 60]] },
        sunday_scaries:        { days: [0], windows: [[15 * 60, 20 * 60]] },
        sunday_evening:        { days: [0], windows: [[18 * 60, 21 * 60]] },
    };
    const CLOCK_TRIGGERS = Object.keys(CLOCK_WINDOWS);
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

    // ── What a new topic is about (docs/platform-plan.md 12f) ───────────────
    // Six kinds; the old triggers' texts (lib/proactive-messaging.js) are their wording.

    const inWindow = (minutes, [from, to]) => (from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to);

    /** The clock texts whose time of day it is at a date. */
    function clockTopics(date) {
        const minutes = date.getHours() * 60 + date.getMinutes();
        return CLOCK_TRIGGERS.filter(type => {
            const { days, windows } = CLOCK_WINDOWS[type];
            return (!days || days.includes(date.getDay())) && (!windows || windows.some(w => inWindow(minutes, w)));
        });
    }

    // Thinking of you: Rapport 20 and up. A shared moment or an inside joke from the memories
    // brings up that memory; with neither, they just think of you
    const YOU_TOPICS = ['thinking_of_you', 'memory_nudge', 'inside_joke_callback'];
    // The memories each kind draws on, by category (lib/memory-system.js); one isn't brought
    // up again within this many days; a share is about one of its memories this often
    const YOU_MEMORIES = { memory_nudge: 'shared_moment', inside_joke_callback: 'inside_joke' };
    const SHARE_MEMORIES = ['hobby', 'favorite_thing', 'person'];
    const RECALL_DAYS = 7;
    const SHARE_MEMORY_CHANCE = 0.3;
    // Sharing: always; a few of its texts only when they fit (f: the feelings, the time)
    const SHARE_TOPICS = [
        { type: 'random_thought' }, { type: 'sharing_impulse' }, { type: 'song_stuck' }, { type: 'craving_share' }, { type: 'curiosity_ping' },
        { type: 'dream_mention', when: f => f.minutes >= 6 * 60 && f.minutes <= 10 * 60 + 30 },
        { type: 'boredom_break', when: f => f.moodTotal < 150 },
        { type: 'pride_share', when: f => f.anticipation >= 70 && f.joy >= 40 },
    ];
    // Feelings: each text its own condition and weight (docs/emotion-plan.md 3.9)
    const MOOD_TOPICS = [
        { type: 'affection_reciprocation', when: f => f.affection && (f.rapport >= 20 || f.joy >= 50), weight: f => 60 + f.joy * 0.2 },
        // Making up only on good terms: on bad terms an upset character goes cold instead
        { type: 'repair_attempt', when: f => (f.anger >= 60 || f.sadness >= 60) && f.rapport >= 20, weight: f => 75 + f.sadness * 0.2 },
        { type: 'anxiety_reassurance', when: f => f.anxiety >= 50, weight: f => 65 + f.anxiety * 0.3 },
        { type: 'celebration_nudge', when: f => f.joy >= 70 && f.rapport >= 20, weight: () => 60 },
        { type: 'mood_follow_up', when: f => f.moodShift, weight: () => 60 },
        { type: 'playful_tease', when: f => (f.joy >= 60 && f.anticipation >= 45) || f.desire >= 55, weight: f => 58 + Math.max(f.joy, f.desire) * 0.15 },
        // Jealous on bad terms too
        { type: 'jealousy_nudge', when: f => f.anger >= 35 && f.anger < 60 && f.romance >= 40, weight: f => 52 + f.anger * 0.2 },
        { type: 'overwhelm_check', when: f => f.anxiety >= 55 && f.sadness >= 40, weight: f => 62 + f.anxiety * 0.15 },
        { type: 'suppressed_thought', when: f => f.disgust >= 35 && f.disgust < 70 && f.anger < 60, weight: () => 48 },
        { type: 'overthinking_spiral', when: f => (f.anxiety >= 40 || f.sadness >= 40) && inWindow(f.minutes, [22 * 60, 3 * 60]), weight: f => 55 + f.anxiety * 0.15 },
        { type: 'longing_ping', when: f => f.romance >= 60, weight: f => 65 + f.romance * 0.15 },
        { type: 'nostalgia_wave', when: f => f.sadness >= 35 && f.rapport >= 20, weight: f => 55 + Math.max(0, f.rapport) * 0.15 },
        { type: 'gratitude_burst', when: f => f.joy >= 65 && f.rapport >= 20, weight: () => 58 },
    ];

    const TOPIC_KINDS = [
        { id: 'life', label: 'Life' },
        { id: 'you', label: 'Thinking of you' },
        { id: 'share', label: 'Sharing' },
        { id: 'callback', label: 'Picking up' },
        { id: 'mood', label: 'Feelings' },
        { id: 'gap', label: "It's been a while" },
    ];
    // Each text's kind ('parted' has none: it goes first, on its own)
    const KIND_OF = Object.fromEntries([
        ...CLOCK_TRIGGERS.map(t => [t, 'life']), ...['block_change', 'errand', 'life_event'].map(t => [t, 'life']),
        ...YOU_TOPICS.map(t => [t, 'you']), ...SHARE_TOPICS.map(t => [t.type, 'share']), ['followup_callback', 'callback'],
        ...MOOD_TOPICS.map(t => [t.type, 'mood']), ['checkin', 'gap'], ['dormancy_break', 'gap'],
    ]);

    const sayAgo = hours => (hours < 1 ? 'under an hour ago' : `${Math.round(hours)}h ago`);

    /**
     * Which kinds of topic there are now, each { id, label, need, ok, why, topics: [{ type,
     * weight?, detail? }] }, from:
     *   feelings     the feelings ({ joy, …, rapport }, zeros with emotions off)
     *   hoursSinceUser  since your last text (Infinity: none)
     *   life         the topics their own day gives (lifeTopics), or null without a schedule
     *   clockPick    0–1, fixed for the day: which clock text, when several fit (no schedule)
     *   now          the date
     *   affection    your heart, star or like on one of their recent texts
     *   moodShift    their strongest feeling has changed since their last proactive text
     *   memories     theirs ({ id, category, content }), and `recalled`: when each was last
     *                brought up (ms by id); one brought up within RECALL_DAYS isn't again
     * Thinking of you and Sharing say how many memories they have (`memoryCount`).
     */
    function topicKinds({ feelings = {}, hoursSinceUser = Infinity, life = null, clockPick = 0, now, affection = false, moodShift = false,
        memories = [], recalled = {} }) {
        const v = id => Number(feelings[id] || 0);
        const f = { joy: v('joy'), anticipation: v('anticipation'), eagerness: v('eagerness'), shock: v('shock'), sadness: v('sadness'),
            anxiety: v('anxiety'), anger: v('anger'), disgust: v('disgust'), rapport: v('rapport'), romance: v('romance'), desire: v('desire'),
            minutes: now.getHours() * 60 + now.getMinutes(), affection, moodShift };
        f.moodTotal = f.joy + f.anticipation + f.eagerness + f.shock + f.sadness + f.anxiety + f.anger + f.disgust;
        const kind = (id, need, topics, why) => ({ ...TOPIC_KINDS.find(k => k.id === id), need, topics, ok: topics.length > 0, why: topics.length ? null : why });
        const clock = clockTopics(now);
        const gap = hoursSinceUser >= 168 ? ['dormancy_break'] : hoursSinceUser >= 24 ? ['checkin'] : [];
        const fresh = memories.filter(m => m?.id && String(m.content || '').trim() && !(now.getTime() - (recalled[m.id] || 0) < RECALL_DAYS * DAY));
        const ofCategory = cats => fresh.filter(m => cats.includes(m.category));
        const you = Object.entries(YOU_MEMORIES).map(([type, cat]) => ({ type, memories: ofCategory([cat]) })).filter(t => t.memories.length);
        const about = ofCategory(SHARE_MEMORIES);
        return [
            life ? kind('life', "Just got free, an errand due or today's news", life.map(t => ({ type: t.type, detail: t.detail })), 'Nothing new in their day')
                : kind('life', 'A time of day with its own text (no schedule)', clock.length ? [{ type: clock[Math.floor(clockPick * clock.length) % clock.length] }] : [],
                    'No time-of-day text for now'),
            { ...kind('you', 'Rapport 20+; Shared Moment and Inside Joke memories', f.rapport >= 20 ? (you.length ? you : [{ type: 'thinking_of_you' }]) : [],
                `Rapport ${Math.round(f.rapport)}, needs 20`), memoryCount: you.reduce((n, t) => n + t.memories.length, 0) },
            { ...kind('share', 'Always; Hobby, Favorite Thing and Important Person memories', SHARE_TOPICS.filter(t => !t.when || t.when(f)).map(({ type }) => ({ type })), ''),
                memories: about, memoryCount: about.length },
            kind('callback', 'Your last text 2–48h ago', hoursSinceUser >= 2 && hoursSinceUser <= 48 ? [{ type: 'followup_callback' }] : [],
                hoursSinceUser === Infinity ? 'No text of yours yet' : `Your last text ${sayAgo(hoursSinceUser)}`),
            kind('mood', 'A feeling strong enough', MOOD_TOPICS.filter(t => t.when(f)).map(t => ({ type: t.type, weight: t.weight(f) })), 'No feeling strong enough'),
            kind('gap', 'Your last text 24h+ ago', gap.map(type => ({ type })),
                hoursSinceUser === Infinity ? 'No text of yours yet' : `Your last text ${sayAgo(hoursSinceUser)}`),
        ];
    }

    /**
     * The topic to text about, { kind, type, detail? }, or null: a kind first (each 1;
     * the last topic's kind × 0.3; with a schedule Life × 1.5; Feelings × 1.5 when the
     * strongest feeling is 70 or more), then in it Feelings by their weights, the rest
     * at random, past the kind's last 3 when there are others. `history`: when each text
     * last went (state.triggerHistory). A memory goes with it: the topic's own (one of its
     * memories), or a share's now and then (SHARE_MEMORY_CHANCE).
     */
    function pickTopic({ kinds, history = {}, withSchedule = false, strongest = 0, random = Math.random }) {
        const open = kinds.filter(k => k.ok);
        if (!open.length) return null;
        const last = Object.entries(history).filter(([type]) => KIND_OF[type]).sort((a, b) => b[1] - a[1])[0];
        const weigh = k => (last && KIND_OF[last[0]] === k.id ? 0.3 : 1) * (k.id === 'life' && withSchedule ? 1.5 : 1) * (k.id === 'mood' && strongest >= 70 ? 1.5 : 1);
        const roll = (items, weight) => {
            let r = random() * items.reduce((sum, item) => sum + weight(item), 0);
            for (const item of items) if ((r -= weight(item)) < 0) return item;
            return items[items.length - 1];
        };
        const kind = roll(open, weigh);
        if (kind.id === 'mood') return { kind: kind.id, ...roll(kind.topics, t => Math.max(1, t.weight)) };
        const recent = Object.entries(history).filter(([type]) => KIND_OF[type] === kind.id).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([type]) => type);
        const fresh = kind.topics.filter(t => !recent.includes(t.type));
        const { memories, ...topic } = roll(fresh.length ? fresh : kind.topics, () => 1);
        const from = memories?.length ? memories : kind.memories?.length && random() < SHARE_MEMORY_CHANCE ? kind.memories : null;
        return { kind: kind.id, ...topic, ...(from ? { memory: from[Math.floor(random() * from.length) % from.length] } : {}) };
    }

    /** What the model is told for a topic from the character's own day. */
    function topicInstruction({ type, detail, charName = 'Character', userName = 'User' }) {
        const N = charName, U = userName;
        if (type === 'parted') return `${N} and ${U} were together in person and have just parted. Text ${U} now that they're apart, the way ${N} would, without summing up what they did.`;
        if (type === 'block_change') return `${N} just got free: ${detail}. Text ${U} about what ${N} just did or what's next.`;
        if (type === 'errand') return `On ${N}'s mind: ${detail}. Tell ${U} about it, the way ${N} would.`;
        return `Something from ${N}'s day: ${detail}. Share it with ${U}.`;
    }

    /** The hour a time falls in, for counting requests: 'YYYY-MM-DDTHH' (local). */
    function hourKey(date) {
        const p = n => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}`;
    }

    window.EchoTextProactiveRounds = {
        TEMPERAMENTS, TEMPERAMENT_IDS, HOURLY_REQUESTS, MIN_GAP_MS, OPEN_CONVERSATION_MS,
        temperamentOf, defaultTemperament, planRound, isConversationOpen, roundInstruction, followUpNote, splitRound, hourKey,
        CLOCK_TRIGGERS, CLOCK_WINDOWS, LIFE_TRIGGERS, TOPIC_KINDS, KIND_OF, RECALL_DAYS, clockTopics, topicKinds, pickTopic, TOPIC_MAX_TEXTS, JUST_FREE_MS, PARTED_LATE_MS, partedAt, topicWaitHours, justGotFree, lifeTopics, topicInstruction,
    };
})();
