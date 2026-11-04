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

        /**
         * Returns a human-readable string describing the elapsed time since `thenTs`
         * for injection into prompt templates. E.g. "a few minutes", "2 hours", "3 days".
         */
        function humanTimeSince(thenTs, nowTs = Date.now()) {
            if (!thenTs || thenTs <= 0) return 'a while';
            const hours = (nowTs - thenTs) / 3600000;
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
        // DAILY SEED
        // ============================================================

        /**
         * Generates a deterministic pseudo-random number in [0, 1) that is:
         *  - stable for the same (type, day) pair — consistent within a day
         *  - different across days and across trigger types
         *
         * For what's fixed for a day: the wait between topics, which busy stretches they
         * text on, which clock text when several fit.
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

        // ============================================================
        // EMOTION GHOST WINDOW
        // ============================================================

        // The cold shoulder's levels by anger and disgust, and how long each lasts (hours)
        const GHOST_HOURS = [null, [1, 2], [3, 6], [7, 10], [10, 14]];

        /** How cold the character's anger or disgust runs: 0 (not at all) to 4 (both 85 and up). */
        function ghostLevel(emotion) {
            if (!emotion) return 0;
            const anger   = Number(emotion.anger   || 0);
            const disgust = Number(emotion.disgust  || 0);
            if (anger >= 85 && disgust >= 85) return 4;
            if (anger >= 85 || disgust >= 85) return 3;
            if (anger >= 70 || disgust >= 70) return 2;
            if (anger >= 50 || disgust >= 50) return 1;
            return 0;
        }

        /**
         * The cold shoulder now, null or { remainingHours, emotionLabel, until }: no proactive
         * texts (replies go on as ever). It runs from your last message for a length drawn
         * once, when it starts, and kept on the state (`state.ghost`: { since, level, until }),
         * so every check, live, in a catch-up or in the insights, counts down to the same end.
         * Only a new message of yours, or anger or disgust moving to another level, draws it
         * again; below 50 there's none.
         */
        function checkEmotionGhostWindow(state, emotion, nowTs = Date.now()) {
            const level = ghostLevel(emotion);
            if (!level) return null;
            const since = state.lastUserMessageAt > 0 ? state.lastUserMessageAt : 0;
            let ghost = state.ghost;
            if (!ghost || ghost.since !== since || ghost.level !== level) {
                const [lo, hi] = GHOST_HOURS[level];
                // No message of yours yet: from the first time it's seen
                ghost = state.ghost = { since, level, until: Math.round((since || nowTs) + (lo + Math.random() * (hi - lo)) * 3600000) };
                // Kept at once: a reload doesn't draw it again
                api.saveSettings?.();
            }
            if (nowTs >= ghost.until) return null;
            const label = (Number(emotion?.anger || 0) >= Number(emotion?.disgust || 0)) ? 'Anger' : 'Disgust';
            return { remainingHours: (ghost.until - nowTs) / 3600000, emotionLabel: label, until: ghost.until };
        }

        /**
         * The wait between proactive texts, in hours: the character's temperament's
         * (lib/proactive-rounds.js topicHours; where in its range is fixed for the day)
         * stretched by the feelings (anticipation, eagerness, Romance and anxiety shorten
         * it, anger and disgust lengthen it, Extraversion once more; within 0.6–1.4, 1 with
         * emotions off). See lib/texting-behavior.js proactivePace.
         */
        function getRateLimitHours(config, now = new Date()) {
            const pace = typeof api.getProactivePace === 'function' ? api.getProactivePace(undefined, now.getTime()) : 1;
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
        function topicGate({ history, state, config, now, away = false }) {
            const t = Rounds.temperamentOf(config?.temperament);
            const lastUser = history.map(m => !!m?.is_user).lastIndexOf(true);
            const unanswered = history.slice(lastUser + 1)
                .filter(m => !m.is_user && m.meta?.proactive && m.meta.proactiveType !== 'follow_up').length;
            const day = typeof api.getDailyLife === 'function' ? api.getDailyLife(away ? now.getTime() : undefined) : null;
            if (day) day.justFree = Rounds.justGotFree({ phone: day.phone, prevPhone: day.prevPhone, since: day.since, now: now.getTime() });
            let waitHours = Rounds.topicWaitHours({ baseHours: getRateLimitHours(config, now), temperament: t.id, unanswered });
            if (day?.justFree) waitHours /= 2;
            const result = { ok: false, why: null, waitHours, unanswered, day };
            if (day?.phone === 'together') return { ...result, why: 'together' };
            // Playing the main chat is only known while the page runs: not while catching up
            if (!away && (api.getStoryPauseUntil?.() || 0) > now.getTime()) return { ...result, why: 'story' };
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

        function getDefaultProactiveConfigForCharacter() {
            return {
                enabled: true,
                // What each topic is about, by text (its kind: lib/proactive-rounds.js topicKinds). Length and format come from the system prompt
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
                        'It is {{time}} on {{weekday}}. Text {{user}} something late-night — sleepy, random, or affectionate.',

                    morning_wave:
                        'Good morning — it is {{weekday}}. Say good morning to {{user}} in a way that matches your current mood.',

                    lunch_nudge:
                        'It is {{time}} on {{weekday}} — midday. Message {{user}} on your lunch break.',

                    evening_winddown:
                        'It is {{time}} on {{weekday}}, evening time. Wind down with {{user}} as the day ends.',

                    weekend_ping:
                        'It is {{weekday}}, a weekend. Send {{user}} something spontaneous and unstructured.',

                    // ── Emotion-driven ──────────────────────────────────────────────
                    affection_reciprocation:
                        '{{user}} showed you affection recently. Return the affection.',

                    repair_attempt:
                        'There was tension between you and {{user}} recently. Reach out gently to soften the mood, with no pressure.',

                    curiosity_ping:
                        'You feel a surge of curiosity. Ask {{user}} something curious and random to start a conversation.',

                    anxiety_reassurance:
                        'You feel uneasy and crave connection. Reach out to {{user}} subtly for reassurance.',

                    celebration_nudge:
                        'Your mood is high and you feel an urge to share that energy. Text {{user}} something upbeat and hyped.',

                    sharing_impulse:
                        'A sudden impulse to share something crosses your mind — {{random::a thought::a random observation::something you just noticed::a question that just occurred to you}}. Share it with {{user}} on the spot.',

                    mood_follow_up:
                        'Your emotional state has shifted recently. It is {{time}} on {{weekday}}. Text {{user}} in a way that shows your current mood naturally, without explaining it.',

                    // ── Memory / shared history ─────────────────────────────────────
                    memory_nudge:
                        'You recall a recent shared moment with {{user}}. Bring it up casually — a "remember when" or a similar callback.',

                    // ── Extended time-of-day triggers ───────────────────────────────
                    afternoon_slump:
                        'It is {{time}} on {{weekday}} — that slow mid-afternoon drag. Text {{user}}, low-energy but affectionate.',

                    pre_dawn:
                        'It is the strange, quiet hours before dawn on {{weekday}}. Send {{user}} something liminal and half-awake, raw.',

                    commute_ping:
                        'It is {{time}} on {{weekday}} — morning or evening commute time. Text {{user}} from the commute — traffic, transit, people-watching, or just boredom.',

                    post_work:
                        'It is {{time}} on {{weekday}} — you\'ve just wound down from the day. Send {{user}} a relaxed "done for the day" message.',

                    sunday_evening:
                        'It is Sunday evening. Send {{user}} something cozy and slightly wistful, soft and real — the week hasn\'t started yet.',

                    post_midnight_impulse:
                        'It is past midnight on {{weekday}}. An impulse hit you to text {{user}}: send something impulsive and raw — it could be anything.',

                    // ── Day-specific triggers ───────────────────────────────────────
                    monday_reboot:
                        'It is Monday and the week is just starting. Send {{user}} something Monday-flavored — new-week energy, mild dread, or a simple hello.',

                    friday_feeling:
                        'It is Friday — the end of the week is near. Send {{user}} something light and casual with a Friday vibe.',

                    sunday_scaries:
                        'It is Sunday and that familiar pre-week unease is setting in. Send {{user}} something gently anxious or commiserating, real and understated.',

                    midweek_check:
                        'It is Wednesday — middle of the week. Nudge {{user}} midweek — silly, tired, or just checking in.',

                    // ── Emotion-driven (extended) ───────────────────────────────────
                    nostalgia_wave:
                        'A wave of nostalgia washed over you and you thought of {{user}}. Hint at a fond memory, warmly but without being sappy.',

                    longing_ping:
                        'You\'ve been missing {{user}}. Let them know you\'ve been thinking of them — honest, not desperate.',

                    playful_tease:
                        'You\'re in a playful, slightly flirty mood. Tease {{user}} — an in-joke, a mild poke, or light sarcasm.',

                    jealousy_nudge:
                        'Something made you feel a faint, unspoken pang of jealousy and now you\'re thinking of {{user}}. Send something subtly possessive or attention-seeking, without explaining why.',

                    boredom_break:
                        'You\'re bored. Send {{user}} an unfiltered bored text — dumb, random, or pointlessly cute.',

                    overwhelm_check:
                        'You\'re feeling overwhelmed or anxious, and you want to reach out to {{user}}. Hint, without drama, that you could use some company.',

                    gratitude_burst:
                        'Out of nowhere, a rush of appreciation for {{user}} hit you. Tell them you\'re glad they exist — warm but not saccharine.',

                    pride_share:
                        'Something happened and you feel quietly proud — and your first thought was to tell {{user}}. Share it in an understated, humblebrag-ish way.',

                    suppressed_thought:
                        'You\'ve been holding something back — a small thing that\'s been sitting in your head. Hint to {{user}}, low-key and a little cryptic, that something is on your mind, without explaining it.',

                    // ── Contextual / behavioral ─────────────────────────────────────
                    thinking_of_you:
                        'You weren\'t doing anything in particular — {{user}} just crossed your mind. Send an unprompted "thinking of you" message, no explanation needed.',

                    random_thought:
                        'A completely random thought occurred to you and {{user}} is the person you want to share it with. Share the genuinely random or weird observation.',

                    dream_mention:
                        'You remember a fragment of a dream and {{user}} was in it or it made you think of them. Tell them about it, still a little groggy.',

                    song_stuck:
                        'A song has been stuck in your head and it made you think of {{user}}, or you just want to share it. Mention the song or the feeling — don\'t name a real song unless you\'re sure of it.',

                    overthinking_spiral:
                        'It is late and you\'re deep in your own head — overthinking, can\'t stop. Send {{user}} something slightly spiraling or self-aware.',

                    craving_share:
                        'You have a very specific craving right now and you want to tell {{user}} about it. Describe it vividly — food, a drink, an experience, anything.',

                    inside_joke_callback:
                        'Something triggered a memory of a running joke or recurring theme between you and {{user}}. Call back to a shared joke or motif from your conversations — keep it in-world.',

                    quiet_productive:
                        'It is {{time}} on {{weekday}}. You\'ve been in your own quiet world — focused, doing your thing. Send {{user}} a "coming up for air" message.',

                    followup_callback:
                        'You\'ve been thinking about the last thing you and {{user}} discussed. Casually continue or reference that thread.'
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
            syncState(getProactiveConversationState(characterKey), characterKey, history);
        }

        /** The same on a state of its own (a catch-up's copy as it goes). */
        function syncState(state, characterKey, history) {
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
            noteSent(state, proactive, outboundType, timestamp);
            // A reply while you two are talking: a follow-up round if you go quiet now
            if (!proactive && outboundType === 'reply') startRound(characterKey);
        }

        /** What a text of the character's does to a state (theirs, or a catch-up's copy). */
        function noteSent(state, proactive, outboundType, timestamp) {
            state.lastCharacterMessageAt = timestamp;
            state.lastOutboundType = outboundType || 'reply';
            if (proactive) {
                state.lastProactiveAt = timestamp;
                state.triggerHistory[outboundType] = timestamp;
                state.parted = null;
            }
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
        function buildProactiveTriggerPrompt(triggerType, config, lastUserMessageTs, at = null) {
            const raw = config?.triggerTemplates?.[triggerType] || '';
            const timeSinceLast = humanTimeSince(lastUserMessageTs, at ? at.getTime() : Date.now());
            // Looking back (a catch-up): that day, not today
            const withTime = raw.replace(/\{\{timeSinceLast\}\}/g, timeSinceLast)
                .replace(/\{\{weekday\}\}/gi, m => (at ? at.toLocaleDateString([], { weekday: 'long' }) : m));

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
        // TOPICS (docs/platform-plan.md 12f; the kinds are lib/proactive-rounds.js topicKinds)
        // ============================================================

        /**
         * The kinds of topic there are now (Rounds.topicKinds) from the chat and the
         * feelings at `now`; `day`: the character's own day (topicGate), null without a schedule.
         */
        function topicKindsAt({ history, state, now, day }) {
            const nowTs = now.getTime();
            const emotion = api.getEmotionState(undefined, nowTs);
            // Their strongest feeling has changed since their last proactive text, or swung 20 or more
            const snap = state.lastEmotionSnapshot;
            const top = emotion ? strongestFeeling(emotion) : null;
            const moodShift = !!(snap && top && (top.dominant !== snap.dominant || Math.abs(top.intensity - snap.intensity) >= 20));
            // A heart, star or like from you on any bubble of a recent text of theirs
            const affection = history.slice(-8).some(m => !m?.is_user
                && (window.EchoTextChatViewModel?.getUserTapbackIds(m) || []).some(id => ['heart', 'star', 'like'].includes(id)));
            const sayDay = window.EchoTextDailyLife?.sayDay || (d => d);
            return {
                kinds: Rounds.topicKinds({
                    feelings: emotion || {},
                    hoursSinceUser: state.lastUserMessageAt > 0 ? (nowTs - state.lastUserMessageAt) / 3600000 : Infinity,
                    life: day ? Rounds.lifeTopics({ day, sayDay }) : null,
                    clockPick: dailySeed('clock_topic', now), now, affection, moodShift,
                    memories: api.getMemories?.() || [], recalled: state.recalled || {},
                }),
                strongest: top?.intensity || 0,
            };
        }

        /**
         * What the model is told for a topic: its own day's in its words; the rest their text,
         * with no schedule led by the time of day's (the clock text that fits now, its first
         * sentence), and the memory it brings up after it.
         */
        function topicPrompt({ kind, type, detail, memory }, { config, state, now, away, kinds }) {
            const userName = api.getUserName ? api.getUserName() : 'the user';
            const charName = api.getCurrentCharacter?.()?.name || 'the character';
            if (detail) return Rounds.topicInstruction({ type, detail, charName, userName });
            const text = id => buildProactiveTriggerPrompt(id, config, state.lastUserMessageAt, away ? now : null);
            const prompt = text(type) + (memory ? ` Something reminded ${charName} of this: "${String(memory.content).trim()}"` : '');
            const clock = kind !== 'life' && kinds.find(k => k.id === 'life')?.topics.find(t => Rounds.CLOCK_TRIGGERS.includes(t.type));
            if (!clock) return prompt;
            const scene = text(clock.type).match(/^.*?[.!?](?=\s|$)/)?.[0];
            return scene ? `${scene} ${prompt}` : prompt;
        }

        /**
         * The topic to text about now, { type, kind, prompt }, or null. `collect` (tests)
         * returns every topic there is instead of a pick.
         */
        function evaluateProactiveTrigger({ history, state, config, now, collect = false, away = false }) {
            if (!config?.enabled) return null;
            if (!Array.isArray(history) || history.length === 0) return null;

            const nowTs = now.getTime();
            const hoursSinceProactive = state.lastProactiveAt > 0 ? ((nowTs - state.lastProactiveAt) / 3600000) : Infinity;

            // ── Emotion-based ghosting ────────────────────────────────────────────
            const ghostInfo = checkEmotionGhostWindow(state, api.getEmotionState(undefined, nowTs), nowTs);
            if (ghostInfo) {
                // Stash on state so Insights can display it — transient, not persisted
                state._ghostWindow = ghostInfo;
                return null;
            }
            state._ghostWindow = null;

            // ── The temperament's wait, stretched by the feelings and by unanswered topics;
            // Daily Life: asleep, busy, just got free (topicGate) ────────────────────
            const gate = topicGate({ history, state, config, now, away });
            if (!gate.ok) return null;
            // Just parted from you: that text goes first, whatever the wait
            if (gate.day && partedDue(state, nowTs)) {
                const parted = { type: 'parted', weight: 100, prompt: Rounds.topicInstruction({ type: 'parted', charName: api.getCurrentCharacter?.()?.name || 'the character',
                    userName: api.getUserName ? api.getUserName() : 'the user' }) };
                return collect ? [parted] : parted;
            }
            if (hoursSinceProactive < gate.waitHours) return null;

            const { kinds, strongest } = topicKindsAt({ history, state, now, day: gate.day });
            const context = { config, state, now, away, kinds };
            if (collect) {
                return kinds.filter(k => k.ok).flatMap(k => k.topics.map(t => ({ ...t, kind: k.id, prompt: topicPrompt({ ...t, kind: k.id }, context) })));
            }
            const pick = Rounds.pickTopic({ kinds, history: state.triggerHistory, withSchedule: !!gate.day, strongest });
            return pick ? { type: pick.type, kind: pick.kind, prompt: topicPrompt(pick, context), memoryId: pick.memory?.id } : null;
        }

        /** The memory a topic brought up, once it's sent: not again for a while (Rounds.RECALL_DAYS). */
        function noteRecalled(state, trigger, at) {
            if (!trigger?.memoryId) return;
            const recalled = Object.entries(state.recalled || {}).filter(([, t]) => at - t < Rounds.RECALL_DAYS * 86400000);
            state.recalled = { ...Object.fromEntries(recalled), [trigger.memoryId]: at };
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
         * @param {string} lead - what kind of text this is
         * @returns {string}
         */
        function buildProactiveContextMsg(lead = 'PROACTIVE OUTBOUND MODE: You are initiating a spontaneous text message, not replying.') {
            const now        = new Date();
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
            // Not how long since your last text: every text would be about the silence
            const situationXml = `<proactive_situation>\nIt is currently ${semanticPeriod} on a ${dayType}.\n</proactive_situation>`;

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
        // is offered only when the character's platform has the feature (lib/features.js).
        // Whether it does is the model's, by the character. A place only when they're out
        // or on their way: a homebody doesn't share where home is
        const OUT_LOCATION = ['location', 'a <location> when you\'re out or on your way somewhere (never when you\'re home)'];
        const TRIGGER_MEDIA = {
            block_change:          [['photo', 'a <photo> of where you are'], OUT_LOCATION],
            life_event:            [['photo', 'a <photo> of it'], OUT_LOCATION],
            lunch_nudge:           [['photo', 'a <photo> of your lunch'], OUT_LOCATION],
            weekend_ping:          [['photo', 'a <photo> of what you\'re up to'], OUT_LOCATION],
            commute_ping:          [['photo', 'a <photo> of the view on the way']],
            post_work:             [['photo', 'a <photo> of where you\'re unwinding'], OUT_LOCATION],
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
        // Media any proactive message may use, by feature id (a place only where its topic offers one: TRIGGER_MEDIA)
        const MEDIA_NAMES = { photo: ['a photo'], voice: ['a voice message'], file: ['a file'], link: ['a link'], music: ['a song'] };

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
                ? `Reply only with what ${charName} sends now, ${Rounds.TOPIC_MAX_TEXTS} texts at most, in the usual format: text messages, plus ${joinOr(kinds)} when one fits.`
                : `Reply only with the text message(s) ${charName} sends now, ${Rounds.TOPIC_MAX_TEXTS} at most, in the usual format.`;
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

        /**
         * The reply to a trigger as it is kept: { mes, mood } (index.js readReply), for the chat
         * `target` (index.js chatTarget); none when that isn't open once the prompt is built.
         */
        async function generateProactiveMessage(history, trigger, target = undefined) {
            const controller = new AbortController();
            const extraSystem = [buildProactiveContextMsg()];
            const filteredHistory = filterImageTriggerFromHistory(history);
            const { apiMessages, rawPrompt, systemPrompt, prefillPrefix } = await api.buildApiMessagesFromHistory(filteredHistory, extraSystem, null, { verbosity: false });
            // Built from what's open now: another chat by then, it isn't sent
            if (target && !api.isViewing(target)) return { mes: '', mood: null };
            appendTriggerTurn(apiMessages, trigger, prefillPrefix, api.getCurrentCharacter()?.name || 'the character');
            const result = await api.requestEchoTextCompletion({ apiMessages, rawPrompt, systemPrompt, prefillPrefix, signal: controller.signal });
            return api.readReply(result || '', target, { maxTexts: Rounds.TOPIC_MAX_TEXTS });
        }

        // ============================================================
        // FOLLOW-UP ROUNDS (docs/platform-plan.md 12d; the timing is lib/proactive-rounds.js)
        // ============================================================
        // You go quiet in the middle of a conversation: the character follows up in a
        // round, each wait longer than the last, as many texts as their temperament
        // allows. Each text is written in its own request when it's due, from the chat as it
        // is then (those gone by while the page wasn't running, together); your next text
        // ends the round. The day's request cap counts a round once.
        //   state.round = { number, startedAt, times: [ms], texts: [{ mes, mood, life }] by text, sent,
        //     silence: [whether each text may mention the silence], paid: its request counted }

        let roundTimer = null;
        // A round text due this long ago or more goes in quietly with its own time (the page was asleep)
        const LATE_MS = 60 * 1000;

        function temperamentFor(characterKey) {
            return typeof api.getTemperament === 'function' ? api.getTemperament(characterKey) : 'normal';
        }

        /**
         * Whether another proactive request is allowed now: null, or why not ('daily' | 'hourly').
         * Catching up (`hourly` false) counts the character's day only: the hourly cap across
         * characters is about real requests, and a catch-up makes one.
         */
        function requestCap(characterKey, state, now = new Date(Date.now()), { hourly: countHourly = true } = {}) {
            const t = Rounds.temperamentOf(temperamentFor(characterKey));
            const used = state.requests?.day === getDateKeyLocal(now) ? state.requests.count : 0;
            if (used >= t.dailyRequests) return 'daily';
            const hourly = settings().proactiveHourly;
            if (countHourly && hourly?.hour === Rounds.hourKey(now) && hourly.count >= Rounds.HOURLY_REQUESTS) return 'hourly';
            return null;
        }

        /** Counts a request toward the character's day (`daily`) and the hour across characters (`hourly`). */
        function spendRequest(state, now = new Date(Date.now()), { daily = true, hourly = true } = {}) {
            const day = getDateKeyLocal(now);
            if (daily) state.requests = { day, count: (state.requests?.day === day ? state.requests.count : 0) + 1 };
            if (!hourly) return;
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
            const temperament = temperamentFor(characterKey);
            const times = Rounds.planRound({ temperament, startAt: startedAt });
            if (times.length) state.round = { number: 1, startedAt, times, texts: [], sent: 0, silence: Rounds.silenceSlots({ temperament, count: times.length }) };
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

        /** The line of the schedule the character is in at `at` (ms), as the schedule has it (lib/daily-life.js blockLine); '' without one. */
        function doingAt(at) {
            const block = typeof api.getDailyLife === 'function' ? api.getDailyLife(at)?.block : null;
            if (!block) return '';
            return window.EchoTextDailyLife ? window.EchoTextDailyLife.blockLine(block) : block.doing || block.place || '';
        }

        /**
         * Writes the round's texts: one request, split at the --- lines. Null when the chat
         * (`target`) isn't open once the prompt is built: it isn't sent.
         */
        async function writeRound(char, characterKey, history, round, target, count = round.times.length - round.sent) {
            const userName = api.getUserName ? api.getUserName() : 'the user';
            const charName = char.name || characterKey;
            // That there's no reply is said once, in the instruction
            const lead = `FOLLOW-UP MODE: you are texting ${userName} again on your own.`;
            const extraSystem = [buildProactiveContextMsg(lead)];
            const { apiMessages, rawPrompt, systemPrompt } = await api.buildApiMessagesFromHistoryForChar(filterImageTriggerFromHistory(history), extraSystem, char, { verbosity: false });
            if (!api.isViewing(target)) return null;
            // Every one of them due a while ago (the page wasn't running): told by the clock, beside the time now
            const now = Date.now();
            const times = round.times.slice(round.sent, round.sent + count);
            const allLate = now - times[times.length - 1] >= LATE_MS;
            const instruction = Rounds.roundInstruction({
                charName, userName, temperament: temperamentFor(characterKey), round: round.number,
                times, startedAt: round.startedAt, now, late: allLate, doing: times.map(doingAt),
            });
            apiMessages.push({ role: 'user', content: `[Instruction for this turn — not a message from ${userName}; never quote or answer it: ${instruction}]` });
            const raw = await api.requestEchoTextCompletion({ apiMessages, rawPrompt, systemPrompt, signal: new AbortController().signal });
            return Rounds.splitRound(raw || '', count).map(part => api.readReply(part, target, { oneText: true })).filter(reply => reply.mes);
        }

        /**
         * Writes the round's next text, due now, in its own request: the chat as it is, the
         * time and the schedule's line, whether it may mention the silence (round.silence).
         * Null when the chat (`target`) isn't open once the prompt is built.
         */
        async function writeText(char, characterKey, history, round, target) {
            const userName = api.getUserName ? api.getUserName() : 'the user';
            const charName = char.name || characterKey;
            const lead = `FOLLOW-UP MODE: you are texting ${userName} again on your own.`;
            const { apiMessages, rawPrompt, systemPrompt } = await api.buildApiMessagesFromHistoryForChar(filterImageTriggerFromHistory(history), [buildProactiveContextMsg(lead)], char, { verbosity: false });
            if (!api.isViewing(target)) return null;
            // Theirs since your last text, the round's earlier ones among them
            const lastUser = history.map(m => !!m?.is_user).lastIndexOf(true);
            const theirs = history.slice(lastUser + 1).filter(m => !m?.is_user);
            const cap = Rounds.temperamentOf(temperamentFor(characterKey)).silence;
            const instruction = Rounds.textInstruction({
                charName, userName, unanswered: Math.max(1, theirs.length), now: Date.now(),
                lastAt: Number(theirs.at(-1)?.send_date) || Date.parse(theirs.at(-1)?.send_date) || round.startedAt,
                doing: doingAt(round.times[round.sent]),
                // A round from before these were drawn: the first ones, as many as the temperament allows
                silence: round.silence?.[round.sent] ?? (cap === null || round.sent < cap),
            });
            apiMessages.push({ role: 'user', content: `[Instruction for this turn — not a message from ${userName}; never quote or answer it: ${instruction}]` });
            const raw = await api.requestEchoTextCompletion({ apiMessages, rawPrompt, systemPrompt, signal: new AbortController().signal });
            return api.readReply(raw || '', target, { oneText: true });
        }

        /**
         * What holds a round's next text back at `nowTs`, live and when catching up: { end }
         * (a cold shoulder ends it), { until } (you're playing the main chat, known only live;
         * asleep, or busy, where an obsessed character sneaks one in half the time), else null.
         * `late` (live: due a while ago, the page wasn't running) skips the schedule, as before.
         */
        function roundHold({ characterKey, state, nowTs, late = false, away = false }) {
            if (checkEmotionGhostWindow(state, api.getEmotionState(undefined, nowTs), nowTs)) return { end: true };
            const storyUntil = away ? 0 : (api.getStoryPauseUntil?.() || 0);
            if (storyUntil > nowTs) return { until: storyUntil };
            const life = !late && typeof api.getScheduleNow === 'function' ? api.getScheduleNow(away ? nowTs : undefined) : null;
            const waitFor = life && life.endsAt > nowTs && (life.phone === 'asleep'
                || (life.phone === 'busy' && !(temperamentFor(characterKey) === 'obsessed' && Math.random() < 0.5)));
            return waitFor ? { until: life.endsAt } : null;
        }

        /** The round's texts from the next one on, moved so that one comes at `until`, the gaps kept. */
        function putOffRound(round, until) {
            const shift = until - round.times[round.sent];
            round.times = round.times.map((t, i) => (i >= round.sent ? t + shift : t));
        }

        /** After a round runs out: an obsessed character comes back in a few hours (a new round); the rest let it go (null). */
        function nextRound(characterKey, round) {
            const t = Rounds.temperamentOf(temperamentFor(characterKey));
            const last = round.times[round.times.length - 1] || Date.now();
            const times = t.againHours ? Rounds.planRound({ temperament: t.id, startAt: last, firstHours: t.againHours }) : [];
            return times.length ? { number: round.number + 1, startedAt: last, times, texts: [], sent: 0, silence: Rounds.silenceSlots({ temperament: t.id, count: times.length }) } : null;
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
            // A catch-up is due: it works the round out with the rest of the gap
            if (api.catchUpPending?.(characterKey)) return true;
            const now = Date.now();
            if (now < round.times[round.sent]) { armRoundTimer(); return true; }
            if (proactiveGenerationLocks.has(characterKey) || api.getIsGenerating()) {
                clearTimeout(roundTimer);
                roundTimer = setTimeout(() => { runDueRound().catch(() => {}); }, 30000);
                return true;
            }
            const late = now - round.times[round.sent] >= LATE_MS;
            const hold = roundHold({ characterKey, state, nowTs: now, late });
            if (hold?.end) { state.round = null; api.saveSettings(); return false; }
            if (hold) {
                putOffRound(round, hold.until);
                api.saveSettings();
                armRoundTimer();
                return true;
            }

            proactiveGenerationLocks.add(characterKey);
            try {
                let history = (settings().chatHistory || {})[characterKey] || [];
                if (!Array.isArray(round.texts)) round.texts = [];
                if (!round.texts[round.sent]) {
                    // The day's cap counts a round once, when its first text is written; the hour's, each request
                    if (!round.paid) {
                        const cap = requestCap(characterKey, state);
                        if (cap) { state.round = null; state.capped = { reason: cap, at: now }; return false; }
                        spendRequest(state);
                        round.paid = true;
                    } else {
                        spendRequest(state, new Date(now), { daily: false });
                    }
                    let texts;
                    if (late) {
                        // Gone by while the page wasn't running: those due now are written together (a bar
                        // says so meanwhile, as a catch-up's does), and go in quietly at their own times
                        const due = round.times.filter((t, i) => i >= round.sent && t <= now).length;
                        const catchingUp = api.isPanelOpen() && api.getCharacterKey() === characterKey;
                        if (catchingUp) api.setRoundBar?.(true, characterKey);
                        try {
                            texts = await writeRound(char, characterKey, history, round, api.chatTarget(), due);
                        } finally {
                            if (catchingUp) api.setRoundBar?.(false, characterKey);
                        }
                        // Fewer written than asked: the rest of those due are left out
                        if (texts) round.times.splice(round.sent + texts.length, due - texts.length);
                    } else {
                        // Due now: written on its own, from the chat as it is
                        const reply = await writeText(char, characterKey, history, round, api.chatTarget());
                        texts = reply ? (reply.mes ? [reply] : []) : null;
                        if (texts && !texts.length) round.times.splice(round.sent, 1);
                    }
                    // You answered (or the chat moved on) while it was being written
                    if (state.round !== round) return !!state.round;
                    // Another chat open by the time it was put together: written when theirs is again
                    if (!texts) return true;
                    texts.forEach((reply, i) => { round.texts[round.sent + i] = reply; });
                }
                // Every text now due: the late ones quietly with their own time, the last one live
                while (round.sent < round.times.length && round.times[round.sent] <= Date.now() && round.texts[round.sent]) {
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
                    // Nothing left from before it began (the chat cleared or replaced): the round goes with it
                    if (!history.some(m => (Number(m.send_date) || Date.parse(m.send_date)) <= round.startedAt)) {
                        state.round = null;
                        return false;
                    }
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
                if (round.sent >= round.times.length) state.round = nextRound(characterKey, round);
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

        // ============================================================
        // CATCHING UP (index.js maybeCatchUp, lib/catch-up.js)
        // ============================================================
        // The page wasn't running: what the character would have sent meanwhile is worked out
        // here by the same rules on a virtual clock (a round's own times for its follow-ups, the
        // scheduler's ticks for new topics), on copies of their state and chat. The catch-up's one
        // request only writes the texts; the copy becomes their state whatever comes back.

        /**
         * What would have been sent from `from` to `to`: { events, state }. Each event is
         * { at, kind: 'follow_up' | 'topic', note (what it's about, for the model), round and
         * index (follow-ups; `text` when the round was written before), type (topics) }, only
         * the last `days` of them, at most `max`, the latest kept. Rounds run from `from` (they
         * go on until they end); new topics are looked for within those days only. `state` is
         * where the character's state would be by `to`; `followUps`, how the follow-ups among
         * the events are written (null for none); `quiet`, why there are none (quietReason).
         */
        function simulateAway(characterKey, char, { from, to, days = 3, max = 30 }) {
            const state = JSON.parse(JSON.stringify(getProactiveConversationState(characterKey)));
            const history = [...((settings().chatHistory || {})[characterKey] || [])];
            const config = getMergedProactiveConfig(characterKey, char);
            const charName = char?.name || characterKey;
            const userName = api.getUserName ? api.getUserName() : 'the user';
            const tickMs = Math.max(1, Number(settings().proactiveTickMinutes || 2)) * 60000;
            const windowFrom = Math.max(from, to - days * 86400000);
            const events = [];
            let tick = windowFrom + tickMs;
            // The round a request has been counted for (one per round, when its first text comes)
            let paid = null;
            const sent = (at, type, extra = {}) => {
                history.push({ is_user: false, mes: '', send_date: at, meta: { proactive: true, proactiveType: type, ...extra } });
                noteSent(state, true, type, at);
            };
            for (let guard = 0; guard < 200000; guard++) {
                const round = state.round;
                const due = round ? round.times[round.sent] : Infinity;
                if (Math.min(due, tick) > to) break;
                if (round && due <= tick) {
                    // With you: the round stops, as when you turn it on (dropRound)
                    if (api.withYouAt?.(due)) { state.round = null; continue; }
                    const hold = roundHold({ characterKey, state, nowTs: due, away: true });
                    if (hold?.end) { state.round = null; continue; }
                    if (hold) { putOffRound(round, hold.until); continue; }
                    if (!round.paid && !round.texts?.length && paid !== round) {
                        const at = new Date(due);
                        const cap = requestCap(characterKey, state, at, { hourly: false });
                        if (cap) { state.round = null; state.capped = { reason: cap, at: due }; continue; }
                        spendRequest(state, at, { hourly: false });
                        paid = round;
                    }
                    events.push({ at: due, kind: 'follow_up', round: round.number, index: round.sent, text: round.texts?.[round.sent] || null,
                        note: Rounds.followUpNote({ round: round.number, index: round.sent }) });
                    sent(due, 'follow_up', { round: round.number });
                    round.sent++;
                    if (round.sent >= round.times.length) state.round = nextRound(characterKey, round);
                    continue;
                }
                const now = new Date(tick);
                tick += tickMs;
                // A round under way holds the triggers back; with you, nothing new
                if (round || api.withYouAt?.(now.getTime())) continue;
                syncState(state, characterKey, history);
                const trigger = evaluateProactiveTrigger({ history, state, config, now, away: true });
                if (!trigger) continue;
                const cap = requestCap(characterKey, state, now, { hourly: false });
                if (cap) { state.capped = { reason: cap, at: now.getTime() }; continue; }
                spendRequest(state, now, { hourly: false });
                if (trigger.type === 'parted') state.parted = null;
                events.push({ at: now.getTime(), kind: 'topic', type: trigger.type, note: trigger.prompt });
                sent(now.getTime(), trigger.type);
                noteRecalled(state, trigger, now.getTime());
                const emotion = api.getEmotionState(undefined, now.getTime());
                if (emotion) state.lastEmotionSnapshot = strongestFeeling(emotion);
            }
            delete state._ghostWindow;
            const kept = events.filter(e => e.at > windowFrom).slice(-max);
            // How the follow-ups among them are written (said once, beside the list)
            const followUps = kept.some(e => e.kind === 'follow_up')
                ? Rounds.followUpGuidance({ charName, userName, temperament: config.temperament, rounds: true }) : null;
            return { events: kept, state, followUps, quiet: kept.length ? null : quietReason(state, history, config) };
        }

        /**
         * Why a gap had nothing to send, for the catch-up's bar: the day's requests used up,
         * new topics unanswered up to the temperament's cap ({ unanswered: n }), else nothing due.
         */
        function quietReason(state, history, config) {
            if (state.capped?.reason === 'daily') return { why: 'limit' };
            const lastUser = history.map(m => !!m?.is_user).lastIndexOf(true);
            const unanswered = history.slice(lastUser + 1).filter(m => !m.is_user && m.meta?.proactive && m.meta.proactiveType !== 'follow_up').length;
            if (unanswered >= Rounds.temperamentOf(config?.temperament).topicCap) return { why: 'unanswered', unanswered };
            return { why: 'none' };
        }

        // What of a catch-up's state becomes the character's
        const SIMULATED = ['round', 'triggerHistory', 'lastProactiveAt', 'lastCharacterMessageAt', 'lastOutboundType', 'parted',
            'lastEmotionSnapshot', 'requests', 'capped', 'ghost', 'recalled'];

        /**
         * A catch-up's simulated state becomes the character's, texts written or not (so the gap
         * isn't caught up on twice). You texted meanwhile: no round or text after parting is left.
         */
        function adoptSimulation(characterKey, simState) {
            const state = getProactiveConversationState(characterKey);
            if (!state || !simState) return;
            for (const field of SIMULATED) if (field in simState) state[field] = simState[field];
            if (state.lastUserMessageAt > (simState.lastUserMessageAt || 0)) { state.round = null; state.parted = null; }
            api.saveSettings();
            armRoundTimer();
        }

        /** A catch-up's one request: the hour's count across characters (its day is the simulation's). */
        function noteCatchUpRequest(characterKey) {
            spendRequest(getProactiveConversationState(characterKey), new Date(Date.now()), { daily: false });
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
            // A catch-up is due: what they'd have sent is worked out there
            if (api.catchUpPending?.(characterKey)) return;

            // ── Group-aware history loading ──────────────────────────────────
            // Group histories live in separate stores, not s.chatHistory.
            // Read from the correct store based on session context.
            let history = [];
            const _inGroup  = !!(api.isGroupSession && api.isGroupSession());
            const _inCombine = _inGroup && !!(api.isCombineMode && api.isCombineMode());
            const _groupId   = _inGroup ? (api.getCurrentGroupId ? api.getCurrentGroupId() : null) : null;

            const readHistory = () => _inGroup
                ? (_inCombine
                    ? (api.getCombineHistory   ? api.getCombineHistory(_groupId)               : [])
                    : (api.getGroupChatHistory ? api.getGroupChatHistory(_groupId, characterKey) : []))
                : ((s.chatHistory && s.chatHistory[characterKey]) || []);
            if (_inGroup && !_groupId) return;
            history = readHistory();
            // Do not initiate proactive messages if there is no prior conversation
            if (!history.length) return;
            // The chat it's for (index.js chatTarget), whether that's still the one open, and the last message it saw
            const target = { group: _inGroup ? _groupId : null, combine: _inCombine, key: _inCombine ? null : characterKey };
            const stillOpen = () => (_inGroup
                ? !!(api.isGroupSession && api.isGroupSession()) && api.getCurrentGroupId?.() === _groupId && !!api.isCombineMode?.() === _inCombine
                : !(api.isGroupSession && api.isGroupSession()) && api.getCharacterKey() === characterKey);
            const anchor = history[history.length - 1];

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

                const extraSystem = [buildProactiveContextMsg()];
                const filteredHistory = filterImageTriggerFromHistory(history);
                const { apiMessages, rawPrompt, systemPrompt } = await api.buildApiMessagesFromHistoryForChar(filteredHistory, extraSystem, char, { verbosity: false });
                // Built from what's open now: another chat by then, it isn't sent
                if (!stillOpen()) return;
                // No prefill on this path, so the trigger always goes last
                appendTriggerTurn(apiMessages, trigger, null, char.name || characterKey);
                const controller = new AbortController();
                const reply = api.readReply(await api.requestEchoTextCompletion({ apiMessages, rawPrompt, systemPrompt, signal: controller.signal }) || '', target, { maxTexts: Rounds.TOPIC_MAX_TEXTS });

                if (!reply.mes) return;

                const typingDelayMs = Math.min(Math.max(reply.mes.length * 40, 1500), 6000);
                await new Promise(resolve => setTimeout(resolve, typingDelayMs));

                // The chat as it is now (you may have texted meanwhile); cleared or replaced: left that way
                const latest = readHistory();
                if (!latest.includes(anchor)) return;

                // Capture emotion snapshot for mood_follow_up detection next tick
                captureEmotionSnapshot(characterKey, api.getEmotionState(characterKey));

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
                const newHistory = [...latest, outbound];

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
                noteRecalled(getProactiveConversationState(characterKey), trigger, outbound.send_date);

                // On screen as it lands, not as it set out
                const showing = stillOpen() && (!_inGroup || api.getActiveGroupCharKey() === characterKey);
                if (api.isPanelOpen() && showing) {
                    api.renderMessages(newHistory);
                    api.setFabUnreadIndicator(false);
                    if ((reply.mood || reply.life) && characterKey === api.getCharacterKey()) api.noteMoodReport();
                } else if (_inGroup && stillOpen() && api.isPanelOpen() && api.markGroupCharUnread) {
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
            // The same gate as the topics (topicGate): the wait with unanswered topics, Daily Life
            const gate = topicGate({ history, state, config, now });
            const hoursSinceProactive = state.lastProactiveAt > 0 ? ((nowTs - state.lastProactiveAt) / 3600000) : Infinity;
            const remainingGap = Math.max(0, gate.waitHours - hoursSinceProactive);

            let next = 'Ready for a new topic';
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
            } else if (!history.length) {
                next = 'No messages yet — start a conversation first';
            }

            // The six kinds of topic as the picker sees them now, whatever holds it back
            const { kinds } = topicKindsAt({ history, state, now, day: gate.day });
            const lastOf = kind => Math.max(0, ...Object.entries(state.triggerHistory || {}).filter(([type]) => Rounds.KIND_OF[type] === kind).map(([, at]) => Number(at) || 0));
            const triggerDiagnostics = kinds.map(k => ({
                id: k.id,
                label: k.label,
                req: k.need,
                status: settings().proactiveMessagingEnabled !== true || !config.enabled ? 'unmet' : k.ok ? 'ready' : 'unmet',
                reason: settings().proactiveMessagingEnabled !== true || !config.enabled ? 'Disabled' : !k.ok ? k.why
                    : k.memoryCount === undefined ? 'Can pick' : `Can pick · ${k.memoryCount ? `${k.memoryCount} ${k.memoryCount === 1 ? 'memory' : 'memories'}` : 'no memories'}`,
                last: formatProactiveTimestamp(lastOf(k.id)),
            }));

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

                let html = '<div class="et-trigger-category-items">';
                for (const t of snapshot.triggerDiagnostics) {
                    html += `
                        <div class="et-trigger-row" data-id="${t.id}">
                            <div class="et-trigger-row-main">
                                <span class="et-trigger-row-name">${t.label}</span>
                                <span class="et-trigger-row-req">${t.req}</span>
                            </div>
                            <div class="et-trigger-row-status">
                                <span class="et-trigger-badge ${t.status === 'ready' ? 'et-badge-ready' : 'et-badge-unmet'}">${t.reason}</span>
                            </div>
                            <div class="et-trigger-row-meta" title="Last sent">
                                <i class="fa-solid fa-clock-rotate-left"></i> ${t.last}
                            </div>
                        </div>`;
                }
                html += '</div>';

                wrap.html(html);
            };

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

            const config = getMergedProactiveConfig(characterKey, char);
            const state  = getProactiveConversationState(characterKey);
            // What the picker would choose now, whatever the wait
            const now = new Date();
            const chat = api.getChatHistory();
            const { day } = topicGate({ history: chat, state, config, now });
            const { kinds, strongest } = topicKindsAt({ history: chat, state, now, day });
            const pick = Rounds.pickTopic({ kinds, history: state.triggerHistory, withSchedule: !!day, strongest });
            const trigger = { type: pick.type, kind: pick.kind, prompt: topicPrompt(pick, { config, state, now, away: false, kinds }), memoryId: pick.memory?.id };

            jQuery('#et_trigger_message').prop('disabled', true).addClass('et-btn-loading');

            proactiveGenerationLocks.add(characterKey);
            try {
                if (api.isPanelOpen() && api.getCharacterKey() === characterKey) api.setTypingIndicatorVisible(true);

                // The chat it's for, and the last message it saw
                const target = api.chatTarget();
                const history = api.getChatHistory(target);
                const anchor = history[history.length - 1] || null;
                const reply = await generateProactiveMessage(history, trigger, target);
                if (!reply.mes) return;
                // Cleared or replaced meanwhile: left that way
                const latest = api.getChatHistory(target);
                if (anchor && !latest.includes(anchor)) return;

                // Capture emotion snapshot for mood_follow_up
                captureEmotionSnapshot(characterKey, api.getEmotionState(characterKey));

                const outbound = {
                    is_user: false,
                    mes: reply.mes,
                    send_date: Date.now(),
                    meta: { proactive: true, proactiveType: trigger.type },
                    ...(reply.mood ? { mood: reply.mood } : {}),
                    ...(reply.life ? { life: reply.life } : {})
                };
                const newHistory = [...latest, outbound];
                api.saveChatHistory(newHistory, target);
                markProactiveCharacterActivity(characterKey, true, trigger.type, outbound.send_date);
                noteRecalled(getProactiveConversationState(characterKey), trigger, outbound.send_date);

                if (api.isPanelOpen() && api.isViewing(target)) {
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
                jQuery('#et_trigger_message').prop('disabled', false).removeClass('et-btn-loading');
                api.saveSettings();
            }
        }

        // ============================================================
        // PUBLIC API
        // ============================================================

        return {
            getDateKeyLocal,
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
            simulateAway,
            adoptSimulation,
            noteCatchUpRequest,
            buildProactiveTriggerPrompt,
            buildTriggerTurnText
        };
    }

    window.EchoTextProactiveMessaging = { createProactiveMessaging };
})();
