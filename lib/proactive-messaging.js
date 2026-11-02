(function () {
    'use strict';

    const Rounds = window.EchoTextProactiveRounds;

    function createProactiveMessaging(api) {
        let proactiveSchedulerHandle = null;
        const proactiveGenerationLocks = new Set();

        // Timestamp of when the scheduler last started — used to suppress
        // the initial "eager" tick that fires 5 s after load (which was causing
        // the typing indicator flash on character selection).
        let schedulerStartedAt = 0;

        function settings() { return api.getSettings(); }

        // ============================================================
        // TIME HELPERS
        // ============================================================

        function getDateKeyLocal(d = new Date()) {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        }

        function getNowMinutes(now = new Date()) {
            return now.getHours() * 60 + now.getMinutes();
        }

        function isNowWithinMinutesWindow(startMin, endMin, now = new Date()) {
            const nowMinutes = getNowMinutes(now);
            if (startMin <= endMin) return nowMinutes >= startMin && nowMinutes <= endMin;
            return nowMinutes >= startMin || nowMinutes <= endMin;
        }

        function parseHHMM(v) {
            const m = String(v || '').match(/^(\d{1,2}):(\d{2})$/);
            if (!m) return null;
            const hh = Math.max(0, Math.min(23, parseInt(m[1], 10)));
            const mm = Math.max(0, Math.min(59, parseInt(m[2], 10)));
            return hh * 60 + mm;
        }

        function isNowWithinWindow(windowDef, now = new Date()) {
            const [startRaw, endRaw] = String(windowDef || '').split('-').map(s => s.trim());
            const start = parseHHMM(startRaw);
            const end = parseHHMM(endRaw);
            if (start === null || end === null) return false;
            const nowMinutes = now.getHours() * 60 + now.getMinutes();
            if (start <= end) return nowMinutes >= start && nowMinutes <= end;
            return nowMinutes >= start || nowMinutes <= end;
        }

        /**
         * Returns a human-readable string describing the elapsed time since `thenTs`
         * for injection into prompt templates. E.g. "a few minutes", "2 hours", "3 days".
         */
        function humanTimeSince(thenTs) {
            if (!thenTs || thenTs <= 0) return 'a while';
            const hours = (Date.now() - thenTs) / 3600000;
            if (hours < 0.1) return 'a few minutes';
            if (hours < 1)   return `${Math.round(hours * 60)} minutes`;
            if (hours < 2)   return 'about an hour';
            if (hours < 24)  return `${Math.round(hours)} hours`;
            if (hours < 48)  return 'yesterday';
            const days = Math.round(hours / 24);
            if (days < 7)    return `${days} days`;
            if (days < 14)   return 'about a week';
            if (days < 30)   return `${Math.round(days / 7)} weeks`;
            return 'a long time';
        }

        // ============================================================
        // JITTER / STAGGER SYSTEM
        // ============================================================

        /**
         * Generates a deterministic pseudo-random number in [0, 1) that is:
         *  - stable for the same (type, day) pair — consistent within a day
         *  - different across days and across trigger types
         *
         * This means every trigger type gets a fixed "personality offset" per day
         * rather than a chaotic re-roll on every scheduler tick.
         */
        function dailySeed(type, now = new Date()) {
            const dateKey = getDateKeyLocal(now);
            const raw = dateKey + '|' + type;
            let hash = 2166136261; // FNV-1a 32-bit offset basis
            for (let i = 0; i < raw.length; i++) {
                hash ^= raw.charCodeAt(i);
                hash = (hash * 16777619) >>> 0; // unsigned 32-bit multiply
            }
            return hash / 4294967295; // normalise to [0, 1)
        }

        /**
         * Per-trigger jitter in hours. The seed is multiplied by 2× this value
         * and then the full range is shifted so jitter is symmetric around 0.
         *  e.g. jitter=1.5 → offset in [-1.5 h, +1.5 h]
         */
        const TRIGGER_JITTER_HOURS = {
            checkin:                  2.0,
            dormancy_break:           4.0,
            late_night:               0.5,
            morning_wave:             0.75,
            lunch_nudge:              0.5,
            evening_winddown:         0.75,
            weekend_ping:             2.0,
            affection_reciprocation:  0.5,
            repair_attempt:           0.75,
            curiosity_ping:           1.0,
            anxiety_reassurance:      0.5,
            celebration_nudge:        0.5,
            sharing_impulse:          0.75,
            mood_follow_up:           0.5,
            memory_nudge:             1.5,
            time_window:              0.5,
            // New triggers
            afternoon_slump:          0.75,
            pre_dawn:                 0.5,
            commute_ping:             0.33,
            post_work:                0.5,
            sunday_evening:           1.0,
            monday_reboot:            0.75,
            friday_feeling:           0.75,
            sunday_scaries:           1.0,
            midweek_check:            1.0,
            nostalgia_wave:           1.5,
            longing_ping:             1.0,
            playful_tease:            0.5,
            jealousy_nudge:           1.0,
            boredom_break:            1.0,
            overwhelm_check:          0.5,
            gratitude_burst:          1.5,
            pride_share:              1.0,
            suppressed_thought:       1.5,
            thinking_of_you:          2.0,
            random_thought:           1.5,
            dream_mention:            0.5,
            song_stuck:               1.5,
            overthinking_spiral:      0.75,
            craving_share:            1.5,
            inside_joke_callback:     2.0,
            followup_callback:        1.0,
            post_midnight_impulse:    0.33,
            quiet_productive:         1.0,
        };

        /**
         * Day-alternation pattern for each trigger.
         * Prevents every trigger from piling on the same days.
         *
         *  'any'     – fires any day (standard)
         *  'even'    – only on even day-of-month (1, 3, 5 … = odd, fires on even)
         *  'odd'     – only on odd day-of-month
         *  'weekday' – only Mon–Fri
         *  'weekend' – only Sat–Sun
         *  'mon_wed_fri' – alternating weekdays
         *  'tue_thu'     – the other alternating weekdays
         */
        const TRIGGER_DAY_PATTERN = {
            checkin:                  'any',
            dormancy_break:           'any',
            late_night:               'any',
            morning_wave:             'any',
            lunch_nudge:              'any',
            evening_winddown:         'any',
            weekend_ping:             'weekend',
            affection_reciprocation:  'any',
            repair_attempt:           'any',
            curiosity_ping:           'odd',
            anxiety_reassurance:      'any',
            celebration_nudge:        'any',
            sharing_impulse:          'even',
            mood_follow_up:           'any',
            memory_nudge:             'odd',
            time_window:              'any',
            // New triggers
            afternoon_slump:          'weekday',
            pre_dawn:                 'odd',
            commute_ping:             'weekday',
            post_work:                'weekday',
            sunday_evening:           'weekend',
            monday_reboot:            'weekday',
            friday_feeling:           'weekday',
            sunday_scaries:           'weekend',
            midweek_check:            'weekday',
            nostalgia_wave:           'even',
            longing_ping:             'odd',
            playful_tease:            'even',
            jealousy_nudge:           'odd',
            boredom_break:            'any',
            overwhelm_check:          'any',
            gratitude_burst:          'even',
            pride_share:              'odd',
            suppressed_thought:       'even',
            thinking_of_you:          'odd',
            random_thought:           'any',
            dream_mention:            'even',
            song_stuck:               'even',
            overthinking_spiral:      'any',
            craving_share:            'odd',
            inside_joke_callback:     'even',
            followup_callback:        'any',
            post_midnight_impulse:    'odd',
            quiet_productive:         'weekday',
        };

        /**
         * Returns true if this trigger type is allowed to fire today based on its
         * day-alternation pattern. Uses the daily seed so the decision is stable
         * for the whole day but varies naturally between days.
         */
        function isTriggerAllowedToday(type, now = new Date()) {
            const pattern = TRIGGER_DAY_PATTERN[type] || 'any';
            if (pattern === 'any') return true;

            const day = now.getDay();    // 0=Sun … 6=Sat
            const date = now.getDate();  // 1–31

            switch (pattern) {
                case 'even':     return date % 2 === 0;
                case 'odd':      return date % 2 !== 0;
                case 'weekday':  return day >= 1 && day <= 5;
                case 'weekend':  return day === 0 || day === 6;
                case 'mon_wed_fri': return day === 1 || day === 3 || day === 5;
                case 'tue_thu':     return day === 2 || day === 4;
                default:         return true;
            }
        }

        /**
         * Returns a per-day jittered cooldown for a trigger type.
         * The base cooldown is the canTriggerType minHours; this adds a
         * deterministic daily offset so triggers don't fire at the exact same
         * interval each day.
         *
         * @param {string} type       trigger key
         * @param {number} baseHours  the minimum cooldown in hours
         * @param {Date}   now
         * @returns {number}          effective cooldown in hours
         */
        function jitteredCooldown(type, baseHours, now = new Date()) {
            const jitter = TRIGGER_JITTER_HOURS[type] || 1.0;
            const seed   = dailySeed(type, now);
            // seed ∈ [0,1) → offset ∈ [-jitter, +jitter)
            const offset = (seed * 2 - 1) * jitter;
            return Math.max(0.5, baseHours + offset);
        }

        /**
         * Convenience wrapper that combines isTriggerAllowedToday + jittered cooldown.
         * Returns true if the trigger is allowed today AND its cooldown has elapsed.
         */
        function canTriggerToday(type, minHours, state, nowTs, now = new Date()) {
            if (!isTriggerAllowedToday(type, now)) return false;
            const prev = Number(state.triggerHistory?.[type] || 0);
            if (!prev) return true;
            const elapsed = (nowTs - prev) / 3600000;
            return elapsed >= jitteredCooldown(type, minHours, now);
        }

        // ============================================================
        // EMOTION GHOST WINDOW
        // ============================================================

        /**
         * Returns the number of hours the character should "ghost" the user
         * (suppress all proactive triggers) based on their current emotional state.
         * Anger and Disgust are the blocking emotions per the design spec.
         *
         * @param {object} emotion – current emotion state (keys: anger, disgust, …)
         * @returns {number} hours to ghost (0 = no ghost)
         */
        function getEmotionGhostWindowHours(emotion) {
            if (!emotion) return 0;
            const anger   = Number(emotion.anger   || 0);
            const disgust = Number(emotion.disgust  || 0);

            // Both very high → extended cold-shoulder
            if (anger >= 85 && disgust >= 85) return 10 + Math.random() * 4; // 10–14h
            if (anger >= 85 || disgust >= 85) return  7 + Math.random() * 3; //  7–10h
            // One or both moderately high
            if (anger >= 70 || disgust >= 70) return  3 + Math.random() * 3; //  3–6h
            if (anger >= 50 || disgust >= 50) return  1 + Math.random() * 1; //  1–2h
            return 0;
        }

        /**
         * Returns null or an object { remainingHours, emotionLabel } if the character
         * is currently in an emotion-driven ghost window.
         */
        function checkEmotionGhostWindow(state, emotion, nowTs = Date.now()) {
            const ghostHours = getEmotionGhostWindowHours(emotion);
            if (ghostHours <= 0) return null;

            // Ghost window is measured from the last USER message timestamp, since
            // anger/disgust spikes in reaction to user messages.
            const elapsed = state.lastUserMessageAt > 0
                ? (nowTs - state.lastUserMessageAt) / 3600000
                : 0;

            if (elapsed < ghostHours) {
                const remaining = ghostHours - elapsed;
                const label = (Number(emotion?.anger || 0) >= Number(emotion?.disgust || 0))
                    ? 'Anger' : 'Disgust';
                return { remainingHours: remaining, emotionLabel: label };
            }
            return null;
        }

        /**
         * The wait between proactive texts, in hours: the character's temperament's
         * (lib/proactive-rounds.js topicHours; where in its range is fixed for the day)
         * stretched by the feelings (anticipation, eagerness, Romance and anxiety shorten
         * it, anger and disgust lengthen it, Extraversion once more; within 0.6–1.4, 1 with
         * emotions off). See lib/texting-behavior.js proactivePace.
         */
        function getRateLimitHours(config, now = new Date()) {
            const pace = typeof api.getProactivePace === 'function' ? api.getProactivePace() : 1;
            const [lo, hi] = Rounds.temperamentOf(config?.temperament).topicHours;
            return (lo + dailySeed('topic_gap', now) * (hi - lo)) * pace;
        }

        /**
         * Whether a new topic (round B) may come now, and if not why: { ok, why, waitHours,
         * unanswered, day }. Your unanswered topics in a row (follow-ups don't count) are
         * capped by the temperament, each one making the wait longer; with Daily Life
         * (api.getDailyLife: a schedule) they don't text while with you in person or asleep,
         * only on some busy stretches (fixed for the day), and just after getting free the
         * wait is halved.
         */
        function topicGate({ history, state, config, now }) {
            const t = Rounds.temperamentOf(config?.temperament);
            const lastUser = history.map(m => !!m?.is_user).lastIndexOf(true);
            const unanswered = history.slice(lastUser + 1)
                .filter(m => !m.is_user && m.meta?.proactive && m.meta.proactiveType !== 'follow_up').length;
            const day = typeof api.getDailyLife === 'function' ? api.getDailyLife() : null;
            if (day) day.justFree = Rounds.justGotFree({ phone: day.phone, prevPhone: day.prevPhone, since: day.since, now: now.getTime() });
            let waitHours = Rounds.topicWaitHours({ baseHours: getRateLimitHours(config, now), temperament: t.id, unanswered });
            if (day?.justFree) waitHours /= 2;
            const result = { ok: false, why: null, waitHours, unanswered, day };
            if (day?.phone === 'together') return { ...result, why: 'together' };
            if ((api.getStoryPauseUntil?.() || 0) > now.getTime()) return { ...result, why: 'story' };
            if (unanswered >= t.topicCap) return { ...result, why: 'unanswered' };
            if (day?.phone === 'asleep') return { ...result, why: 'asleep' };
            // Busy: only some stretches, the same all day
            if (day?.phone === 'busy' && dailySeed(`busy_${day.block?.from}`, now) >= 0.3) return { ...result, why: 'busy' };
            return { ...result, ok: true };
        }

        /** Whether the text after parting is due now; left too late, it's dropped. */
        function partedDue(state, nowTs) {
            const at = state.parted?.at;
            if (!at || nowTs < at) return false;
            if (nowTs - at < Rounds.PARTED_LATE_MS) return true;
            state.parted = null;
            return false;
        }

        // ============================================================
        // CHARACTER CONFIG
        // ============================================================

        function getDefaultProactiveConfigForCharacter(char) {
            const corpus = `${char?.description || ''} ${char?.personality || ''} ${char?.scenario || ''}`.toLowerCase();
            const insomniaFriendly = /\b(insomnia|night owl|can't sleep|late[- ]?night|up all night|nocturnal)\b/.test(corpus);
            return {
                enabled: true,
                minInactivityBeforePingHours: 24,
                minInactivityForWindowHours: insomniaFriendly ? 3 : 4,
                allowedPingHours: insomniaFriendly ? ['02:00-03:00'] : [],
                suppressCheckinRepeatHours: 18,
                // What each trigger is about. Length and format come from the system prompt
                // (reply length, texting format, feature rules); media hints are added per
                // platform when the trigger turn is built (TRIGGER_MEDIA).
                triggerTemplates: {
                    // ── Core re-engagement ──────────────────────────────────────────
                    checkin:
                        'You have not heard from {{user}} in {{timeSinceLast}}. Check in with them casually.',

                    dormancy_break:
                        'You have not spoken with {{user}} in {{timeSinceLast}}. Reach out, warm but understated, and acknowledge the gap naturally.',

                    // ── Time-of-day ─────────────────────────────────────────────────
                    late_night:
                        'It is {{time}} on {{weekday}} and you haven\'t talked with {{user}} in {{timeSinceLast}}. Text them something late-night — sleepy, random, or affectionate.',

                    morning_wave:
                        'Good morning — it is {{weekday}}. You last heard from {{user}} {{timeSinceLast}} ago. Say good morning in a way that matches your current mood.',

                    lunch_nudge:
                        'It is {{time}} on {{weekday}} — midday. Message {{user}} on your lunch break.',

                    evening_winddown:
                        'It is {{time}} on {{weekday}}, evening time. You last spoke with {{user}} {{timeSinceLast}} ago. Wind down with them as the day ends.',

                    weekend_ping:
                        'It is {{weekday}}, a weekend, and {{timeSinceLast}} since you and {{user}} last talked. Send them something spontaneous and unstructured.',

                    // ── Emotion-driven ──────────────────────────────────────────────
                    affection_reciprocation:
                        '{{user}} showed you affection recently. It has been {{timeSinceLast}} since their last message. Return the affection.',

                    repair_attempt:
                        'There was tension between you and {{user}} recently. It has been {{timeSinceLast}}. Reach out gently to soften the mood, with no pressure.',

                    curiosity_ping:
                        'You feel a surge of curiosity. It has been {{timeSinceLast}} since you heard from {{user}}. Ask them something curious and random to start a conversation.',

                    anxiety_reassurance:
                        'You feel uneasy and crave connection. It has been {{timeSinceLast}} since {{user}} messaged. Reach out subtly for reassurance.',

                    celebration_nudge:
                        'Your mood is high and you feel an urge to share that energy. It has been {{timeSinceLast}} since you last spoke with {{user}}. Text them something upbeat and hyped.',

                    sharing_impulse:
                        'A sudden impulse to share something crosses your mind — {{random::a thought::a random observation::something you just noticed::a question that just occurred to you}}. Share it with {{user}} on the spot.',

                    mood_follow_up:
                        'Your emotional state has shifted recently. It is {{time}} on {{weekday}}. Text {{user}} in a way that shows your current mood naturally, without explaining it.',

                    // ── Memory / shared history ─────────────────────────────────────
                    memory_nudge:
                        'You recall a recent shared moment with {{user}}. It has been {{timeSinceLast}}. Bring it up casually — a "remember when" or a similar callback.',

                    // ── Time-window ping (for custom allowed hours) ─────────────────
                    time_window:
                        'You feel like texting {{user}}. It is {{time}} on {{weekday}}. Send something that fits this time of day.',

                    // ── Extended time-of-day triggers ───────────────────────────────
                    afternoon_slump:
                        'It is {{time}} on {{weekday}} — that slow mid-afternoon drag. You haven\'t talked with {{user}} in {{timeSinceLast}}. Text them, low-energy but affectionate.',

                    pre_dawn:
                        'It is the strange, quiet hours before dawn on {{weekday}}. You haven\'t heard from {{user}} in {{timeSinceLast}}. Send something liminal and half-awake, raw.',

                    commute_ping:
                        'It is {{time}} on {{weekday}} — morning or evening commute time. It has been {{timeSinceLast}} since {{user}} last messaged. Text them from the commute — traffic, transit, people-watching, or just boredom.',

                    post_work:
                        'It is {{time}} on {{weekday}} — you\'ve just wound down from the day. You haven\'t spoken with {{user}} in {{timeSinceLast}}. Send a relaxed "done for the day" message.',

                    sunday_evening:
                        'It is Sunday evening. {{timeSinceLast}} since {{user}} messaged. Send something cozy and slightly wistful, soft and real — the week hasn\'t started yet.',

                    post_midnight_impulse:
                        'It is past midnight on {{weekday}}. {{timeSinceLast}} since you last heard from {{user}}. An impulse hit you to text them: send something impulsive and raw — it could be anything.',

                    // ── Day-specific triggers ───────────────────────────────────────
                    monday_reboot:
                        'It is Monday and the week is just starting. You haven\'t heard from {{user}} in {{timeSinceLast}}. Send something Monday-flavored — new-week energy, mild dread, or a simple hello.',

                    friday_feeling:
                        'It is Friday — the end of the week is near. It has been {{timeSinceLast}} since {{user}} last texted. Send something light and casual with a Friday vibe.',

                    sunday_scaries:
                        'It is Sunday and that familiar pre-week unease is setting in. {{timeSinceLast}} since {{user}} last messaged. Send something gently anxious or commiserating, real and understated.',

                    midweek_check:
                        'It is Wednesday — middle of the week. {{timeSinceLast}} since you heard from {{user}}. Nudge them midweek — silly, tired, or just checking in.',

                    // ── Emotion-driven (extended) ───────────────────────────────────
                    nostalgia_wave:
                        'A wave of nostalgia washed over you and you thought of {{user}}. {{timeSinceLast}} since they last texted. Hint at a fond memory, warmly but without being sappy.',

                    longing_ping:
                        'You\'ve been missing {{user}}. It has been {{timeSinceLast}} since their last message. Let them know you\'ve been thinking of them — honest, not desperate.',

                    playful_tease:
                        'You\'re in a playful, slightly flirty mood. {{user}} hasn\'t messaged in {{timeSinceLast}}. Tease them — an in-joke, a mild poke, or light sarcasm.',

                    jealousy_nudge:
                        'Something made you feel a faint, unspoken pang of jealousy and now you\'re thinking of {{user}}. {{timeSinceLast}} since their last text. Send something subtly possessive or attention-seeking, without explaining why.',

                    boredom_break:
                        'You\'re bored. {{timeSinceLast}} since {{user}} last texted. Send them an unfiltered bored text — dumb, random, or pointlessly cute.',

                    overwhelm_check:
                        'You\'re feeling overwhelmed or anxious, and you want to reach out to {{user}}. {{timeSinceLast}} since their last message. Hint, without drama, that you could use some company.',

                    gratitude_burst:
                        'Out of nowhere, a rush of appreciation for {{user}} hit you. {{timeSinceLast}} since they last messaged. Tell them you\'re glad they exist — warm but not saccharine.',

                    pride_share:
                        'Something happened and you feel quietly proud — and your first thought was to tell {{user}}. {{timeSinceLast}} since their last text. Share it in an understated, humblebrag-ish way.',

                    suppressed_thought:
                        'You\'ve been holding something back — a small thing that\'s been sitting in your head. {{timeSinceLast}} since {{user}} last texted. Hint, low-key and a little cryptic, that something is on your mind, without explaining it.',

                    // ── Contextual / behavioral ─────────────────────────────────────
                    thinking_of_you:
                        'You weren\'t doing anything in particular — {{user}} just crossed your mind. {{timeSinceLast}} since their last message. Send an unprompted "thinking of you" message, no explanation needed.',

                    random_thought:
                        'A completely random thought occurred to you and {{user}} is the person you want to share it with. {{timeSinceLast}} since they last texted. Share the genuinely random or weird observation.',

                    dream_mention:
                        'You remember a fragment of a dream and {{user}} was in it or it made you think of them. {{timeSinceLast}} since their last message. Tell them about it, still a little groggy.',

                    song_stuck:
                        'A song has been stuck in your head and it made you think of {{user}}, or you just want to share it. {{timeSinceLast}} since they last texted. Mention the song or the feeling — don\'t name a real song unless you\'re sure of it.',

                    overthinking_spiral:
                        'It is late and you\'re deep in your own head — overthinking, can\'t stop. {{timeSinceLast}} since {{user}} last messaged. Send something slightly spiraling or self-aware.',

                    craving_share:
                        'You have a very specific craving right now and you want to tell {{user}} about it. {{timeSinceLast}} since their last text. Describe it vividly — food, a drink, an experience, anything.',

                    inside_joke_callback:
                        'Something triggered a memory of a running joke or recurring theme between you and {{user}}. {{timeSinceLast}} since their last message. Call back to a shared joke or motif from your conversations — keep it in-world.',

                    quiet_productive:
                        'It is {{time}} on {{weekday}}. You\'ve been in your own quiet world — focused, doing your thing. {{timeSinceLast}} since {{user}} last texted. Send a "coming up for air" message.',

                    followup_callback:
                        'You\'ve been thinking about the last thing you and {{user}} discussed — {{timeSinceLast}} ago. Casually continue or reference that thread.'
                }
            };
        }

        function getMergedProactiveConfig(characterKey, char) {
            const base = getDefaultProactiveConfigForCharacter(char);
            const stored = settings().proactiveCharacterConfig?.[characterKey] || {};
            const merged = {
                ...base,
                ...stored,
                triggerTemplates: {
                    ...(base.triggerTemplates || {}),
                    ...(stored.triggerTemplates || {})
                }
            };
            if (!Array.isArray(merged.allowedPingHours)) merged.allowedPingHours = [];
            merged.temperament = typeof api.getTemperament === 'function' ? api.getTemperament(characterKey) : 'normal';
            return merged;
        }

        // ============================================================
        // STATE TRACKING
        // ============================================================

        function getProactiveConversationState(characterKey) {
            if (!characterKey) return null;
            const s = settings();
            if (!s.proactiveState || typeof s.proactiveState !== 'object') s.proactiveState = {};
            if (!s.proactiveState[characterKey]) {
                s.proactiveState[characterKey] = {
                    lastUserMessageAt: 0,
                    lastCharacterMessageAt: 0,
                    lastProactiveAt: 0,
                    lastOutboundType: 'none',
                    triggerHistory: {},
                    lastEmotionSnapshot: null // { dominant, intensity } for mood_follow_up
                };
            }
            const state = s.proactiveState[characterKey];
            if (!state.triggerHistory || typeof state.triggerHistory !== 'object') state.triggerHistory = {};
            return state;
        }

        function syncProactiveStateWithHistory(characterKey, history) {
            const state = getProactiveConversationState(characterKey);
            if (!state || !Array.isArray(history)) return;

            let latestUser = 0;
            let latestChar = 0;
            let latestProactive = 0;

            for (const msg of history) {
                const ts = Number(msg.send_date || 0) || 0;
                if (!ts) continue;
                if (msg.is_user) {
                    if (ts > latestUser) latestUser = ts;
                } else {
                    if (ts > latestChar) latestChar = ts;
                    // In combined group mode each proactive message carries a charKey so we
                    // can attribute it to the correct character.  Only update lastProactiveAt
                    // for messages that belong to THIS character (or have no charKey, which
                    // is the solo-session case).  Without this guard every member's cooldown
                    // was reset whenever *any* group member fired, causing one character
                    // (typically the first in sort order) to monopolise all proactive slots.
                    const isThisCharProactive = msg.meta?.proactive === true &&
                        (!msg.charKey || msg.charKey === characterKey);
                    if (isThisCharProactive && ts > latestProactive) latestProactive = ts;
                }
            }

            state.lastUserMessageAt = latestUser;
            state.lastCharacterMessageAt = latestChar;
            state.lastProactiveAt = latestProactive;

            if (latestChar === 0) {
                state.triggerHistory = {};
            } else {
                // Rebuild triggerHistory from proactive message metadata so that per-trigger
                // cooldowns survive a lost or stale proactiveState (e.g. page reload, failed
                // saveSettings).  Without this, triggerHistory stayed empty after a session
                // boundary even though the chat history contained the previous proactive
                // messages with their timestamps, allowing canTriggerType to bypass the
                // cooldown and fire the same trigger again — producing verbatim duplicates.
                if (!state.triggerHistory || typeof state.triggerHistory !== 'object') {
                    state.triggerHistory = {};
                }
                for (const msg of history) {
                    if (!msg.meta?.proactive || !msg.meta?.proactiveType || !msg.send_date) continue;
                    const isThisChar = !msg.charKey || msg.charKey === characterKey;
                    if (!isThisChar) continue;
                    const ts   = Number(msg.send_date || 0);
                    const type = msg.meta.proactiveType;
                    if (ts && (!state.triggerHistory[type] || ts > state.triggerHistory[type])) {
                        state.triggerHistory[type] = ts;
                    }
                }
            }
        }

        function markProactiveUserActivity(characterKey, timestamp = Date.now()) {
            const state = getProactiveConversationState(characterKey);
            if (!state) return;
            state.lastUserMessageAt = timestamp;
            // You texted first: nothing left to say after parting
            state.parted = null;
            // You answered: the follow-up round is over
            if (state.round) { state.round = null; armRoundTimer(); }
        }

        function markProactiveCharacterActivity(characterKey, proactive = false, outboundType = 'reply', timestamp = Date.now()) {
            const state = getProactiveConversationState(characterKey);
            if (!state) return;
            state.lastCharacterMessageAt = timestamp;
            state.lastOutboundType = outboundType || 'reply';
            if (proactive) {
                state.lastProactiveAt = timestamp;
                state.triggerHistory[outboundType] = timestamp;
                state.parted = null;
            }
            // A reply while you two are talking: a follow-up round if you go quiet now
            if (!proactive && outboundType === 'reply') startRound(characterKey);
        }

        /**
         * The strongest feeling as { dominant, intensity }, for mood_follow_up. Rapport
         * and Romance don't count: they are the relationship, not a mood.
         */
        function strongestFeeling(emotion) {
            const top = window.EchoTextEmotionModel?.strongest(emotion, { nsfw: true, feelingsOnly: true });
            return top ? { dominant: top.dim.id, intensity: top.value } : { dominant: 'neutral', intensity: 0 };
        }

        /**
         * Capture a lightweight snapshot of the strongest feeling for mood_follow_up comparisons.
         * Called after each proactive tick so we can detect shifts in the next tick.
         */
        function captureEmotionSnapshot(characterKey, emotion) {
            const state = getProactiveConversationState(characterKey);
            if (!state || !emotion) return;
            state.lastEmotionSnapshot = strongestFeeling(emotion);
        }

        // ============================================================
        // TRIGGER PROMPT BUILDER
        // ============================================================

        /**
         * Builds the final trigger prompt string, expanding ST macros AND our custom
         * {{timeSinceLast}} token so prompts are richly time-aware.
         *
         * Exact clock times ({{time}}, {{date}}) are smoothly removed before macro
         * expansion so the LLM never sees a specific timestamp it could accidentally
         * echo back.  Grammar is repaired so sentences like
         * "It is {{time}} on {{weekday}}" don't collapse into "It is on Monday".
         */
        function buildProactiveTriggerPrompt(triggerType, config, lastUserMessageTs) {
            const raw = config?.triggerTemplates?.[triggerType] || '';
            const timeSinceLast = humanTimeSince(lastUserMessageTs);
            const withTime = raw.replace(/\{\{timeSinceLast\}\}/g, timeSinceLast);

            // Smoothly remove exact-time macros so we don't leave broken grammar behind.
            // More-specific patterns must come first (longest match wins).
            const withoutTimeMacros = withTime
                .replace(/It is \{\{time\}\} on \{\{weekday\}\}/ig, 'It is {{weekday}}')
                .replace(/It is \{\{time\}\}/ig,                   'It is currently this time of day')
                .replace(/\{\{time\}\}/ig,                         'this time of day')
                .replace(/\{\{date\}\}/ig,                         'today');

            // expandTimeDateMacros handles {{weekday}}; replaceMacros handles {{user}}/{{char}}
            const expanded = api.expandTimeDateMacros(withoutTimeMacros);
            return api.replaceMacros ? api.replaceMacros(expanded) : expanded;
        }

        // ============================================================
        // SEMANTIC CATEGORY SYSTEM
        // ============================================================

        /**
         * Clusters triggers into broad emotional "vibes" so the character doesn't
         * send semantically identical messages back-to-back even when they come from
         * different trigger types (e.g. sharing_impulse → playful_tease → gratitude_burst
         * all feel like "I'm happy and want your attention").
         *
         * The cooldown for each category is enforced independently of per-trigger cooldowns.
         */
        const TRIGGER_SEMANTIC_CATEGORY = {
            // "I'm happy and want to share that" cluster
            sharing_impulse:          'happy_outreach',
            playful_tease:            'happy_outreach',
            celebration_nudge:        'happy_outreach',
            affection_reciprocation:  'happy_outreach',
            gratitude_burst:          'happy_outreach',
            pride_share:              'happy_outreach',
            boredom_break:            'happy_outreach',

            // "I miss you / thinking of you" cluster
            thinking_of_you:          'missing_you',
            longing_ping:             'missing_you',
            nostalgia_wave:           'missing_you',
            memory_nudge:             'missing_you',
            inside_joke_callback:     'missing_you',

            // "I'm anxious / need connection" cluster
            anxiety_reassurance:      'anxious_reach',
            overwhelm_check:          'anxious_reach',
            overthinking_spiral:      'anxious_reach',
            suppressed_thought:       'anxious_reach',

            // "Something crossed my mind" cluster
            random_thought:           'random_impulse',
            song_stuck:               'random_impulse',
            craving_share:            'random_impulse',
            dream_mention:            'random_impulse',

            // All other triggers are uncategorised — no category-level throttle
        };

        /** Minimum hours between any two triggers in the same semantic category. */
        const CATEGORY_COOLDOWN_HOURS = {
            happy_outreach: 6,
            missing_you:    8,
            anxious_reach:  5,
            random_impulse: 4,
        };

        /**
         * Returns the timestamp (ms) when this category last fired, scanning
         * triggerHistory for any member trigger.
         */
        function getCategoryLastFiredAt(category, state, nowTs) {
            let latest = 0;
            for (const [type, cat] of Object.entries(TRIGGER_SEMANTIC_CATEGORY)) {
                if (cat !== category) continue;
                const ts = Number(state.triggerHistory?.[type] || 0);
                if (ts > latest) latest = ts;
            }
            return latest;
        }

        /**
         * Returns true if this trigger's semantic category is on cooldown.
         */
        function isCategoryOnCooldown(type, state, nowTs) {
            const category = TRIGGER_SEMANTIC_CATEGORY[type];
            if (!category) return false;
            const cooldownHours = CATEGORY_COOLDOWN_HOURS[category] || 0;
            if (cooldownHours <= 0) return false;
            const lastFiredAt = getCategoryLastFiredAt(category, state, nowTs);
            if (!lastFiredAt) return false;
            return ((nowTs - lastFiredAt) / 3600000) < cooldownHours;
        }

        // ============================================================
        // TRIGGER EVALUATION
        // ============================================================

        /**
         * Picks the trigger to send now, or null. `collect` (tests) returns every
         * candidate instead of a weighted-random pick.
         */
        function evaluateProactiveTrigger({ history, state, config, now, collect = false }) {
            if (!config?.enabled) return null;
            if (!Array.isArray(history) || history.length === 0) return null;

            const nowTs = now.getTime();
            const hoursSinceUser      = state.lastUserMessageAt > 0 ? ((nowTs - state.lastUserMessageAt) / 3600000) : Infinity;
            const hoursSinceProactive = state.lastProactiveAt   > 0 ? ((nowTs - state.lastProactiveAt)   / 3600000) : Infinity;

            // ── Emotion state (docs/emotion-plan.md 3.9) ──────────────────────────
            // Null while emotions are off: every trigger then sees neutral (0) feelings.
            // Where a trigger wants a good relationship it reads Rapport's good side.
            const emotion = api.getEmotionState();
            const feel = id => Number(emotion?.[id] || 0);
            const rapport = feel('rapport'), romance = feel('romance'), desire = feel('desire');
            const joy = feel('joy'), anticipation = feel('anticipation'), eagerness = feel('eagerness'), shock = feel('shock');
            const sadness = feel('sadness'), anxiety = feel('anxiety'), anger = feel('anger'), disgust = feel('disgust');
            const goodRapport = Math.max(0, rapport);
            // How much is going on in the moods (Rapport and Romance are the relationship)
            const moodTotal = joy + anticipation + eagerness + shock + sadness + anxiety + anger + disgust;

            // ── Emotion-based ghosting ────────────────────────────────────────────
            const ghostInfo = checkEmotionGhostWindow(state, emotion, nowTs);
            if (ghostInfo) {
                // Stash on state so Insights can display it — transient, not persisted
                state._ghostWindow = ghostInfo;
                return null;
            }
            state._ghostWindow = null;

            // ── The temperament's wait, stretched by the feelings and by unanswered topics;
            // Daily Life: asleep, busy, just got free (topicGate) ────────────────────
            const gate = topicGate({ history, state, config, now });
            if (!gate.ok) return null;
            // Just parted from you: that text goes first, whatever the wait
            if (gate.day && partedDue(state, nowTs)) {
                const parted = { type: 'parted', weight: 100, prompt: Rounds.topicInstruction({ type: 'parted', charName: api.getCurrentCharacter?.()?.name || 'the character',
                    userName: api.getUserName ? api.getUserName() : 'the user' }) };
                return collect ? [parted] : parted;
            }
            const globalRateLimitHours = gate.waitHours;
            if (hoursSinceProactive < globalRateLimitHours) return null;
            const lastUserMsgIndexBudget = api.findLastUserMessageIndex(history);
            // With a schedule the clock triggers give way to the character's own day
            const ownDay = gate.day;

            // ── Context helpers ───────────────────────────────────────────────────
            const lastUserMsgIndex = lastUserMsgIndexBudget;
            const lastUserMsg  = lastUserMsgIndex >= 0 ? history[lastUserMsgIndex] : null;
            const lastCharMsg  = [...history].reverse().find(m => !m?.is_user) || null;
            // A heart, star or like from the user on any bubble of a recent character message
            const recentAffectionReaction  = history.slice(-8).some(m => !m?.is_user
                && (window.EchoTextChatViewModel?.getUserTapbackIds(m) || []).some(id => ['heart', 'star', 'like'].includes(id)));
            const hasRecentSharedMoment    = history.slice(-12).some(m => /\b(remember|that time|earlier|before|yesterday|last night)\b/i.test(String(m?.mes || '')));

            const canTriggerType = (type, minHours = 10) => {
                return canTriggerToday(type, minHours, state, nowTs, now);
            };

            // Detect a significant shift in the strongest feeling since the last snapshot (for mood_follow_up)
            const emotionShiftDetected = (() => {
                const snap = state.lastEmotionSnapshot;
                if (!snap || !emotion) return false;
                const { dominant, intensity } = strongestFeeling(emotion);
                // Trigger if the strongest feeling changed, or its intensity swung by more than 20 pts
                return dominant !== snap.dominant || Math.abs(intensity - snap.intensity) >= 20;
            })();

            // ── Candidate accumulation ────────────────────────────────────────────
            let candidates = [];

            // Weight receives a per-call random float so identical-weight triggers
            // don't always resolve deterministically — but day-seed keeps the
            // overall daily "personality" stable.
            const daySeedBase = dailySeed('_global', now);
            const addCandidate = (type, baseWeight, ownPrompt = null) => {
                if (ownDay && Rounds.CLOCK_TRIGGERS.includes(type)) return;
                // Skip if this trigger's semantic category is still on cooldown
                if (isCategoryOnCooldown(type, state, nowTs)) return;
                const prompt = ownPrompt || buildProactiveTriggerPrompt(type, config, state.lastUserMessageAt);
                // Blend a small daily-stable offset with a small truly-random spike
                const dailyNoise  = (dailySeed(type, now) - 0.5) * 8;
                const randomSpike = (Math.random() - 0.5) * 14;
                candidates.push({ type, prompt, weight: baseWeight + dailyNoise + randomSpike });
            };

            // ── Core re-engagement ────────────────────────────────────────────────
            const hoursSinceCheckin = Number(state.triggerHistory?.checkin || 0) > 0
                ? ((nowTs - state.triggerHistory.checkin) / 3600000) : Infinity;

            if (hoursSinceUser >= Math.max(globalRateLimitHours, config.minInactivityBeforePingHours || 24)
                && hoursSinceCheckin >= (config.suppressCheckinRepeatHours || 12)) {
                addCandidate('checkin', 50);
            }

            // Dormancy break — very long silence (7+ days)
            if (hoursSinceUser >= 168 && canTriggerType('dormancy_break', 72)) {
                addCandidate('dormancy_break', 80);
            }

            // ── Time-of-day ───────────────────────────────────────────────────────
            if (hoursSinceUser >= 1.5 && isNowWithinMinutesWindow(23 * 60, 2 * 60 + 30, now) && canTriggerType('late_night', 14))
                addCandidate('late_night', 60);
            if (hoursSinceUser >= 8  && isNowWithinMinutesWindow(6 * 60, 9 * 60 + 30, now) && canTriggerType('morning_wave', 18))
                addCandidate('morning_wave', 70);
            if (hoursSinceUser >= 5  && isNowWithinMinutesWindow(11 * 60 + 15, 13 * 60 + 45, now) && canTriggerType('lunch_nudge', 18))
                addCandidate('lunch_nudge', 55);
            if (hoursSinceUser >= 4  && isNowWithinMinutesWindow(19 * 60, 22 * 60 + 30, now) && canTriggerType('evening_winddown', 14))
                addCandidate('evening_winddown', 60);

            const day = now.getDay();
            if (hoursSinceUser >= 6 && (day === 0 || day === 6) && canTriggerType('weekend_ping', 18))
                addCandidate('weekend_ping', 50);

            // ── Extended time-of-day ──────────────────────────────────────────────
            // Afternoon slump (14:00–16:30, weekdays)
            if (hoursSinceUser >= 2 && day >= 1 && day <= 5
                && isNowWithinMinutesWindow(14 * 60, 16 * 60 + 30, now)
                && canTriggerType('afternoon_slump', 20))
                addCandidate('afternoon_slump', 52);

            // Pre-dawn (04:00–05:30)
            if (hoursSinceUser >= 1 && isNowWithinMinutesWindow(4 * 60, 5 * 60 + 30, now)
                && canTriggerType('pre_dawn', 30))
                addCandidate('pre_dawn', 55);

            // Commute ping (07:30–09:00 or 17:00–18:30, weekdays)
            if (hoursSinceUser >= 3 && day >= 1 && day <= 5
                && (isNowWithinMinutesWindow(7 * 60 + 30, 9 * 60, now) || isNowWithinMinutesWindow(17 * 60, 18 * 60 + 30, now))
                && canTriggerType('commute_ping', 16))
                addCandidate('commute_ping', 54);

            // Post-work (17:30–19:30, weekdays)
            if (hoursSinceUser >= 4 && day >= 1 && day <= 5
                && isNowWithinMinutesWindow(17 * 60 + 30, 19 * 60 + 30, now)
                && canTriggerType('post_work', 18))
                addCandidate('post_work', 58);

            // Sunday evening (18:00–21:00, Sunday only)
            if (hoursSinceUser >= 3 && day === 0
                && isNowWithinMinutesWindow(18 * 60, 21 * 60, now)
                && canTriggerType('sunday_evening', 20))
                addCandidate('sunday_evening', 62);

            // Post-midnight impulse (00:00–01:30)
            if (hoursSinceUser >= 1 && isNowWithinMinutesWindow(0, 1 * 60 + 30, now)
                && canTriggerType('post_midnight_impulse', 24))
                addCandidate('post_midnight_impulse', 56);

            // ── Day-specific ──────────────────────────────────────────────────────
            // Monday reboot (morning window, Monday only)
            if (hoursSinceUser >= 8 && day === 1
                && isNowWithinMinutesWindow(7 * 60, 11 * 60, now)
                && canTriggerType('monday_reboot', 96))
                addCandidate('monday_reboot', 60);

            // Friday feeling (after noon, Friday only)
            if (hoursSinceUser >= 4 && day === 5
                && isNowWithinMinutesWindow(12 * 60, 18 * 60, now)
                && canTriggerType('friday_feeling', 96))
                addCandidate('friday_feeling', 62);

            // Sunday scaries (afternoon, Sunday only)
            if (hoursSinceUser >= 4 && day === 0
                && isNowWithinMinutesWindow(15 * 60, 20 * 60, now)
                && canTriggerType('sunday_scaries', 96))
                addCandidate('sunday_scaries', 58);

            // Midweek check (Wednesday, any reasonable hour)
            if (hoursSinceUser >= 6 && day === 3
                && isNowWithinMinutesWindow(10 * 60, 20 * 60, now)
                && canTriggerType('midweek_check', 96))
                addCandidate('midweek_check', 50);

            // ── Emotion-driven (docs/emotion-plan.md 3.9) ─────────────────────────
            if (hoursSinceUser >= 1.5 && recentAffectionReaction && (rapport >= 20 || joy >= 50)
                && canTriggerType('affection_reciprocation', 20)) {
                addCandidate('affection_reciprocation', 60 + (joy * 0.2));
            }
            // Making up only on good terms: on bad terms an upset character goes cold instead
            if (hoursSinceUser >= 1.5 && (anger >= 60 || sadness >= 60) && rapport >= 20
                && canTriggerType('repair_attempt', 14)) {
                addCandidate('repair_attempt', 75 + (sadness * 0.2));
            }
            if (hoursSinceUser >= 2.5 && anticipation >= 50
                && canTriggerType('curiosity_ping', 14)) {
                addCandidate('curiosity_ping', 55 + (anticipation * 0.3));
            }
            if (hoursSinceUser >= 2 && anxiety >= 50
                && canTriggerType('anxiety_reassurance', 14)) {
                addCandidate('anxiety_reassurance', 65 + (anxiety * 0.3));
            }
            if (hoursSinceUser >= 2 && joy >= 70 && rapport >= 20
                && canTriggerType('celebration_nudge', 20)) {
                addCandidate('celebration_nudge', 60);
            }

            // Sharing impulse — joy OR anticipation spike
            if (hoursSinceUser >= 1 && (joy >= 65 || anticipation >= 65)
                && canTriggerType('sharing_impulse', 18)) {
                addCandidate('sharing_impulse', 65 + ((joy + anticipation) * 0.15));
            }

            // Mood follow-up — the strongest feeling shifted significantly
            if (hoursSinceUser >= 2 && emotionShiftDetected
                && canTriggerType('mood_follow_up', 8)) {
                addCandidate('mood_follow_up', 60);
            }

            // Nostalgia wave — sadness on good terms (looking back fondly)
            if (hoursSinceUser >= 3 && sadness >= 35 && rapport >= 20
                && canTriggerType('nostalgia_wave', 36)) {
                addCandidate('nostalgia_wave', 55 + (goodRapport * 0.15));
            }

            // Longing ping — high Romance, missing the user
            if (hoursSinceUser >= 4 && romance >= 60
                && canTriggerType('longing_ping', 28)) {
                addCandidate('longing_ping', 65 + (romance * 0.15));
            }

            // Playful tease — high joy + anticipation; with NSFW on, Desire too
            if (hoursSinceUser >= 1 && ((joy >= 60 && anticipation >= 45) || desire >= 55)
                && canTriggerType('playful_tease', 22)) {
                addCandidate('playful_tease', 58 + (Math.max(joy, desire) * 0.15));
            }

            // Jealousy nudge — moderate anger, not high enough for repair_attempt, with
            // some Romance: on bad terms too (bickering, and jealous of it)
            if (hoursSinceUser >= 2 && anger >= 35 && anger < 60 && romance >= 40
                && canTriggerType('jealousy_nudge', 24)) {
                addCandidate('jealousy_nudge', 52 + (anger * 0.2));
            }

            // Boredom break — little going on in the moods
            if (hoursSinceUser >= 2 && moodTotal < 150
                && canTriggerType('boredom_break', 20)) {
                addCandidate('boredom_break', 48);
            }

            // Overwhelm check — anxiety + sadness (a stressed state)
            if (hoursSinceUser >= 1.5 && anxiety >= 55 && sadness >= 40
                && canTriggerType('overwhelm_check', 16)) {
                addCandidate('overwhelm_check', 62 + (anxiety * 0.15));
            }

            // Gratitude burst — high joy on good terms
            if (hoursSinceUser >= 2 && joy >= 65 && rapport >= 20
                && canTriggerType('gratitude_burst', 36)) {
                addCandidate('gratitude_burst', 58);
            }

            // Pride share — high anticipation and some joy (confident, accomplished)
            if (hoursSinceUser >= 1.5 && anticipation >= 70 && joy >= 40
                && canTriggerType('pride_share', 28)) {
                addCandidate('pride_share', 55 + (anticipation * 0.15));
            }

            // Suppressed thought — moderate disgust or anger that isn't full ghost-level
            if (hoursSinceUser >= 3 && (disgust >= 35 && disgust < 70) && anger < 60
                && canTriggerType('suppressed_thought', 24)) {
                addCandidate('suppressed_thought', 48);
            }

            // ── Contextual / behavioral ───────────────────────────────────────────
            // Thinking of you — pure spontaneous, low bar (joy or Rapport threshold)
            if (hoursSinceUser >= 4 && (rapport >= 40 || joy >= 40)
                && canTriggerType('thinking_of_you', 36)) {
                addCandidate('thinking_of_you', 46 + (goodRapport * 0.15));
            }

            // Random thought — genuinely random, low emotion dependency
            if (hoursSinceUser >= 2 && canTriggerType('random_thought', 22)) {
                addCandidate('random_thought', 42 + (daySeedBase * 12));
            }

            // Dream mention — morning window, any emotion state
            if (hoursSinceUser >= 6 && isNowWithinMinutesWindow(6 * 60, 10 * 60 + 30, now)
                && canTriggerType('dream_mention', 30)) {
                addCandidate('dream_mention', 50);
            }

            // Song stuck — moderate joy or nostalgia-adjacent (sadness + Rapport)
            if (hoursSinceUser >= 2 && (joy >= 45 || (sadness >= 30 && rapport >= 40))
                && canTriggerType('song_stuck', 26)) {
                addCandidate('song_stuck', 47);
            }

            // Overthinking spiral — late night + anxiety or sadness
            if (hoursSinceUser >= 1.5 && (anxiety >= 40 || sadness >= 40)
                && isNowWithinMinutesWindow(22 * 60, 3 * 60, now)
                && canTriggerType('overthinking_spiral', 20)) {
                addCandidate('overthinking_spiral', 55 + (anxiety * 0.15));
            }

            // Craving share — any state, mild boredom or joy
            if (hoursSinceUser >= 2 && (joy >= 30 || moodTotal < 200)
                && canTriggerType('craving_share', 28)) {
                addCandidate('craving_share', 44 + (daySeedBase * 10));
            }

            // Inside joke callback — requires recent shared references in history
            if (hoursSinceUser >= 2 && hasRecentSharedMoment && rapport >= 50
                && canTriggerType('inside_joke_callback', 30)) {
                addCandidate('inside_joke_callback', 52);
            }

            // Quiet productive — weekday, midmorning, has been a while
            if (hoursSinceUser >= 5 && day >= 1 && day <= 5
                && isNowWithinMinutesWindow(9 * 60, 12 * 60, now)
                && canTriggerType('quiet_productive', 26)) {
                addCandidate('quiet_productive', 48);
            }

            // Followup callback — picks up the last topic a while later (following up on
            // being left on read is the rounds', lib/proactive-rounds.js)
            if (hoursSinceUser >= 2 && hoursSinceUser <= 48 && !!lastUserMsg
                && canTriggerType('followup_callback', 16)) {
                addCandidate('followup_callback', 50 + (anticipation * 0.1));
            }

            // ── Shared memory ─────────────────────────────────────────────────────
            if (hoursSinceUser >= 3 && hasRecentSharedMoment && !!lastCharMsg
                && canTriggerType('memory_nudge', 12)) {
                addCandidate('memory_nudge', 50);
            }

            // ── Daily Life: the character's own day (lib/proactive-rounds.js lifeTopics) ──
            if (ownDay) {
                const sayDay = window.EchoTextDailyLife?.sayDay || (d => d);
                const userName = api.getUserName ? api.getUserName() : 'the user';
                const charName = api.getCurrentCharacter?.()?.name || 'the character';
                const minHours = { block_change: 0.5, errand: 2, life_event: 2 };
                const cooldown = { block_change: 4, errand: 12, life_event: 20 };
                for (const topic of Rounds.lifeTopics({ day: ownDay, sayDay })) {
                    if (hoursSinceUser < minHours[topic.type] || !canTriggerType(topic.type, cooldown[topic.type])) continue;
                    addCandidate(topic.type, topic.weight, Rounds.topicInstruction({
                        type: topic.type, detail: topic.detail, charName, userName, timeSince: humanTimeSince(state.lastUserMessageAt),
                    }));
                }
            }

            // ── Custom time-window pings ──────────────────────────────────────────
            if (hoursSinceUser >= (config.minInactivityForWindowHours || 4)
                && Array.isArray(config.allowedPingHours) && config.allowedPingHours.length) {
                if (config.allowedPingHours.some(w => isNowWithinWindow(w, now))) {
                    const hoursSinceWindow = Number(state.triggerHistory?.time_window || 0) > 0
                        ? ((nowTs - state.triggerHistory.time_window) / 3600000) : Infinity;
                    if (hoursSinceWindow >= Math.max(12, globalRateLimitHours))
                        addCandidate('time_window', 50);
                }
            }

            if (collect) return candidates;
            if (candidates.length === 0) return null;

            // Weighted-random selection: each candidate's probability is proportional to
            // its weight. This ensures lower-weight contextual triggers (random_thought,
            // dream_mention, song_stuck) get a realistic chance to fire, producing natural
            // variety instead of always picking the numerically highest trigger.
            // Weights are floored at 1 to prevent zero-weight candidates from being excluded.
            const totalWeight = candidates.reduce((sum, c) => sum + Math.max(1, c.weight), 0);
            let roll = Math.random() * totalWeight;
            for (const c of candidates) {
                roll -= Math.max(1, c.weight);
                if (roll <= 0) return c;
            }
            return candidates[candidates.length - 1];
        }

        // ============================================================
        // GENERATION
        // ============================================================

        /**
         * Builds the base PROACTIVE OUTBOUND MODE system message using
         * SEMANTIC TIME FRAMING — the LLM receives a temporal "vibe"
         * (e.g. "evening, winding down from the day") instead of an exact
         * clock reading.  Because the model never sees "10:35 AM" it is
         * impossible for it to accidentally echo those tokens.
         *
         * Instructions are expressed as POSITIVE constraints ("write a
         * message that fits the mood...") rather than negative ones
         * ("DO NOT say the time") to avoid the attention-illumination
         * problem where naming the forbidden token makes it more likely.
         *
         * @param {number} lastUserMessageAt - timestamp of last user message
         * @param {Array}  history           - full chat history array
         * @returns {string}
         */
        function buildProactiveContextMsg(lastUserMessageAt, lead = 'PROACTIVE OUTBOUND MODE: You are initiating a spontaneous text message, not replying.') {
            const now        = new Date();
            const timeSince  = humanTimeSince(lastUserMessageAt);
            const hour       = now.getHours();

            // Semantic Time translation: give the LLM a "vibe" instead of a clock.
            // Granular buckets provide better emotional framing than a plain AM/PM split.
            let semanticPeriod;
            if      (hour >= 4  && hour < 8)  semanticPeriod = 'early morning, the day is just beginning';
            else if (hour >= 8  && hour < 12) semanticPeriod = 'morning';
            else if (hour >= 12 && hour < 14) semanticPeriod = 'midday / lunchtime';
            else if (hour >= 14 && hour < 17) semanticPeriod = 'afternoon';
            else if (hour >= 17 && hour < 21) semanticPeriod = 'evening, winding down from the day';
            else if (hour >= 21 && hour < 24) semanticPeriod = 'late night';
            else                              semanticPeriod = 'the quiet, liminal hours before dawn';

            const dayType = (now.getDay() === 0 || now.getDay() === 6) ? 'weekend' : 'weekday';

            // Positive constraints: tell the model exactly what to DO, not what to avoid.
            const situationXml = `<proactive_situation>\nIt is currently ${semanticPeriod} on a ${dayType}. Time since last message from user: ${timeSince}.\n</proactive_situation>`;

            // Situational framing only — the trigger instruction is injected as a
            // final user turn AFTER conversation history so it is the last thing
            // the model attends to before generating.
            return [lead, situationXml].join('\n');
        }

        /**
         * If the last message in history is a user message that triggers an image
         * generation request, return a copy of history with that message removed so
         * the character never sees the raw "show me a photo" prompt in context.
         * Falls back to the original history when detection is unavailable.
         */
        function filterImageTriggerFromHistory(history) {
            if (!Array.isArray(history) || !history.length) return history;
            if (typeof api.detectImageRequest !== 'function') return history;
            const last = history[history.length - 1];
            if (last?.is_user && api.detectImageRequest(last.mes, history).triggered) {
                return history.slice(0, -1);
            }
            return history;
        }

        // What a trigger's message could come with, as [feature id, what to send]; each
        // is offered only when the character's platform has the feature (lib/features.js)
        const TRIGGER_MEDIA = {
            block_change:          [['photo', 'a <photo> of where you are']],
            life_event:            [['photo', 'a <photo> of it']],
            lunch_nudge:           [['photo', 'a <photo> of your lunch']],
            weekend_ping:          [['photo', 'a <photo> of what you\'re up to']],
            commute_ping:          [['photo', 'a <photo> of the view on the way']],
            post_work:             [['photo', 'a <photo> of where you\'re unwinding']],
            craving_share:         [['photo', 'a <photo> of what you\'re craving']],
            memory_nudge:          [['photo', 'an old <photo> of that moment']],
            nostalgia_wave:        [['photo', 'an old <photo> of that moment']],
            song_stuck:            [['voice', 'a <voice> message humming or singing a bit of it'], ['music', 'the song as <music>']],
            dream_mention:         [['voice', 'a groggy <voice> message telling it']],
            pre_dawn:              [['voice', 'a quiet, half-awake <voice> message']],
            post_midnight_impulse: [['voice', 'a <voice> message']],
            sharing_impulse:       [['photo', 'a <photo>'], ['link', 'a <link>'], ['music', 'a song as <music>']],
            random_thought:        [['photo', 'a <photo> of what sparked it'], ['link', 'a <link>']],
            curiosity_ping:        [['photo', 'a <photo> of what sparked it'], ['link', 'a <link>']],
        };
        // Media any proactive message may use, by feature id
        const MEDIA_NAMES = { photo: ['a photo'], voice: ['a voice message'], location: ['a location'], file: ['a file'], link: ['a link'], music: ['a song'] };

        const joinOr = items => items.length > 1 ? `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}` : items[0];

        /**
         * The trigger turn's text: the trigger's instruction, the media its message
         * could come with, and the reply format — media only where the platform has it.
         */
        function buildTriggerTurnText(trigger, charName) {
            const instruction = trigger?.prompt || 'Send a natural, in-character message.';
            const userName = api.getUserName ? api.getUserName() : 'the user';
            const features = api.getActiveFeatures ? api.getActiveFeatures() : [];
            const media = (TRIGGER_MEDIA[trigger?.type] || []).filter(([id]) => features.includes(id)).map(([, what]) => what);
            const mediaHint = media.length ? ` If it feels natural, send ${joinOr(media)} with it, or instead of text.` : '';
            const kinds = Object.keys(MEDIA_NAMES).filter(id => features.includes(id)).flatMap(id => MEDIA_NAMES[id]);
            const reply = kinds.length
                ? `Reply only with what ${charName} sends now, in the usual format: text messages, plus ${joinOr(kinds)} when one fits.`
                : `Reply only with the text message(s) ${charName} sends now, in the usual format.`;
            return `[Instruction for this turn — not a message from ${userName}; never quote or answer it: ${instruction}${mediaHint} ${reply}]`;
        }

        /**
         * Adds the trigger instruction as the final user turn — the last thing the
         * model reads. It is framed as an out-of-chat instruction: as a bare user
         * turn, models take it for something the user texted and answer or echo it.
         * Only an anti-refusal prefill (a trailing assistant turn) may follow it;
         * a trailing assistant turn from the history must not.
         */
        function appendTriggerTurn(apiMessages, trigger, prefillPrefix, charName) {
            const content = buildTriggerTurnText(trigger, charName);
            const insertAt = prefillPrefix ? apiMessages.length - 1 : apiMessages.length;
            apiMessages.splice(insertAt, 0, { role: 'user', content });
        }

        /** The reply to a trigger as it is kept: { mes, mood } (index.js readReply). */
        async function generateProactiveMessage(history, trigger, lastUserMessageAt = 0) {
            const controller = new AbortController();
            const extraSystem = [buildProactiveContextMsg(lastUserMessageAt)];
            const filteredHistory = filterImageTriggerFromHistory(history);
            const { apiMessages, rawPrompt, systemPrompt, prefillPrefix } = await api.buildApiMessagesFromHistory(filteredHistory, extraSystem);
            appendTriggerTurn(apiMessages, trigger, prefillPrefix, api.getCurrentCharacter()?.name || 'the character');
            const result = await api.requestEchoTextCompletion({ apiMessages, rawPrompt, systemPrompt, prefillPrefix, signal: controller.signal });
            return api.readReply(result || '');
        }

        // ============================================================
        // FOLLOW-UP ROUNDS (docs/platform-plan.md 12d; the timing is lib/proactive-rounds.js)
        // ============================================================
        // You go quiet in the middle of a conversation: the character follows up in a
        // round, each wait longer than the last, as many texts as their temperament
        // allows. The round's texts are written in one request when the first is due
        // and let out one by one; your next text ends the round.
        //   state.round = { number, startedAt, times: [ms], texts: null | [{ mes, mood, life }], sent }

        let roundTimer = null;
        // A round text due this long ago or more goes in quietly with its own time (the page was asleep)
        const LATE_MS = 60 * 1000;

        function temperamentFor(characterKey) {
            return typeof api.getTemperament === 'function' ? api.getTemperament(characterKey) : 'normal';
        }

        /** Whether another proactive request is allowed now: null, or why not ('daily' | 'hourly'). */
        function requestCap(characterKey, state, now = new Date(Date.now())) {
            const t = Rounds.temperamentOf(temperamentFor(characterKey));
            const used = state.requests?.day === getDateKeyLocal(now) ? state.requests.count : 0;
            if (used >= t.dailyRequests) return 'daily';
            const hourly = settings().proactiveHourly;
            if (hourly?.hour === Rounds.hourKey(now) && hourly.count >= Rounds.HOURLY_REQUESTS) return 'hourly';
            return null;
        }

        function spendRequest(state, now = new Date(Date.now())) {
            const day = getDateKeyLocal(now);
            state.requests = { day, count: (state.requests?.day === day ? state.requests.count : 0) + 1 };
            const s = settings();
            const hour = Rounds.hourKey(now);
            s.proactiveHourly = { hour, count: (s.proactiveHourly?.hour === hour ? s.proactiveHourly.count : 0) + 1 };
        }

        function followUpsOn() {
            const s = settings();
            return s.enabled !== false && s.proactiveMessagingEnabled === true;
        }

        /** After the character's reply: a round if you two were talking (solo chats only). */
        function startRound(characterKey) {
            const state = getProactiveConversationState(characterKey);
            if (!state) return;
            state.round = null;
            if (!followUpsOn() || (api.isGroupSession && api.isGroupSession())) return;
            // With you in person: nothing to follow up on
            if (api.getScheduleNow?.()?.phone === 'together') return;
            const history = api.getChatHistory();
            if (!Rounds.isConversationOpen(history)) return;
            const startedAt = Number(history[history.length - 1].send_date) || Date.now();
            const times = Rounds.planRound({ temperament: temperamentFor(characterKey), startAt: startedAt });
            if (times.length) state.round = { number: 1, startedAt, times, texts: null, sent: 0 };
            armRoundTimer();
        }

        /** The character's follow-up round stops where it is: you two are together now. */
        function dropRound(characterKey) {
            const state = getProactiveConversationState(characterKey);
            if (!state?.round) return;
            state.round = null;
            api.saveSettings();
            armRoundTimer();
        }

        /** Time together ended at `endedAt` (ms): the text after it, if their temperament sends one and it isn't too late. */
        function planParted(characterKey, endedAt) {
            const state = getProactiveConversationState(characterKey);
            if (!state) return;
            const at = Rounds.partedAt({ temperament: temperamentFor(characterKey), endedAt });
            state.parted = at && Date.now() - at < Rounds.PARTED_LATE_MS ? { at } : null;
            api.saveSettings();
        }

        /** Sets the timer for the open character's next round text. */
        function armRoundTimer() {
            clearTimeout(roundTimer);
            roundTimer = null;
            const key = api.getCharacterKey();
            const round = key ? settings().proactiveState?.[key]?.round : null;
            if (!round || round.sent >= round.times.length) return;
            const wait = Math.max(1000, Math.min(round.times[round.sent] - Date.now(), 2 ** 31 - 1));
            roundTimer = setTimeout(() => { runDueRound().catch(err => api.warn('Follow-up failed:', err)); }, wait);
        }

        /** Writes the round's texts: one request, split at the --- lines. */
        async function writeRound(char, characterKey, history, round) {
            const userName = api.getUserName ? api.getUserName() : 'the user';
            const charName = char.name || characterKey;
            const lead = `FOLLOW-UP MODE: ${userName} stopped answering in the middle of your conversation; you are texting again without a reply.`;
            const extraSystem = [buildProactiveContextMsg(getProactiveConversationState(characterKey).lastUserMessageAt, lead)];
            const { apiMessages, rawPrompt, systemPrompt } = await api.buildApiMessagesFromHistoryForChar(filterImageTriggerFromHistory(history), extraSystem, char);
            const instruction = Rounds.roundInstruction({
                charName, userName, temperament: temperamentFor(characterKey), round: round.number,
                waits: round.times.slice(round.sent).map(t => t - round.startedAt),
            });
            apiMessages.push({ role: 'user', content: `[Instruction for this turn — not a message from ${userName}; never quote or answer it: ${instruction}]` });
            const raw = await api.requestEchoTextCompletion({ apiMessages, rawPrompt, systemPrompt, signal: new AbortController().signal });
            return Rounds.splitRound(raw || '', round.times.length - round.sent).map(part => api.readReply(part)).filter(reply => reply.mes);
        }

        /**
         * The open character's round, when a text is due: written first if need be (within
         * the request caps), then let out; asleep or busy (Daily Life), it waits for them.
         * Texts due a while ago (the page wasn't running) go in quietly with their own times.
         * Returns whether a round is under way (the trigger tick then holds back).
         */
        async function runDueRound() {
            const char = api.getCurrentCharacter();
            const characterKey = api.getCharacterKey();
            if (!char || !characterKey || (api.isGroupSession && api.isGroupSession())) return false;
            const state = getProactiveConversationState(characterKey);
            const round = state?.round;
            if (!round) return false;
            if (!followUpsOn()) { state.round = null; return false; }
            const now = Date.now();
            if (now < round.times[round.sent]) { armRoundTimer(); return true; }
            if (proactiveGenerationLocks.has(characterKey) || api.getIsGenerating()) {
                clearTimeout(roundTimer);
                roundTimer = setTimeout(() => { runDueRound().catch(() => {}); }, 30000);
                return true;
            }
            // A cold shoulder ends it
            if (checkEmotionGhostWindow(state, api.getEmotionState(), now)) { state.round = null; api.saveSettings(); return false; }
            const putOff = until => {
                const shift = until - round.times[round.sent];
                round.times = round.times.map((t, i) => (i >= round.sent ? t + shift : t));
                api.saveSettings();
                armRoundTimer();
                return true;
            };
            // You're playing the main chat: it waits until that's been quiet a while
            const storyUntil = api.getStoryPauseUntil?.() || 0;
            if (storyUntil > now) return putOff(storyUntil);
            // Daily Life: asleep, or busy (an obsessed character sneaks one in half the time), the rest waits for them
            const late = now - round.times[round.sent] >= LATE_MS;
            const life = !late && typeof api.getScheduleNow === 'function' ? api.getScheduleNow() : null;
            const waitFor = life && life.endsAt > now && (life.phone === 'asleep'
                || (life.phone === 'busy' && !(temperamentFor(characterKey) === 'obsessed' && Math.random() < 0.5)));
            if (waitFor) return putOff(life.endsAt);

            proactiveGenerationLocks.add(characterKey);
            try {
                let history = (settings().chatHistory || {})[characterKey] || [];
                if (!round.texts) {
                    const cap = requestCap(characterKey, state);
                    if (cap) { state.round = null; state.capped = { reason: cap, at: now }; return false; }
                    spendRequest(state);
                    const texts = await writeRound(char, characterKey, history, round);
                    // You answered (or the chat moved on) while it was being written
                    if (state.round !== round) return !!state.round;
                    round.texts = texts;
                    round.times = round.times.slice(0, round.sent + texts.length);
                }
                // Every text now due: the late ones quietly with their own time, the last one live
                while (round.sent < round.times.length && round.times[round.sent] <= Date.now()) {
                    const reply = round.texts[round.sent];
                    const quiet = Date.now() - round.times[round.sent] >= LATE_MS;
                    if (!quiet) {
                        const visible = api.isPanelOpen() && api.getCharacterKey() === characterKey;
                        if (visible) api.setTypingIndicatorVisible(true);
                        await new Promise(resolve => setTimeout(resolve, Math.min(Math.max(reply.mes.length * 40, 1500), 6000)));
                        api.setTypingIndicatorVisible(false);
                        if (state.round !== round) return !!state.round;
                    }
                    history = (settings().chatHistory || {})[characterKey] || [];
                    const sendDate = quiet ? round.times[round.sent] : Date.now();
                    const outbound = {
                        is_user: false, mes: reply.mes, send_date: sendDate,
                        meta: { proactive: true, proactiveType: 'follow_up', round: round.number },
                        ...(reply.mood ? { mood: reply.mood } : {}),
                        ...(reply.life ? { life: reply.life } : {}),
                    };
                    settings().chatHistory[characterKey] = [...history, outbound];
                    markProactiveCharacterActivity(characterKey, true, 'follow_up', sendDate);
                    round.sent++;
                    if (api.isPanelOpen() && api.getCharacterKey() === characterKey) {
                        api.renderMessages(settings().chatHistory[characterKey]);
                        api.setFabUnreadIndicator(false);
                        if (reply.mood || reply.life) api.noteMoodReport();
                    } else {
                        api.setFabUnreadIndicator(true);
                    }
                }
                if (round.sent >= round.times.length) {
                    // Ran out: an obsessed character comes back in a few hours; the rest let it go
                    const t = Rounds.temperamentOf(temperamentFor(characterKey));
                    const last = round.times[round.times.length - 1] || Date.now();
                    const times = t.againHours ? Rounds.planRound({ temperament: t.id, startAt: last, firstHours: t.againHours }) : [];
                    state.round = times.length ? { number: round.number + 1, startedAt: last, times, texts: null, sent: 0 } : null;
                }
                return !!state.round;
            } catch (err) {
                api.warn('Follow-up failed:', err);
                state.round = null;
                return false;
            } finally {
                api.setTypingIndicatorVisible(false);
                proactiveGenerationLocks.delete(characterKey);
                api.saveSettings();
                armRoundTimer();
            }
        }

        /**
         * For a catch-up (lib/catch-up.js): the character's temperament, topic wait (hours,
         * with the feelings), new topics of theirs you haven't answered, requests left today
         * (0 at a limit), and whether a follow-up round is under way.
         */
        function catchUpInputs(characterKey, char) {
            const state = getProactiveConversationState(characterKey);
            const history = (settings().chatHistory || {})[characterKey] || [];
            const config = getMergedProactiveConfig(characterKey, char);
            const now = new Date(Date.now());
            const t = Rounds.temperamentOf(config.temperament);
            const lastUser = history.map(m => !!m?.is_user).lastIndexOf(true);
            const unanswered = history.slice(lastUser + 1)
                .filter(m => !m.is_user && m.meta?.proactive && m.meta.proactiveType !== 'follow_up').length;
            const used = state.requests?.day === getDateKeyLocal(now) ? state.requests.count : 0;
            return {
                temperament: t.id, baseHours: getRateLimitHours(config, now), unanswered,
                left: requestCap(characterKey, state, now) ? 0 : Math.max(0, t.dailyRequests - used),
                roundActive: !!state.round,
            };
        }

        /** A catch-up's request counts toward the limits like any proactive one. */
        function noteCatchUpRequest(characterKey) {
            spendRequest(getProactiveConversationState(characterKey));
        }

        // ============================================================
        // SCHEDULER TICK
        // ============================================================

        async function runProactiveTickForChar(char, characterKey) {
            // ── Startup guard ─────────────────────────────────────────────────────
            // Suppress the eager initial tick that fires 5 s after the scheduler
            // starts. Without this the typing indicator flashes on character load.
            const msSinceStart = Date.now() - schedulerStartedAt;
            if (msSinceStart < 90_000) return;

            if (proactiveGenerationLocks.has(characterKey)) return;
            if (api.getIsGenerating()) return;

            const s = api.getSettings();

            // Daily Life: they haven't seen your texts yet (busy or asleep), so they don't text first
            if (s.pendingReplies?.[characterKey]) return;

            // ── Group-aware history loading ──────────────────────────────────
            // Group histories live in separate stores, not s.chatHistory.
            // Read from the correct store based on session context.
            let history = [];
            const _inGroup  = !!(api.isGroupSession && api.isGroupSession());
            const _inCombine = _inGroup && !!(api.isCombineMode && api.isCombineMode());
            const _groupId   = _inGroup ? (api.getCurrentGroupId ? api.getCurrentGroupId() : null) : null;

            if (_inGroup) {
                if (!_groupId) return;
                history = _inCombine
                    ? (api.getCombineHistory   ? api.getCombineHistory(_groupId)               : [])
                    : (api.getGroupChatHistory ? api.getGroupChatHistory(_groupId, characterKey) : []);
            } else {
                history = (s.chatHistory && s.chatHistory[characterKey]) || [];
            }
            // Do not initiate proactive messages if there is no prior conversation
            if (!history.length) return;

            const state = getProactiveConversationState(characterKey);
            if (!state) return;
            syncProactiveStateWithHistory(characterKey, history);

            if (state.round) return;
            const config = getMergedProactiveConfig(characterKey, char);
            const trigger = evaluateProactiveTrigger({ history, state, config, now: new Date() });
            if (!trigger) return;
            const cap = requestCap(characterKey, state);
            if (cap) { state.capped = { reason: cap, at: Date.now() }; return; }
            spendRequest(state);
            // Only once, even if the request fails
            if (trigger.type === 'parted') state.parted = null;

            proactiveGenerationLocks.add(characterKey);
            try {
                const isActiveChar = !api.isGroupSession || !api.isGroupSession() || api.getActiveGroupCharKey() === characterKey;

                if (api.isPanelOpen() && isActiveChar) {
                    api.setTypingIndicatorVisible(true);
                }

                const extraSystem = [buildProactiveContextMsg(state.lastUserMessageAt)];
                const filteredHistory = filterImageTriggerFromHistory(history);
                const { apiMessages, rawPrompt, systemPrompt } = await api.buildApiMessagesFromHistoryForChar(filteredHistory, extraSystem, char);
                // No prefill on this path, so the trigger always goes last
                appendTriggerTurn(apiMessages, trigger, null, char.name || characterKey);
                const controller = new AbortController();
                const reply = api.readReply(await api.requestEchoTextCompletion({ apiMessages, rawPrompt, systemPrompt, signal: controller.signal }) || '');

                if (!reply.mes) return;

                const typingDelayMs = Math.min(Math.max(reply.mes.length * 40, 1500), 6000);
                await new Promise(resolve => setTimeout(resolve, typingDelayMs));

                // Capture emotion snapshot for mood_follow_up detection next tick
                captureEmotionSnapshot(characterKey, api.getEmotionState());

                const outbound = {
                    is_user: false,
                    mes: reply.mes,
                    send_date: Date.now(),
                    meta: { proactive: true, proactiveType: trigger.type },
                    ...(reply.mood ? { mood: reply.mood } : {}),
                    ...(reply.life ? { life: reply.life } : {}),
                    // Combined mode needs charName + charKey for bubble attribution in renderMessages
                    ...(_inCombine ? { charName: char.name || characterKey, charKey: characterKey } : {})
                };
                const newHistory = [...history, outbound];

                // ── Group-aware history saving ───────────────────────────────
                if (_inGroup && _groupId) {
                    if (_inCombine) {
                        if (api.saveCombineHistory) api.saveCombineHistory(_groupId, newHistory);
                    } else {
                        if (api.saveGroupChatHistory) api.saveGroupChatHistory(_groupId, characterKey, newHistory);
                    }
                } else {
                    if (!s.chatHistory) s.chatHistory = {};
                    s.chatHistory[characterKey] = newHistory;
                    api.saveSettings();
                }
                markProactiveCharacterActivity(characterKey, true, trigger.type, outbound.send_date);

                if (api.isPanelOpen() && isActiveChar) {
                    api.renderMessages(newHistory);
                    api.setFabUnreadIndicator(false);
                    if ((reply.mood || reply.life) && characterKey === api.getCharacterKey()) api.noteMoodReport();
                } else if (api.isPanelOpen() && api.markGroupCharUnread) {
                    api.markGroupCharUnread(characterKey);
                } else {
                    api.setFabUnreadIndicator(true);
                }
            } catch (err) {
                api.warn('Proactive scheduler tick failed:', err);
            } finally {
                api.setTypingIndicatorVisible(false);
                proactiveGenerationLocks.delete(characterKey);
                api.saveSettings();
            }
        }

        async function runProactiveSchedulerTick() {
            if (settings().enabled !== true || settings().proactiveMessagingEnabled !== true) return;

            if (api.isGroupSession && api.isGroupSession() && api.getGroupMemberKeys) {
                const memberKeys = api.getGroupMemberKeys();

                if (api.isCombineMode && api.isCombineMode()) {
                    // ── Combined Mode: one proactive message per tick ────────────
                    // All members share a single history so we must serialise to avoid
                    // concurrent reads/writes and prevent multiple messages in one tick.
                    // Pick the member whose proactive cooldown is most overdue first.
                    const members = memberKeys
                        .map(k => ({ key: k, char: api.getGroupMemberByKey ? api.getGroupMemberByKey(k) : null }))
                        .filter(m => m.char);

                    // Sort by lastProactiveAt ascending (least recently active goes first)
                    members.sort((a, b) => {
                        const sa = (settings().proactiveState || {})[a.key] || {};
                        const sb = (settings().proactiveState || {})[b.key] || {};
                        return (sa.lastProactiveAt || 0) - (sb.lastProactiveAt || 0);
                    });

                    // Try each member in order; stop after the first one fires
                    for (const { key, char } of members) {
                        const before = settings().proactiveState?.[key]?.lastProactiveAt || 0;
                        await runProactiveTickForChar(char, key);
                        const after  = settings().proactiveState?.[key]?.lastProactiveAt || 0;
                        if (after > before) break; // a message was sent — done for this tick
                    }
                } else {
                    // ── Individual Group Mode: each member ticks independently ──
                    for (const charKey of memberKeys) {
                        const char = api.getGroupMemberByKey ? api.getGroupMemberByKey(charKey) : null;
                        if (char) await runProactiveTickForChar(char, charKey);
                    }
                }
                return;
            }

            const char = api.getCurrentCharacter();
            const characterKey = api.getCharacterKey();
            if (!char || !characterKey) return;
            // A follow-up round under way holds the triggers back
            if (await runDueRound()) return;
            await runProactiveTickForChar(char, characterKey);
        }

        // ============================================================
        // SCHEDULER LIFECYCLE
        // ============================================================

        function stopProactiveScheduler() {
            if (proactiveSchedulerHandle) {
                clearInterval(proactiveSchedulerHandle);
                proactiveSchedulerHandle = null;
            }
            clearTimeout(roundTimer);
            roundTimer = null;
        }

        function startProactiveScheduler() {
            stopProactiveScheduler();

            if (settings().proactiveMessagingEnabled !== true) return;

            // Record startup time — runProactiveTickForChar uses this to suppress
            // the initial eager tick that caused the typing indicator flash.
            schedulerStartedAt = Date.now();

            const tickMinutes = Math.max(1, Number(settings().proactiveTickMinutes || 2));
            proactiveSchedulerHandle = setInterval(() => runProactiveSchedulerTick(), tickMinutes * 60 * 1000);

            // The initial tick is deliberately delayed by 90 s (the same guard
            // window) so there is NO flash even if the guard were ever removed.
            setTimeout(() => runProactiveSchedulerTick(), 90_000);
            // A follow-up round left from before (the page reloaded) picks up again
            armRoundTimer();
        }

        // ============================================================
        // FORMAT HELPERS
        // ============================================================

        function formatProactiveTimestamp(ts) {
            if (!ts || !Number.isFinite(ts)) return '—';
            const d = new Date(ts);
            return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        }

        function formatHoursDuration(hours) {
            if (!Number.isFinite(hours) || hours <= 0) return '0m';
            const totalMin = Math.max(1, Math.ceil(hours * 60));
            const h = Math.floor(totalMin / 60);
            const m = totalMin % 60;
            if (h > 0 && m > 0) return `${h}h ${m}m`;
            if (h > 0) return `${h}h`;
            return `${m}m`;
        }

        // ============================================================
        // INSIGHTS PANEL
        // ============================================================

        const PRETTY_TYPE = {
            follow_up:                'Follow-up',
            catch_up:                 'Catch-up',
            block_change:             'Just got free',
            errand:                   'Errand',
            life_event:               'Today',
            parted:                   'After parting',
            checkin:                  'Check-in',
            time_window:              'Time-window ping',
            late_night:               'Late-night ping',
            morning_wave:             'Morning ping',
            lunch_nudge:              'Lunch nudge',
            evening_winddown:         'Evening wind-down',
            weekend_ping:             'Weekend ping',
            affection_reciprocation:  'Affection reciprocation',
            repair_attempt:           'Repair attempt',
            curiosity_ping:           'Curiosity ping',
            anxiety_reassurance:      'Anxiety reassurance',
            celebration_nudge:        'Celebration nudge',
            sharing_impulse:          'Sharing impulse',
            mood_follow_up:           'Mood follow-up',
            memory_nudge:             'Memory nudge',
            dormancy_break:           'Dormancy break',
            // Extended time-of-day
            afternoon_slump:          'Afternoon slump',
            pre_dawn:                 'Pre-dawn ping',
            commute_ping:             'Commute ping',
            post_work:                'Post-work ping',
            sunday_evening:           'Sunday evening',
            post_midnight_impulse:    'Post-midnight impulse',
            // Day-specific
            monday_reboot:            'Monday reboot',
            friday_feeling:           'Friday feeling',
            sunday_scaries:           'Sunday scaries',
            midweek_check:            'Midweek check',
            // Emotion-driven (extended)
            nostalgia_wave:           'Nostalgia wave',
            longing_ping:             'Longing ping',
            playful_tease:            'Playful tease',
            jealousy_nudge:           'Jealousy nudge',
            boredom_break:            'Boredom break',
            overwhelm_check:          'Overwhelm check',
            gratitude_burst:          'Gratitude burst',
            pride_share:              'Pride share',
            suppressed_thought:       'Suppressed thought',
            // Contextual / behavioral
            thinking_of_you:          'Thinking of you',
            random_thought:           'Random thought',
            dream_mention:            'Dream mention',
            song_stuck:               'Song stuck',
            overthinking_spiral:      'Overthinking spiral',
            craving_share:            'Craving share',
            inside_joke_callback:     'Inside joke callback',
            quiet_productive:         'Quiet productive',
            followup_callback:        'Follow-up callback',
            // Meta
            reply:                    'Normal reply',
            none:                     'None'
        };

        const TRIGGER_DEFS = [
            // Core
            ['checkin',                 'Check-in'],
            ['dormancy_break',          'Dormancy break'],
            // Time-of-day
            ['late_night',              'Late-night ping'],
            ['morning_wave',            'Morning ping'],
            ['lunch_nudge',             'Lunch nudge'],
            ['afternoon_slump',         'Afternoon slump'],
            ['evening_winddown',        'Evening wind-down'],
            ['post_work',               'Post-work ping'],
            ['post_midnight_impulse',   'Post-midnight impulse'],
            ['pre_dawn',                'Pre-dawn ping'],
            ['commute_ping',            'Commute ping'],
            // Day-specific
            ['monday_reboot',           'Monday reboot'],
            ['midweek_check',           'Midweek check'],
            ['friday_feeling',          'Friday feeling'],
            ['weekend_ping',            'Weekend ping'],
            ['sunday_evening',          'Sunday evening'],
            ['sunday_scaries',          'Sunday scaries'],
            // Emotion-driven
            ['affection_reciprocation', 'Affection reciprocation'],
            ['repair_attempt',          'Repair attempt'],
            ['curiosity_ping',          'Curiosity ping'],
            ['anxiety_reassurance',     'Anxiety reassurance'],
            ['celebration_nudge',       'Celebration nudge'],
            ['sharing_impulse',         'Sharing impulse'],
            ['mood_follow_up',          'Mood follow-up'],
            ['nostalgia_wave',          'Nostalgia wave'],
            ['longing_ping',            'Longing ping'],
            ['playful_tease',           'Playful tease'],
            ['jealousy_nudge',          'Jealousy nudge'],
            ['boredom_break',           'Boredom break'],
            ['overwhelm_check',         'Overwhelm check'],
            ['gratitude_burst',         'Gratitude burst'],
            ['pride_share',             'Pride share'],
            ['suppressed_thought',      'Suppressed thought'],
            // Contextual / behavioral
            ['thinking_of_you',         'Thinking of you'],
            ['random_thought',          'Random thought'],
            ['dream_mention',           'Dream mention'],
            ['song_stuck',              'Song stuck'],
            ['overthinking_spiral',     'Overthinking spiral'],
            ['craving_share',           'Craving share'],
            ['inside_joke_callback',    'Inside joke callback'],
            ['quiet_productive',        'Quiet productive'],
            ['memory_nudge',            'Memory nudge'],
            ['followup_callback',       'Follow-up callback'],
            // Custom window
            ['time_window',             'Time-window ping'],
            // Daily Life: the character's own day
            ['block_change',            'Just got free'],
            ['errand',                  'Errand'],
            ['life_event',              'Today'],
            ['parted',                  'After parting']
        ];

        const DIAGNOSTIC_CATEGORIES = [
            { id: 'core', label: 'Core', icon: 'fa-star' },
            { id: 'time', label: 'Time-of-Day', icon: 'fa-moon' },
            { id: 'day', label: 'Day-Specific', icon: 'fa-calendar' },
            { id: 'emotion', label: 'Emotion-Driven', icon: 'fa-heart-pulse' },
            { id: 'context', label: 'Contextual & Behavioral', icon: 'fa-brain' },
            { id: 'custom', label: 'Custom', icon: 'fa-clock' },
            { id: 'life', label: 'Daily Life', icon: 'fa-calendar-days' }
        ];

        const TRIGGER_CATEGORY_MAP = {
            'checkin': 'core', 'dormancy_break': 'core',
            'late_night': 'time', 'morning_wave': 'time', 'lunch_nudge': 'time', 'afternoon_slump': 'time', 'evening_winddown': 'time', 'post_work': 'time', 'post_midnight_impulse': 'time', 'pre_dawn': 'time', 'commute_ping': 'time',
            'monday_reboot': 'day', 'midweek_check': 'day', 'friday_feeling': 'day', 'weekend_ping': 'day', 'sunday_evening': 'day', 'sunday_scaries': 'day',
            'affection_reciprocation': 'emotion', 'repair_attempt': 'emotion', 'curiosity_ping': 'emotion', 'anxiety_reassurance': 'emotion', 'celebration_nudge': 'emotion', 'sharing_impulse': 'emotion', 'mood_follow_up': 'emotion', 'nostalgia_wave': 'emotion', 'longing_ping': 'emotion', 'playful_tease': 'emotion', 'jealousy_nudge': 'emotion', 'boredom_break': 'emotion', 'overwhelm_check': 'emotion', 'gratitude_burst': 'emotion', 'pride_share': 'emotion', 'suppressed_thought': 'emotion',
            'thinking_of_you': 'context', 'random_thought': 'context', 'dream_mention': 'context', 'song_stuck': 'context', 'overthinking_spiral': 'context', 'craving_share': 'context', 'inside_joke_callback': 'context', 'quiet_productive': 'context', 'memory_nudge': 'context', 'followup_callback': 'context',
            'time_window': 'custom',
            'block_change': 'life', 'errand': 'life', 'life_event': 'life', 'parted': 'life'
        };

        const TRIGGER_REQUIREMENTS = {
            'block_change': { req: 'Just got free after busy or asleep' },
            'errand': { req: 'An errand due by tomorrow' },
            'life_event': { req: 'Today\'s change of plans or news' },
            'parted': { req: 'Just after time together' },
            'checkin': { req: 'Inactive for min gap', type: 'gap', gapHrs: (c) => Math.max(0.25, c.minInactivityBeforePingHours || 24) },
            'dormancy_break': { req: 'Silent for 7+ days', type: 'gap', gapHrs: () => 168 },
            'late_night': { req: '23:00 - 02:30', active: (now) => isNowWithinMinutesWindow(23*60, 2*60+30, now) },
            'morning_wave': { req: '06:00 - 09:30', active: (now) => isNowWithinMinutesWindow(6*60, 9*60+30, now) },
            'lunch_nudge': { req: '11:15 - 13:45', active: (now) => isNowWithinMinutesWindow(11*60+15, 13*60+45, now) },
            'afternoon_slump': { req: '14:00 - 16:30 (Weekdays)', active: (now) => now.getDay()>=1 && now.getDay()<=5 && isNowWithinMinutesWindow(14*60, 16*60+30, now) },
            'evening_winddown': { req: '19:00 - 22:30', active: (now) => isNowWithinMinutesWindow(19*60, 22*60+30, now) },
            'post_work': { req: '17:30 - 19:30 (Weekdays)', active: (now) => now.getDay()>=1 && now.getDay()<=5 && isNowWithinMinutesWindow(17*60+30, 19*60+30, now) },
            'post_midnight_impulse': { req: '00:00 - 01:30', active: (now) => isNowWithinMinutesWindow(0, 1*60+30, now) },
            'pre_dawn': { req: '04:00 - 05:30', active: (now) => isNowWithinMinutesWindow(4*60, 5*60+30, now) },
            'commute_ping': { req: 'Morning or evening commute', active: (now) => now.getDay()>=1 && now.getDay()<=5 && (isNowWithinMinutesWindow(7*60+30, 9*60, now) || isNowWithinMinutesWindow(17*60, 18*60+30, now)) },
            'monday_reboot': { req: 'Monday, 07:00 - 11:00', active: (now) => now.getDay() === 1 && isNowWithinMinutesWindow(7*60, 11*60, now) },
            'midweek_check': { req: 'Wednesday, 10:00 - 20:00', active: (now) => now.getDay() === 3 && isNowWithinMinutesWindow(10*60, 20*60, now) },
            'friday_feeling': { req: 'Friday, 12:00 - 18:00', active: (now) => now.getDay() === 5 && isNowWithinMinutesWindow(12*60, 18*60, now) },
            'weekend_ping': { req: 'Saturday or Sunday', active: (now) => now.getDay()===0 || now.getDay()===6 },
            'sunday_evening': { req: 'Sunday, 18:00 - 21:00', active: (now) => now.getDay() === 0 && isNowWithinMinutesWindow(18*60, 21*60, now) },
            'sunday_scaries': { req: 'Sunday, 15:00 - 20:00', active: (now) => now.getDay() === 0 && isNowWithinMinutesWindow(15*60, 20*60, now) },
            'affection_reciprocation': { req: 'Your heart or like + Rapport 20+ or Joy' },
            'repair_attempt': { req: 'High Anger or Sadness + Rapport 20+' },
            'curiosity_ping': { req: 'High Anticipation' },
            'anxiety_reassurance': { req: 'High Anxiety' },
            'celebration_nudge': { req: 'High Joy + Rapport 20+' },
            'sharing_impulse': { req: 'High Joy or Anticipation' },
            'mood_follow_up': { req: 'Strongest feeling changed' },
            'nostalgia_wave': { req: 'Sadness + Rapport 20+' },
            'longing_ping': { req: 'High Romance' },
            'playful_tease': { req: 'High Joy + Anticipation' },
            'jealousy_nudge': { req: 'Some Anger + Romance 40+' },
            'boredom_break': { req: 'Low overall mood' },
            'overwhelm_check': { req: 'High Anxiety + Sadness' },
            'gratitude_burst': { req: 'High Joy + Rapport 20+' },
            'pride_share': { req: 'High Anticipation + Joy' },
            'suppressed_thought': { req: 'Some Disgust' },
            'thinking_of_you': { req: 'Rapport or Joy 40+' },
            'random_thought': { req: 'Spontaneous thought' },
            'dream_mention': { req: 'Morning, after sleep' },
            'song_stuck': { req: 'Joy, or Sadness + Rapport' },
            'overthinking_spiral': { req: 'Late night + Anxiety or Sadness' },
            'craving_share': { req: 'Some Joy, or a calm mood' },
            'inside_joke_callback': { req: 'Shared moment + Rapport 50+' },
            'quiet_productive': { req: 'After long silence' },
            'memory_nudge': { req: 'Shared moment mentioned' },
            'followup_callback': { req: 'Picks up the last topic, 2–48h later' },
            'time_window': { req: 'Configured time window' }
        };

        function getProactiveInsightsSnapshot() {
            const char = api.getCurrentCharacter();
            const characterKey = api.getCharacterKey();
            const now = new Date(Date.now());

            const fallback = {
                character: char?.name || 'No character selected',
                tick: `Every ${Math.max(1, Number(settings().proactiveTickMinutes || 2))} min`,
                lastUser: 'No recent message',
                lastChar: 'No recent reply',
                lastAuto: 'No proactive text yet',
                next: 'No active conversation yet',
                type: '—',
                triggerDiagnostics: [],
                ghostWindow: null
            };
            if (!characterKey || !char) return fallback;

            const history = api.getChatHistory();
            const state = getProactiveConversationState(characterKey);
            syncProactiveStateWithHistory(characterKey, history);
            const config = getMergedProactiveConfig(characterKey, char);

            const emotion = api.getEmotionState();
            const ghostInfo = checkEmotionGhostWindow(state, emotion);

            const nowTs = now.getTime();
            // The same gate as the triggers (topicGate): the wait with unanswered topics, Daily Life
            const gate = topicGate({ history, state, config, now });
            const globalRateLimitHours = gate.waitHours;
            const ownDay = gate.day;
            const lifeTypes = new Set(Rounds.lifeTopics({ day: ownDay, sayDay: window.EchoTextDailyLife?.sayDay }).map(t => t.type));
            if (partedDue(state, nowTs)) lifeTypes.add('parted');
            const hoursSinceUser      = state.lastUserMessageAt > 0 ? ((nowTs - state.lastUserMessageAt) / 3600000) : Infinity;
            const hoursSinceProactive = state.lastProactiveAt   > 0 ? ((nowTs - state.lastProactiveAt)   / 3600000) : Infinity;
            const remainingGap  = Math.max(0, globalRateLimitHours - hoursSinceProactive);
            const userGapNeed   = Math.max(0, Math.min(globalRateLimitHours, config.minInactivityBeforePingHours || 24) - hoursSinceUser);

            let next = 'Ready to send when a trigger matches';
            if (settings().proactiveMessagingEnabled !== true) {
                next = 'Proactive messaging is currently paused';
            } else if (!config.enabled) {
                next = 'This character is not configured for proactive pings';
            } else if (ghostInfo) {
                next = `Ghosting (~${formatHoursDuration(ghostInfo.remainingHours)} remaining — ${ghostInfo.emotionLabel})`;
            } else if (state.round) {
                // A follow-up round: which text comes next, and when
                const due = state.round.times[state.round.sent];
                next = `Follow-up ${state.round.sent + 1}/${state.round.times.length}${due > nowTs ? ` in ${formatHoursDuration((due - nowTs) / 3600000)}` : ' due'}`;
            } else if (gate.why === 'together') {
                next = 'With you';
            } else if (gate.why === 'story') {
                next = 'Paused during story';
            } else if (state.parted?.at > nowTs) {
                next = `After parting in ${formatHoursDuration((state.parted.at - nowTs) / 3600000)}`;
            } else if (requestCap(characterKey, state, now)) {
                next = requestCap(characterKey, state, now) === 'daily' ? 'Daily limit reached' : 'Hourly limit reached';
            } else if (gate.why === 'unanswered') {
                next = `Waiting for you (${gate.unanswered} unanswered)`;
            } else if (gate.why === 'asleep') {
                next = 'Asleep';
            } else if (gate.why === 'busy') {
                next = 'Busy';
            } else if (remainingGap > 0) {
                next = `Cooling down (${formatHoursDuration(remainingGap)} remaining)`;
            } else if (userGapNeed > 0) {
                next = `Waiting for quiet time (${formatHoursDuration(userGapNeed)} left)`;
            } else if (!history.length) {
                next = 'No messages yet — start a conversation first';
            }

            const sharedWait = ghostInfo
                ? `Ghosting ~${formatHoursDuration(ghostInfo.remainingHours)}`
                : remainingGap > 0
                    ? `~${formatHoursDuration(remainingGap)}`
                    : userGapNeed > 0
                        ? `~${formatHoursDuration(userGapNeed)}`
                        : 'When conditions match';

            // With a schedule the clock triggers give way to the character's own day; without, there's no own day
            const shownDefs = TRIGGER_DEFS.filter(([id]) => (ownDay ? !Rounds.CLOCK_TRIGGERS.includes(id) : !Rounds.LIFE_TRIGGERS.includes(id)));
            const triggerDiagnostics = shownDefs.map(([id, label]) => {
                const reqData = TRIGGER_REQUIREMENTS[id] || { req: 'When conditions match' };
                let isActive = Rounds.LIFE_TRIGGERS.includes(id) ? lifeTypes.has(id)
                    : typeof reqData.active === 'function' ? reqData.active(now) : null;
                const neverFired = !(Number(state.triggerHistory?.[id] || 0) > 0);
                
                let status = 'unmet';
                let reason = 'Conditions unmet';

                if (ghostInfo) {
                    status = 'ghosting';
                    reason = `Ghosting (~${formatHoursDuration(ghostInfo.remainingHours)})`;
                } else if (remainingGap > 0 || userGapNeed > 0) {
                    status = 'cooling';
                    reason = remainingGap > 0 ? `Rate limited (~${formatHoursDuration(remainingGap)})` : `Need silence (~${formatHoursDuration(userGapNeed)})`;
                } else if (isActive === true) {
                    status = 'active';
                    reason = 'Active Window';
                } else if (isActive === false) {
                    status = neverFired ? 'never' : 'unmet';
                    reason = 'Out of window';
                } else {
                    status = 'ready';
                    reason = 'Ready';
                }

                // Gap-based trigger specific adjustment
                if (reqData.type === 'gap') {
                    const requiredGap = typeof reqData.gapHrs === 'function' ? reqData.gapHrs(config) : 24;
                    if (hoursSinceUser < requiredGap) {
                        status = 'cooling';
                        reason = `Needs ${formatHoursDuration(requiredGap)} silence`;
                    } else if (!ghostInfo) {
                        status = 'ready';
                        reason = 'Ready';
                    }
                }

                // Override status if globally disabled
                if (settings().proactiveMessagingEnabled !== true || !config.enabled) {
                    status = 'unmet';
                    reason = 'Disabled';
                }

                return {
                    id,
                    label,
                    last: formatProactiveTimestamp(Number(state.triggerHistory?.[id] || 0)),
                    req: reqData.req,
                    status,
                    reason,
                    category: TRIGGER_CATEGORY_MAP[id] || 'core'
                };
            });

            return {
                // With how they follow up when ignored
                character: `${char.name || 'Character'} · ${Rounds.temperamentOf(config.temperament).label}`,
                tick: `Every ${Math.max(1, Number(settings().proactiveTickMinutes || 2))} min`,
                lastUser: formatProactiveTimestamp(state.lastUserMessageAt),
                lastChar: formatProactiveTimestamp(state.lastCharacterMessageAt),
                lastAuto: formatProactiveTimestamp(state.lastProactiveAt),
                next,
                type: PRETTY_TYPE[state.lastOutboundType] || state.lastOutboundType || 'None',
                triggerDiagnostics,
                ghostWindow: ghostInfo
            };
        }

        function refreshProactiveInsights() {
            const snapshot = getProactiveInsightsSnapshot();
            const targets = [
                ['#et_proactive_character_panel', snapshot.character],
                ['#et_proactive_tick_panel',      snapshot.tick],
                ['#et_proactive_last_user_panel', snapshot.lastUser],
                ['#et_proactive_last_char_panel', snapshot.lastChar],
                ['#et_proactive_last_auto_panel', snapshot.lastAuto],
                ['#et_proactive_next_panel',      snapshot.next],
                ['#et_proactive_type_panel',      snapshot.type],
                ['#et_proactive_character',       snapshot.character],
                ['#et_proactive_tick',            snapshot.tick],
                ['#et_proactive_last_user',       snapshot.lastUser],
                ['#et_proactive_last_char',       snapshot.lastChar],
                ['#et_proactive_last_auto',       snapshot.lastAuto],
                ['#et_proactive_next',            snapshot.next],
                ['#et_proactive_type',            snapshot.type]
            ];
            targets.forEach(([sel, val]) => {
                const el = jQuery(sel);
                if (el.length) el.text(val);
            });

            const renderDiagnostics = (selector) => {
                const wrap = jQuery(selector);
                if (!wrap.length) return;
                
                if (!snapshot.triggerDiagnostics || snapshot.triggerDiagnostics.length === 0) {
                    wrap.html('<div class="et-trigger-row"><span class="et-trigger-row-name">No trigger diagnostics available</span></div>');
                    return;
                }

                const groupsData = JSON.parse(JSON.stringify(DIAGNOSTIC_CATEGORIES)).map(g => ({ ...g, items: [] }));
                const groupMap = {};
                groupsData.forEach(g => groupMap[g.id] = g);

                snapshot.triggerDiagnostics.forEach(t => {
                    const g = groupMap[t.category] || groupMap['core'];
                    g.items.push(t);
                });

                let html = '';
                for (const group of groupsData) {
                    if (group.items.length === 0) continue;
                    
                    html += `
                        <div class="et-trigger-category">
                            <div class="et-trigger-category-header">
                                <i class="fa-solid ${group.icon}"></i> <span>${group.label}</span>
                            </div>
                            <div class="et-trigger-category-items">`;
                    
                    for (const t of group.items) {
                        let badgeClass = 'et-badge-unmet';
                        if (t.status === 'never') badgeClass = 'et-badge-never';
                        else if (t.status === 'ghosting') badgeClass = 'et-badge-ghosting';
                        else if (t.status === 'cooling') badgeClass = 'et-badge-cooling';
                        else if (t.status === 'active') badgeClass = 'et-badge-active';
                        else if (t.status === 'ready') badgeClass = 'et-badge-ready';
                        
                        let badgeText = t.status === 'never' ? 'Never Fired' : t.reason;

                        html += `
                        <div class="et-trigger-row" data-id="${t.id}">
                            <div class="et-trigger-row-main">
                                <span class="et-trigger-row-name">${t.label}</span>
                                <span class="et-trigger-row-req">${t.req}</span>
                            </div>
                            <div class="et-trigger-row-status">
                                <span class="et-trigger-badge ${badgeClass}">${badgeText}</span>
                            </div>
                            <div class="et-trigger-row-meta" title="Last triggered">
                                <i class="fa-solid fa-clock-rotate-left"></i> ${t.last}
                            </div>
                        </div>`;
                    }
                    html += `</div></div>`;
                }

                wrap.html(html);
            };

            renderDiagnostics('#et_trigger_list_panel');
            renderDiagnostics('#et_trigger_list');
        }

        // ============================================================
        // MANUAL TEST TRIGGER
        // ============================================================

        async function triggerTestProactiveMessage() {
            const char = api.getCurrentCharacter();
            const characterKey = api.getCharacterKey();
            if (!char || !characterKey) {
                toastr.warning('Please select a character card first.');
                return;
            }
            if (proactiveGenerationLocks.has(characterKey) || api.getIsGenerating()) {
                toastr.warning('A generation is already in progress.');
                return;
            }

            const triggerTypes = [
                // Core
                'checkin', 'dormancy_break',
                // Time-of-day
                'late_night', 'morning_wave', 'lunch_nudge', 'afternoon_slump',
                'evening_winddown', 'post_work', 'post_midnight_impulse', 'pre_dawn', 'commute_ping',
                // Day-specific
                'monday_reboot', 'midweek_check', 'friday_feeling',
                'weekend_ping', 'sunday_evening', 'sunday_scaries',
                // Emotion-driven
                'affection_reciprocation', 'repair_attempt', 'curiosity_ping',
                'anxiety_reassurance', 'celebration_nudge', 'sharing_impulse', 'mood_follow_up',
                'nostalgia_wave', 'longing_ping', 'playful_tease', 'jealousy_nudge',
                'boredom_break', 'overwhelm_check', 'gratitude_burst', 'pride_share', 'suppressed_thought',
                // Contextual / behavioral
                'thinking_of_you', 'random_thought', 'dream_mention', 'song_stuck',
                'overthinking_spiral', 'craving_share', 'inside_joke_callback', 'quiet_productive',
                'memory_nudge', 'followup_callback'
            ];

            const randomType = triggerTypes[Math.floor(Math.random() * triggerTypes.length)];
            const config = getMergedProactiveConfig(characterKey, char);
            const state  = getProactiveConversationState(characterKey);
            const trigger = {
                type: randomType,
                prompt: buildProactiveTriggerPrompt(randomType, config, state?.lastUserMessageAt || 0)
            };

            jQuery('#et_trigger_message, #et_trigger_message_panel').prop('disabled', true).addClass('et-btn-loading');

            proactiveGenerationLocks.add(characterKey);
            try {
                if (api.isPanelOpen() && api.getCharacterKey() === characterKey) api.setTypingIndicatorVisible(true);

                const history = api.getChatHistory();
                const reply = await generateProactiveMessage(history, trigger);
                if (!reply.mes) return;

                // Capture emotion snapshot for mood_follow_up
                captureEmotionSnapshot(characterKey, api.getEmotionState());

                const outbound = {
                    is_user: false,
                    mes: reply.mes,
                    send_date: Date.now(),
                    meta: { proactive: true, proactiveType: trigger.type },
                    ...(reply.mood ? { mood: reply.mood } : {}),
                    ...(reply.life ? { life: reply.life } : {})
                };
                const newHistory = [...history, outbound];
                api.saveChatHistory(newHistory);
                markProactiveCharacterActivity(characterKey, true, trigger.type, outbound.send_date);

                if (api.isPanelOpen() && api.getCharacterKey() === characterKey) {
                    api.renderMessages(newHistory);
                    api.setFabUnreadIndicator(false);
                    if (reply.mood || reply.life) api.noteMoodReport();
                } else {
                    api.setFabUnreadIndicator(true);
                }

                const prettyType = PRETTY_TYPE[trigger.type] || trigger.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                toastr.success('Triggered: ' + prettyType);
                refreshProactiveInsights();
            } catch (err) {
                api.warn('Trigger test failed:', err);
                toastr.error('Trigger failed: ' + err.message);
            } finally {
                api.setTypingIndicatorVisible(false);
                proactiveGenerationLocks.delete(characterKey);
                jQuery('#et_trigger_message, #et_trigger_message_panel').prop('disabled', false).removeClass('et-btn-loading');
                api.saveSettings();
            }
        }

        // ============================================================
        // PUBLIC API
        // ============================================================

        return {
            getDateKeyLocal,
            getNowMinutes,
            isNowWithinMinutesWindow,
            syncProactiveStateWithHistory,
            markProactiveUserActivity,
            markProactiveCharacterActivity,
            startProactiveScheduler,
            stopProactiveScheduler,
            refreshProactiveInsights,
            triggerTestProactiveMessage,
            getProactiveInsightsSnapshot,
            // For tests: the default templates, what a trigger turn says, and the candidates
            getDefaultProactiveConfigForCharacter,
            evaluateProactiveTrigger,
            // Follow-up rounds: the timer for the open character (after a character switch), and for tests
            armRoundTimer,
            dropRound,
            planParted,
            runDueRound,
            startRound,
            // Catch-up (lib/catch-up.js, index.js maybeCatchUp)
            catchUpInputs,
            noteCatchUpRequest,
            buildProactiveTriggerPrompt,
            buildTriggerTurnText
        };
    }

    window.EchoTextProactiveMessaging = { createProactiveMessaging };
})();
