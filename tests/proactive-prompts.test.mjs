// Run: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = {};
new Function(readFileSync(new URL('../lib/proactive-rounds.js', import.meta.url), 'utf8'))();
new Function(readFileSync(new URL('../lib/proactive-messaging.js', import.meta.url), 'utf8'))();

const WECHAT = ['photo', 'voice', 'location', 'transfer', 'file', 'link', 'music'];
const ECHOTEXT = ['photo', 'voice', 'location', 'react', 'transfer', 'file', 'link', 'music'];

function proactive(features) {
    return window.EchoTextProactiveMessaging.createProactiveMessaging({
        getSettings: () => ({}),
        getUserName: () => 'Me',
        getActiveFeatures: () => features,
        expandTimeDateMacros: text => text,
        replaceMacros: text => text.replace(/\{\{user\}\}/g, 'Me'),
    });
}
const templates = proactive([]).getDefaultProactiveConfigForCharacter({}).triggerTemplates;
// What a text on a topic is offered to send with it, and the reply format (lib/proactive-messaging.js writeOutreach)
const turn = (features, type) => { const p = proactive(features); return [p.mediaHint(type, 'Mira'), p.replyFormat('Mira')].filter(Boolean).join(' '); };

const TRIGGERS = ['checkin', 'dormancy_break', 'late_night', 'morning_wave', 'lunch_nudge', 'evening_winddown',
    'weekend_ping', 'affection_reciprocation', 'repair_attempt', 'curiosity_ping', 'anxiety_reassurance', 'celebration_nudge',
    'interest_share', 'mood_follow_up', 'memory_nudge', 'afternoon_slump', 'pre_dawn', 'commute_ping', 'post_work',
    'sunday_evening', 'post_midnight_impulse', 'monday_reboot', 'friday_feeling', 'sunday_scaries', 'midweek_check',
    'nostalgia_wave', 'longing_ping', 'playful_tease', 'jealousy_nudge', 'boredom_break', 'overwhelm_check', 'gratitude_burst',
    'pride_share', 'suppressed_thought', 'daily_observation', 'dream_mention', 'song_stuck', 'overthinking_spiral',
    'craving_share', 'inside_joke_callback', 'quiet_productive', 'followup_callback'];

test('every trigger still has a template', () => {
    assert.deepEqual(Object.keys(templates).sort(), [...TRIGGERS].sort());
});

test('no template sets the length or the format: the system prompt does', () => {
    const limits = /\b(under \d+|\d+ words|words?\b.*\bmax|single[- ]sentence|one sentence|sms|asterisks?|text format|texting format|texting style|short|brief|quick)\b/i;
    for (const [type, text] of Object.entries(templates)) {
        assert.doesNotMatch(text, limits, type);
        // A dangling "Time: {{time}}" became "Time: this time of day."
        assert.doesNotMatch(text, /\b(time|date):\s*\{\{/i, type);
    }
});

test('templates read well once exact times are taken out', () => {
    // buildProactiveTriggerPrompt replaces {{time}} with "this time of day"; only time_window means it
    const p = proactive([]);
    const config = p.getDefaultProactiveConfigForCharacter({});
    for (const type of TRIGGERS) {
        const text = p.buildProactiveTriggerPrompt(type, config, 0);
        if (type !== 'time_window') assert.doesNotMatch(text, /this time of day/, type);
        assert.doesNotMatch(text, /\{\{(time|date)\}\}|It is on /, type);
    }
});

test('a topic offers its media when the platform has them', () => {
    assert.equal(turn(WECHAT, 'commute_ping'),
        'If it feels natural, send a <photo> of the view on the way with it, or instead of text.'
        + ' Reply only with what Mira sends now, 3 texts at most, in the usual format: text messages, plus a photo, a voice message, a file, a link or a song when one fits.');
    assert.match(turn(ECHOTEXT, 'song_stuck'), /send a <voice> message humming or singing a bit of it or the song as <music> with it/);
    assert.match(turn(['voice'], 'song_stuck'), /send a <voice> message humming or singing a bit of it with it/);
    assert.match(turn(WECHAT, 'daily_observation'), /send a <photo> of what sparked it or a <link> with it/);
    // A core interest: the medium that interest is usually shared in, each only where the platform has it
    assert.match(turn(WECHAT, 'interest_share'), /^Send it the way that interest is usually shared: a song as <music> for music, a <link> to an article or video for a subject Mira follows or reads about, a <photo> for gardening, cooking, making or collecting things, a <voice> message for something to be heard — or just text when it's something talked about\. /);
    assert.match(turn(['music', 'photo'], 'interest_share'), /^Send it the way that interest is usually shared: a song as <music> for music, a <photo> for gardening, cooking, making or collecting things — or just text/);
    assert.doesNotMatch(turn(['transfer'], 'interest_share'), /Send it the way/);
});

test('media the platform lacks are never offered', () => {
    const plain = turn(['transfer'], 'commute_ping');
    assert.doesNotMatch(plain, /photo|voice|location|link|file|music|song/);
    assert.match(plain, /Reply only with the text message\(s\) Mira sends now, 3 at most, in the usual format\.$/);
    assert.doesNotMatch(turn(['photo'], 'song_stuck'), /voice/);
    assert.match(turn(['photo'], 'daily_observation'), /send a <photo> of what sparked it with it, or instead of text\. Reply only with what Mira sends now, 3 texts at most, in the usual format: text messages, plus a photo when one fits\.$/);
});

test('triggers without a media idea still allow any media, but a place', () => {
    const text = turn(WECHAT, 'checkin');
    assert.doesNotMatch(text, /If it feels natural/);
    assert.match(text, /plus a photo, a voice message, a file, a link or a song when one fits/);
    assert.doesNotMatch(text, /location/);
});

test('a place only on the topics of being out, and only when they are out or on their way', () => {
    const out = /or a <location> when you're out or on your way somewhere \(never when you're home\) with it/;
    for (const type of ['block_change', 'life_event', 'lunch_nudge', 'weekend_ping', 'post_work']) assert.match(turn(WECHAT, type), out, type);
    for (const type of ['daily_observation', 'craving_share', 'commute_ping', 'checkin']) assert.doesNotMatch(turn(WECHAT, type), /location/, type);
    // A platform without places: none
    assert.doesNotMatch(turn(['photo'], 'lunch_nudge'), /location/);
});

test('every text has its kind, and every kind\'s text a template (their own day\'s three are worded apart)', () => {
    const kinds = window.EchoTextProactiveRounds.KIND_OF;
    const ownDay = ['block_change', 'errand', 'life_event'];
    assert.deepEqual(Object.keys(kinds).filter(t => !ownDay.includes(t)).sort(), Object.keys(templates).sort());
    assert.ok(!('time_window' in templates));
});
