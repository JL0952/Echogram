(function () {
    'use strict';

    /**
     * EchoText Texting Behavior
     *
     * Turns a character's Big Five and current feelings into how they text right now
     * (docs/emotion-plan.md 3.3, 3.6, 3.7): a few lines for the system prompt, and the
     * reply length moved a step up or down. Everything at the middle adds nothing.
     *
     * The lines give a direction, not a script: the character card and the chat decide
     * who the two are and what has happened, and how the character shows any of this.
     *
     *   relation  Rapport as an attitude toward the user, Romance as how strong the
     *             attraction is plus how openly it shows (by the Big Five) — one line
     *   desire    with NSFW on, five steps from a flirty spark to desperate; how it
     *             comes out (crude, plain, indirect) by Morality
     *   moods     the strongest one or two (≥ 40) as typing traits
     *   knobs     the only concrete behaviors: how many texts, initiative, sharing,
     *             tapbacks, how complete — each a score from the traits (±1 per level)
     *             and the feelings (value / 70); a line only past ±1
     *   specials  a few trait pairs the knobs can't express
     *
     * Pure: no settings, DOM or time of its own. The texts are English, like the
     * other prompts; the model writes in the conversation's language.
     */

    const MAX_LINES = 6;
    const KNOB_THRESHOLD = 1;
    const MOOD_THRESHOLD = 40;
    const MAX_MOODS = 2;
    const MAX_SPECIALS = 2;
    // A trait pair counts as both its traits when it competes with the knobs for a line
    const SPECIAL_WEIGHT = 2;
    const VERBOSITY_STEPS = ['short', 'medium', 'long'];

    const NO_FEELINGS = 'Express this through tone, phrasing, and energy — do not name or announce emotions directly unless asked.';

    /** A trait's push: high +1, low −1. */
    const trait = level => (level === 'high' ? 1 : level === 'low' ? -1 : 0);
    /**
     * A feeling's push: 70 counts as one trait level. It lowers how easily a feeling
     * changes behavior rather than setting a floor: a moderate feeling on its own only
     * gets its mood line, but two of them, or one with a trait, can still move a knob.
     */
    const feel = value => (Number(value) || 0) / 70;

    /** "a, b or c" */
    function joinOr(items) {
        return items.length < 3 ? items.join(' or ') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
    }

    /** The step a value has reached: 0 below the first cut. */
    const step = (value, cuts) => cuts.filter(c => value >= c).length;

    // ── Relationship and Romance ────────────────────────────────────────────

    /** Rapport as N's attitude toward U, or '' between −20 and 20. */
    function rapportText(r, N, U) {
        if (r <= -60) return `${N} is hostile toward ${U}: no patience, no effort to be nice.`;
        if (r <= -20) return `${N} is guarded and cool toward ${U}: less patient, less forthcoming.`;
        if (r >= 60) return `${N} trusts ${U} deeply and is fully at ease with them: open, warm, patient.`;
        if (r >= 20) return `${N} likes ${U} and is comfortable with them: friendly, patient, willing to explain.`;
        return '';
    }

    // Romance's steps (20 / 40 / 60 / 80 / 100): how strong the attraction is
    function romancePredicate(level, U) {
        return [
            `is a little drawn to ${U}`,
            `is drawn to ${U}`,
            `has fallen for ${U}`,
            `is completely gone on ${U}`,
            `is limerent toward ${U}: obsessively preoccupied with ${U}, craving reciprocation and intensely sensitive to ${U}'s attention or rejection`,
        ][level - 1];
    }

    /**
     * How openly Romance shows: 'guarded' won't admit it, 'direct' lets it show.
     * Extraversion decides first (a shy character keeps it in, an outgoing one shows
     * it, kindly or not), then Agreeableness; with both at the middle, 'either'.
     */
    function romanceStyle(b) {
        for (const id of ['E', 'A']) {
            if (b[id] === 'low') return 'guarded';
            if (b[id] === 'high') return 'direct';
        }
        return 'either';
    }

    function romanceStyleText(style, level, N) {
        if (style === 'guarded') {
            const more = level >= 4 ? ', and it may slip out' : level >= 3 ? ', more and more' : '';
            return `${N} won't admit it, but it leaks out in what ${N} does${more}.`;
        }
        if (style === 'direct') return `${N} lets it show.`;
        return `How openly is up to ${N}; even denied, it leaks out in what ${N} does.`;
    }

    /** One line for Rapport and Romance, or null when both are at the middle. */
    function relationLine(b, v, N, U) {
        const attitude = rapportText(v.rapport, N, U);
        const level = step(v.romance, [20, 40, 60, 80, 100]);
        if (!level) return attitude || null;
        // Attraction in spite of a bad relationship: said as a fact, not as a struggle
        const romance = v.rapport <= -20
            ? `Yet ${N} ${romancePredicate(level, U)}; the attraction persists despite the ${v.rapport <= -60 ? 'hostility' : 'distance'}.`
            : `${N} ${romancePredicate(level, U)}.`;
        return [attitude, romance, romanceStyleText(romanceStyle(b), level, N)].filter(Boolean).join(' ');
    }

    // ── Desire ──────────────────────────────────────────────────────────────

    // Five steps (20 / 40 / 55 / 70 / 85): how much N wants it, saying nothing of how
    // it comes out
    function desireIntensity(level, N, U) {
        return [
            `${N} feels a flirty spark with ${U}`,
            `${N} wants ${U} and is testing how far ${U} will go`,
            `${N} is turned on and wants ${U} to know it`,
            `${N} is horny and makes the first move`,
            `${N} is desperate for ${U} — so worked up it's all ${N} can think about, impatient and insistent, pushing for more`,
        ][level - 1];
    }

    // How it comes out, by Morality: mid is plain flirting that gets dirty as desire
    // rises; low is crude, sleazy and opportunistic; high stays indirect
    const DESIRE_STYLE = {
        mid: ['playful, a little suggestive', 'teasing, with the odd dirty joke', 'open dirty talk', 'explicit sexting', 'explicit, graphic sexting'],
        low: [
            ...Array(2).fill('heavy on dirty jokes, a little sleazy, pushing the line at every chance'),
            'crude, sleazy dirty talk, blunt and lewd, seizing every opening',
            'crude, explicit sexting — sleazy and blunt, seizing every opening',
            'the filthiest, most graphic sexting — crude, sleazy, shameless, seizing every opening',
        ],
        high: [
            ...Array(2).fill('only hints and light innuendo'),
            ...Array(3).fill('indirect even now — suggestion and innuendo rather than crude words'),
        ],
    };

    function desireLine(v, morality, N, U) {
        const level = step(v.desire, [20, 40, 55, 70, 85]);
        if (!level) return null;
        return `${desireIntensity(level, N, U)}: ${(DESIRE_STYLE[morality] || DESIRE_STYLE.mid)[level - 1]}.`;
    }

    /**
     * The NSFW permission, said once in the system prompt while NSFW is on. It gives
     * no examples of how a kind of character behaves: every character drifted toward them.
     */
    function nsfwPermission(N) {
        return `ADULT CONTENT: Sexting is encouraged, and comments on body parts, especially genitals, are allowed — don't steer away from it out of caution. How explicit ${N} gets follows ${N}'s desire and morals. Keep ${N} true to their personality: arousal shows through ${N}'s established mannerisms, confidence, inhibitions and way of speaking — a slip in restraint, not a sudden personality change.`;
    }

    // ── Moods ───────────────────────────────────────────────────────────────

    // Per mood: [40–69, 70+]
    const MOOD_TEXTS = {
        joy: N => [`${N} is in a good mood: upbeat and light.`, `${N} is overjoyed, and it spills into every text.`],
        anticipation: N => [`${N} is looking forward to something, and it shows.`, `${N} can hardly wait for what's coming; it keeps coming up.`],
        eagerness: N => [`${N} is eager: texts in quick succession.`, `${N} is impatient: rapid bursts, not waiting for a reply.`],
        shock: N => [`${N} is caught off guard: short, choppy texts.`, `${N} is stunned: broken fragments, thoughts trailing off.`],
        sadness: N => [`${N} is down: fewer words, low energy.`, `${N} is really sad: few words, flat and heavy.`],
        anxiety: N => [`${N} is uneasy: looks for reassurance, reads into short replies.`, `${N} is anxious: needs reassurance, overthinks every reply.`],
        anger: N => [`${N} is irritated: short and cool.`, `${N} is angry: cold and curt, may barely answer.`],
        disgust: N => [`${N} is put off: minimal, perfunctory replies.`, `${N} is repelled: dismissive brush-offs.`],
    };

    function moodLines(v, N) {
        return Object.keys(MOOD_TEXTS)
            .filter(id => v[id] >= MOOD_THRESHOLD)
            .sort((a, b) => v[b] - v[a])
            .slice(0, MAX_MOODS)
            .map(id => MOOD_TEXTS[id](N)[v[id] >= 70 ? 1 : 0]);
    }

    // ── Knobs ───────────────────────────────────────────────────────────────

    // Media the sharing knob talks about, by feature
    const SHARE_MEDIA = [
        { feature: 'photo', one: 'a photo', many: 'photos', less: true },
        { feature: 'voice', one: 'a voice message', many: 'voice messages', less: true, extraversion: true },
        { feature: 'file', one: 'a link', many: 'links', less: false },
    ];

    function knobScores(b, v) {
        const goodRapport = Math.max(0, v.rapport), badRapport = Math.max(0, -v.rapport);
        const sharing = trait(b.O) + feel(v.anticipation) + feel(v.joy) + feel(v.desire) - feel(v.sadness) - feel(v.anger);
        return {
            count: trait(b.E) + feel(v.anticipation) + feel(v.eagerness) + feel(v.joy) + feel(v.romance)
                - feel(v.shock) - feel(v.sadness) - feel(v.disgust),
            completeness: trait(b.C) - feel(v.eagerness) - feel(v.shock),
            // Extraversion moves voice messages only
            sharing: Object.fromEntries(SHARE_MEDIA.map(m => [m.feature, sharing + (m.extraversion ? trait(b.E) : 0)])),
            reactions: trait(b.A) + feel(goodRapport) + feel(v.romance) + feel(v.joy)
                - feel(badRapport) - feel(v.anger) - feel(v.disgust),
            initiative: trait(b.E) + feel(goodRapport) + feel(v.romance) + feel(v.anticipation) + feel(v.anxiety)
                - feel(badRapport) - feel(v.disgust) - feel(v.anger),
        };
    }

    /** The knob lines, each with its score's size as its weight. */
    function knobLines(scores, features, N, U) {
        const lines = [];
        const past = s => Math.abs(s) >= KNOB_THRESHOLD;

        if (past(scores.initiative)) {
            lines.push({ weight: Math.abs(scores.initiative), text: scores.initiative > 0
                ? `${N} is more likely than usual to keep the conversation going: follow-up questions, new topics.`
                : `${N} tends to just answer, without follow-up questions or new topics.` });
        }

        const media = SHARE_MEDIA.filter(m => features.includes(m.feature));
        const more = media.filter(m => scores.sharing[m.feature] >= KNOB_THRESHOLD);
        const less = media.filter(m => m.less && scores.sharing[m.feature] <= -KNOB_THRESHOLD);
        if (more.length) {
            lines.push({ weight: Math.max(...more.map(m => scores.sharing[m.feature])),
                text: `${N} is readier than usual to send ${joinOr(more.map(m => m.one))} when something fits.` });
        } else if (less.length) {
            lines.push({ weight: Math.max(...less.map(m => -scores.sharing[m.feature])),
                text: `${N} is unlikely to send ${joinOr(less.map(m => m.many))} unless asked.` });
        }

        if (features.includes('react') && past(scores.reactions)) {
            lines.push({ weight: Math.abs(scores.reactions), text: scores.reactions > 0
                ? `${N} is quicker than usual to react to ${U}'s messages with a tapback.`
                : `${N} is unlikely to use tapback reactions.` });
        }

        if (past(scores.completeness)) {
            lines.push({ weight: Math.abs(scores.completeness), text: scores.completeness > 0
                ? `${N} tends toward complete, carefully punctuated sentences.`
                : `${N} is more casual with phrasing and punctuation, sometimes leaving fragments or typos.` });
        }
        return lines;
    }

    /** The reply length a step up or down from the character's own. */
    function shiftVerbosity(verbosity, score) {
        // Anything else is medium, as getVerbosityPrompt reads it
        const at = VERBOSITY_STEPS.includes(verbosity) ? VERBOSITY_STEPS.indexOf(verbosity) : 1;
        const move = score >= KNOB_THRESHOLD ? 1 : score <= -KNOB_THRESHOLD ? -1 : 0;
        return VERBOSITY_STEPS[Math.max(0, Math.min(VERBOSITY_STEPS.length - 1, at + move))];
    }

    // ── Trait pairs ─────────────────────────────────────────────────────────

    function specialLines(b, N, U) {
        return [
            b.E === 'high' && b.C === 'low' && `${N} fires off thoughts in a rapid stream, half of them unfinished.`,
            b.E === 'low' && b.N === 'high' && `${N} is slow to reply and overthinks; may send something, then take it back.`,
            b.A === 'high' && b.N === 'high' && `${N} apologizes a lot, anxious not to upset ${U}.`,
            b.A === 'low' && b.E === 'high' && `${N} likes to roast and needle ${U}.`,
            b.O === 'high' && b.E === 'high' && `${N} jumps from topic to topic.`,
        ].filter(Boolean).slice(0, MAX_SPECIALS).map(text => ({ weight: SPECIAL_WEIGHT, text }));
    }

    // ── Behavior block ──────────────────────────────────────────────────────

    /**
     * @param {object} p
     * @param {object} p.bigFive     { E, A, C, O, N: 'low' | 'mid' | 'high' }
     * @param {string} p.morality   'low' | 'mid' | 'high': how Desire comes out
     * @param {object|null} p.values the current feelings (null: emotions off, only the Big Five count)
     * @param {string[]} p.features  the platform's features
     * @param {string|null} p.verbosity the character's reply length ('short' | 'medium' | 'long')
     * @param {boolean} p.nsfw       Desire counts only with NSFW on
     * @returns {{ lines: string[], text: string, verbosity: string }}
     *   text: the block for the system prompt ('' when there is nothing to say)
     */
    function buildBehavior({ bigFive, morality = 'mid', values, features = [], verbosity = null, nsfw = false, charName = 'Character', userName = 'User' }) {
        const N = charName, U = userName;
        const b = { E: 'mid', A: 'mid', C: 'mid', O: 'mid', N: 'mid', ...(bigFive || {}) };
        const v = { rapport: 0, romance: 0, desire: 0, joy: 0, anticipation: 0, eagerness: 0, shock: 0, sadness: 0, anxiety: 0, anger: 0, disgust: 0, ...(values || {}) };
        if (!nsfw) v.desire = 0;

        const scores = knobScores(b, v);
        // Feelings first (at most four lines); knobs and trait pairs share the rest by weight,
        // a knob first on a tie
        const feelings = [relationLine(b, v, N, U), desireLine(v, morality, N, U), ...moodLines(v, N)].filter(Boolean);
        const rest = [...knobLines(scores, features, N, U), ...specialLines(b, N, U)]
            .sort((a, c) => c.weight - a.weight).map(l => l.text);
        const lines = [...feelings, ...rest].slice(0, MAX_LINES);

        const text = lines.length
            ? `\n\n<texting_behavior>\nHow ${N} feels and tends to text right now. These are leanings, not scripts: they add no history or events, and the character reference and the conversation so far come first.\n${lines.map(l => `- ${l}`).join('\n')}${feelings.length ? `\n${NO_FEELINGS}` : ''}\n</texting_behavior>`
            : '';
        return { lines, text, verbosity: shiftVerbosity(verbosity, scores.count) };
    }

    window.EchoTextTextingBehavior = {
        MAX_LINES,
        buildBehavior,
        nsfwPermission,
        shiftVerbosity,
        romanceStyle,
    };
})();
