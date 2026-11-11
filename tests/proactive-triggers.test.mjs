// Run: node --test tests/*.test.mjs
// The emotion-driven topics, the cold shoulder and the insights on the new feelings
// (docs/emotion-plan.md 3.9), through the real topic picker and the sequence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = {};
for (const f of ['lib/rich-messages.js', 'lib/features.js', 'lib/chat-view-model.js', 'lib/emotion-model.js', 'lib/proactive-rounds.js', 'lib/proactive-messaging.js']) {
    new Function(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'))();
}
const Model = window.EchoTextEmotionModel;

const HOUR = 3600000;
const EMOTION_TRIGGERS = ['affection_reciprocation', 'repair_attempt', 'curiosity_ping', 'anxiety_reassurance', 'celebration_nudge',
    'interest_share', 'mood_follow_up', 'nostalgia_wave', 'longing_ping', 'playful_tease', 'jealousy_nudge', 'boredom_break',
    'overwhelm_check', 'gratitude_burst', 'pride_share', 'suppressed_thought'];

/**
 * The emotion-driven triggers the feelings allow: every candidate over a week of
 * afternoons (some triggers only run on odd or even dates, or some weekdays), with
 * the user's last text 5 hours back. `values: null` is emotions off.
 */
function triggers(values, { snapshot = null, heart = false, bubbleHeart = false, pace = 1, lastUserHours = 5, lastProactiveHours = null, temperament = 'normal' } = {}) {
    const found = new Set();
    let blocked = 0;
    for (let d = 0; d < 7; d++) {
        const now = new Date(2026, 9, 12 + d, 15, 0, 0);
        const p = window.EchoTextProactiveMessaging.createProactiveMessaging({
            getSettings: () => ({}),
            getUserName: () => 'Me', getActiveFeatures: () => [], getTemperament: () => temperament,
            expandTimeDateMacros: t => t, replaceMacros: t => t,
            getEmotionState: () => (values ? { ...Model.zeroValues(), ...values } : null),
            getProactivePace: () => pace,
            findLastUserMessageIndex: h => h.map(m => m.is_user).lastIndexOf(true),
        });
        const userAt = now.getTime() - lastUserHours * HOUR;
        const history = [
            { is_user: false, mes: 'hey\nthere', send_date: userAt - HOUR, ...(heart ? { reactions: { heart: { count: 1, mine: true } } } : {}),
                ...(bubbleHeart ? { bubbleReactions: { 0: ['heart'] } } : {}) },
            { is_user: true, mes: 'ok', send_date: userAt },
        ];
        const state = { lastUserMessageAt: userAt, lastCharacterMessageAt: userAt - HOUR, triggerHistory: {}, lastEmotionSnapshot: snapshot,
            lastProactiveAt: lastProactiveHours === null ? 0 : now.getTime() - lastProactiveHours * HOUR };
        const config = { ...p.getDefaultProactiveConfigForCharacter({}), temperament };
        const candidates = p.topicAt({ history, state, config, now, collect: true });
        if (!candidates.length) blocked++;
        for (const c of candidates || []) if (EMOTION_TRIGGERS.includes(c.type)) found.add(c.type);
    }
    return blocked === 7 ? null : found;
}
const has = (values, type, opts) => triggers(values, opts).has(type);

test('making up only on good terms; on bad terms an upset character goes cold', () => {
    assert.ok(has({ anger: 60, rapport: 30 }, 'repair_attempt'));
    assert.ok(has({ sadness: 60, rapport: 30 }, 'repair_attempt'));
    assert.ok(!has({ anger: 60, rapport: -30 }, 'repair_attempt'));
    assert.ok(!has({ anger: 60 }, 'repair_attempt'));
});

test('the relationship gates the warm triggers: Rapport 20 and up', () => {
    assert.ok(has({ rapport: 20 }, 'affection_reciprocation', { heart: true }));
    // A heart on any one bubble counts too
    assert.ok(has({ rapport: 20 }, 'affection_reciprocation', { bubbleHeart: true }));
    assert.ok(has({ joy: 50 }, 'affection_reciprocation', { heart: true }));
    assert.ok(!has({ rapport: 10 }, 'affection_reciprocation', { heart: true }));
    assert.ok(!has({ rapport: 80 }, 'affection_reciprocation'));
    for (const type of ['celebration_nudge', 'gratitude_burst']) {
        assert.ok(has({ joy: 75, rapport: 20 }, type), type);
        assert.ok(!has({ joy: 75 }, type), type);
    }
    assert.ok(has({ sadness: 40, rapport: 20 }, 'nostalgia_wave'));
    assert.ok(!has({ sadness: 40, rapport: -50 }, 'nostalgia_wave'));
});

test('Romance drives longing and jealousy — jealous on bad terms too', () => {
    assert.ok(has({ romance: 60 }, 'longing_ping'));
    assert.ok(!has({ romance: 50 }, 'longing_ping'));
    // The old condition (sadness + trust) no longer does it
    assert.ok(!has({ sadness: 80, rapport: 80 }, 'longing_ping'));
    assert.ok(has({ anger: 40, romance: 40 }, 'jealousy_nudge'));
    assert.ok(has({ anger: 40, romance: 40, rapport: -60 }, 'jealousy_nudge'));
    assert.ok(!has({ anger: 40, rapport: 80 }, 'jealousy_nudge'));
});

test('the moods map one to one', () => {
    assert.ok(has({ anticipation: 60 }, 'curiosity_ping'));
    assert.ok(has({ anxiety: 60 }, 'anxiety_reassurance'));
    assert.ok(has({ joy: 70 }, 'interest_share'));
    assert.ok(has({ anxiety: 60, sadness: 45 }, 'overwhelm_check'));
    assert.ok(has({ disgust: 40 }, 'suppressed_thought'));
    assert.ok(has({ anticipation: 75, joy: 45 }, 'pride_share'));
    assert.ok(!has({ anticipation: 75 }, 'pride_share'));
    assert.ok(has({ joy: 60, anticipation: 45 }, 'playful_tease'));
    // Desire counts too (it is 0 while NSFW is off)
    assert.ok(has({ desire: 60 }, 'playful_tease'));
    assert.ok(!has({ joy: 60 }, 'playful_tease'));
});

test('boredom counts the moods only; the mood follow-up the strongest feeling', () => {
    assert.ok(has({}, 'boredom_break'));
    assert.ok(has({ rapport: 100, romance: 100 }, 'boredom_break'));
    assert.ok(!has({ joy: 80, anticipation: 80 }, 'boredom_break'));
    assert.ok(has({ anger: 40 }, 'mood_follow_up', { snapshot: { dominant: 'joy', intensity: 60 } }));
    // Romance 90 isn't a feeling: joy is still the strongest, nothing shifted
    assert.ok(!has({ joy: 60, romance: 90 }, 'mood_follow_up', { snapshot: { dominant: 'joy', intensity: 60 } }));
});

test('emotions off: the same as every feeling at 0', () => {
    assert.deepEqual([...triggers(null)].sort(), [...triggers({})].sort());
});

test('the cold shoulder: high anger or disgust holds her next text back, however long ago your last text was', () => {
    const now = Date.now();
    const next = (values, userHours, settings = { proactiveMessagingEnabled: true }) => window.EchoTextProactiveMessaging.createProactiveMessaging({
        getSettings: () => settings, saveSettings: () => {}, getUserName: () => 'Me', getActiveFeatures: () => [],
        expandTimeDateMacros: t => t, replaceMacros: t => t,
        getCurrentCharacter: () => ({ name: 'Mira', avatar: 'mira.png' }), getCharacterKey: () => 'mira.png',
        getChatHistory: () => [{ is_user: true, mes: 'ok', send_date: now - userHours * HOUR }, { is_user: false, mes: 'fine', send_date: now - userHours * HOUR + 60000 }],
        getEmotionState: () => ({ ...Model.zeroValues(), ...values }), getProactivePace: () => 1,
    }).getProactiveInsightsSnapshot().next;
    // 50 or more, anger or disgust: ghosting, from 5 hours or 15 since your last text; below: none
    for (const hours of [5, 15]) {
        assert.match(next({ anger: 50 }, hours), /^Ghosting /);
        assert.match(next({ disgust: 85 }, hours), /^Ghosting /);
    }
    assert.doesNotMatch(next({ anger: 49, disgust: 49, sadness: 90 }, 5), /^Ghosting /);
});

test('the insights panel: the six kinds with what each needs, the cold shoulder and the stretched wait', () => {
    const now = Date.now();
    const insights = (values, pace = 1) => {
        const settings = { proactiveMessagingEnabled: true };
        return window.EchoTextProactiveMessaging.createProactiveMessaging({
            getSettings: () => settings, getUserName: () => 'Me', getActiveFeatures: () => [],
            expandTimeDateMacros: t => t, replaceMacros: t => t,
            getCurrentCharacter: () => ({ name: 'Mira', avatar: 'mira.png' }), getCharacterKey: () => 'mira.png',
            getChatHistory: () => [{ is_user: true, mes: 'ok', send_date: now - HOUR }, { is_user: false, mes: 'hi', send_date: now - HOUR + 60000 }],
            getEmotionState: () => ({ ...Model.zeroValues(), ...values }), getProactivePace: () => pace,
        }).getProactiveInsightsSnapshot();
    };
    const row = (snapshot, id) => snapshot.triggerDiagnostics.find(t => t.id === id);
    const calm = insights({});
    assert.deepEqual(calm.triggerDiagnostics.map(t => t.label), ['Life', 'Thinking of you', 'Sharing', 'Picking up', 'Feelings', "It's been a while"]);
    assert.equal(row(calm, 'mood').reason, 'No feeling strong enough');
    assert.equal(row(calm, 'you').reason, 'Rapport 0, needs 20');
    const warm = insights({ rapport: 30, anxiety: 60 });
    assert.equal(row(warm, 'mood').reason, 'Can pick');
    // Warm enough, but no shared moment or inside joke to bring up
    assert.equal(row(warm, 'you').reason, 'No Shared Moment or Inside Joke memory to bring up');
    assert.equal(row(warm, 'callback').reason, 'Your last text 1h ago');
    assert.match(insights({ anger: 90 }).next, /^Ghosting · Anger 90 · until /);
    // Her reply an hour ago, unanswered: her next text (Normal: 20–60 minutes after it)
    assert.match(calm.next, /^Next text (in .*|due)$/);
    // With the temperament by the name
    assert.equal(calm.character, 'Mira · Normal');
});

test('the cold shoulder lasts while anger or disgust is 50 or more: it ends when they fade below, not on a clock of its own', () => {
    const MIN = 60000;
    const realNow = Date.now;
    const T0 = new Date(2026, 9, 12, 17, 0).getTime();
    let clock = T0;
    Date.now = () => clock;
    try {
        const settings = { proactiveMessagingEnabled: true };
        // Auto mode: the values from `base` at `from`, faded by their half-lives; Manual: they stay
        let base = { anger: 90 }, from = T0, fades = true;
        const valuesAt = at => Object.fromEntries(Object.entries({ ...Model.zeroValues(), ...base })
            .map(([id, v]) => [id, fades ? Model.DIMENSIONS.find(d => d.id === id)?.halfLifeHours ? v * 0.5 ** ((at - from) / HOUR / Model.DIMENSIONS.find(d => d.id === id).halfLifeHours) : v : v]));
        const history = [{ is_user: true, mes: 'whatever', send_date: T0 - 3 * MIN }, { is_user: false, mes: 'fine', send_date: T0 }];
        const p = window.EchoTextProactiveMessaging.createProactiveMessaging({
            getSettings: () => settings, saveSettings: () => {}, getUserName: () => 'Me', getActiveFeatures: () => [],
            expandTimeDateMacros: t => t, replaceMacros: t => t,
            getCurrentCharacter: () => ({ name: 'Mira', avatar: 'mira.png' }), getCharacterKey: () => 'mira.png',
            getChatHistory: () => history, getEmotionState: (k, at = clock) => valuesAt(at), getProactivePace: () => 1,
            findLastUserMessageIndex: h => h.map(m => m.is_user).lastIndexOf(true),
        });
        const ghost = () => p.getProactiveInsightsSnapshot().ghostWindow;

        // Anger 90, half-life 8h: below 50 after 8 × log2(90/50) ≈ 6.8h
        const first = ghost();
        assert.equal(first.feeling, 'Anger');
        assert.equal(first.value, 90);
        const end = T0 + 8 * Math.log2(90 / 50) * HOUR;
        assert.ok(first.until > end && first.until - end <= 2 * MIN);
        assert.match(p.getProactiveInsightsSnapshot().next, /^Ghosting · Anger 90 · until \d\d:\d\d$/);
        // Hours later: the same end, the value faded
        clock = T0 + 3 * HOUR;
        assert.ok(Math.abs(ghost().until - first.until) <= MIN);
        assert.ok(ghost().value < 90);
        // A message of yours changes nothing; a reply that angers him more pushes it later
        history.push({ is_user: true, mes: 'sorry', send_date: clock });
        assert.ok(Math.abs(ghost().until - first.until) <= MIN);
        base = { anger: 80 }; from = clock;
        assert.ok(ghost().until > first.until);
        // Faded below 50: over
        clock = ghost().until;
        assert.equal(ghost(), null);
        // Sadness doesn't count; disgust does, at its own half-life (12h)
        base = { sadness: 90 }; from = clock;
        assert.equal(ghost(), null);
        base = { disgust: 60, anger: 55 }; from = clock;
        assert.equal(ghost().feeling, 'Disgust');
        assert.ok(ghost().until - clock >= 12 * Math.log2(60 / 50) * HOUR);
        // Manual mode or a lock: no end of its own, until it's lowered
        fades = false; base = { anger: 60 };
        assert.equal(ghost().until, null);
        assert.equal(p.getProactiveInsightsSnapshot().next, 'Ghosting · Anger 60 · until below 50');
        base = { anger: 49 };
        assert.equal(ghost(), null);
        // Nothing kept on the state: an old drawn end is dropped
        assert.equal(settings.proactiveState['mira.png'].ghost, undefined);
    } finally {
        Date.now = realNow;
    }
});
