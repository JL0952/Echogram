// Run: node --test tests/*.test.mjs
// The emotion-driven proactive triggers, the cold shoulder and the pace on the
// new feelings (docs/emotion-plan.md 3.9), through the real trigger evaluation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = {};
for (const f of ['lib/emotion-model.js', 'lib/proactive-messaging.js']) new Function(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'))();
const Model = window.EchoTextEmotionModel;

const HOUR = 3600000;
const EMOTION_TRIGGERS = ['affection_reciprocation', 'repair_attempt', 'curiosity_ping', 'anxiety_reassurance', 'celebration_nudge',
    'sharing_impulse', 'mood_follow_up', 'nostalgia_wave', 'longing_ping', 'playful_tease', 'jealousy_nudge', 'boredom_break',
    'overwhelm_check', 'gratitude_burst', 'pride_share', 'suppressed_thought'];

/**
 * The emotion-driven triggers the feelings allow: every candidate over a week of
 * afternoons (some triggers only run on odd or even dates, or some weekdays), with
 * the user's last text 5 hours back. `values: null` is emotions off.
 */
function triggers(values, { snapshot = null, heart = false, pace = 1, lastUserHours = 5, lastProactiveHours = null } = {}) {
    const found = new Set();
    let blocked = 0;
    for (let d = 0; d < 7; d++) {
        const now = new Date(2026, 9, 12 + d, 15, 0, 0);
        const p = window.EchoTextProactiveMessaging.createProactiveMessaging({
            getSettings: () => ({ proactiveRateLimitMinutes: 180 }),
            getUserName: () => 'Me', getActiveFeatures: () => [],
            expandTimeDateMacros: t => t, replaceMacros: t => t,
            getEmotionState: () => (values ? { ...Model.zeroValues(), ...values } : null),
            getProactivePace: () => pace,
            findLastUserMessageIndex: h => h.map(m => m.is_user).lastIndexOf(true),
        });
        const userAt = now.getTime() - lastUserHours * HOUR;
        const history = [
            { is_user: false, mes: 'hey', send_date: userAt - HOUR, ...(heart ? { reactions: { heart: { count: 1, mine: true } } } : {}) },
            { is_user: true, mes: 'ok', send_date: userAt },
        ];
        const state = { lastUserMessageAt: userAt, lastCharacterMessageAt: userAt - HOUR, triggerHistory: {}, lastEmotionSnapshot: snapshot,
            lastProactiveAt: lastProactiveHours === null ? 0 : now.getTime() - lastProactiveHours * HOUR };
        const config = p.getDefaultProactiveConfigForCharacter({});
        const candidates = p.evaluateProactiveTrigger({ history, state, config, now, collect: true });
        if (!candidates) blocked++;
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
    assert.ok(has({ joy: 70 }, 'sharing_impulse'));
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

test('the cold shoulder: high anger or disgust holds every proactive text back for hours', () => {
    // 85 and up: 7–10 hours from the user's last text (5 hours back here)
    assert.equal(triggers({ anger: 85 }), null);
    assert.equal(triggers({ disgust: 85 }), null);
    assert.ok(triggers({ anger: 85 }, { lastUserHours: 15 }));
    // 50–69: 1–2 hours, long over; below 50: none
    assert.ok(triggers({ anger: 55 }));
    assert.ok(triggers({ anger: 45 }));
});

test('the pace from the feelings sets the wait between proactive texts', () => {
    // 2.5 hours since the last one, a 3-hour wait: too soon as configured, fine at 0.6 of it
    assert.equal(triggers({}, { lastProactiveHours: 2.5 }), null);
    assert.ok(triggers({}, { lastProactiveHours: 2.5, pace: 0.6 }));
});

test('the insights panel names the new conditions, the cold shoulder and the stretched wait', () => {
    const now = Date.now();
    const insights = (values, pace = 1) => {
        const settings = { proactiveMessagingEnabled: true, proactiveRateLimitMinutes: 180 };
        return window.EchoTextProactiveMessaging.createProactiveMessaging({
            getSettings: () => settings, getUserName: () => 'Me', getActiveFeatures: () => [],
            expandTimeDateMacros: t => t, replaceMacros: t => t,
            getCurrentCharacter: () => ({ name: 'Mira', avatar: 'mira.png' }), getCharacterKey: () => 'mira.png',
            getChatHistory: () => [{ is_user: false, mes: 'hi', send_date: now - 2 * HOUR, meta: { proactive: true } }, { is_user: true, mes: 'ok', send_date: now - HOUR }],
            getEmotionState: () => ({ ...Model.zeroValues(), ...values }), getProactivePace: () => pace,
        }).getProactiveInsightsSnapshot();
    };
    const req = (snapshot, id) => snapshot.triggerDiagnostics.find(t => t.id === id)?.req;
    const calm = insights({});
    assert.equal(req(calm, 'repair_attempt'), 'High Anger or Sadness + Rapport 20+');
    assert.equal(req(calm, 'longing_ping'), 'High Romance');
    assert.equal(req(calm, 'jealousy_nudge'), 'Some Anger + Romance 40+');
    assert.equal(req(calm, 'anxiety_reassurance'), 'High Anxiety');
    assert.doesNotMatch(JSON.stringify(calm.triggerDiagnostics), /Trust|Fear/);
    assert.match(insights({ anger: 90 }).next, /^Ghosting .* Anger\)$/);
    // The last proactive text went 2 hours ago: a 3-hour wait still has 1 to go, 1.4 × 3 has 2.2
    assert.match(calm.next, /Cooling down \(~?1 ?h/);
    assert.match(insights({}, 1.4).next, /Cooling down \(~?2 ?h/);
});
