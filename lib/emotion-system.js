(function () {
    'use strict';

    /**
     * EchoText Emotion System
     *
     * Where the character's feelings and personality are kept, the popup that
     * edits them, the status chip under the name, the texting-style prompt and the
     * reply timing and proactive pace they drive. The data itself is lib/emotion-model.js, how it
     * changes the texting is lib/texting-behavior.js; the plan is docs/emotion-plan.md.
     *
     *   settings.emotionMode           'off' | 'manual' | 'auto'
     *   settings.nsfwEnabled           shows and uses Desire
     *   settings.characterProfiles[k]  per character: Big Five, Morality, locks, texting style
     *   settings.verbosityByCharacter[k] per character: reply length (Personality tab; else settings.verbosityDefault)
     *   settings.emotionState[k]       per chat: { start, startAt }
     *   msg.mood                       Auto mode: what a reply's <mood> line reported
     *   settings.characterSchedules[k] Daily Life: the character's week (lib/daily-life.js), on the Schedule tab
     *
     * In Auto mode the values are replayed from the chat's replies each time, so a
     * deleted, regenerated or swiped reply takes its report with it.
     */

    const Model = window.EchoTextEmotionModel;
    const Behavior = window.EchoTextTextingBehavior;
    const Icons = window.EchoTextEmotionIcons;
    const DailyLife = window.EchoTextDailyLife;

    const MODE_LABELS = { off: 'Off', manual: 'Manual', auto: 'Auto' };
    // The status chip when no feeling is above 0
    const NEUTRAL = { label: 'Neutral', svg: 'neutral', color: '#b4b4c4' };
    const LEVEL_LABELS = { low: 'Low', mid: 'Mid', high: 'High' };
    const VERBOSITY_LABELS = { short: 'Short', medium: 'Medium', long: 'Long' };
    const STYLE_TYPE_LABELS = { instruction: 'Instruction', example: 'Examples' };
    const STYLE_PLACEHOLDERS = {
        instruction: 'e.g. all lowercase, barely any punctuation, says "lol" a lot',
        example: 'A few texts the way they\'d write them, one per line',
    };

    const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
    const escapeHtml = value => String(value ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    const iconHtml = Icons.iconHtml;

    function createEmotionSystem(api) {
        // api: getSettings, saveSettings, getCharacterKey, getCharacterName, isPanelOpen, isMobileDevice, onEmotionStateUpdated,
        //      getChatHistory(key) (a character's chat, whose replies carry Auto mode's reports),
        //      generateSchedule({ signal }) (drafts and keeps the current character's week; rejects when it can't),
        //      scheduleTimeoutMs (tests only: how long a draft may take)

        function settings() { return api.getSettings(); }
        function getMode() { return Model.MODES.includes(settings().emotionMode) ? settings().emotionMode : 'manual'; }
        function nsfwOn() { return settings().nsfwEnabled === true; }
        function dailyLifeOn() { return settings().dailyLifeEnabled === true; }

        function getSchedule(key = api.getCharacterKey()) {
            return DailyLife.normalizeSchedule(key ? settings().characterSchedules?.[key] : null);
        }

        /** In Auto mode, what the values are replayed from: the chat and the time now. */
        function replayInput(key) {
            return getMode() === 'auto' ? { history: api.getChatHistory?.(key) || [], now: Date.now() } : {};
        }

        // ── Storage ─────────────────────────────────────────────────────────────

        function getProfile(key = api.getCharacterKey()) {
            const s = settings();
            if (!isObject(s.characterProfiles)) s.characterProfiles = {};
            return Model.normalizeProfile(key ? s.characterProfiles[key] : null);
        }

        function saveProfile(profile, key = api.getCharacterKey()) {
            if (!key) return;
            settings().characterProfiles[key] = profile;
            api.saveSettings();
        }

        /** The chat's state; an old-format or missing one is replaced by a fresh one. */
        function getChatState(key = api.getCharacterKey()) {
            const s = settings();
            if (!isObject(s.emotionState)) s.emotionState = {};
            const state = Model.normalizeChatState(key ? s.emotionState[key] : null, Date.now());
            if (key) s.emotionState[key] = state;
            return state;
        }

        function saveChatState(state, key = api.getCharacterKey()) {
            if (!key) return;
            settings().emotionState[key] = state;
            api.saveSettings();
        }

        function getValues(key = api.getCharacterKey(), nsfw = nsfwOn()) {
            return Model.computeState({ chat: getChatState(key), profile: getProfile(key), nsfw, ...replayInput(key) });
        }

        /** Auto mode: what the latest reply's <mood> line changed ({ id: delta }), or null. */
        function getLastChange(key = api.getCharacterKey()) {
            if (getMode() !== 'auto') return null;
            return Model.lastChange({ chat: getChatState(key), profile: getProfile(key), nsfw: nsfwOn(), ...replayInput(key) });
        }

        /** The character's current values, or null while emotions are off. */
        function getEmotionState() {
            return getMode() === 'off' ? null : getValues();
        }

        /** The chat's state as an archive saves it. */
        function getEmotionSnapshot() {
            return JSON.parse(JSON.stringify(getChatState()));
        }

        /** A cleared chat starts from 0; locks belong to the character and stay. */
        function clearEmotionState() {
            const key = api.getCharacterKey();
            if (!key) return;
            saveChatState(Model.normalizeChatState(null, Date.now()), key);
        }

        // ── Edits ───────────────────────────────────────────────────────────────

        /**
         * The chat's state starting over from the values as they are now: an edit in
         * Auto mode keeps the reports so far in without replaying them on top of it.
         * Locked feelings keep their own start; Desire keeps its own with NSFW off.
         */
        function freeze(key = api.getCharacterKey()) {
            const state = getChatState(key);
            const values = getValues(key, true);
            const { locks } = getProfile(key);
            for (const id of Model.DIMENSION_IDS) if (!(id in locks)) state.start[id] = values[id];
            state.startAt = Date.now();
            return state;
        }

        function setValue(id, value) {
            if (id in getProfile().locks) return;
            const state = freeze();
            state.start[id] = Model.clampValue(value, id);
            saveChatState(state);
        }

        /** Locking keeps the current value for this character; unlocking hands it back to the chat. */
        function toggleLock(id) {
            const profile = getProfile();
            if (id in profile.locks) {
                const state = freeze();
                state.start[id] = profile.locks[id];
                delete profile.locks[id];
                saveChatState(state);
            } else {
                profile.locks[id] = getValues()[id];
            }
            saveProfile(profile);
        }

        function resetUnlocked() {
            const locks = getProfile().locks;
            const state = getChatState();
            for (const id of Model.DIMENSION_IDS) if (!(id in locks)) state.start[id] = 0;
            state.startAt = Date.now();
            saveChatState(state);
        }

        /** Switching mode keeps every chat's values as they are (Auto mode's reports included). */
        function setMode(mode) {
            if (!Model.MODES.includes(mode) || mode === getMode()) return;
            for (const key of Object.keys(settings().emotionState || {})) freeze(key);
            settings().emotionMode = mode;
            api.saveSettings();
            refresh();
        }

        function setTrait(id, level) {
            const profile = getProfile();
            if (id === Model.MORALITY.id) profile.morality = level;
            else profile.bigFive[id] = level;
            saveProfile(profile);
        }

        /** The character's reply length: their own, else the default in the settings. */
        function getVerbosity(key = api.getCharacterKey()) {
            const own = key ? settings().verbosityByCharacter?.[key] : null;
            if (VERBOSITY_LABELS[own]) return own;
            return VERBOSITY_LABELS[settings().verbosityDefault] ? settings().verbosityDefault : 'medium';
        }

        function setVerbosity(level, key = api.getCharacterKey()) {
            if (!key || !VERBOSITY_LABELS[level]) return;
            const s = settings();
            if (!isObject(s.verbosityByCharacter)) s.verbosityByCharacter = {};
            s.verbosityByCharacter[key] = level;
            api.saveSettings();
        }

        function setTextingStyle(changes) {
            const profile = getProfile();
            profile.textingStyle = { ...profile.textingStyle, ...changes };
            saveProfile(profile);
        }

        // ── Prompt ──────────────────────────────────────────────────────────────

        /** The character's texting style for the system prompt, or ''. */
        function buildTextingStyleContext(key, charName) {
            const { type, text } = getProfile(key).textingStyle;
            if (!text.trim()) return '';
            if (type === 'example') {
                return `\n\n<texting_style_reference>\nThe following messages show how ${charName} texts. Use these as a stylistic reference ONLY — do NOT copy, repeat, or reproduce any of these examples verbatim in your replies:\n\n${text.trim()}\n</texting_style_reference>`;
            }
            return `\n\n<texting_style>\n${charName} texts in this style: ${text.trim()}\n</texting_style>`;
        }

        /**
         * How the character texts right now, for the system prompt: the NSFW
         * permission, the behavior block and the reply length it moves to. With
         * emotions off only the Big Five count.
         */
        function buildBehaviorContext(key, { charName, userName, features, verbosity }) {
            const { bigFive, morality } = getProfile(key);
            const { text, verbosity: shifted } = Behavior.buildBehavior({
                bigFive, morality,
                values: getMode() === 'off' ? null : getValues(key),
                features, verbosity, nsfw: nsfwOn(), charName, userName,
            });
            const nsfw = nsfwOn() ? `\n\n${Behavior.nsfwPermission(charName)}` : '';
            return { nsfw, text, verbosity: shifted };
        }

        /** Auto mode's rule for the <mood> line, for after the format rules; '' in the other modes. */
        function buildMoodRules(key, { charName, userName }) {
            if (getMode() !== 'auto') return '';
            const profile = getProfile(key);
            const values = getValues(key);
            const ids = Model.activeDimensions({ nsfw: nsfwOn() }).map(d => d.id);
            return `\n\n${Behavior.moodRules({
                values: Object.fromEntries(ids.map(id => [id, values[id]])),
                fixed: ids.filter(id => id in profile.locks),
                steps: Model.reportSteps(profile),
                first: !Model.hasReport(api.getChatHistory?.(key)),
                charName, userName,
            })}`;
        }

        /**
         * A reply as it is kept: its text without the <mood> line, and in Auto mode
         * the feelings that line reports, for msg.mood (null otherwise).
         */
        function readReply(text) {
            const { text: mes, mood } = Model.parseMoodTag(text);
            return { mes, mood: getMode() === 'auto' ? mood : null };
        }

        // ── Status chip ─────────────────────────────────────────────────────────

        /**
         * The status row under the name: the strongest feeling, or Neutral in the
         * same kind of chip. Rapport and Romance don't count: they are the relationship.
         */
        function buildStatusHtml() {
            if (getMode() === 'off') return '<span class="et-status-placeholder">Emotions off</span>';
            const top = Model.strongest(getValues(), { nsfw: nsfwOn(), feelingsOnly: true });
            const dim = top ? top.dim : NEUTRAL;
            const title = top ? `${dim.label}: ${top.value}` : dim.label;
            return `<span class="et-status-chip et-status-chip-emotion" style="--emo-color:${dim.color}" title="${title}"><span class="et-status-emotion-icon" style="color:${dim.color}">${iconHtml(dim)}</span><span class="et-status-main">${dim.label}</span></span>`;
        }

        let lastStrongestId = null;

        /** Tells index.js to redraw the status row, and whether the strongest feeling changed. */
        function updateEmotionIndicator() {
            if (!api.isPanelOpen()) return;
            const top = getMode() === 'off' ? null : Model.strongest(getValues(), { nsfw: nsfwOn(), feelingsOnly: true });
            const id = top ? top.dim.id : null;
            const dominantChanged = lastStrongestId !== null && id !== null && id !== lastStrongestId;
            lastStrongestId = id;
            if (typeof api.onEmotionStateUpdated === 'function') {
                api.onEmotionStateUpdated({ dominant: top ? top.dim : null, dominantChanged });
            }
        }

        let burstTimer = null;

        /**
         * Redraws the status row, and the open popup when what it shows has changed:
         * in Auto mode a new, deleted or swiped reply moves the values.
         */
        function refresh() {
            updateEmotionIndicator();
            if (document.getElementById('et-emotion-popup') && popupSignature() !== renderedSignature) renderPopup();
        }

        /**
         * After a reply with a <mood> or <life> line: what the first changed, as chips under the header
         * and on the open popup's rows; what the second touched, lit on the Life tab.
         */
        function noteReport() {
            refresh();
            flashLifeChange();
            const change = getLastChange();
            if (!change) return;
            showEmotionDeltaBurst(change);
            flashChanges(change);
        }

        /**
         * A brief strip of chips below the panel header showing which feelings changed
         * and which way ({ id: delta }). For Auto mode's reports.
         */
        function showEmotionDeltaBurst(changes) {
            if (!api.isPanelOpen() || getMode() === 'off' || !isObject(changes)) return;
            const entries = Object.entries(changes)
                .filter(([id, d]) => Model.DIMENSION_IDS.includes(id) && Math.abs(d) > 0.5)
                .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))
                .slice(0, 3);
            if (!entries.length) return;

            if (burstTimer) { clearTimeout(burstTimer); burstTimer = null; }
            jQuery('#et-emo-burst').remove();
            const headerH = jQuery('#et-panel-drag-handle').outerHeight() || 70;
            const chips = entries.map(([id, delta], i) => {
                const dim = Model.DIMENSIONS.find(d => d.id === id);
                const up = delta > 0;
                return `<span class="et-emo-burst-chip" style="--burst-color:${dim.color};animation-delay:${i * 60}ms" title="${dim.label}: ${up ? '+' : ''}${Math.round(delta)}"><span class="et-emo-burst-icon" style="color:${dim.color}">${iconHtml(dim)}</span><i class="fa-solid ${up ? 'fa-arrow-up' : 'fa-arrow-down'} et-emo-burst-arrow ${up ? 'et-emo-burst-up' : 'et-emo-burst-down'}"></i></span>`;
            }).join('');
            jQuery('#et-panel').append(`<div id="et-emo-burst" class="et-emo-burst" style="top:${headerH + 6}px">${chips}</div>`);
            burstTimer = setTimeout(() => {
                const el = jQuery('#et-emo-burst');
                el.addClass('et-emo-burst-hiding');
                setTimeout(() => el.remove(), 480);
                burstTimer = null;
            }, 3200);
        }

        // ── Popup ───────────────────────────────────────────────────────────────

        let activeTab = 'emotions';

        /** Where a slider's coloured part runs: from 0 to the value (0 is the middle of Rapport's). */
        function sliderFill(id, value) {
            const min = Model.DIMENSIONS.find(d => d.id === id)?.min ?? 0;
            const pct = v => `${Math.round(((v - min) / (100 - min)) * 100)}%`;
            return { from: pct(Math.min(0, value)), to: pct(Math.max(0, value)) };
        }

        const formatValue = v => (v < 0 ? `−${-v}` : `${v}`);

        /**
         * Auto mode: what the last reply changed, to the right of the value for a few
         * seconds (style.css fades it), when the popup opens and when a reply arrives.
         * It sits over the lock, so the rows keep Manual's layout.
         */
        function flashChanges(changes) {
            const popup = document.getElementById('et-emotion-popup');
            if (!popup) return;
            for (const [id, delta] of Object.entries(changes)) {
                const row = popup.querySelector(`[data-emo-dim="${id}"]`)?.closest('.et-emo-row');
                if (!row) continue;
                const up = delta > 0;
                const flash = jQuery(`<span class="et-emo-flash ${up ? 'et-emo-flash-up' : 'et-emo-flash-down'}"><i class="fa-solid ${up ? 'fa-arrow-up' : 'fa-arrow-down'}"></i>${Math.abs(delta)}</span>`);
                jQuery(row).append(flash);
                setTimeout(() => flash.remove(), 3300);
            }
        }

        function segmented(items, current, attr, extraClass = '') {
            return `<div class="et-emo-seg${extraClass}">${items.map(([value, label]) =>
                `<button type="button" class="et-emo-seg-btn${value === current ? ' et-emo-seg-on' : ''}" ${attr}="${value}">${label}</button>`).join('')}</div>`;
        }

        function emotionsPanel() {
            const mode = getMode();
            const modeSwitch = segmented(Model.MODES.map(m => [m, MODE_LABELS[m]]), mode, 'data-emo-mode');
            if (mode === 'off') return modeSwitch;

            const values = getValues();
            const locks = getProfile().locks;
            const dims = Model.activeDimensions({ nsfw: nsfwOn() });
            const groups = Model.GROUPS.map(group => {
                const rows = dims.filter(d => d.group === group.id).map(dim => {
                    const locked = dim.id in locks;
                    const value = values[dim.id];
                    const fill = sliderFill(dim.id, value);
                    return `<div class="et-emo-row${locked ? ' et-emo-locked' : ''}" style="--emo-color:${dim.color}">`
                        + `<span class="et-emo-icon" style="color:${dim.color}">${iconHtml(dim)}</span>`
                        + `<span class="et-emo-label">${dim.label}</span>`
                        + `<input type="range" class="et-emo-slider et-slider" min="${dim.min ?? 0}" max="100" step="5" value="${value}" style="--emo-from:${fill.from};--emo-to:${fill.to}" data-emo-dim="${dim.id}"${locked ? ' disabled' : ''}>`
                        + `<span class="et-emo-val">${formatValue(value)}</span>`
                        + `<button type="button" class="et-emo-lock" data-emo-lock="${dim.id}" title="${locked ? 'Unlock' : 'Lock for this character'}"><i class="fa-solid ${locked ? 'fa-lock' : 'fa-lock-open'}"></i></button>`
                        + `</div>`;
                }).join('');
                return rows ? `<div class="et-emo-group-label">${group.label}</div>${rows}` : '';
            }).join('');
            return modeSwitch + groups;
        }

        function personalityPanel() {
            const { bigFive, morality, textingStyle } = getProfile();
            // The Big Five, then Morality while NSFW is on
            const rows = [...Model.BIG_FIVE.map(trait => [trait, bigFive[trait.id]]), ...(nsfwOn() ? [[Model.MORALITY, morality]] : [])];
            const traits = rows.map(([trait, level]) =>
                `<div class="et-emo-row" style="--emo-color:${trait.color}">`
                + `<span class="et-emo-icon" style="color:${trait.color}">${iconHtml(trait)}</span>`
                + `<span class="et-emo-label">${trait.label}</span>`
                + segmented(Model.LEVELS.map(l => [l, LEVEL_LABELS[l]]), level, `data-emo-trait="${trait.id}" data-emo-level`, ' et-emo-seg-sm')
                + `</div>`).join('');
            return traits
                + `<div class="et-emo-group-label">Reply length</div>`
                + segmented(Object.entries(VERBOSITY_LABELS), getVerbosity(), 'data-emo-verbosity')
                + `<div class="et-emo-group-label">Texting style</div>`
                + segmented(Model.TEXTING_STYLE_TYPES.map(t => [t, STYLE_TYPE_LABELS[t]]), textingStyle.type, 'data-emo-style-type')
                + `<textarea class="et-emo-style-text" rows="3" placeholder="${escapeHtml(STYLE_PLACEHOLDERS[textingStyle.type])}">${escapeHtml(textingStyle.text)}</textarea>`;
        }

        // Daily Life: the day the Schedule tab shows (null: today's), what is being edited
        // ({ key, kind: 'block' | 'errand' | 'entry', day (blocks), index }, index -1 for a new
        // one; Schedule and Life tabs), each character's week being drafted
        // (its AbortController), and Regenerate waiting for its second click
        let scheduleDay = null;
        let editing = null;
        const drafting = new Map();
        let regenerateArmed = false;
        let regenerateTimer = null;
        // A draft that hasn't come back by then gives up
        const DRAFT_TIMEOUT_MINUTES = 5;

        function blockEditor(block, index) {
            return `<div class="et-sched-edit">`
                + `<div class="et-sched-edit-times"><input type="time" class="et-sched-in" data-emo-field="from" value="${block.from}">`
                + `<span>–</span><input type="time" class="et-sched-in" data-emo-field="to" value="${block.to}"></div>`
                + `<input type="text" class="et-sched-in" data-emo-field="doing" placeholder="Doing" value="${escapeHtml(block.doing)}">`
                + `<input type="text" class="et-sched-in" data-emo-field="place" placeholder="Place" value="${escapeHtml(block.place)}">`
                + segmented(DailyLife.PHONES.map(p => [p.id, `<i class="fa-solid ${p.icon}"></i> ${p.label}`]), block.phone, 'data-emo-phone', ' et-emo-seg-sm')
                + `<div class="et-sched-edit-actions">`
                + (index >= 0 ? `<button type="button" class="et-sched-delete" data-emo-action="delete-block" title="Delete"><i class="fa-solid fa-trash"></i></button>` : '')
                + `<button type="button" class="et-emo-reset" data-emo-action="cancel-block">Cancel</button>`
                + `<button type="button" class="et-sched-save" data-emo-action="save-block">Save</button>`
                + `</div></div>`;
        }

        /** A new block starts where the day's last one ends, for an hour. */
        function newBlock(blocks) {
            const from = blocks.length ? blocks[blocks.length - 1].to : '09:00';
            const end = (DailyLife.minutesOf(from) + 60) % (24 * 60);
            const to = `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
            return { from, to, place: '', doing: '', phone: 'free' };
        }

        function schedulePanel() {
            const key = api.getCharacterKey();
            if (drafting.has(key)) {
                return `<div class="et-sched-empty et-sched-drafting"><i class="fa-solid fa-spinner fa-spin"></i>`
                    + `<button type="button" class="et-emo-reset" data-emo-action="cancel-schedule">Cancel</button></div>`;
            }
            if (editing && editing.key !== key) editing = null;
            const schedule = getSchedule(key);
            const date = new Date();
            const day = scheduleDay || DailyLife.dayOf(date);
            const now = DailyLife.blockAt(schedule, date);
            const rows = schedule[day].map((block, index) => {
                if (editing?.kind === 'block' && editing.day === day && editing.index === index) return blockEditor(block, index);
                const phone = DailyLife.PHONES.find(p => p.id === block.phone);
                const current = now && now.day === day && now.index === index;
                return `<div class="et-sched-row${current ? ' et-sched-now' : ''}" data-emo-block="${index}">`
                    + `<span class="et-sched-time">${block.from}–${block.to}</span>`
                    + `<span class="et-sched-what"><span class="et-sched-doing">${escapeHtml(block.doing)}</span>`
                    + (block.place ? `<span class="et-sched-place">${escapeHtml(block.place)}</span>` : '') + `</span>`
                    + `<span class="et-sched-phone et-sched-${phone.id}" title="${phone.label}"><i class="fa-solid ${phone.icon}"></i></span>`
                    + `</div>`;
            }).join('');
            const adding = editing?.kind === 'block' && editing.day === day && editing.index === -1;
            const generate = !DailyLife.hasSchedule(schedule) && !editing
                ? `<div class="et-sched-empty"><button type="button" class="et-sched-generate" data-emo-action="generate-schedule"><i class="fa-solid fa-wand-magic-sparkles"></i><span>Generate</span></button></div>`
                : '';
            return segmented(DailyLife.DAYS.map(d => [d.id, d.label]), day, 'data-emo-day')
                + generate + rows
                + (adding ? blockEditor(newBlock(schedule[day]), -1)
                    : `<button type="button" class="et-sched-add" data-emo-action="add-block"><i class="fa-solid fa-plus"></i><span>Add</span></button>`);
        }

        /** Keeps the edited block (or adds it); a block that starts when it ends is marked and not kept. */
        function saveEditedBlock(editor) {
            const field = name => editor.querySelector(`[data-emo-field="${name}"]`);
            const block = {
                from: field('from').value, to: field('to').value,
                doing: field('doing').value, place: field('place').value,
                phone: editor.querySelector('[data-emo-phone].et-emo-seg-on')?.dataset.emoPhone || 'free',
            };
            const bad = !/^\d{2}:\d{2}$/.test(block.from) || !/^\d{2}:\d{2}$/.test(block.to) || block.from === block.to;
            field('from').classList.toggle('et-sched-in-bad', bad);
            field('to').classList.toggle('et-sched-in-bad', bad);
            if (bad) return;
            const { key, day, index } = editing;
            saveSchedule(DailyLife.withBlock(getSchedule(key), day, index, block), key);
            editing = null;
            renderPopup();
        }

        function saveSchedule(schedule, key = api.getCharacterKey()) {
            if (!key) return;
            const s = settings();
            if (!isObject(s.characterSchedules)) s.characterSchedules = {};
            s.characterSchedules[key] = schedule;
            api.saveSettings();
        }

        // ── Life tab: the chat's errands, what happened, today's change (12b) ──

        /**
         * The chat's life as it stands now: the replies' <life> reports replayed, a week of
         * what happened, today's change on its day.
         */
        function getLife(key = api.getCharacterKey()) {
            return DailyLife.currentLife(key ? settings().lifeState?.[key] : null, new Date(), key ? api.getChatHistory?.(key) : null);
        }

        /** After a reply with a <life> line: what it touched lights up on the open Life tab for a few seconds. */
        function flashLifeChange() {
            const popup = document.getElementById('et-emotion-popup');
            if (!popup || activeTab !== 'life') return;
            const key = api.getCharacterKey();
            const ids = DailyLife.lastLifeChange(settings().lifeState?.[key], api.getChatHistory?.(key));
            for (const id of ids) {
                const el = id === 'today' ? popup.querySelector('[data-emo-life-today]') : popup.querySelector(`[data-emo-life-id="${id}"]`);
                if (!el) continue;
                el.classList.remove('et-life-touched');
                void el.offsetWidth;
                el.classList.add('et-life-touched');
            }
        }

        /** Keeps an edited life as the chat's new start: what has expired is gone from it then. */
        function saveLife(parts, key = api.getCharacterKey()) {
            if (!key) return;
            const s = settings();
            if (!isObject(s.lifeState)) s.lifeState = {};
            s.lifeState[key] = { start: parts, startAt: Date.now() };
            api.saveSettings();
        }

        const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);
        const LIFE_PLACEHOLDERS = { today: 'Change of plan', errand: 'Errand', progress: 'Progress', feeling: 'Feeling', entry: 'What happened' };

        function editActions(index, kind) {
            return `<div class="et-sched-edit-actions">`
                + (index >= 0 ? `<button type="button" class="et-sched-delete" data-emo-action="delete-${kind}" title="Delete"><i class="fa-solid fa-trash"></i></button>` : '')
                + `<button type="button" class="et-emo-reset" data-emo-action="cancel-${kind}">Cancel</button>`
                + `<button type="button" class="et-sched-save" data-emo-action="save-${kind}">Save</button>`
                + `</div>`;
        }

        function errandEditor(errand, index) {
            return `<div class="et-sched-edit" data-emo-edit="errand">`
                + `<input type="text" class="et-sched-in" data-emo-field="text" placeholder="${LIFE_PLACEHOLDERS.errand}" value="${escapeHtml(errand.text)}">`
                + `<input type="text" class="et-sched-in" data-emo-field="progress" placeholder="${LIFE_PLACEHOLDERS.progress}" value="${escapeHtml(errand.progress)}">`
                + `<div class="et-sched-edit-times"><i class="fa-regular fa-calendar"></i><input type="date" class="et-sched-in" data-emo-field="due" value="${errand.due}"></div>`
                + `<input type="text" class="et-sched-in" data-emo-field="feeling" placeholder="${LIFE_PLACEHOLDERS.feeling}" value="${escapeHtml(errand.feeling)}">`
                + editActions(index, 'errand')
                + `</div>`;
        }

        /** The days something that happened can be on: the last week, today included (older ones aren't kept). */
        function entryDays() {
            const date = new Date();
            const first = new Date(date.getFullYear(), date.getMonth(), date.getDate() - (DailyLife.LOG_DAYS - 1));
            return { min: DailyLife.dateKey(first), max: DailyLife.dateKey(date) };
        }

        function entryEditor(entry, index) {
            const { min, max } = entryDays();
            return `<div class="et-sched-edit" data-emo-edit="entry">`
                + `<div class="et-sched-edit-times"><i class="fa-regular fa-calendar"></i><input type="date" class="et-sched-in" data-emo-field="date" min="${min}" max="${max}" value="${entry.date}"></div>`
                + `<input type="text" class="et-sched-in" data-emo-field="text" placeholder="${LIFE_PLACEHOLDERS.entry}" value="${escapeHtml(entry.text)}">`
                + editActions(index, 'entry')
                + `</div>`;
        }

        const isEditing = (kind, index) => editing?.kind === kind && editing.index === index;
        const addButton = kind => `<button type="button" class="et-sched-add" data-emo-action="add-${kind}"><i class="fa-solid fa-plus"></i><span>Add</span></button>`;

        function lifePanel() {
            const key = api.getCharacterKey();
            if (editing && editing.key !== key) editing = null;
            const date = new Date();
            const today = DailyLife.dateKey(date);
            const life = getLife(key);

            // Now: the block of the week they're in, and today's change
            const schedule = getSchedule(key);
            const now = DailyLife.hasSchedule(schedule) ? DailyLife.blockAt(schedule, date) : null;
            const nowLine = now
                ? `<div class="et-sched-row et-sched-now"><span class="et-sched-time">${now.block.from}–${now.block.to}</span>`
                    + `<span class="et-sched-what"><span class="et-sched-doing">${escapeHtml(now.block.doing)}</span>`
                    + (now.block.place ? `<span class="et-sched-place">${escapeHtml(now.block.place)}</span>` : '') + `</span></div>`
                : DailyLife.hasSchedule(schedule) ? `<div class="et-sched-row et-sched-now"><span class="et-sched-time">Free</span></div>` : '';
            const todayInput = `<input type="text" class="et-sched-in et-life-today" data-emo-life-today placeholder="${LIFE_PLACEHOLDERS.today}" value="${escapeHtml(life.today?.text || '')}">`;

            const errands = life.errands.map((errand, index) => {
                if (isEditing('errand', index)) return errandEditor(errand, index);
                const late = errand.due < today;
                const meta = [errand.progress, errand.feeling].filter(Boolean).map(escapeHtml).join(' · ');
                return `<div class="et-sched-row" data-emo-errand="${index}" data-emo-life-id="${escapeHtml(errand.id)}">`
                    + `<span class="et-sched-what"><span class="et-sched-doing">${escapeHtml(errand.text)}</span>`
                    + (meta ? `<span class="et-sched-place">${meta}</span>` : '') + `</span>`
                    + `<span class="et-life-due${late ? ' et-life-late' : ''}">${capitalize(DailyLife.sayDay(errand.due, today))}</span>`
                    + `</div>`;
            }).join('');
            const addingErrand = isEditing('errand', -1);
            const due = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7);
            const errandTail = addingErrand ? errandEditor({ text: '', progress: '', due: DailyLife.dateKey(due), feeling: '' }, -1)
                : life.errands.length < DailyLife.MAX_ERRANDS ? addButton('errand') : '';

            const entries = life.log.map((entry, index) => {
                if (isEditing('entry', index)) return entryEditor(entry, index);
                return `<div class="et-sched-row et-life-entry" data-emo-entry="${index}" data-emo-life-id="${escapeHtml(entry.id)}">`
                    + `<span class="et-sched-time">${capitalize(DailyLife.sayDay(entry.date, today))}</span>`
                    + `<span class="et-sched-what"><span class="et-sched-doing">${escapeHtml(entry.text)}</span></span>`
                    + `</div>`;
            }).join('');
            const entryTail = isEditing('entry', -1) ? entryEditor({ date: today, text: '' }, -1) : addButton('entry');

            return `<div class="et-emo-group-label">Now</div>${nowLine}${todayInput}`
                + `<div class="et-emo-group-label">Errands</div>${errands}${errandTail}`
                + `<div class="et-emo-group-label">Recent</div>${entries}${entryTail}`;
        }

        /** The edited errand or entry from its editor, or null (the bad fields marked) when it can't be kept. */
        function readLifeEditor(editor) {
            const field = name => editor.querySelector(`[data-emo-field="${name}"]`);
            const kind = editor.dataset.emoEdit;
            const required = kind === 'errand' ? ['text', 'due'] : ['date', 'text'];
            const bad = required.filter(name => !field(name).value.trim());
            // What happened is kept for a week: a day outside it would vanish once saved
            const { min, max } = entryDays();
            const day = kind === 'entry' ? field('date').value : '';
            if (day && (day < min || day > max)) bad.push('date');
            required.forEach(name => field(name).classList.toggle('et-sched-in-bad', bad.includes(name)));
            if (bad.length) return null;
            const value = name => field(name).value;
            return kind === 'errand'
                ? { text: value('text'), progress: value('progress'), due: value('due'), feeling: value('feeling') }
                : { date: value('date'), text: value('text') };
        }

        function saveLifeEdit(editor) {
            const item = readLifeEditor(editor);
            if (!item) return;
            const { key, kind, index } = editing;
            const life = getLife(key);
            if (kind === 'errand') {
                // Keep who wrote it and its id when editing
                const before = life.errands[index];
                saveLife(DailyLife.withErrand(life, index, { ...before, ...item, from: before?.from || 'you', id: before?.id }), key);
            } else {
                saveLife(DailyLife.withEntry(life, index, { ...life.log[index], ...item }), key);
            }
            editing = null;
            renderPopup();
        }

        function deleteLifeItem() {
            const { key, kind, index } = editing;
            const life = getLife(key);
            saveLife(kind === 'errand' ? DailyLife.withoutErrand(life, index) : DailyLife.withoutEntry(life, index), key);
            editing = null;
            renderPopup();
        }

        let todaySaveTimer = null;

        function popupInnerHtml() {
            if ((activeTab === 'schedule' || activeTab === 'life') && !dailyLifeOn()) activeTab = 'emotions';
            const tabs = [['emotions', 'fa-heart-pulse', 'Emotions'], ['personality', 'fa-user-pen', 'Personality'],
                ...(dailyLifeOn() ? [['schedule', 'fa-calendar-days', 'Schedule'], ['life', 'fa-list-check', 'Life']] : [])];
            const showReset = activeTab === 'emotions' && getMode() !== 'off';
            const key = api.getCharacterKey();
            const showRegenerate = activeTab === 'schedule' && !drafting.has(key) && DailyLife.hasSchedule(getSchedule(key));
            const panels = { emotions: emotionsPanel, personality: personalityPanel, schedule: schedulePanel, life: lifePanel };
            return `<div class="et-emotion-popup-header">`
                + `<i class="fa-solid fa-heart-pulse" style="color:var(--et-theme-color)"></i>`
                + `<span>${escapeHtml(api.getCharacterName() || 'Character')}</span>`
                + (showReset ? `<button type="button" class="et-emo-reset" data-emo-action="reset" title="Set every unlocked feeling back to 0">Reset</button>` : '')
                + (showRegenerate ? `<button type="button" class="et-emo-reset${regenerateArmed ? ' et-emo-reset-armed' : ''}" data-emo-action="regenerate-schedule">${regenerateArmed ? 'Replace?' : 'Regenerate'}</button>` : '')
                + `<button type="button" class="et-emotion-popup-close" data-emo-action="close" title="Close"><i class="fa-solid fa-xmark"></i></button>`
                + `</div>`
                + `<div class="et-emotion-popup-body">`
                + `<div class="et-emo-tabs">${tabs.map(([id, icon, label]) =>
                    `<button type="button" class="et-emo-tab${id === activeTab ? ' et-emo-tab-active' : ''}" data-emo-tab="${id}"><i class="fa-solid ${icon}"></i><span>${label}</span></button>`).join('')}</div>`
                + panels[activeTab]()
                + `</div>`;
        }

        // The character the open popup shows, and what it showed (refresh() redraws it when that changes)
        let popupKey = null;
        let renderedSignature = null;

        function popupSignature() {
            const shown = activeTab === 'emotions' && getMode() !== 'off';
            const key = api.getCharacterKey();
            const schedule = activeTab === 'schedule' ? [getSchedule(key), drafting.has(key)] : null;
            const life = activeTab === 'life' ? getLife(key) : null;
            return JSON.stringify([key, getMode(), dailyLifeOn(), activeTab, shown ? getValues() : null, schedule, life]);
        }

        function disarmRegenerate() {
            clearTimeout(regenerateTimer);
            regenerateArmed = false;
        }

        /**
         * Drafts the character's week; the tab shows a spinner and Cancel meanwhile, and the
         * week (or what was there) after. It gives up after a few minutes; cancelled, it
         * stops at once and says nothing.
         */
        async function draftSchedule() {
            const key = api.getCharacterKey();
            if (!key || drafting.has(key) || typeof api.generateSchedule !== 'function') return;
            disarmRegenerate();
            editing = null;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(new Error(`no answer after ${DRAFT_TIMEOUT_MINUTES} minutes`)),
                api.scheduleTimeoutMs ?? DRAFT_TIMEOUT_MINUTES * 60000);
            // Stops waiting even if the request itself can't be stopped
            const stopped = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason)));
            drafting.set(key, controller);
            renderPopup();
            try {
                await Promise.race([api.generateSchedule({ signal: controller.signal }), stopped]);
            } catch (err) {
                if (!controller.cancelled) {
                    const reason = controller.signal.aborted ? controller.signal.reason : err;
                    window.toastr?.error(`Could not make a schedule: ${reason?.message || reason}`, 'Echogram');
                }
            } finally {
                clearTimeout(timer);
                drafting.delete(key);
                if (document.getElementById('et-emotion-popup')) renderPopup();
            }
        }

        function cancelDraft() {
            const controller = drafting.get(api.getCharacterKey());
            if (!controller) return;
            controller.cancelled = true;
            controller.abort();
        }

        function renderPopup() {
            const popup = document.getElementById('et-emotion-popup');
            if (!popup) return;
            popupKey = api.getCharacterKey();
            renderedSignature = popupSignature();
            const scroll = popup.querySelector('.et-emotion-popup-body')?.scrollTop || 0;
            popup.innerHTML = popupInnerHtml();
            const body = popup.querySelector('.et-emotion-popup-body');
            if (body) body.scrollTop = scroll;
            window.EchoTextSettingsModal?.patchIOSSliders?.(popup);
        }

        /**
         * Opens centred on the panel. On a computer it sits beside the panel rather
         * than in it, placed against the window, so it can be dragged out of the panel;
         * on a phone it stays in the panel, which mobile-style.css centres it in.
         */
        function placePopup(el, panel) {
            if (el.classList.contains('et-emotion-popup-floating')) {
                const box = panel.getBoundingClientRect();
                el.style.left = `${Math.round(box.left + Math.max(8, (box.width - el.offsetWidth) / 2))}px`;
                el.style.top = `${Math.round(box.top + Math.max(12, (box.height - el.offsetHeight) / 2))}px`;
            } else {
                el.style.left = `${Math.max(8, Math.round((panel.clientWidth - el.offsetWidth) / 2))}px`;
                el.style.top = `${Math.max(12, Math.round((panel.clientHeight - el.offsetHeight) / 2))}px`;
            }
        }

        /** On a computer the header drags the popup anywhere in the window (like the panel's own header). */
        function makePopupDraggable(popup) {
            popup.addClass('et-emotion-popup-draggable');
            popup.on('mousedown', '.et-emotion-popup-header', function (e) {
                if (e.button !== 0 || e.target.closest('button')) return;
                const el = popup[0];
                const startX = e.clientX, startY = e.clientY;
                const origLeft = el.offsetLeft, origTop = el.offsetTop;
                const header = this.offsetHeight;
                function onMove(ev) {
                    el.style.left = `${Math.max(0, Math.min(window.innerWidth - el.offsetWidth, origLeft + ev.clientX - startX))}px`;
                    el.style.top = `${Math.max(0, Math.min(window.innerHeight - header, origTop + ev.clientY - startY))}px`;
                }
                function onUp() {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                }
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
                e.preventDefault();
            });
        }

        function closeEmotionPopup() {
            const popup = jQuery('#et-emotion-popup');
            if (!popup.length) return;
            popup.addClass('et-emotion-popup-closing');
            setTimeout(() => popup.remove(), 200);
        }

        /** Shows the new character's feelings when the character changes under an open popup. */
        function refreshEmotionPopup() {
            if (document.getElementById('et-emotion-popup') && api.getCharacterKey() !== popupKey) renderPopup();
        }

        function changed() {
            renderPopup();
            updateEmotionIndicator();
        }

        let styleSaveTimer = null;

        function bindPopup(popup) {
            popup.on('click', '[data-emo-action="close"]', e => { e.stopPropagation(); closeEmotionPopup(); });
            popup.on('click', '[data-emo-action="reset"]', () => { resetUnlocked(); changed(); });
            popup.on('click', '[data-emo-tab]', function () { activeTab = this.dataset.emoTab; editing = null; disarmRegenerate(); renderPopup(); });
            popup.on('click', '[data-emo-day]', function () { scheduleDay = this.dataset.emoDay; editing = null; renderPopup(); });
            popup.on('click', '[data-emo-action="generate-schedule"]', () => { draftSchedule(); });
            popup.on('click', '[data-emo-action="cancel-schedule"]', () => { cancelDraft(); });
            // Editing a block: a row opens it, Add a new one; the phone choice changes in place
            // so what was typed stays
            popup.on('click', '[data-emo-block]', function () {
                editing = { key: api.getCharacterKey(), kind: 'block', day: scheduleDay || DailyLife.dayOf(new Date()), index: Number(this.dataset.emoBlock) };
                renderPopup();
            });
            popup.on('click', '[data-emo-action="add-block"]', () => {
                editing = { key: api.getCharacterKey(), kind: 'block', day: scheduleDay || DailyLife.dayOf(new Date()), index: -1 };
                renderPopup();
            });
            popup.on('click', '[data-emo-phone]', function () {
                jQuery(this).addClass('et-emo-seg-on').siblings().removeClass('et-emo-seg-on');
            });
            popup.on('click', '[data-emo-action="save-block"]', function () { saveEditedBlock(this.closest('.et-sched-edit')); });
            popup.on('click', '[data-emo-action="cancel-block"]', () => { editing = null; renderPopup(); });
            // The Life tab: errands and what happened open in place like blocks; today's change saves as it's typed
            for (const kind of ['errand', 'entry']) {
                popup.on('click', `[data-emo-${kind}]`, function () {
                    editing = { key: api.getCharacterKey(), kind, index: Number(this.dataset[kind === 'errand' ? 'emoErrand' : 'emoEntry']) };
                    renderPopup();
                });
                popup.on('click', `[data-emo-action="add-${kind}"]`, () => { editing = { key: api.getCharacterKey(), kind, index: -1 }; renderPopup(); });
                popup.on('click', `[data-emo-action="save-${kind}"]`, function () { saveLifeEdit(this.closest('.et-sched-edit')); });
                popup.on('click', `[data-emo-action="cancel-${kind}"]`, () => { editing = null; renderPopup(); });
                popup.on('click', `[data-emo-action="delete-${kind}"]`, () => { deleteLifeItem(); });
            }
            popup.on('input', '[data-emo-life-today]', function () {
                const text = this.value;
                const key = api.getCharacterKey();
                clearTimeout(todaySaveTimer);
                todaySaveTimer = setTimeout(() => saveLife(DailyLife.withToday(getLife(key), new Date(), text), key), 400);
            });
            popup.on('click', '[data-emo-action="delete-block"]', () => {
                const { key, day, index } = editing;
                saveSchedule(DailyLife.withoutBlock(getSchedule(key), day, index), key);
                editing = null;
                renderPopup();
            });
            // Regenerate replaces the week: a second click within a few seconds
            popup.on('click', '[data-emo-action="regenerate-schedule"]', () => {
                if (regenerateArmed) { draftSchedule(); return; }
                regenerateArmed = true;
                renderPopup();
                regenerateTimer = setTimeout(() => { regenerateArmed = false; renderPopup(); }, 3000);
            });
            popup.on('click', '[data-emo-mode]', function () {
                setMode(this.dataset.emoMode);
                changed();
            });
            popup.on('input', '.et-emo-slider', function () {
                const fill = sliderFill(this.dataset.emoDim, Number(this.value));
                this.style.setProperty('--emo-from', fill.from);
                this.style.setProperty('--emo-to', fill.to);
                jQuery(this).siblings('.et-emo-val').text(formatValue(Number(this.value)));
            });
            popup.on('change', '.et-emo-slider', function () {
                setValue(this.dataset.emoDim, this.value);
                updateEmotionIndicator();
            });
            popup.on('click', '[data-emo-lock]', function () { toggleLock(this.dataset.emoLock); changed(); });
            popup.on('click', '[data-emo-level]', function () { setTrait(this.dataset.emoTrait, this.dataset.emoLevel); renderPopup(); });
            popup.on('click', '[data-emo-style-type]', function () { setTextingStyle({ type: this.dataset.emoStyleType }); renderPopup(); });
            popup.on('click', '[data-emo-verbosity]', function () { setVerbosity(this.dataset.emoVerbosity); renderPopup(); });
            popup.on('input', '.et-emo-style-text', function () {
                const text = this.value;
                clearTimeout(styleSaveTimer);
                styleSaveTimer = setTimeout(() => setTextingStyle({ text }), 400);
            });
        }

        /** Opens the popup; only its × closes it (and closing the panel). */
        function openEmotionPopup() {
            const panel = document.getElementById('et-panel');
            if (!panel || document.getElementById('et-emotion-popup')) return;

            const floating = !api.isMobileDevice?.();
            const popup = jQuery(`<div id="et-emotion-popup" class="et-emotion-popup${floating ? ' et-emotion-popup-floating' : ''}"></div>`);
            jQuery(floating ? panel.parentNode : panel).append(popup);
            renderPopup();
            placePopup(popup[0], panel);
            bindPopup(popup);
            if (floating) makePopupDraggable(popup);
            requestAnimationFrame(() => popup.addClass('et-emotion-popup-open'));
            const change = getLastChange();
            if (change) flashChanges(change);
        }

        // ── Pace: reply timing, proactive waits ────────────────────────────────

        /**
         * Delays around a reply (lib/texting-behavior.js replyTiming): warm feelings
         * speed it up, cold ones slow it and can leave you on read. With emotions off,
         * fixed delays, as before.
         */
        function getEmotionReplyTimingModel() {
            const values = getEmotionState();
            if (!values) return { deliveredDelayMs: 500, readDelayMs: 1200, ghostDelayMs: 0, typingLeadMs: 300, replyDelayMs: 600 };
            return Behavior.replyTiming({ bigFive: getProfile().bigFive, values });
        }

        /**
         * How much the feelings and Extraversion stretch the wait between proactive
         * texts (lib/texting-behavior.js proactivePace); 1 with emotions off.
         */
        function getProactivePace() {
            if (getMode() === 'off') return 1;
            return Behavior.proactivePace({ bigFive: getProfile().bigFive, values: getValues() });
        }

        return {
            getMode,
            setMode,
            getEmotionState,
            getEmotionSnapshot,
            clearEmotionState,
            buildTextingStyleContext,
            buildBehaviorContext,
            buildMoodRules,
            readReply,
            buildStatusHtml,
            updateEmotionIndicator,
            refresh,
            noteReport,
            showEmotionDeltaBurst,
            openEmotionPopup,
            closeEmotionPopup,
            refreshEmotionPopup,
            getEmotionReplyTimingModel,
            getProactivePace,
        };
    }

    window.EchoTextEmotionSystem = { createEmotionSystem };
})();
