// Run: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = {};
new Function(readFileSync(new URL('../lib/proactive-messaging.js', import.meta.url), 'utf8'))();

const WECHAT = ['photo', 'voice', 'transfer', 'file', 'link'];
const ECHOTEXT = ['photo', 'voice', 'react', 'transfer', 'file', 'link'];

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
const turn = (features, type, prompt = templates[type]) => proactive(features).buildTriggerTurnText({ type, prompt }, 'Mira');

const TRIGGERS = ['checkin', 'pregnant_pause', 'dormancy_break', 'late_night', 'morning_wave', 'lunch_nudge', 'evening_winddown',
    'weekend_ping', 'affection_reciprocation', 'repair_attempt', 'curiosity_ping', 'anxiety_reassurance', 'celebration_nudge',
    'sharing_impulse', 'mood_follow_up', 'memory_nudge', 'time_window', 'afternoon_slump', 'pre_dawn', 'commute_ping', 'post_work',
    'sunday_evening', 'post_midnight_impulse', 'monday_reboot', 'friday_feeling', 'sunday_scaries', 'midweek_check',
    'nostalgia_wave', 'longing_ping', 'playful_tease', 'jealousy_nudge', 'boredom_break', 'overwhelm_check', 'gratitude_burst',
    'pride_share', 'suppressed_thought', 'thinking_of_you', 'random_thought', 'dream_mention', 'song_stuck', 'overthinking_spiral',
    'craving_share', 'inside_joke_callback', 'quiet_productive', 'double_text', 'seen_no_reply_soft', 'followup_callback'];

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

test('a trigger turn offers its media when the platform has them', () => {
    assert.equal(turn(WECHAT, 'commute_ping'),
        '[Instruction for this turn — not a message from Me; never quote or answer it: '
        + 'It is {{time}} on {{weekday}} — morning or evening commute time. It has been {{timeSinceLast}} since {{user}} last messaged. Text them from the commute — traffic, transit, people-watching, or just boredom.'
        + ' If it feels natural, send a <photo> of the view on the way with it, or instead of text.'
        + ' Reply only with what Mira sends now, in the usual format: text messages, plus a photo, a voice message, a file or a link when one fits.]');
    assert.match(turn(ECHOTEXT, 'song_stuck'), /send a <voice> message humming or singing a bit of it with it/);
    assert.match(turn(WECHAT, 'random_thought'), /send a <photo> of what sparked it or a <link> with it/);
});

test('media the platform lacks are never offered', () => {
    const plain = turn(['transfer'], 'commute_ping');
    assert.doesNotMatch(plain, /photo|voice|link|file/);
    assert.match(plain, /Reply only with the text message\(s\) Mira sends now, in the usual format\.\]$/);
    assert.doesNotMatch(turn(['photo'], 'song_stuck'), /voice/);
    assert.match(turn(['photo'], 'random_thought'), /send a <photo> of what sparked it with it, or instead of text\. Reply only with what Mira sends now, in the usual format: text messages, plus a photo when one fits\.\]$/);
});

test('triggers without a media idea still allow any media', () => {
    const text = turn(WECHAT, 'checkin');
    assert.doesNotMatch(text, /If it feels natural/);
    assert.match(text, /plus a photo, a voice message, a file or a link when one fits/);
});
