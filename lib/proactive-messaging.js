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

        /** You texted: her sequence starts over from her next message (and nothing's left to say after parting). */
        function markProactiveUserActivity(characterKey, timestamp = Date.now()) {
            const state = getProactiveConversationState(characterKey);
            if (!state) return;
            state.lastUserMessageAt = timestamp;
            state.parted = null;
            state.seq = null;
            state.unanswered = 0;
            delete state.round;
            armProactiveTimer();
        }

        /** A message of hers: the next text of her sequence is planned from it. */
        function markProactiveCharacterActivity(characterKey, proactive = false, outboundType = 'reply', timestamp = Date.now()) {
            const state = getProactiveConversationState(characterKey);
            if (!state) return;
            noteSent(state, proactive, outboundType, timestamp);
            planNext(state, characterKey, timestamp);
            armProactiveTimer();
        }

        /**
         * What a text of the character's does to a state (theirs, or a catch-up's copy): a
         * reply starts the unanswered count over, one of her own adds one.
         */
        function noteSent(state, proactive, outboundType, timestamp) {
            state.lastCharacterMessageAt = timestamp;
            state.lastOutboundType = outboundType || 'reply';
            state.unanswered = proactive ? (state.unanswered || 0) + 1 : 0;
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
         * feelings at `now`; `day`: the character's own day (api.getDailyLife), null without a schedule.
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
         * What may be on her mind at `now`, as material for a text ({ type, kind, prompt,
         * memoryId }): a kind of topic, then one in it (Rounds.pickTopic), her own day's with
         * a schedule (`away`: at `now`, when catching up). `collect` (tests) returns every topic
         * there is instead of a pick.
         */
        function topicAt({ history, state, config, now, away = false, collect = false }) {
            const day = typeof api.getDailyLife === 'function' ? api.getDailyLife(away ? now.getTime() : undefined) : null;
            if (day) day.justFree = Rounds.justGotFree({ phone: day.phone, prevPhone: day.prevPhone, since: day.since, now: now.getTime() });
            const { kinds, strongest } = topicKindsAt({ history, state, now, day });
            const context = { config, state, now, away, kinds };
            if (collect) {
                return kinds.filter(k => k.ok).flatMap(k => k.topics.map(t => ({ ...t, kind: k.id, prompt: topicPrompt({ ...t, kind: k.id }, context) })));
            }
            const pick = Rounds.pickTopic({ kinds, history: state.triggerHistory, withSchedule: !!day, strongest });
            return pick ? { type: pick.type, kind: pick.kind, prompt: topicPrompt(pick, context), memoryId: pick.memory?.id } : null;
        }

        /** The text after parting from you, as what's on her mind. */
        function partedTopic() {
            return { type: 'parted', kind: 'life', prompt: Rounds.topicInstruction({ type: 'parted', charName: api.getCurrentCharacter?.()?.name || 'the character',
                userName: api.getUserName ? api.getUserName() : 'the user' }) };
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

        /** What a topic's text could come with, as the instruction offers it: the platform's media only. */
        function mediaHint(type) {
            const features = api.getActiveFeatures ? api.getActiveFeatures() : [];
            const media = (TRIGGER_MEDIA[type] || []).filter(([id]) => features.includes(id)).map(([, what]) => what);
            return media.length ? `If it feels natural, send ${joinOr(media)} with it, or instead of text.` : '';
        }

        /** The reply format a proactive text is asked for: a few texts at most, plus the platform's media. */
        function replyFormat(charName) {
            const features = api.getActiveFeatures ? api.getActiveFeatures() : [];
            const kinds = Object.keys(MEDIA_NAMES).filter(id => features.includes(id)).flatMap(id => MEDIA_NAMES[id]);
            return kinds.length
                ? `Reply only with what ${charName} sends now, ${Rounds.TOPIC_MAX_TEXTS} texts at most, in the usual format: text messages, plus ${joinOr(kinds)} when one fits.`
                : `Reply only with the text message(s) ${charName} sends now, ${Rounds.TOPIC_MAX_TEXTS} at most, in the usual format.`;
        }

        // ============================================================
        // THE SEQUENCE (docs/mechanics-reference.md 5.13; the waits are lib/proactive-rounds.js)
        // ============================================================
        // From her last message, each text of hers comes after the one before by the
        // temperament's base wait × its growth^(texts of hers unanswered), the feelings
        // stretching it; your next text starts it over. What holds one back (holdAt) moves
        // it to when that's over. Live: the open character's, by a timer; the rest, and
        // whatever was due while the page didn't run, the catch-up's (simulateAway), by the
        // same rules.
        //   state.seq = { next: ms }   state.unanswered: her texts since your last one, hers first

        let seqTimer = null;

        function temperamentFor(characterKey) {
            return typeof api.getTemperament === 'function' ? api.getTemperament(characterKey) : 'normal';
        }

        function followUpsOn() {
            const s = settings();
            return s.enabled !== false && s.proactiveMessagingEnabled === true;
        }

        // Proactive requests a day, all characters together (settings: at least 1)
        const DAILY_LIMIT_DEFAULT = 20;
        function dailyLimit() {
            const n = Math.round(Number(settings().proactiveDailyLimit));
            return Number.isFinite(n) ? Math.max(1, n) : DAILY_LIMIT_DEFAULT;
        }
        /** The day's count at `at` from a counter ({ day, count }; a catch-up's copy, or the settings'). */
        const dailyUsed = (counter, at) => (counter?.day === getDateKeyLocal(new Date(at)) ? counter.count : 0);
        function spendDaily(counter, at) {
            const day = getDateKeyLocal(new Date(at));
            return { day, count: (counter?.day === day ? counter.count : 0) + 1 };
        }
        const nextMidnight = at => { const d = new Date(at); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(); };

        /** Her next text, planned from her message at `from` (Rounds.waitMs, with the unanswered count and the feelings then). */
        function planNext(state, characterKey, from) {
            const pace = typeof api.getProactivePace === 'function' ? api.getProactivePace(characterKey, from) : 1;
            state.seq = { next: from + Rounds.waitMs({ temperament: temperamentFor(characterKey), unanswered: state.unanswered || 0, pace }) };
        }

        /** A sequence for a chat that ends with her message but has none planned (an older state): from that message. */
        function ensureSeq(state, characterKey, history) {
            delete state.round;
            if (state.seq) return;
            const last = history[history.length - 1];
            if (!last || last.is_user) return;
            const lastUser = history.map(m => !!m?.is_user).lastIndexOf(true);
            state.unanswered = history.slice(lastUser + 1).filter(m => !m.is_user && m.meta?.proactive).length;
            planNext(state, characterKey, Number(last.send_date) || Date.parse(last.send_date) || Date.now());
        }

        /** When her next text is due: the sequence's, or the one after parting if that comes first. */
        function nextDue(state) {
            const times = [state.seq?.next, state.parted?.at].filter(Number.isFinite);
            return times.length ? Math.min(...times) : null;
        }
        const partedFirst = state => Number.isFinite(state.parted?.at) && (!Number.isFinite(state.seq?.next) || state.parted.at <= state.seq.next);

        /** The due text moved to `until`, whichever it is. */
        function putOff(state, until) {
            if (partedFirst(state)) state.parted.at = until;
            else if (state.seq) state.seq.next = until;
        }

        /**
         * What holds her text back at `at`, live and when catching up (`away`, with its own
         * day's count `counter`): the cold shoulder, time with you, you playing the main chat,
         * her asleep or busy, the day's requests used up. { until, why }, or null.
         */
        function holdAt({ characterKey, state, at, away = false, counter = settings().proactiveDaily }) {
            const ghost = checkEmotionGhostWindow(state, api.getEmotionState(undefined, at), at);
            if (ghost) return { until: ghost.until, why: 'ghost' };
            const life = typeof api.getScheduleNow === 'function' ? api.getScheduleNow(away ? at : undefined) : null;
            if (life?.phone === 'together' && life.endsAt > at) return { until: life.endsAt, why: 'together' };
            if (away && api.withYouAt?.(at)) return { until: at + 10 * 60000, why: 'together' };
            const storyUntil = api.getStoryPauseUntil?.(away ? at : undefined) || 0;
            if (storyUntil > at) return { until: storyUntil, why: 'story' };
            if (life && life.endsAt > at && (life.phone === 'asleep' || life.phone === 'busy')) return { until: life.endsAt, why: life.phone };
            if (dailyUsed(counter, at) >= dailyLimit()) return { until: nextMidnight(at), why: 'limit' };
            return null;
        }

        /** Time together ended at `endedAt` (ms): the text after it, if their temperament sends one and it isn't too late. */
        function planParted(characterKey, endedAt) {
            const state = getProactiveConversationState(characterKey);
            if (!state) return;
            const at = Rounds.partedAt({ temperament: temperamentFor(characterKey), endedAt });
            state.parted = at && Date.now() - at < Rounds.PARTED_LATE_MS ? { at } : null;
            api.saveSettings();
            armProactiveTimer();
        }

        /** Sets the timer for the open character's next text (solo chats; the minute's tick covers the rest). */
        function armProactiveTimer() {
            clearTimeout(seqTimer);
            seqTimer = null;
            const key = api.getCharacterKey?.();
            const state = key ? settings().proactiveState?.[key] : null;
            const due = state ? nextDue(state) : null;
            if (!due || (api.isGroupSession && api.isGroupSession())) return;
            const wait = Math.max(1000, Math.min(due - Date.now(), 2 ** 31 - 1));
            seqTimer = setTimeout(() => { runProactiveSchedulerTick().catch(err => api.warn('Proactive text failed:', err)); }, wait);
        }

        /** The line of the schedule the character is in at `at` (ms), as the schedule has it (lib/daily-life.js blockLine); '' without one. */
        function doingAt(at) {
            const block = typeof api.getDailyLife === 'function' ? api.getDailyLife(at)?.block : null;
            if (!block) return '';
            return window.EchoTextDailyLife ? window.EchoTextDailyLife.blockLine(block) : block.doing || block.place || '';
        }

        /**
         * Writes her text due now, in its own request: the chat as it is, how many of hers
         * are unanswered, the time and the schedule's line, what may be on her mind (`topic`),
         * its media and the format. Null when the chat (`target`) isn't open once the prompt
         * is built.
         */
        async function writeOutreach(char, characterKey, history, topic, target, isOpen = () => api.isViewing(target)) {
            const userName = api.getUserName ? api.getUserName() : 'the user';
            const charName = char.name || characterKey;
            const lead = `PROACTIVE MODE: you are texting ${userName} on your own, not replying.`;
            const { apiMessages, rawPrompt, systemPrompt } = await api.buildApiMessagesFromHistoryForChar(filterImageTriggerFromHistory(history), [buildProactiveContextMsg(lead)], char, { verbosity: false });
            if (!isOpen()) return null;
            const lastUser = history.map(m => !!m?.is_user).lastIndexOf(true);
            const theirs = history.slice(lastUser + 1).filter(m => !m?.is_user);
            const now = Date.now();
            const instruction = Rounds.outreachInstruction({
                charName, userName, unanswered: Math.max(1, theirs.length), now,
                lastAt: Number(theirs.at(-1)?.send_date) || Date.parse(theirs.at(-1)?.send_date) || 0,
                doing: doingAt(now), material: topic?.prompt || '', media: topic ? mediaHint(topic.type) : '', format: replyFormat(charName),
            });
            apiMessages.push({ role: 'user', content: `[Instruction for this turn — not a message from ${userName}; never quote or answer it: ${instruction}]` });
            const raw = await api.requestEchoTextCompletion({ apiMessages, rawPrompt, systemPrompt, signal: new AbortController().signal });
            return api.readReply(raw || '', target, { maxTexts: Rounds.TOPIC_MAX_TEXTS });
        }

        // ============================================================
        // CATCHING UP (index.js maybeCatchUp, lib/catch-up.js)
        // ============================================================
        // The page wasn't running (or she wasn't the one open): what she'd have sent meanwhile
        // is worked out here by the same sequence on a virtual clock, on copies of her state
        // and chat. The catch-up's one request only writes the texts; the copy becomes her
        // state whatever comes back.

        /**
         * What she'd have sent from `from` to `to`: { events, state, guidance, quiet }. Each
         * event is { at, type, note (what may be on her mind then), media }, only the last
         * `days` of them, at most `max`, the latest kept (the earlier ones still move the
         * sequence on). `state` is where hers would be by `to`, the day's count with it
         * (`_daily`); `guidance`, how the texts are written (null for none); `quiet`, why
         * there are none (quietReason).
         */
        function simulateAway(characterKey, char, { from, to, days = 3, max = 30 }) {
            const state = JSON.parse(JSON.stringify(getProactiveConversationState(characterKey)));
            const history = [...((settings().chatHistory || {})[characterKey] || [])];
            const config = getMergedProactiveConfig(characterKey, char);
            const charName = char?.name || characterKey;
            const userName = api.getUserName ? api.getUserName() : 'the user';
            const windowFrom = Math.max(from, to - days * 86400000);
            let counter = settings().proactiveDaily ? { ...settings().proactiveDaily } : null;
            let limited = false;
            const events = [];
            ensureSeq(state, characterKey, history);
            for (let guard = 0; guard < 200000 && config?.enabled !== false; guard++) {
                const at = nextDue(state);
                if (!at || at > to) break;
                const hold = holdAt({ characterKey, state, at, away: true, counter });
                if (hold) {
                    if (hold.why === 'limit' && at > windowFrom) limited = true;
                    putOff(state, Math.max(hold.until, at + 1000));
                    continue;
                }
                const parted = partedFirst(state);
                const topic = parted ? partedTopic() : topicAt({ history, state, config, now: new Date(at), away: true });
                counter = spendDaily(counter, at);
                events.push({ at, type: topic?.type || 'checkin', note: topic?.prompt || '', media: topic ? mediaHint(topic.type) : '' });
                history.push({ is_user: false, mes: '', send_date: at, meta: { proactive: true, proactiveType: topic?.type || 'checkin' } });
                noteSent(state, true, topic?.type || 'checkin', at);
                noteRecalled(state, topic, at);
                const emotion = api.getEmotionState(undefined, at);
                if (emotion) state.lastEmotionSnapshot = strongestFeeling(emotion);
                planNext(state, characterKey, at);
            }
            delete state._ghostWindow;
            state._daily = counter;
            const kept = events.filter(e => e.at > windowFrom).slice(-max);
            return {
                events: kept, state,
                guidance: kept.length ? Rounds.catchUpGuidance({ charName, userName }) : null,
                quiet: kept.length ? null : { why: limited ? 'limit' : 'none' },
            };
        }

        // What of a catch-up's state becomes the character's
        const SIMULATED = ['seq', 'unanswered', 'triggerHistory', 'lastProactiveAt', 'lastCharacterMessageAt', 'lastOutboundType', 'parted',
            'lastEmotionSnapshot', 'ghost', 'recalled'];

        /**
         * A catch-up's simulated state becomes the character's, texts written or not (so the gap
         * isn't caught up on twice), and its day's count the day's. You texted meanwhile: her
         * sequence waits for her next message, and nothing's left after parting.
         */
        function adoptSimulation(characterKey, simState) {
            const state = getProactiveConversationState(characterKey);
            if (!state || !simState) return;
            for (const field of SIMULATED) if (field in simState) state[field] = simState[field];
            delete state.round;
            const daily = simState._daily;
            if (daily && daily.day >= (settings().proactiveDaily?.day || '')) settings().proactiveDaily = daily;
            if (state.lastUserMessageAt > (simState.lastUserMessageAt || 0)) { state.seq = null; state.unanswered = 0; state.parted = null; }
            api.saveSettings();
            armProactiveTimer();
        }

        // ============================================================
        // LIVE
        // ============================================================

        /**
         * Her next text, when it's due now (the open character; in a group, a member): held
         * back by holdAt (moved to when that's over), else written in its own request, a
         * moment's "typing", then sent. You texting meanwhile drops it; the chat changed
         * (cleared, replaced, another one open) leaves it be. Returns whether one went out.
         */
        async function runSequenceFor(char, characterKey) {
            // Not right after the page loads: no "typing" flash on a character being opened
            if (Date.now() - schedulerStartedAt < 90_000) return false;
            if (proactiveGenerationLocks.has(characterKey) || api.getIsGenerating()) return false;
            const s = settings();
            // They haven't seen your texts yet (Daily Life), or a catch-up is due: not now
            if (s.pendingReplies?.[characterKey]) return false;
            if (api.catchUpPending?.(characterKey)) return false;

            const inGroup = !!(api.isGroupSession && api.isGroupSession());
            const inCombine = inGroup && !!(api.isCombineMode && api.isCombineMode());
            const groupId = inGroup ? (api.getCurrentGroupId ? api.getCurrentGroupId() : null) : null;
            if (inGroup && !groupId) return false;
            const readHistory = () => inGroup
                ? (inCombine ? (api.getCombineHistory ? api.getCombineHistory(groupId) : []) : (api.getGroupChatHistory ? api.getGroupChatHistory(groupId, characterKey) : []))
                : ((s.chatHistory && s.chatHistory[characterKey]) || []);
            const history = readHistory();
            if (!history.length) return false;
            const target = { group: inGroup ? groupId : null, combine: inCombine, key: inCombine ? null : characterKey };
            const stillOpen = () => (inGroup
                ? !!(api.isGroupSession && api.isGroupSession()) && api.getCurrentGroupId?.() === groupId && !!api.isCombineMode?.() === inCombine
                : !(api.isGroupSession && api.isGroupSession()) && api.getCharacterKey() === characterKey);

            const state = getProactiveConversationState(characterKey);
            if (!state) return false;
            syncProactiveStateWithHistory(characterKey, history);
            const config = getMergedProactiveConfig(characterKey, char);
            if (!followUpsOn() || config?.enabled === false) return false;
            ensureSeq(state, characterKey, history);
            const now = Date.now();
            const due = nextDue(state);
            if (!due || due > now) return false;
            // The text after parting, left too late: dropped (the sequence goes on)
            if (partedFirst(state) && now - state.parted.at >= Rounds.PARTED_LATE_MS) { state.parted = null; api.saveSettings(); return false; }
            const hold = holdAt({ characterKey, state, at: now });
            if (hold) { putOff(state, Math.max(hold.until, now + 1000)); api.saveSettings(); return false; }

            const parted = partedFirst(state);
            const topic = parted ? partedTopic() : topicAt({ history, state, config, now: new Date(now) });
            s.proactiveDaily = spendDaily(s.proactiveDaily, now);
            if (parted) state.parted = null;
            const plan = state.seq;
            const anchor = history[history.length - 1];
            proactiveGenerationLocks.add(characterKey);
            try {
                const reply = await writeOutreach(char, characterKey, history, topic, target, stillOpen);
                // Another chat open by the time it was put together: tried again when it's back
                if (!reply) return false;
                // You texted while it was written: it's dropped, your text starts things over
                if (state.seq !== plan || state.lastUserMessageAt > now) return false;
                if (!reply.mes) { planNext(state, characterKey, now); return false; }
                const showing = () => stillOpen() && (!inGroup || api.getActiveGroupCharKey() === characterKey);
                if (api.isPanelOpen() && showing()) api.setTypingIndicatorVisible(true);
                await new Promise(resolve => setTimeout(resolve, Math.min(Math.max(reply.mes.length * 40, 1500), 6000)));
                api.setTypingIndicatorVisible(false);
                if (state.seq !== plan || state.lastUserMessageAt > now) return false;
                // The chat cleared or replaced meanwhile: left that way
                const latest = readHistory();
                if (!latest.includes(anchor)) return false;

                captureEmotionSnapshot(characterKey, api.getEmotionState(characterKey));
                const outbound = {
                    is_user: false, mes: reply.mes, send_date: Date.now(),
                    meta: { proactive: true, proactiveType: topic?.type || 'checkin' },
                    ...(reply.mood ? { mood: reply.mood } : {}),
                    ...(reply.life ? { life: reply.life } : {}),
                    // Combined mode needs charName + charKey for bubble attribution in renderMessages
                    ...(inCombine ? { charName: char.name || characterKey, charKey: characterKey } : {}),
                };
                const newHistory = [...latest, outbound];
                if (inGroup) {
                    if (inCombine) api.saveCombineHistory?.(groupId, newHistory);
                    else api.saveGroupChatHistory?.(groupId, characterKey, newHistory);
                } else {
                    if (!s.chatHistory) s.chatHistory = {};
                    s.chatHistory[characterKey] = newHistory;
                }
                markProactiveCharacterActivity(characterKey, true, outbound.meta.proactiveType, outbound.send_date);
                noteRecalled(getProactiveConversationState(characterKey), topic, outbound.send_date);
                if (api.isPanelOpen() && showing()) {
                    api.renderMessages(newHistory);
                    api.setFabUnreadIndicator(false);
                    if ((reply.mood || reply.life) && characterKey === api.getCharacterKey()) api.noteMoodReport();
                } else if (inGroup && stillOpen() && api.isPanelOpen() && api.markGroupCharUnread) {
                    api.markGroupCharUnread(characterKey);
                } else {
                    api.setFabUnreadIndicator(true);
                }
                return true;
            } catch (err) {
                // Failed (an error, an empty answer, a stream gone silent): the next one is planned from now
                api.warn('Proactive text failed:', err);
                if (state.seq === plan) planNext(state, characterKey, now);
                return false;
            } finally {
                api.setTypingIndicatorVisible(false);
                proactiveGenerationLocks.delete(characterKey);
                api.saveSettings();
                armProactiveTimer();
            }
        }

        async function runProactiveSchedulerTick() {
            if (!followUpsOn()) return;
            if (api.isGroupSession && api.isGroupSession() && api.getGroupMemberKeys) {
                const members = api.getGroupMemberKeys()
                    .map(key => ({ key, char: api.getGroupMemberByKey ? api.getGroupMemberByKey(key) : null }))
                    .filter(m => m.char);
                if (api.isCombineMode && api.isCombineMode()) {
                    // One shared history: one text a tick, whoever's has been due longest first
                    const dueOf = key => nextDue(settings().proactiveState?.[key] || {}) || Infinity;
                    members.sort((a, b) => dueOf(a.key) - dueOf(b.key));
                    for (const { key, char } of members) if (await runSequenceFor(char, key)) break;
                } else {
                    for (const { key, char } of members) await runSequenceFor(char, key);
                }
                return;
            }
            const char = api.getCurrentCharacter();
            const characterKey = api.getCharacterKey();
            if (char && characterKey) await runSequenceFor(char, characterKey);
            armProactiveTimer();
        }

        /** A catch-up's one request: kept apart from the day's count, which its simulated texts already make. */
        function noteCatchUpRequest() {}

        // ============================================================
        // SCHEDULER LIFECYCLE
        // ============================================================

        function stopProactiveScheduler() {
            if (proactiveSchedulerHandle) {
                clearInterval(proactiveSchedulerHandle);
                proactiveSchedulerHandle = null;
            }
            clearTimeout(seqTimer);
            seqTimer = null;
        }

        function startProactiveScheduler() {
            stopProactiveScheduler();

            if (settings().proactiveMessagingEnabled !== true) return;

            // Record startup time — runSequenceFor uses this to suppress
            // the initial eager tick that caused the typing indicator flash.
            schedulerStartedAt = Date.now();

            const tickMinutes = Math.max(1, Number(settings().proactiveTickMinutes || 2));
            proactiveSchedulerHandle = setInterval(() => runProactiveSchedulerTick(), tickMinutes * 60 * 1000);

            // The initial tick is deliberately delayed by 90 s (the same guard
            // window) so there is NO flash even if the guard were ever removed.
            setTimeout(() => runProactiveSchedulerTick(), 90_000);
            // A text planned from before (the page reloaded) picks up again
            armProactiveTimer();
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
            ensureSeq(state, characterKey, history);
            const due = nextDue(state);
            const hold = due ? holdAt({ characterKey, state, at: Math.max(due, nowTs) }) : null;
            const until = ms => new Date(ms).toTimeString().slice(0, 5);
            const unanswered = state.unanswered ? ` · ${state.unanswered} unanswered` : '';
            const HOLDS = { together: 'With you', story: 'Paused during story', asleep: 'Asleep', busy: 'Busy', limit: `Daily limit reached (${dailyLimit()})` };

            let next = 'No text planned';
            if (settings().proactiveMessagingEnabled !== true) {
                next = 'Proactive messaging is currently paused';
            } else if (!config.enabled) {
                next = 'This character is not configured for proactive pings';
            } else if (ghostInfo) {
                next = `Ghosting (~${formatHoursDuration(ghostInfo.remainingHours)} remaining — ${ghostInfo.emotionLabel})`;
            } else if (!history.length) {
                next = 'No messages yet — start a conversation first';
            } else if (!due) {
                next = 'Waiting to reply';
            } else if (hold) {
                next = `${HOLDS[hold.why] || 'Held'} until ${until(hold.until)}${unanswered}`;
            } else {
                const what = partedFirst(state) ? 'After parting' : 'Next text';
                next = `${what} ${due > nowTs ? `in ${formatHoursDuration((due - nowTs) / 3600000)}` : 'due'}${unanswered}`;
            }

            // The six kinds of topic as the picker sees them now, whatever holds it back
            const day = typeof api.getDailyLife === 'function' ? api.getDailyLife() : null;
            const { kinds } = topicKindsAt({ history, state, now, day });
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
            // What she'd send now, whatever the wait
            const trigger = topicAt({ history: api.getChatHistory(), state, config, now: new Date() });

            jQuery('#et_trigger_message').prop('disabled', true).addClass('et-btn-loading');

            proactiveGenerationLocks.add(characterKey);
            try {
                if (api.isPanelOpen() && api.getCharacterKey() === characterKey) api.setTypingIndicatorVisible(true);

                // The chat it's for, and the last message it saw
                const target = api.chatTarget();
                const history = api.getChatHistory(target);
                const anchor = history[history.length - 1] || null;
                const reply = await writeOutreach(char, characterKey, history, trigger, target);
                if (!reply?.mes) return;
                // Cleared or replaced meanwhile: left that way
                const latest = api.getChatHistory(target);
                if (anchor && !latest.includes(anchor)) return;

                // Capture emotion snapshot for mood_follow_up
                captureEmotionSnapshot(characterKey, api.getEmotionState(characterKey));

                const outbound = {
                    is_user: false,
                    mes: reply.mes,
                    send_date: Date.now(),
                    meta: { proactive: true, proactiveType: trigger?.type || 'checkin' },
                    ...(reply.mood ? { mood: reply.mood } : {}),
                    ...(reply.life ? { life: reply.life } : {})
                };
                const newHistory = [...latest, outbound];
                api.saveChatHistory(newHistory, target);
                markProactiveCharacterActivity(characterKey, true, outbound.meta.proactiveType, outbound.send_date);
                noteRecalled(getProactiveConversationState(characterKey), trigger, outbound.send_date);

                if (api.isPanelOpen() && api.isViewing(target)) {
                    api.renderMessages(newHistory);
                    api.setFabUnreadIndicator(false);
                    if (reply.mood || reply.life) api.noteMoodReport();
                } else {
                    api.setFabUnreadIndicator(true);
                }

                const type = outbound.meta.proactiveType;
                const prettyType = PRETTY_TYPE[type] || type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
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
            // For tests: the default templates and the topics there are
            getDefaultProactiveConfigForCharacter,
            buildProactiveTriggerPrompt,
            topicAt,
            mediaHint,
            replyFormat,
            // The sequence: the open character's timer (after a character switch), the text after parting, the live run
            armProactiveTimer,
            planParted,
            runProactiveSchedulerTick,
            runSequenceFor,
            // Catch-up (lib/catch-up.js, index.js maybeCatchUp)
            simulateAway,
            adoptSimulation,
            noteCatchUpRequest,
        };
    }

    window.EchoTextProactiveMessaging = { createProactiveMessaging };
})();
