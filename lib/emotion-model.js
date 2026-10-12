(function () {
    'use strict';

    /**
     * EchoText Emotion Model
     *
     * The character's feelings and personality as plain data (docs/emotion-plan.md 3.1–3.5):
     *
     *   profile (per character, kept across chats)
     *     { bigFive: { E, A, C, O, N: 'low' | 'mid' | 'high' },
     *       morality: 'low' | 'mid' | 'high'  (how a character is about sex; NSFW only),
     *       locks: { dimensionId: value },
     *       textingStyle: { type: 'instruction' | 'example', text } }
     *   chat state (per character's chat: reset with it, saved in archives)
     *     { start: { dimensionId: value }, startAt: ms }
     *   Auto mode's reports (3.8), on the character's replies (each swipe its own)
     *     msg.mood = { dimensionId: new value }, from the reply's <mood> line
     *
     * Every value is 0–100, except Rapport's −100–100 (below 0: a strained or distant
     * relationship). 0 asks nothing of the model ("as the card says").
     * A locked dimension always has its lock value. Desire exists only with NSFW on.
     * Pure: no settings, DOM or time of its own.
     */

    // Order is the popup's order; groups as they're labelled there
    const GROUPS = [
        { id: 'relation', label: 'Relationship' },
        { id: 'desire', label: 'Desire' },
        { id: 'mood', label: 'Mood' },
    ];

    // halfLifeHours: how fast an Auto-mode value fades back to 0 (null: it doesn't)
    // min: the lowest value (0 unless given)
    const DIMENSIONS = [
        { id: 'rapport', label: 'Rapport', group: 'relation', halfLifeHours: null, min: -100, svg: 'rapport', color: '#4cd2b6' },
        { id: 'romance', label: 'Romance', group: 'relation', halfLifeHours: null, icon: 'fa-solid fa-heart', color: '#ff4d6d' },
        { id: 'desire', label: 'Desire', group: 'desire', halfLifeHours: 3, svg: 'desire', color: '#f84fba', nsfw: true },
        { id: 'joy', label: 'Joy', group: 'mood', halfLifeHours: 6, icon: 'fa-solid fa-sun', color: '#facc15' },
        { id: 'anticipation', label: 'Anticipation', group: 'mood', halfLifeHours: 4, icon: 'fa-solid fa-forward', color: '#fb923c' },
        { id: 'eagerness', label: 'Eagerness', group: 'mood', halfLifeHours: 2, icon: 'fa-solid fa-gauge-high', color: '#f97316' },
        { id: 'shock', label: 'Shock', group: 'mood', halfLifeHours: 0.5, icon: 'fa-solid fa-bolt', color: '#38bdf8' },
        { id: 'sadness', label: 'Sadness', group: 'mood', halfLifeHours: 12, icon: 'fa-solid fa-cloud-rain', color: '#60a5fa' },
        { id: 'anxiety', label: 'Anxiety', group: 'mood', halfLifeHours: 8, icon: 'fa-solid fa-ghost', color: '#a78bfa' },
        { id: 'anger', label: 'Anger', group: 'mood', halfLifeHours: 8, icon: 'fa-solid fa-fire-flame-curved', color: '#f87171' },
        { id: 'disgust', label: 'Disgust', group: 'mood', halfLifeHours: 12, icon: 'fa-solid fa-face-grimace', color: '#a3e635' },
    ];
    const DIMENSION_IDS = DIMENSIONS.map(d => d.id);

    // The Big Five, in the popup's order
    const BIG_FIVE = [
        { id: 'E', label: 'Extraversion', svg: 'extraversion', color: '#f97676' },
        { id: 'A', label: 'Agreeableness', svg: 'agreeableness', color: '#76f98a' },
        { id: 'C', label: 'Conscientiousness', svg: 'conscientiousness', color: '#f9dd76' },
        { id: 'O', label: 'Openness', svg: 'openness', color: '#76bcf9' },
        { id: 'N', label: 'Neuroticism', svg: 'neuroticism', color: '#a676f9' },
    ];
    // Not one of the Big Five, but a trait shown under them: how the character is
    // about sex, from crude and sleazy to indirect. Only with NSFW on.
    const MORALITY = { id: 'morality', label: 'Morality', svg: 'morality', color: '#f9bb76', nsfw: true };
    const LEVELS = ['low', 'mid', 'high'];
    const MODES = ['off', 'manual', 'auto'];
    const TEXTING_STYLE_TYPES = ['instruction', 'example'];

    const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
    const minOf = id => DIMENSIONS.find(d => d.id === id)?.min ?? 0;
    /** A value rounded into its dimension's range (0–100 without an id). */
    const clampValue = (v, id) => Math.max(minOf(id), Math.min(100, Math.round(Number(v) || 0)));

    /** The dimensions shown and used: desire only with NSFW on. */
    function activeDimensions({ nsfw = false } = {}) {
        return DIMENSIONS.filter(d => nsfw || !d.nsfw);
    }

    function zeroValues() {
        return Object.fromEntries(DIMENSION_IDS.map(id => [id, 0]));
    }

    /** A character's profile, filled in and cleaned up (unknown keys and values dropped). */
    function normalizeProfile(raw) {
        const src = isObject(raw) ? raw : {};
        const bigFive = {};
        for (const trait of BIG_FIVE) {
            const level = isObject(src.bigFive) ? src.bigFive[trait.id] : null;
            bigFive[trait.id] = LEVELS.includes(level) ? level : 'mid';
        }
        const locks = {};
        if (isObject(src.locks)) {
            for (const id of DIMENSION_IDS) if (id in src.locks) locks[id] = clampValue(src.locks[id], id);
        }
        const style = isObject(src.textingStyle) ? src.textingStyle : {};
        const textingStyle = {
            type: TEXTING_STYLE_TYPES.includes(style.type) ? style.type : 'instruction',
            text: typeof style.text === 'string' ? style.text : '',
        };
        const morality = LEVELS.includes(src.morality) ? src.morality : 'mid';
        return { bigFive, morality, locks, textingStyle };
    }

    /**
     * A chat's state, filled in. Anything else — like the old Plutchik / MBTI state,
     * which had no `start` — is replaced by a fresh state starting at `now`.
     */
    function normalizeChatState(raw, now) {
        if (!isObject(raw) || !isObject(raw.start)) return { start: zeroValues(), startAt: now };
        const start = zeroValues();
        for (const id of DIMENSION_IDS) start[id] = clampValue(raw.start[id], id);
        return { start, startAt: Number.isFinite(raw.startAt) ? raw.startAt : now };
    }

    // ── Auto mode (docs/emotion-plan.md 3.8) ────────────────────────────────

    // How far one reply can move a feeling: Rapport and Romance slowly, the rest by Neuroticism
    const RELATION_IDS = ['rapport', 'romance'];
    const RELATION_STEP = 10;
    const MOOD_STEPS = { low: 15, mid: 25, high: 40 };

    /** How far one report can move a feeling, for a character's profile. */
    function reportSteps(profile) {
        return { relation: RELATION_STEP, mood: MOOD_STEPS[profile.bigFive.N] || MOOD_STEPS.mid };
    }

    /** A value faded toward 0 over `ms`, by its feeling's half-life (Rapport and Romance don't fade). */
    function fade(value, id, ms) {
        const halfLife = DIMENSIONS.find(d => d.id === id)?.halfLifeHours;
        if (!halfLife || !(ms > 0)) return value;
        return value * Math.pow(0.5, ms / 3600000 / halfLife);
    }

    // <mood> and the names models use for it
    const MOOD_TAG_NAMES = ['mood', 'moods', 'mood_update', 'emotion', 'emotions', 'emotion_update', 'feeling', 'feelings', '情绪', '心情'];
    // Feeling id → the names models write for it, besides the id
    const FEELING_ALIASES = {
        rapport: ['relationship', 'relation', 'trust', '关系', '信任', '好感'],
        romance: ['romantic', 'attraction', 'crush', 'love', '心动', '爱慕'],
        desire: ['lust', 'arousal', 'horny', '欲望', '性欲'],
        joy: ['happiness', 'happy', '开心', '快乐', '高兴'],
        anticipation: ['excitement', 'excited', '期待'],
        eagerness: ['eager', 'impatience', 'impatient', '急切'],
        shock: ['surprise', 'surprised', 'shocked', '震惊', '惊讶'],
        sadness: ['sad', 'sorrow', '难过', '伤心'],
        anxiety: ['anxious', 'fear', 'worry', 'nervous', '不安', '焦虑', '担心'],
        anger: ['angry', 'irritation', 'annoyance', '生气', '愤怒'],
        disgust: ['disgusted', 'contempt', '反感', '厌恶'],
    };
    const FEELING_BY_NAME = new Map();
    for (const id of DIMENSION_IDS) for (const name of [id, ...(FEELING_ALIASES[id] || [])]) FEELING_BY_NAME.set(name, id);

    const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Longest first; a name must be followed by whitespace, '/' or '>' (\b doesn't work for CJK names)
    const TAG_GROUP = [...MOOD_TAG_NAMES].sort((a, b) => b.length - a.length).map(escapeRe).join('|');
    const ANY_MOOD_TAG_RE = new RegExp(`<\\s*\\/?\\s*(?:${TAG_GROUP})(?=[\\s/>])`, 'i');
    const PAIRED_MOOD_RE = new RegExp(`<\\s*(?:${TAG_GROUP})(?=[\\s/>])([^>]*)>([\\s\\S]*?)<\\s*\\/\\s*(?:${TAG_GROUP})\\s*>`, 'gi');
    // Self-closing, or unclosed: then it runs to the end of its line
    const OPEN_MOOD_RE = new RegExp(`<\\s*(?:${TAG_GROUP})(?=[\\s/>])([^>]*?)(\\/?)\\s*>([^\\n]*)`, 'gi');
    const CLOSE_MOOD_RE = new RegExp(`<\\s*\\/\\s*(?:${TAG_GROUP})\\s*>`, 'gi');
    // "joy 60", "joy: 60", "\"joy\": 60", joy="60", "开心60"; a "+" makes it a change, not a value
    const FEELING_RE = /([a-z_一-鿿]+)\s*["'“”]?\s*[:：=]?\s*["'“”]?\s*([+＋]?)\s*([-−–]?\d+(?:\.\d+)?)/gi;
    const CUT = '\u0000';

    /**
     * Takes a reply's <mood> line out: the text without it, and the feelings it
     * reports as { id: value } (null when there's no tag or nothing in it reads).
     * Lenient like lib/rich-messages.js: other tag names, attributes, self-closing
     * or unclosed tags, Chinese names and common aliases. A value written as a change
     * ("+10") is left out rather than guessed at.
     */
    function parseMoodTag(text) {
        const source = String(text ?? '');
        if (!ANY_MOOD_TAG_RE.test(source)) return { text: source, mood: null };
        const mood = {};
        const read = s => {
            for (const [, name, plus, number] of s.matchAll(FEELING_RE)) {
                const id = FEELING_BY_NAME.get(name.toLowerCase());
                if (id && !plus) mood[id] = clampValue(number.replace(/[−–]/, '-'), id);
            }
        };
        const cut = source
            .replace(PAIRED_MOOD_RE, (_, attrs, content) => { read(`${attrs} ${content}`); return CUT; })
            .replace(OPEN_MOOD_RE, (_, attrs, selfClosing, rest) => { read(`${attrs} ${selfClosing ? '' : rest}`); return CUT + (selfClosing ? rest : ''); })
            .replace(CLOSE_MOOD_RE, CUT);
        // A line that held only the tag goes with it
        const rest = cut.split('\n')
            .map(line => (line.includes(CUT) ? line.replaceAll(CUT, '').trimEnd() || CUT : line))
            .filter(line => line !== CUT)
            .join('\n').trim();
        return { text: rest, mood: Object.keys(mood).length ? mood : null };
    }

    /** Whether any reply in the chat has reported its feelings yet. */
    function hasReport(history) {
        return (history || []).some(msg => msg && !msg.is_user && isObject(msg.mood));
    }

    const timeOf = msg => {
        const time = typeof msg.send_date === 'number' ? msg.send_date : Date.parse(msg.send_date);
        return Number.isFinite(time) ? time : null;
    };

    /**
     * Auto mode: the values from `start`, replaying each report made since `startAt`
     * and fading between them and on to `now`; also what the latest report changed.
     * A report moves a feeling at most a step (reportSteps), except the chat's very
     * first one, which sets feelings still at 0 straight to where the story has them.
     * Locked feelings, and Desire with NSFW off, ignore reports.
     */
    function replay({ chat, profile, history, now, nsfw }) {
        const values = { ...chat.start };
        const steps = reportSteps(profile);
        let at = chat.startAt;
        let reported = false;
        let change = null;
        const fadeTo = time => {
            if (!(time > at)) return;
            for (const id of DIMENSION_IDS) values[id] = fade(values[id], id, time - at);
            at = time;
        };
        for (const msg of history || []) {
            if (!msg || msg.is_user || !isObject(msg.mood)) continue;
            const time = timeOf(msg) ?? at;
            if (time < chat.startAt) { reported = true; continue; }
            fadeTo(time);
            change = {};
            for (const [id, reportedValue] of Object.entries(msg.mood)) {
                if (!DIMENSION_IDS.includes(id) || id in profile.locks || (id === 'desire' && !nsfw)) continue;
                const step = !reported && Math.round(values[id]) === 0 ? Infinity
                    : RELATION_IDS.includes(id) ? steps.relation : steps.mood;
                const delta = Math.max(-step, Math.min(step, clampValue(reportedValue, id) - values[id]));
                values[id] += delta;
                change[id] = delta;
            }
            reported = true;
        }
        fadeTo(now);
        return { values, change };
    }

    /**
     * The character's current values: the chat's values (in Auto mode, given the
     * chat's `history` and `now`, replayed from its reports) with the profile's locks
     * on top, desire at 0 while NSFW is off.
     */
    function computeState({ chat, profile, nsfw = false, history = null, now = chat.startAt }) {
        const values = history ? replay({ chat, profile, history, now, nsfw }).values : { ...chat.start };
        for (const id of DIMENSION_IDS) values[id] = clampValue(values[id], id);
        for (const [id, value] of Object.entries(profile.locks)) values[id] = value;
        if (!nsfw) values.desire = 0;
        return values;
    }

    /** Auto mode: what the latest report since `startAt` changed, as { id: rounded delta }, or null. */
    function lastChange({ chat, profile, history, now = chat.startAt, nsfw = false }) {
        const { change } = replay({ chat, profile, history, now, nsfw });
        const moved = Object.entries(change || {}).map(([id, d]) => [id, Math.round(d)]).filter(([, d]) => d !== 0);
        return moved.length ? Object.fromEntries(moved) : null;
    }

    /** The strongest active dimension (furthest from 0) and its value, or null when everything is at 0. */
    function strongest(values, { nsfw = false } = {}) {
        let best = null;
        for (const dim of activeDimensions({ nsfw })) {
            const value = values[dim.id] || 0;
            if (value !== 0 && (!best || Math.abs(value) > Math.abs(best.value))) best = { dim, value };
        }
        return best;
    }

    window.EchoTextEmotionModel = {
        GROUPS,
        DIMENSIONS,
        DIMENSION_IDS,
        BIG_FIVE,
        MORALITY,
        LEVELS,
        MODES,
        TEXTING_STYLE_TYPES,
        clampValue,
        activeDimensions,
        zeroValues,
        normalizeProfile,
        normalizeChatState,
        computeState,
        strongest,
        reportSteps,
        fade,
        parseMoodTag,
        hasReport,
        lastChange,
    };
})();
