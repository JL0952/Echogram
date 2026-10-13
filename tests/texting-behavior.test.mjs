// Run: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = {};
new Function(readFileSync(new URL('../lib/texting-behavior.js', import.meta.url), 'utf8'))();
const Behavior = window.EchoTextTextingBehavior;

const NATIVE = ['photo', 'voice', 'react', 'transfer', 'file'];
const WECHAT = ['photo', 'voice', 'transfer', 'file'];
const build = (opts = {}) => Behavior.buildBehavior({ features: NATIVE, verbosity: 'medium', charName: 'Mira', userName: 'Qi', ...opts });

const KEEPS_GOING = 'Mira is more likely than usual to keep the conversation going: follow-up questions, new topics.';
const REACTS_MORE = 'Mira is quicker than usual to react to Qi\'s messages with a tapback.';
const GONE_GUARDED = 'Mira won\'t admit it, but it leaks out in what Mira does, and it may slip out.';
const QUICK_TO_FEEL = 'Mira is quick to feel: small things hit hard, and moods swing fast and far.';
const BLUNT = 'Mira tends to put things bluntly.';
const TACTFUL = 'Mira tends to put things tactfully.';
// What the old version made up: relationship labels and plot
const SCRIPTED = /friends|lovers|flirt|fight|spat|make up|cold war|aren't close|jealous|who Qi is texting/i;

test('everything at the middle adds nothing', () => {
    for (const values of [undefined, null, { rapport: 0, joy: 0 }, { rapport: 19, romance: 19, desire: 19 }]) {
        const result = build({ values, nsfw: true });
        assert.deepEqual(result.lines, [], JSON.stringify(values));
        assert.equal(result.text, '');
        assert.equal(result.verbosity, 'medium');
    }
    assert.equal(build({ verbosity: null }).verbosity, 'medium');
});

test('shy, Romance 90: how strong, and that it leaks out — no script of what to do', () => {
    const result = build({ bigFive: { E: 'low' }, values: { romance: 90 } });
    assert.equal(result.text, `

<texting_behavior>
How Mira feels and tends to text right now. These are leanings, not scripts: they add no history or events, and the character reference and the conversation so far come first.
- Mira is completely gone on Qi. ${GONE_GUARDED}
- ${REACTS_MORE}
- Mira is unlikely to send voice messages unless asked.
Express this through tone, phrasing, and energy — do not name or announce emotions directly unless asked.
</texting_behavior>`);
    // Low Extraversion holds back what Romance pushes: no more texts, no more initiative
    assert.equal(result.verbosity, 'medium');
    assert.ok(!result.text.includes(KEEPS_GOING));
    assert.doesNotMatch(result.text, SCRIPTED);
});

test('Romance 100 is limerence', () => {
    assert.equal(build({ values: { romance: 100 } }).lines[0],
        'Mira is limerent toward Qi: obsessively preoccupied with Qi, craving reciprocation and intensely sensitive to Qi\'s attention or rejection. How openly is up to Mira; even denied, it leaks out in what Mira does.');
    assert.equal(build({ values: { romance: 95 } }).lines[0], 'Mira is completely gone on Qi. How openly is up to Mira; even denied, it leaks out in what Mira does.');
    assert.equal(build({ values: { romance: 25 } }).lines[0], 'Mira is a little drawn to Qi. How openly is up to Mira; even denied, it leaks out in what Mira does.');
});

test('Rapport −40 with Romance 80: the attraction persists; anger is only its own mood line', () => {
    const relation = 'Mira is guarded and cool toward Qi: less patient, less forthcoming. Yet Mira is completely gone on Qi; the attraction persists despite the distance.';
    const angry = build({ bigFive: { A: 'low' }, values: { rapport: -40, romance: 80, anger: 60 } });
    assert.deepEqual(angry.lines, [
        `${relation} ${GONE_GUARDED}`,
        'Mira is irritated: short and cool.',
        BLUNT,
        'Mira is unlikely to use tapback reactions.',
    ]);
    const calm = build({ bigFive: { A: 'low' }, values: { rapport: -40, romance: 80 } });
    assert.deepEqual(calm.lines, [`${relation} ${GONE_GUARDED}`, BLUNT]);
    for (const r of [angry, calm]) assert.doesNotMatch(r.text, SCRIPTED);
    // Openly hostile, and an outgoing character lets it show
    assert.equal(build({ bigFive: { E: 'high' }, values: { rapport: -70, romance: 50 } }).lines[0],
        'Mira is hostile toward Qi: no patience, no effort to be nice. Yet Mira is drawn to Qi; the attraction persists despite the hostility. Mira lets it show.');
});

test('Rapport 70 with Romance 0: an attitude, no relationship label', () => {
    const result = build({ values: { rapport: 70 } });
    assert.deepEqual(result.lines, [
        'Mira trusts Qi deeply and is fully at ease with them: open, warm, patient.',
        KEEPS_GOING,
        REACTS_MORE,
    ]);
    assert.equal(result.verbosity, 'medium');
    assert.doesNotMatch(result.text, SCRIPTED);
    assert.equal(build({ values: { rapport: 30, anger: 80 } }).lines[0], 'Mira likes Qi and is comfortable with them: friendly, patient, willing to explain.');
    assert.equal(build({ values: { rapport: -80 } }).lines[0], 'Mira is hostile toward Qi: no patience, no effort to be nice.');
});

test('WeChat has no reactions, so no tapback line', () => {
    const result = build({ features: WECHAT, values: { rapport: 70 } });
    assert.deepEqual(result.lines.slice(1), [KEEPS_GOING]);
    assert.ok(!build({ features: WECHAT, bigFive: { A: 'low' } }).text.includes('tapback'));
});

test('high Extraversion with Anticipation 80: more texts, more initiative, more sharing', () => {
    const result = build({ bigFive: { E: 'high' }, values: { anticipation: 80 } });
    assert.deepEqual(result.lines, [
        'Mira can hardly wait for what\'s coming; it keeps coming up.',
        KEEPS_GOING,
        'Mira is readier than usual to send a photo, a voice message or a link when something fits.',
    ]);
    assert.equal(result.verbosity, 'long');
    // Sharing names only what the platform has; Extraversion alone moves voice messages only
    assert.ok(build({ features: ['react'], bigFive: { E: 'high' }, values: { anticipation: 80 } }).lines.every(l => !l.includes('readier')));
    assert.deepEqual(build({ bigFive: { E: 'high' } }).lines, [KEEPS_GOING, 'Mira is readier than usual to send a voice message when something fits.']);
});

test('a moderate feeling alone only colors the tone; two of them can move a knob', () => {
    assert.deepEqual(build({ values: { joy: 60 } }).lines, ['Mira is in a good mood: upbeat and light.']);
    assert.equal(build({ values: { joy: 60 } }).verbosity, 'medium');
    assert.ok(build({ values: { anticipation: 40, anxiety: 40 } }).lines.includes(KEEPS_GOING));
    assert.ok(build({ values: { joy: 75 } }).lines.includes(REACTS_MORE));
});

test('Desire counts only with NSFW on, five steps up to desperate', () => {
    assert.deepEqual(build({ values: { desire: 90 } }).lines, []);
    const steps = [25, 45, 60, 75, 90].map(desire => build({ values: { desire }, nsfw: true }).lines[0]);
    assert.deepEqual(steps, [
        'Mira feels a flirty spark with Qi: playful, a little suggestive.',
        'Mira wants Qi and is testing how far Qi will go: teasing, with the odd dirty joke.',
        'Mira is turned on and wants Qi to know it: open dirty talk.',
        'Mira is horny and makes the first move: explicit sexting.',
        'Mira is desperate for Qi — so worked up it\'s all Mira can think about, impatient and insistent, pushing for more: explicit, graphic sexting.',
    ]);
    // Nothing about what the two are to each other
    assert.equal(build({ values: { desire: 60, rapport: -50 }, nsfw: true }).lines[1], steps[2]);
    assert.equal(build({ values: { desire: 60, rapport: 50 }, nsfw: true }).lines[1], steps[2]);
});

test('Morality decides how Desire comes out: crude and sleazy, plain, or indirect', () => {
    const line = (morality, desire) => build({ morality, values: { desire }, nsfw: true }).lines[0];
    assert.equal(line('low', 25), 'Mira feels a flirty spark with Qi: heavy on dirty jokes, a little sleazy, pushing the line at every chance.');
    assert.equal(line('low', 90), 'Mira is desperate for Qi — so worked up it\'s all Mira can think about, impatient and insistent, pushing for more: the filthiest, most graphic sexting — crude, sleazy, shameless, seizing every opening.');
    assert.equal(line('high', 45), 'Mira wants Qi and is testing how far Qi will go: only hints and light innuendo.');
    assert.equal(line('high', 90), 'Mira is desperate for Qi — so worked up it\'s all Mira can think about, impatient and insistent, pushing for more: indirect even now — suggestion and innuendo rather than crude words.');
    // Without Desire, Morality says nothing; with NSFW off, neither does
    assert.deepEqual(build({ morality: 'low', nsfw: true }).lines, []);
    assert.deepEqual(build({ morality: 'low', values: { desire: 90 } }).lines, []);
    assert.equal(line(undefined, 60), line('mid', 60));
});

test('the NSFW permission gives no examples of how kinds of characters behave', () => {
    const permission = Behavior.nsfwPermission('Mira');
    assert.match(permission, /^ADULT CONTENT: Sexting is encouraged, and comments on body parts, especially genitals, are allowed/);
    assert.match(permission, /How explicit Mira gets follows Mira's desire and morals\./);
    assert.doesNotMatch(permission, /for example|timid|flustered|reserved/i);
});

test('moods: the strongest two at 40 and up, two steps each', () => {
    const result = build({ values: { shock: 45, sadness: 75, joy: 39 } });
    assert.deepEqual(result.lines.slice(0, 2), ['Mira is really sad: few words, flat and heavy.', 'Mira is caught off guard: short, choppy texts.']);
    assert.equal(result.verbosity, 'short');
    assert.equal(build({ values: { anger: 40, anxiety: 50, disgust: 60 } }).lines.filter(l => / is (irritated|uneasy|put off)/.test(l)).length, 2);
});

test('Big Five alone: knobs and trait pairs, no feelings note', () => {
    const result = build({ bigFive: { E: 'high', C: 'low' } });
    assert.deepEqual(result.lines, [
        // A trait pair weighs 2, more than any single-trait knob here
        'Mira fires off thoughts in a rapid stream, half of them unfinished.',
        KEEPS_GOING,
        'Mira is readier than usual to send a voice message when something fits.',
        'Mira is more casual with phrasing and punctuation, sometimes leaving fragments or typos.',
    ]);
    assert.ok(!result.text.includes('Express this'));
    assert.equal(build({ bigFive: { C: 'high' } }).lines[0], 'Mira tends toward complete, carefully punctuated sentences.');
    // Emotions off: the traits still count
    assert.equal(build({ bigFive: { E: 'low' }, values: null }).verbosity, 'short');
});

test('Neuroticism on its own: how hard things hit, ahead of the trait pairs', () => {
    assert.deepEqual(build({ bigFive: { N: 'high' } }).lines, [QUICK_TO_FEEL]);
    assert.deepEqual(build({ bigFive: { N: 'low' } }).lines, ['Mira is even-keeled: it takes a lot to shake Mira, and moods pass quickly.']);
    // With a pair that has it too, both
    assert.deepEqual(build({ bigFive: { N: 'high', E: 'low' } }).lines.slice(0, 2), [
        QUICK_TO_FEEL,
        'Mira is slow to reply and overthinks; may send something, then take it back.',
    ]);
    // Feelings still come first
    assert.match(build({ bigFive: { N: 'high' }, values: { shock: 70 } }).lines[0], /^Mira is (caught off guard|stunned)/);
});

test('Agreeableness on its own: one line on how things are put', () => {
    assert.deepEqual(build({ bigFive: { A: 'high' } }).lines, [TACTFUL, REACTS_MORE]);
    assert.deepEqual(build({ bigFive: { A: 'low' } }).lines, [BLUNT, 'Mira is unlikely to use tapback reactions.']);
    // The single traits don't take the pairs' places: two pairs at most, besides them
    const crowded = build({ bigFive: { N: 'high', E: 'low', A: 'high' } }).lines;
    for (const line of [QUICK_TO_FEEL, TACTFUL, 'Mira is slow to reply and overthinks; may send something, then take it back.', 'Mira apologizes a lot, anxious not to upset Qi.']) {
        assert.ok(crowded.includes(line), line);
    }
    const pairs = build({ bigFive: { E: 'high', C: 'low', A: 'low', O: 'high' } }).lines;
    assert.ok(pairs.includes(BLUNT) && pairs.includes('Mira likes to roast and needle Qi.') && !pairs.includes('Mira jumps from topic to topic.'));
});

test('warm and outgoing (Agreeableness and Extraversion high): more tapbacks, more sharing', () => {
    const SHARES_ALL = 'Mira is readier than usual to send a photo, a voice message or a link when something fits.';
    const both = build({ bigFive: { A: 'high', E: 'high' } }).lines;
    assert.ok(both.includes(REACTS_MORE) && both.includes(SHARES_ALL) && both.includes(TACTFUL));
    // Each alone shares less: Extraversion only voice messages, Agreeableness nothing
    assert.ok(!build({ bigFive: { A: 'high' } }).lines.some(l => l.includes('readier than usual')));
    assert.ok(build({ bigFive: { E: 'high' } }).lines.includes('Mira is readier than usual to send a voice message when something fits.'));
    // The pair holds the tapbacks against some anger; Agreeableness alone doesn't
    assert.ok(build({ bigFive: { A: 'high', E: 'high' }, values: { anger: 50 } }).lines.includes(REACTS_MORE));
    assert.ok(!build({ bigFive: { A: 'high' }, values: { anger: 50 } }).lines.includes(REACTS_MORE));
});

test('at most six lines: feelings first, then knobs and trait pairs by weight', () => {
    const result = build({ nsfw: true, bigFive: { E: 'high', C: 'low', O: 'high' },
        values: { rapport: 40, romance: 60, desire: 90, joy: 80, eagerness: 70, anticipation: 50 } });
    assert.equal(result.lines.length, Behavior.MAX_LINES);
    assert.equal(result.lines[0], 'Mira likes Qi and is comfortable with them: friendly, patient, willing to explain. Mira has fallen for Qi. Mira lets it show.');
    assert.match(result.lines[1], /^Mira is desperate for Qi/);
    assert.match(result.lines[2], /^Mira is overjoyed/);
    assert.match(result.lines[3], /^Mira is impatient/);
    // Strong feelings push the sharing and initiative knobs past the trait pairs
    assert.deepEqual(result.lines.slice(4), ['Mira is readier than usual to send a photo, a voice message or a link when something fits.', KEEPS_GOING]);
});

test('reply length moves one step, within short–long', () => {
    assert.equal(Behavior.shiftVerbosity('long', 3), 'long');
    assert.equal(Behavior.shiftVerbosity('short', -3), 'short');
    assert.equal(Behavior.shiftVerbosity('short', 2.5), 'medium');
    assert.equal(Behavior.shiftVerbosity(null, -1), 'short');
    assert.equal(Behavior.shiftVerbosity('medium', 0.9), 'medium');
});

test('Romance shows guarded or direct by Extraversion, then Agreeableness', () => {
    assert.equal(Behavior.romanceStyle({ E: 'high', A: 'low' }), 'direct');
    assert.equal(Behavior.romanceStyle({ E: 'low', A: 'high' }), 'guarded');
    assert.equal(Behavior.romanceStyle({ E: 'mid', A: 'low' }), 'guarded');
    assert.equal(Behavior.romanceStyle({ E: 'mid', A: 'high' }), 'direct');
    assert.equal(Behavior.romanceStyle({ E: 'mid', A: 'mid' }), 'either');
    assert.ok(build({ bigFive: { E: 'low' }, values: { romance: 70 } }).lines[0].endsWith('leaks out in what Mira does, more and more.'));
    assert.ok(build({ bigFive: { E: 'low' }, values: { romance: 50 } }).lines[0].endsWith('leaks out in what Mira does.'));
});

test('Auto mode: the <mood> rule lists the feelings, marks fixed ones and gives the steps', () => {
    const values = { rapport: -20, romance: 100, joy: 35, anticipation: 0, eagerness: 0, shock: 0, sadness: 0, anxiety: 0, anger: 0, disgust: 0 };
    const rules = Behavior.moodRules({ values, fixed: ['romance'], steps: { relation: 10, mood: 25 }, charName: 'Mira', userName: 'Qi' });
    assert.equal(rules, `MOOD: How Mira feels shifts with what happens (news, a tease, a quarrel, a long silence), as much as it fairly would. Weigh Qi's latest messages against the values below; when they move any of them, end the reply with one more line: use the format <mood>feeling_1 value, feeling_2 value</mood>, with multiple entries separated by commas, indicating the new values of just the feelings that changed. If nothing changed, leave it out. A reserved Mira may hide it in the texts, but the values still move.
How Mira feels now, 0 (not at all) to 100 (overwhelming): rapport -20 (how they get along, from -100 hostile to 100 deep trust), romance 100 (romantic attraction, fixed), joy 35, anticipation 0, eagerness 0, shock 0, sadness 0, anxiety 0, anger 0, disgust 0.
Fixed feelings never change. A feeling moves at most 25 per reply, rapport and romance at most 10.`);
    // The chat's first report can set what's still at 0 straight away
    const first = Behavior.moodRules({ values: { rapport: 0, joy: 0, desire: 0 }, steps: { relation: 10, mood: 40 }, first: true, charName: 'Mira', userName: 'Qi' });
    assert.equal(first.split('\n')[2], 'In this first report, feelings still at 0 can go straight to where things stand so far; otherwise a feeling moves at most 40 per reply, rapport and romance at most 10.');
    assert.match(first, /desire 0 \(sexual desire\)/);
});

test('Auto mode: a line in the rule\'s format, with the feelings it lists, reads back', () => {
    globalThis.window.EchoTextEmotionModel || new Function(readFileSync(new URL('../lib/emotion-model.js', import.meta.url), 'utf8'))();
    const values = { rapport: 0, romance: 0, desire: 0, joy: 0, anticipation: 0, eagerness: 0, shock: 0, sadness: 0, anxiety: 0, anger: 0, disgust: 0 };
    const rules = Behavior.moodRules({ values, steps: { relation: 10, mood: 25 } });
    // <mood>feeling_1 value, feeling_2 value</mood>, filled in with the names listed
    const format = rules.match(/<mood>(.*?)<\/mood>/)[1];
    assert.equal(format, 'feeling_1 value, feeling_2 value');
    const listed = rules.split('\n')[1].match(/\b([a-z]+) 0\b/g).map(m => m.split(' ')[0]);
    assert.deepEqual(listed, Object.keys(values));
    const line = `<mood>${listed.map((id, i) => `${id} ${(i + 1) * 5}`).join(', ')}</mood>`;
    assert.deepEqual(window.EchoTextEmotionModel.parseMoodTag(`hi\n${line}`), { text: 'hi', mood: Object.fromEntries(listed.map((id, i) => [id, (i + 1) * 5])) });
});

// ── Pace (docs/emotion-plan.md 3.9) ─────────────────────────────────────────

const timing = (values, bigFive) => Behavior.replyTiming({ bigFive, values, random: () => 0.5 });

test('reply timing: neutral, warm, cold, and left on read only when cold enough', () => {
    assert.deepEqual(timing({}), { deliveredDelayMs: 700, readDelayMs: 1600, ghostDelayMs: 0, typingLeadMs: 750, replyDelayMs: 1400 });
    // Warm feelings answer sooner
    assert.ok(timing({ joy: 80, romance: 60 }).replyDelayMs < timing({}).replyDelayMs);
    // Cold ones read later; past a point the user is left on read for a while
    assert.ok(timing({ anger: 60 }).readDelayMs > timing({}).readDelayMs);
    assert.equal(timing({ anger: 60 }).ghostDelayMs, 0);
    assert.ok(timing({ anger: 80 }).ghostDelayMs > 0);
    // A bad relationship adds to the cold, a good one takes from it
    assert.ok(timing({ anger: 40, rapport: -70 }).ghostDelayMs > 0);
    assert.equal(timing({ anger: 40, rapport: 70 }).ghostDelayMs, 0);
    // Anxiety is in neither (it shortens the proactive wait instead)
    assert.deepEqual(timing({ anxiety: 90 }), timing({}));
});

test('reply timing: eagerness and Extraversion are quicker, low Extraversion slower', () => {
    for (const key of ['readDelayMs', 'replyDelayMs']) {
        assert.ok(timing({}, { E: 'high' })[key] < timing({})[key], key);
        assert.ok(timing({}, { E: 'low' })[key] > timing({})[key], key);
        assert.ok(timing({ eagerness: 80 })[key] < timing({})[key], key);
    }
    // No quicker than 0.55 of the neutral read delay
    assert.equal(timing({ eagerness: 100 }, { E: 'high' }).readDelayMs, Math.round(1600 * 0.55));
});

test('proactive pace: the feelings and Extraversion stretch the wait, within 0.6–1.4', () => {
    const pace = (values, bigFive) => Behavior.proactivePace({ bigFive, values });
    assert.equal(pace({}), 1);
    assert.equal(pace({ anticipation: 80 }), 0.8);
    assert.equal(pace({ romance: 40, anxiety: 40 }), 0.8);
    assert.equal(pace({ anticipation: 100, eagerness: 100, romance: 100, anxiety: 100 }), 0.6);
    assert.equal(pace({ anger: 40 }), 1.2);
    assert.equal(pace({ anger: 85, disgust: 30 }), 1.4);
    assert.equal(pace({}, { E: 'high' }), 0.85);
    assert.equal(pace({}, { E: 'low' }), 1.15);
    // Sadness no longer shortens it (the old formula's mistake); the relationship's attitude doesn't count
    assert.equal(pace({ sadness: 90, rapport: -80 }), 1);
});
