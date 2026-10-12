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

    /**
     * The character's current values: the chat's values with the profile's locks on
     * top, desire at 0 while NSFW is off. (Auto mode's replay and fading come in step E4.)
     */
    function computeState({ chat, profile, nsfw = false }) {
        const values = { ...chat.start };
        for (const [id, value] of Object.entries(profile.locks)) values[id] = value;
        if (!nsfw) values.desire = 0;
        return values;
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
    };
})();
