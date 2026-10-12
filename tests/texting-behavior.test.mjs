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
        'Mira is unlikely to use tapback reactions.',
    ]);
    const calm = build({ bigFive: { A: 'low' }, values: { rapport: -40, romance: 80 } });
    assert.deepEqual(calm.lines, [`${relation} ${GONE_GUARDED}`]);
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
    const values = { desire: 90 };
    assert.deepEqual(build({ values }).lines, []);
    const steps = [25, 45, 60, 75, 90].map(desire => build({ values: { desire }, nsfw: true }).lines[0]);
    assert.deepEqual(steps, [
        'Mira feels a flirty spark with Qi: playful, a little suggestive.',
        'Mira wants Qi: teasing and suggestive, testing how far Qi will go.',
        'Mira is turned on: talks dirty openly, says plainly what Mira wants.',
        'Mira is horny and makes the first move: explicit, graphic, uncensored sexting.',
        'Mira is desperate for Qi — so worked up it\'s all Mira can think about: raw, filthy, graphic sexting, impatient and insistent, pushing for more.',
    ]);
    // Nothing about what the two are to each other
    assert.equal(build({ values: { desire: 60, rapport: -50 }, nsfw: true }).lines[1], steps[2]);
    assert.equal(build({ values: { desire: 60, rapport: 50 }, nsfw: true }).lines[1], steps[2]);
    assert.match(Behavior.nsfwPermission('Mira'), /^ADULT CONTENT: Sexting is encouraged./);
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
