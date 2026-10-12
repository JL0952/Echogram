(function () {
    'use strict';

    /**
     * EchoText Emotion System
     *
     * Where the character's feelings and personality are kept, the popup that
     * edits them, the status chip under the name, the texting-style prompt and the
     * reply timing they drive. The data itself is lib/emotion-model.js, how it
     * changes the texting is lib/texting-behavior.js; the plan is docs/emotion-plan.md.
     *
     *   settings.emotionMode           'off' | 'manual' | 'auto'
     *   settings.nsfwEnabled           shows and uses Desire
     *   settings.characterProfiles[k]  per character: Big Five, Morality, locks, texting style
     *   settings.emotionState[k]       per chat: { start, startAt }
     *   msg.mood                       Auto mode: what a reply's <mood> line reported
     *
     * In Auto mode the values are replayed from the chat's replies each time, so a
     * deleted, regenerated or swiped reply takes its report with it.
     */

    const Model = window.EchoTextEmotionModel;
    const Behavior = window.EchoTextTextingBehavior;
    const Icons = window.EchoTextEmotionIcons;

    const MODE_LABELS = { off: 'Off', manual: 'Manual', auto: 'Auto' };
    const LEVEL_LABELS = { low: 'Low', mid: 'Mid', high: 'High' };
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
        //      getChatHistory(key) (a character's chat, whose replies carry Auto mode's reports)

        function settings() { return api.getSettings(); }
        function getMode() { return Model.MODES.includes(settings().emotionMode) ? settings().emotionMode : 'manual'; }
        function nsfwOn() { return settings().nsfwEnabled === true; }

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

        /** The status row under the name: the strongest feeling. */
        function buildStatusHtml() {
            if (getMode() === 'off') return '<span class="et-status-placeholder">Emotions off</span>';
            const top = Model.strongest(getValues(), { nsfw: nsfwOn() });
            if (!top) return '<span class="et-status-placeholder">Neutral</span>';
            const { dim, value } = top;
            return `<span class="et-status-chip et-status-chip-emotion" style="--emo-color:${dim.color}" title="${dim.label}: ${value}"><span class="et-status-emotion-icon" style="color:${dim.color}">${iconHtml(dim)}</span><span class="et-status-main">${dim.label}</span></span>`;
        }

        let lastStrongestId = null;

        /** Tells index.js to redraw the status row, and whether the strongest feeling changed. */
        function updateEmotionIndicator() {
            if (!api.isPanelOpen()) return;
            const top = getMode() === 'off' ? null : Model.strongest(getValues(), { nsfw: nsfwOn() });
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

        /** After a reply with a <mood> line: what it changed, as chips under the header and on the open popup's rows. */
        function noteReport() {
            refresh();
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
                + `<div class="et-emo-group-label">Texting style</div>`
                + segmented(Model.TEXTING_STYLE_TYPES.map(t => [t, STYLE_TYPE_LABELS[t]]), textingStyle.type, 'data-emo-style-type')
                + `<textarea class="et-emo-style-text" rows="3" placeholder="${escapeHtml(STYLE_PLACEHOLDERS[textingStyle.type])}">${escapeHtml(textingStyle.text)}</textarea>`;
        }

        function popupInnerHtml() {
            const tabs = [['emotions', 'fa-heart-pulse', 'Emotions'], ['personality', 'fa-user-pen', 'Personality']];
            const showReset = activeTab === 'emotions' && getMode() !== 'off';
            return `<div class="et-emotion-popup-header">`
                + `<i class="fa-solid fa-heart-pulse" style="color:var(--et-theme-color)"></i>`
                + `<span>${escapeHtml(api.getCharacterName() || 'Character')}</span>`
                + (showReset ? `<button type="button" class="et-emo-reset" data-emo-action="reset" title="Set every unlocked feeling back to 0">Reset</button>` : '')
                + `<button type="button" class="et-emotion-popup-close" data-emo-action="close" title="Close"><i class="fa-solid fa-xmark"></i></button>`
                + `</div>`
                + `<div class="et-emotion-popup-body">`
                + `<div class="et-emo-tabs">${tabs.map(([id, icon, label]) =>
                    `<button type="button" class="et-emo-tab${id === activeTab ? ' et-emo-tab-active' : ''}" data-emo-tab="${id}"><i class="fa-solid ${icon}"></i><span>${label}</span></button>`).join('')}</div>`
                + (activeTab === 'emotions' ? emotionsPanel() : personalityPanel())
                + `</div>`;
        }

        // The character the open popup shows, and what it showed (refresh() redraws it when that changes)
        let popupKey = null;
        let renderedSignature = null;

        function popupSignature() {
            const shown = activeTab === 'emotions' && getMode() !== 'off';
            return JSON.stringify([api.getCharacterKey(), getMode(), activeTab, shown ? getValues() : null]);
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
            popup.on('click', '[data-emo-tab]', function () { activeTab = this.dataset.emoTab; renderPopup(); });
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

        // ── Reply timing ────────────────────────────────────────────────────────

        /** Delays around a reply; warm feelings speed it up, cold ones slow it and can leave you on read. */
        function getEmotionReplyTimingModel() {
            const state = getEmotionState();
            if (!state) return { deliveredDelayMs: 500, readDelayMs: 1200, ghostDelayMs: 0, typingLeadMs: 300, replyDelayMs: 600 };

            // Until step E5 rethinks it: the old formula on the nearest new feelings
            // (trust → the good side of rapport, fear → anxiety)
            const warmFactor = (state.joy * 0.55 + Math.max(0, state.rapport) * 0.45 + state.anticipation * 0.3) / 100;
            const coldFactor = (state.anger * 0.6 + state.sadness * 0.35 + state.anxiety * 0.25) / 100;
            const volatility = Math.max(0, coldFactor - warmFactor * 0.65);

            return {
                deliveredDelayMs: Math.round(250 + Math.random() * 900),
                readDelayMs: Math.round((700 + Math.random() * 1800) * (1 + volatility * 1.6)),
                ghostDelayMs: volatility > 0.42 ? Math.round((20000 + Math.random() * 70000) * Math.min(1.9, 1 + volatility)) : 0,
                typingLeadMs: Math.round(300 + Math.random() * 900),
                replyDelayMs: Math.round((300 + Math.random() * 2200) * Math.max(0.25, 1 + volatility * 1.8 - warmFactor * 0.95))
            };
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
        };
    }

    window.EchoTextEmotionSystem = { createEmotionSystem };
})();
