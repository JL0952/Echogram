// EchoText Extension - A floating text messaging panel for SillyTavern
// Uses SillyTavern.getContext() global pattern (no ES6 imports from ST internals)

(function () {
    'use strict';

    const MODULE_NAME = 'EchoText';
    const EXTENSION_NAME = 'EchoText';

    // Get BASE_URL and cache-buster from script tag
    const scripts = document.querySelectorAll('script[src*="index.js"]');
    let BASE_URL = '';
    let VERSION_QUERY = '';
    for (const script of scripts) {
        if (script.src.includes('EchoText')) {
            // Use URL API for resilient parsing
            try {
                const urlObj = new URL(script.src, window.location.href);
                VERSION_QUERY = urlObj.search; // Contains "?test5" etc
                BASE_URL = urlObj.origin + urlObj.pathname.split('/').slice(0, -1).join('/');
            } catch (e) {
                // Fallback for unexpected URL formats
                BASE_URL = script.src.split('?')[0].split('/').slice(0, -1).join('/');
                const parts = script.src.split('?');
                if (parts.length > 1) VERSION_QUERY = '?' + parts[1];
            }
            break;
        }
    }
    if (!BASE_URL) {
        BASE_URL = '/scripts/extensions/third-party/SillyTavern-EchoText';
    }
    // SillyTavern loads index.js without a version: give the files EchoText loads
    // itself one per page load, so a browser never keeps a stylesheet or module
    // from before an update (a platform stylesheet goes in after page load, when a
    // hard reload no longer bypasses the cache)
    if (!VERSION_QUERY) VERSION_QUERY = `?t=${Date.now()}`;

    console.log(`[EchoText] Initializing from ${BASE_URL} with query ${VERSION_QUERY}`);

    function runEchoTextScript(relativePath) {
        const xhr = new XMLHttpRequest();
        // Propagate the cache-buster to all sub-modules
        const moduleUrl = `${BASE_URL}/${relativePath}${VERSION_QUERY}`;
        xhr.open('GET', moduleUrl, false);
        xhr.send();
        if (xhr.status < 200 || xhr.status >= 300) {
            console.error(`[EchoText] Failed to load module ${relativePath}: HTTP ${xhr.status}`);
            throw new Error(`Failed to load module ${relativePath}: HTTP ${xhr.status}`);
        }
        // eslint-disable-next-line no-new-func
        new Function(xhr.responseText)();
    }

    function loadEchoTextModule(relativePath, globalKey) {
        if (window[globalKey]) return;
        runEchoTextScript(relativePath);
        if (!window[globalKey]) {
            throw new Error(`Module loaded but global '${globalKey}' is missing (${relativePath})`);
        }
    }

    loadEchoTextModule('lib/config.js', 'EchoTextConfig');
    loadEchoTextModule('lib/emotion-model.js', 'EchoTextEmotionModel');
    loadEchoTextModule('lib/emotion-icons.js', 'EchoTextEmotionIcons');
    loadEchoTextModule('lib/texting-behavior.js', 'EchoTextTextingBehavior');
    loadEchoTextModule('lib/emotion-system.js', 'EchoTextEmotionSystem');
    loadEchoTextModule('lib/proactive-messaging.js', 'EchoTextProactiveMessaging');
    loadEchoTextModule('lib/settings-modal.js', 'EchoTextSettingsModal');
    loadEchoTextModule('lib/memory-system.js', 'EchoTextMemorySystem');
    loadEchoTextModule('lib/saveload-modal.js', 'EchoTextSaveLoadModal');
    loadEchoTextModule('lib/group.js', 'EchoTextGroupManager');
    loadEchoTextModule('lib/image-generation.js', 'EchoTextImageGeneration');
    loadEchoTextModule('lib/gallery.js', 'EchoTextGallery');
    loadEchoTextModule('lib/character-picker.js', 'EchoTextCharacterPicker');
    loadEchoTextModule('lib/theme-editor.js', 'EchoTextThemeEditor');
    loadEchoTextModule('lib/rich-messages.js', 'EchoTextRichMessages');
    loadEchoTextModule('lib/features.js', 'EchoTextFeatures');
    loadEchoTextModule('lib/chat-view-model.js', 'EchoTextChatViewModel');
    loadEchoTextModule('lib/story-texts.js', 'EchoTextStoryTexts');

    // Platform packs (platforms/<id>/platform.js), in menu order. Their scripts are
    // small and all load now; a pack's stylesheet loads only while it's in use.
    // EchoText's own look must load, the others are optional.
    const PLATFORM_IDS = ['echotext', 'wechat'];
    for (const id of PLATFORM_IDS) {
        try {
            if (!window.EchoTextPlatforms?.[id]) runEchoTextScript(`platforms/${id}/platform.js`);
        } catch (e) {
            if (id === 'echotext') throw e;
            console.error(`[EchoText] Failed to load platform '${id}':`, e);
        }
    }

    const RichMessages = window.EchoTextRichMessages;
    const Features = window.EchoTextFeatures;
    const ChatViewModel = window.EchoTextChatViewModel;
    const StoryTexts = window.EchoTextStoryTexts;
    const Platforms = window.EchoTextPlatforms;

    // ============================================================
    // THEME PRESETS
    // ============================================================

    const THEME_PRESETS = window.EchoTextConfig.THEME_PRESETS;

    // Returns the merged set of built-in presets + user-created custom themes.
    // All theme-aware code should call this rather than referencing THEME_PRESETS
    // directly, so custom themes are always included.
    function getAllThemePresets() {
        return Object.assign({}, THEME_PRESETS, settings.customThemes || {});
    }

    // ============================================================
    // DEFAULT SETTINGS
    // ============================================================

    const defaultSettings = window.EchoTextConfig.defaultSettings;

    let settings = JSON.parse(JSON.stringify(defaultSettings));
    let isGenerating = false;
    let abortController = null;
    let panelOpen = false;
    let fabDragging = false;
    let loadedFontFamily = null;
    let showTypingIndicator = false;
    // When set ('photo' | 'voice' | 'transfer' | 'file'), the next message the user sends
    // is that kind of content and the typed text is its description / words / amount
    let composeMode = null;
    // The kind of file the user shares (RichMessages.SHARE_TYPES), kept between shares
    let shareType = 'pdf';
    // Reply scheduling: the user can send several texts in a row and the character
    // answers once they pause (see scheduleCharacterReply)
    let replyTimer = null;
    let replyQueued = false;
    let replyInProgress = false;
    // Completion requests in flight — once the model is writing, a new user text
    // waits for a follow-up reply instead of cancelling it
    let activeCompletionRequests = 0;
    let hasUnreadCharacterMessage = false;
    let emotionSystem = null;
    let proactiveMessaging = null;
    let settingsModal = null;
    let memorySystem = null;
    let saveLoadModal = null;
    let groupManager = null;
    let imageGeneration = null;
    let gallery = null;
    let characterPicker = null;
    let themeEditor = null;
    let FA_REACTIONS = [];
    let selectedCharacterKey = null;

    // Named event handler references for cleanup
    let _onChatChanged = null;
    let _onGroupUpdated = null;

    // ============================================================
    // MOBILE / iOS DETECTION & VIEWPORT HELPERS
    // ============================================================

    function isMobileDevice() {
        return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
            || ('ontouchstart' in window && window.innerWidth < 1024);
    }

    function isIOS() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent)
            || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }

    // Use visualViewport when available — reports the region actually visible
    // to the user on iOS (excludes address bar, keyboard, etc.).
    function getViewportHeight() {
        return window.visualViewport ? window.visualViewport.height : window.innerHeight;
    }

    function getViewportWidth() {
        return window.visualViewport ? window.visualViewport.width : window.innerWidth;
    }

    // ============================================================
    // iOS PORTAL — escape SillyTavern's body { position: fixed }
    // ============================================================
    // SillyTavern's mobile-styles.css applies:
    //   body { position: fixed; overflow: hidden; }
    // which breaks position:fixed children appended directly to body.
    //
    // Fix: mount a <div id="et-portal"> as a direct sibling of <body>
    // (child of <html>) to escape SillyTavern's clipped/fixed body.
    // We use a high z-index and dynamic viewport units for total coverage.
    const ET_PORTAL_ID = 'et-portal';

    function ensurePortal() {
        let portal = document.getElementById(ET_PORTAL_ID);
        if (!portal) {
            portal = document.createElement('div');
            portal.id = ET_PORTAL_ID;
            // Max z-index, fixed fullscreen, tracking dynamic viewport (dvh/dvw)
            // We use color:initial and text-align:initial to ensureST defaults don't bleed in.
            portal.style.cssText = `position:fixed; top:0; left:0; width:100dvw; height:100dvh; z-index:${isMobileDevice() ? '2147483647' : '1500'}; pointer-events:none; display:block !important; border:none !important; margin:0 !important; padding:0 !important;`;
            
            // Try appending to html first to escape body bugs
            try {
                document.documentElement.appendChild(portal);
            } catch (e) {
                console.warn('[EchoText] Failed to append to <html>, falling back to <body>', e);
                document.body.appendChild(portal);
            }
        }
        return portal;
    }

    function portalAppend(html) {
        const portal = ensurePortal();
        // Re-enable pointer events on children (portal itself has none).
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'pointer-events:auto;';
        wrapper.innerHTML = html;
        while (wrapper.firstChild) portal.appendChild(wrapper.firstChild);
    }

    function removePortal() {
        const portal = document.getElementById(ET_PORTAL_ID);
        if (portal) portal.remove();
    }

    /**
     * On mobile the portal lives on <html> with z-index MAX, so anything left
     * in <body> (where external modal modules append their DOM) renders beneath
     * the panel.  Call this immediately after triggering any modal open; it
     * relocates the modal root element into the portal so it shares the same
     * stacking context and appears above the panel.
     *
     * Safe to call on desktop too — it's a no-op when !isMobileDevice().
     *
     * @param {string} selector  CSS selector for the modal's root element
     */
    function moveModalToPortal(selector) {
        if (!isMobileDevice()) return;
        const portal = ensurePortal();
        const tryMove = () => {
            const el = document.querySelector(selector);
            if (el && el.parentElement !== portal) {
                portal.appendChild(el);
                return true;
            }
            return !!el;
        };
        // Try synchronously first (modal may already be in DOM),
        // then retry at 50 ms, 150 ms, and 400 ms to cover modules that do
        // async DB reads or multi-step renders before appending their element.
        if (!tryMove()) {
            setTimeout(() => {
                if (!tryMove()) {
                    setTimeout(() => {
                        if (!tryMove()) setTimeout(tryMove, 250);
                    }, 100);
                }
            }, 50);
        }
    }

    // ============================================================
    // LOGGING
    // ============================================================

    function log(...args) { console.log(`[${EXTENSION_NAME}]`, ...args); }
    function warn(...args) { console.warn(`[${EXTENSION_NAME}]`, ...args); }
    function error(...args) { console.error(`[${EXTENSION_NAME}]`, ...args); }

    function getImageMimeTypeFromDataUrl(dataUrl) {
        const match = String(dataUrl || '').match(/^data:([^;]+);base64,/i);
        return match?.[1] || 'image/png';
    }

    function extractImageUrlFromPluginResult(result) {
        if (!result) return null;
        if (typeof result === 'string') return result;
        if (Array.isArray(result)) {
            for (const item of result) {
                const nested = extractImageUrlFromPluginResult(item);
                if (nested) return nested;
            }
        }
        if (typeof result === 'object') {
            if (typeof result.pipe === 'string' && result.pipe.trim()) return result.pipe.trim();
            if (typeof result.value === 'string' && result.value.trim()) return result.value.trim();
        }
        return result.url || result.image || result.path || result.src || result.data || result.base64 || null;
    }

    async function requestSillyTavernImageGeneration(payload) {
        // Use sdPrompt (SD-optimized, includes character appearance) for the /sd command.
        // contextPrompt is reserved for multimodal generators that handle verbose prose.
        const sdPrompt = payload.sdPrompt || payload.prompt || '';
        const response = await executeImageGenerationSlashCommand(buildImageGenerationSlashCommand(payload));

        let url = extractImageUrlFromPluginResult(response);
        if (typeof url === 'string') {
            const mdMatch = url.match(/\!\[[^\]]*\]\(([^)]+)\)/);
            if (mdMatch?.[1]) url = mdMatch[1];
        }
        if (!url) {
            throw new Error('The SillyTavern Image Generation plugin did not return an image URL or data payload.');
        }

        return {
            ok: true,
            url,
            mimeType: String(url).startsWith('data:') ? getImageMimeTypeFromDataUrl(url) : 'image/png',
            prompt: sdPrompt,
            provider: 'st_image_plugin'
        };
    }

    function buildImageGenerationSlashCommand(payload) {
        // Always use sdPrompt — the SD-optimized prompt that includes character appearance,
        // visual descriptors, and scene context. Never use raw userDirectives here, as
        // those may be unstripped trigger phrases with no appearance information.
        const subject = String(payload.sdPrompt || payload.prompt || 'a candid photo')
            .replace(/\r?\n+/g, ' ')
            .replace(/"/g, '\\"')
            .trim();
        return `/sd quiet=true ${subject}`;
    }

    async function executeImageGenerationSlashCommand(command) {
        const context = SillyTavern.getContext?.() || {};
        const executor = context.executeSlashCommandsWithOptions
            || context.executeSlashCommands
            || window.executeSlashCommandsWithOptions
            || window.executeSlashCommands;

        if (typeof executor !== 'function') {
            throw new Error('SillyTavern slash-command execution API was not available for image generation.');
        }

        // ST's image generation plugin shows a persistent "Generating an image..." toast.
        // EchoText already has its own camera indicator, so dismiss that toast after a
        // brief moment so it doesn't linger for the full generation duration.
        setTimeout(() => {
            const container = document.getElementById('toast-container');
            if (!container) return;
            container.querySelectorAll('.toast-info').forEach(toast => {
                const title = toast.querySelector('.toast-title');
                if (title && title.textContent.includes('Image Generation')) {
                    jQuery(toast).fadeOut(400, () => jQuery(toast).remove());
                }
            });
        }, 1500);

        const result = await executor(command, { quiet: true, source: 'echotext' });
        if (typeof result === 'string') return result.trim();
        return result;
    }

    function getIsGenerating() {
        return isGenerating;
    }

    function isPanelOpen() {
        return panelOpen;
    }

    // ============================================================
    // SETTINGS MANAGEMENT
    // ============================================================

    function getSettings() {
        const context = SillyTavern.getContext();
        if (!context.extensionSettings[MODULE_NAME]) {
            context.extensionSettings[MODULE_NAME] = JSON.parse(JSON.stringify(defaultSettings));
        }
        const s = context.extensionSettings[MODULE_NAME];
        // The old emotion on/off switch, before the defaults fill in emotionMode
        if (s.emotionSystemEnabled === false && !Object.hasOwn(s, 'emotionMode')) s.emotionMode = 'off';
        for (const key of Object.keys(defaultSettings)) {
            if (!Object.hasOwn(s, key)) {
                const val = defaultSettings[key];
                s[key] = (val !== null && typeof val === 'object') ? JSON.parse(JSON.stringify(val)) : val;
            }
        }
        // The loop above freezes each prompt at the default of the version that first
        // saved it. A prompt still equal to an earlier factory default was never
        // customised, so upgrade it to the current default.
        const legacyPrompts = window.EchoTextConfig.LEGACY_PROMPT_DEFAULTS || {};
        for (const [key, oldDefaults] of Object.entries(legacyPrompts)) {
            if (oldDefaults.includes(s[key])) s[key] = defaultSettings[key];
        }
        // Settings of removed features
        for (const key of window.EchoTextConfig.REMOVED_SETTINGS || []) delete s[key];
        if (s.savedChats) delete s.savedChats.untethered;
        if (!s.chatHistory || typeof s.chatHistory !== 'object' || Array.isArray(s.chatHistory)) {
            s.chatHistory = {};
        }
        if (!s.emotionState || typeof s.emotionState !== 'object' || Array.isArray(s.emotionState)) {
            s.emotionState = {};
        }
        if (!s.proactiveCharacterConfig || typeof s.proactiveCharacterConfig !== 'object' || Array.isArray(s.proactiveCharacterConfig)) {
            s.proactiveCharacterConfig = {};
        }
        if (!s.proactiveState || typeof s.proactiveState !== 'object' || Array.isArray(s.proactiveState)) {
            s.proactiveState = {};
        }
        return s;
    }

    function saveSettings() {
        SillyTavern.getContext().saveSettingsDebounced();
    }

    // ============================================================
    // ACTIVITY MODE HELPER
    // ============================================================

    /**
     * Named activity mode presets.
     * Each maps to a floor in minutes and a human description.
     *  'expressive' uses 30 min so the trigger/jitter system is the real governor.
     */
    const ACTIVITY_MODE_PRESETS = {
        quiet:      { minutes: 480, hint: 'Quiet: ~1–2 messages per day. Minimal API use — ideal when watching token spend.' },
        relaxed:    { minutes: 300, hint: 'Relaxed: ~3 messages per day. A gentle presence that doesn\'t intrude.' },
        natural:    { minutes: 180, hint: 'Natural: Dynamic, emotion-influenced frequency. The default — feels organic without overwhelming.' },
        lively:     { minutes:  90, hint: 'Lively: ~6–8 messages per day. The character reaches out more readily, especially when emotionally engaged.' },
        expressive: { minutes:  30, hint: 'Expressive: Minimal floor — the trigger system drives everything. Best with a fast or local model.' },
        custom:     { minutes: null, hint: 'Custom: Use the slider to set your own minimum gap between messages.' }
    };

    /**
     * Applies an activity mode to a given set of DOM targets (works for both
     * the settings modal and the panel accordion — just pass different selectors).
     *
     * @param {string} mode        - one of the ACTIVITY_MODE_PRESETS keys
     * @param {string} gridSel     - selector for the button grid
     * @param {string} customSel   - selector for the custom slider row
     * @param {string} sliderSel   - selector for the range input
     * @param {string} valSel      - selector for the value display span
     * @param {string} hintSel     - selector for the hint text element
     */
    function applyActivityMode(mode, gridSel, customSel, sliderSel, valSel, hintSel) {
        const preset = ACTIVITY_MODE_PRESETS[mode] || ACTIVITY_MODE_PRESETS.natural;

        // Highlight the active button
        jQuery(gridSel).find('.et-activity-btn').removeClass('et-activity-btn-active');
        jQuery(gridSel).find(`.et-activity-btn[data-mode="${mode}"]`).addClass('et-activity-btn-active');

        // Show/hide custom slider
        if (mode === 'custom') {
            jQuery(customSel).show();
        } else {
            jQuery(customSel).hide();
            // Apply the preset floor
            if (preset.minutes !== null) {
                jQuery(sliderSel).val(preset.minutes);
                jQuery(valSel).text(preset.minutes + ' min');
                settings.proactiveRateLimitMinutes = preset.minutes;
            }
        }

        // Update hint
        jQuery(hintSel).text(preset.hint);

        // Persist
        settings.proactiveActivityMode = mode;
        saveSettings();
        if (typeof refreshProactiveInsights === 'function') refreshProactiveInsights();
    }

    function loadSettings() {
        settings = getSettings();
        applySettingsToUI();
        applyAppearanceSettings();
        // Initialize panel accordion after settings are loaded
        initPanelAccordion();
    }

    function applySettingsToUI() {
        // Sync modal settings
        jQuery('#et_enabled').prop('checked', settings.enabled);
        jQuery('#et_enabled_quick').prop('checked', settings.enabled);
        jQuery('#et_auto_open').prop('checked', settings.autoOpenOnReload);
        jQuery('#et_auto_load_last_char').prop('checked', settings.autoLoadLastCharacter === true);
        jQuery('#et_source').val(settings.source);
        jQuery('#et_profile_select').val(settings.preset);
        jQuery('#et_ollama_url').val(settings.ollama_url);
        jQuery('#et_openai_preset').val(settings.openai_preset);
        jQuery('#et_openai_url').val(settings.openai_url);
        jQuery('#et_openai_key').val(settings.openai_key);
        jQuery('#et_openai_model').val(settings.openai_model);
        jQuery('#et_anti_refusal').prop('checked', settings.antiRefusal === true);
        jQuery('#et_image_generation_enabled').prop('checked', settings.imageGenerationEnabled === true);
        jQuery('#et_image_generation_include_text_reply').prop('checked', settings.imageGenerationIncludeTextReply !== false);
        jQuery('#et_image_generation_plugin_notice').toggle(settings.imageGenerationEnabled === true);
        jQuery('#et_font_size').val(settings.fontSize);
        jQuery('#et_font_size_val').text(settings.fontSize + 'px');
        jQuery('#et_theme').val(settings.theme);
        jQuery('#et_glass_blur').val(settings.glassBlur);
        jQuery('#et_glass_blur_val').text(settings.glassBlur + 'px');
        jQuery('#et_glass_opacity').val(settings.glassOpacity);
        jQuery('#et_glass_opacity_val').text(settings.glassOpacity + '%');
        jQuery('#et_line_spacing').val(settings.lineSpacing || 1.3);
        jQuery('#et_line_spacing_val').text((settings.lineSpacing || 1.3).toFixed(2));
        jQuery('#et_paragraph_spacing').val(settings.paragraphSpacing || 12);
        jQuery('#et_paragraph_spacing_val').text((settings.paragraphSpacing || 12) + 'px');

        jQuery('#et_emotion_mode').val(settings.emotionMode || 'manual');
        jQuery('#et_nsfw_enabled').prop('checked', settings.nsfwEnabled === true);
        jQuery('#et_swiped_messages').prop('checked', settings.swipedMessages === true);
        jQuery('#et_fab_size').val(settings.fabSize);
        jQuery('#et_fab_size_val').text(settings.fabSize + 'px');
        jQuery('#et_fab_opacity').val(settings.fabOpacity || 100);
        jQuery('#et_fab_opacity_val').text((settings.fabOpacity || 100) + '%');
        jQuery('#et_auto_scroll').prop('checked', settings.autoScroll);
        jQuery('#et_verbosity_default').val(settings.verbosityDefault || 'medium');
        // Context settings
        jQuery('#et_ctx_description').prop('checked', settings.ctxDescription !== false);
        jQuery('#et_ctx_personality').prop('checked', settings.ctxPersonality !== false);
        jQuery('#et_ctx_scenario').prop('checked', settings.ctxScenario !== false);
        jQuery('#et_ctx_persona').prop('checked', settings.ctxPersona === true);
        jQuery('#et_ctx_authors_note').prop('checked', settings.ctxAuthorsNote === true);
        jQuery('#et_ctx_world_info').prop('checked', settings.ctxWorldInfo === true);
        jQuery('#et_ctx_st_messages').prop('checked', settings.ctxSTMessages === true);
        jQuery('#et_proactive_rate_limit').val(settings.proactiveRateLimitMinutes || 180);
        jQuery('#et_proactive_rate_limit_val').text((settings.proactiveRateLimitMinutes || 180) + ' min');
        // Activity mode
        const activeMode = settings.proactiveActivityMode || 'natural';
        jQuery('#et_activity_mode_grid').find('.et-activity-btn').removeClass('et-activity-btn-active');
        jQuery(`#et_activity_mode_grid .et-activity-btn[data-mode="${activeMode}"]`).addClass('et-activity-btn-active');
        jQuery('#et_activity_custom_row').toggle(activeMode === 'custom');
        const modeHint = (ACTIVITY_MODE_PRESETS[activeMode] || ACTIVITY_MODE_PRESETS.natural).hint;
        jQuery('#et_activity_mode_hint').text(modeHint);
        jQuery('#et_proactive_emotion_urgency').prop('checked', settings.proactiveEmotionUrgency !== false);
        updateProactiveToggleButtons();

        jQuery('.et-icon-option').removeClass('selected');
        jQuery(`.et-icon-option[data-icon="${settings.fabIcon}"]`).addClass('selected');

        updateProviderVisibility();
        updateThemePreview();
        // Update custom dropdowns
        updateCustomDropdown('et_theme_custom', settings.theme);
        updateCustomDropdown('et_font_family_custom', settings.fontFamily);

        // Strip reasoning tags
        jQuery('#et_strip_thinking_enabled').prop('checked', settings.stripThinkingTagsEnabled !== false);
        renderStripTagChips('et_strip_tag_chips');
        renderCustomPatternRows('et_custom_pattern_list');
        updateStripTagsSubsectionVisibility();

        // Also sync to panel accordion settings
        applySettingsToPanel();
    }

    // Apply settings to the panel accordion UI
    function applySettingsToPanel() {
        // General
        jQuery('#et_enabled_panel').prop('checked', settings.enabled);
        jQuery('#et_auto_open_panel').prop('checked', settings.autoOpenOnReload);
        jQuery('#et_auto_load_last_char_panel').prop('checked', settings.autoLoadLastCharacter === true);
        jQuery('#et_auto_scroll_panel').prop('checked', settings.autoScroll);
        jQuery('#et_emotion_mode_panel').val(settings.emotionMode || 'manual');
        jQuery('#et_nsfw_enabled_panel').prop('checked', settings.nsfwEnabled === true);
        jQuery('#et_swiped_messages_panel').prop('checked', settings.swipedMessages === true);
        jQuery('#et_verbosity_default_panel').val(settings.verbosityDefault || 'medium');

        // Generation Engine
        jQuery('#et_source_panel').val(settings.source);
        jQuery('#et_profile_select_panel').val(settings.preset);
        jQuery('#et_ollama_url_panel').val(settings.ollama_url);
        jQuery('#et_openai_preset_panel').val(settings.openai_preset);
        jQuery('#et_openai_url_panel').val(settings.openai_url);
        jQuery('#et_openai_key_panel').val(settings.openai_key);
        jQuery('#et_openai_model_panel').val(settings.openai_model);
        jQuery('#et_anti_refusal_panel').prop('checked', settings.antiRefusal === true);
        jQuery('#et_image_generation_enabled_panel').prop('checked', settings.imageGenerationEnabled === true);
        jQuery('#et_image_generation_include_text_reply_panel').prop('checked', settings.imageGenerationIncludeTextReply !== false);
        jQuery('#et_image_generation_plugin_notice_panel').toggle(settings.imageGenerationEnabled === true);
        updateImageGenerationVisibility();
        updateProviderVisibilityPanel();

        // Populate connection profiles for panel
        populateConnectionProfilesPanel();

        // Context
        jQuery('#et_ctx_description_panel').prop('checked', settings.ctxDescription !== false);
        jQuery('#et_ctx_personality_panel').prop('checked', settings.ctxPersonality !== false);
        jQuery('#et_ctx_scenario_panel').prop('checked', settings.ctxScenario !== false);
        jQuery('#et_ctx_persona_panel').prop('checked', settings.ctxPersona === true);
        jQuery('#et_ctx_authors_note_panel').prop('checked', settings.ctxAuthorsNote === true);
        jQuery('#et_ctx_world_info_panel').prop('checked', settings.ctxWorldInfo === true);
        // World Info sub-panel — toggle visibility and apply saved mode state
        const _wiEnabled = settings.ctxWorldInfo === true;
        jQuery('#et-ctx-wi-sub_panel').toggle(_wiEnabled);
        if (_wiEnabled) {
            const _wiMode = settings.ctxWorldInfoMode || 'min_order';
            jQuery('#et-ctx-wi-sub_panel .et-ctx-wi-mode-btn').removeClass('et-ctx-wi-mode-btn-active');
            jQuery('#et-ctx-wi-sub_panel .et-ctx-wi-mode-btn[data-mode="' + _wiMode + '"]').addClass('et-ctx-wi-mode-btn-active');
            jQuery('#et_ctx_wi_min_panel').val(typeof settings.ctxWorldInfoMinOrder === 'number' ? settings.ctxWorldInfoMinOrder : 250);
            jQuery('#et_ctx_wi_max_panel').val(typeof settings.ctxWorldInfoMaxOrder === 'number' ? String(settings.ctxWorldInfoMaxOrder) : '');
            jQuery('#et_ctx_wi_targeted_panel').val(Array.isArray(settings.ctxWorldInfoTargetedOrders) ? settings.ctxWorldInfoTargetedOrders.join(', ') : '');
            toggleWIPanelRows(_wiMode);
        }
        jQuery('#et_ctx_st_messages_panel').prop('checked', settings.ctxSTMessages === true);
        jQuery('#et_proactive_rate_limit_panel').val(settings.proactiveRateLimitMinutes || 180);
        jQuery('#et_proactive_rate_limit_val_panel').text((settings.proactiveRateLimitMinutes || 180) + ' min');
        // Activity mode
        const activeModePanel = settings.proactiveActivityMode || 'natural';
        jQuery('#et_activity_mode_grid_panel').find('.et-activity-btn').removeClass('et-activity-btn-active');
        jQuery(`#et_activity_mode_grid_panel .et-activity-btn[data-mode="${activeModePanel}"]`).addClass('et-activity-btn-active');
        jQuery('#et_activity_custom_row_panel').toggle(activeModePanel === 'custom');
        const modeHintPanel = (ACTIVITY_MODE_PRESETS[activeModePanel] || ACTIVITY_MODE_PRESETS.natural).hint;
        jQuery('#et_activity_mode_hint_panel').text(modeHintPanel);
        jQuery('#et_proactive_emotion_urgency_panel').prop('checked', settings.proactiveEmotionUrgency !== false);
        updateProactiveToggleButtons();

        // Appearance
        jQuery('#et_font_size_panel').val(settings.fontSize);
        jQuery('#et_font_size_val_panel').text(settings.fontSize + 'px');
        jQuery('#et_glass_blur_panel').val(settings.glassBlur);
        jQuery('#et_glass_blur_val_panel').text(settings.glassBlur + 'px');
        jQuery('#et_glass_opacity_panel').val(settings.glassOpacity);
        jQuery('#et_glass_opacity_val_panel').text(settings.glassOpacity + '%');
        jQuery('#et_line_spacing_panel').val(settings.lineSpacing || 1.3);
        jQuery('#et_line_spacing_val_panel').text((settings.lineSpacing || 1.3).toFixed(2));
        jQuery('#et_paragraph_spacing_panel').val(settings.paragraphSpacing || 12);
        jQuery('#et_paragraph_spacing_val_panel').text((settings.paragraphSpacing || 12) + 'px');


        populatePlatformSelects();

        // Populate theme dropdown
        jQuery('#et_theme_panel_container').html(buildThemeDropdownHtml(settings.theme));
        // Populate font dropdown
        jQuery('#et_font_family_panel_container').html(buildFontDropdownHtml(settings.fontFamily));
        // Initialize custom dropdowns in panel
        initCustomDropdownsPanel();

        // Action Button
        jQuery('#et_fab_size_panel').val(settings.fabSize);
        jQuery('#et_fab_size_val_panel').text(settings.fabSize + 'px');
        jQuery('#et_fab_opacity_panel').val(settings.fabOpacity || 100);
        jQuery('#et_fab_opacity_val_panel').text((settings.fabOpacity || 100) + '%');
        initCustomDropdownPanel('et_fab_icon_panel', settings.fabIcon);

        // Populate Prompt Manager in Panel if available
        if (typeof settingsModal !== 'undefined' && settingsModal && typeof settingsModal.buildPromptManagerSectionHtml === 'function') {
            jQuery('#et_prompt_manager_panel_container').html(settingsModal.buildPromptManagerSectionHtml());
        }

        // Populate Memory System panel card list and apply scope pill state
        if (typeof settingsModal !== 'undefined' && settingsModal && typeof settingsModal.renderMemoryListInto === 'function') {
            settingsModal.renderMemoryListInto('#et_memory_list_panel', '#et_memory_empty_panel', '#et_memory_list_label_panel');
        }
        // Memory panel toggles
        jQuery('#et_memory_enabled_panel').prop('checked', settings.memoryEnabled !== false);
        jQuery('#et_memory_auto_extract_panel').prop('checked', settings.memoryAutoExtract !== false);
        // Memory scope pills
        const _memScope = settings.memoryScope || 'per-character';
        jQuery('#et_memory_scope_pills_panel .et-mem-scope-btn').removeClass('et-mem-scope-btn-active');
        jQuery(`#et_memory_scope_pills_panel .et-mem-scope-btn[data-scope="${_memScope}"]`).addClass('et-mem-scope-btn-active');
        jQuery('#et_memory_scope_hint_panel').text(
            _memScope === 'global' ? 'One shared memory pool for all characters.' : 'Each character keeps their own separate memory pool.'
        );
        // Strip reasoning tags
        jQuery('#et_strip_thinking_enabled_panel').prop('checked', settings.stripThinkingTagsEnabled !== false);
        renderStripTagChips('et_strip_tag_chips_panel');
        renderCustomPatternRows('et_custom_pattern_list_panel');
        updateStripTagsSubsectionVisibility();
    }

    function updateProactiveToggleButtons() {
        // Check both proactiveMessagingEnabled and dynamicSystemsEnabled for the toggle state
        const enabled = settings.proactiveMessagingEnabled !== false && settings.dynamicSystemsEnabled !== false;

        const syncButton = (selector) => {
            const btn = jQuery(selector);
            if (!btn.length) return;
            btn.toggleClass('et-proactive-paused', !enabled);
            btn.find('i').attr('class', `fa-solid ${enabled ? 'fa-toggle-on' : 'fa-toggle-off'}`);
            btn.find('span').text(`Proactive: ${enabled ? 'Enabled' : 'Paused'}`);
        };

        syncButton('#et_proactive_toggle_panel');
        syncButton('#et_proactive_toggle');
    }

    // Initialize a custom dropdown in the panel
    function initCustomDropdownPanel(id, currentValue) {
        const dropdown = jQuery('#' + id);
        if (!dropdown.length) return;

        dropdown.attr('data-value', currentValue);

        // Update selected option in menu
        dropdown.find('.et-dd-option').removeClass('et-dd-selected');
        dropdown.find(`.et-dd-option[data-value="${currentValue}"]`).addClass('et-dd-selected');

        // Update display
        const selectedOption = dropdown.find(`.et-dd-option[data-value="${currentValue}"]`).html();
        dropdown.find('.et-dd-display').html(selectedOption);
    }

    // Update provider visibility for panel
    function updateProviderVisibilityPanel() {
        const source = jQuery('#et_source_panel').val() || settings.source;
        jQuery('#et_profile_settings_panel').hide();
        jQuery('#et_ollama_settings_panel').hide();
        jQuery('#et_openai_settings_panel').hide();
        jQuery('#et_image_generation_plugin_notice_panel').toggle(settings.imageGenerationEnabled === true);
        if (source === 'profile') jQuery('#et_profile_settings_panel').show();
        if (source === 'ollama') jQuery('#et_ollama_settings_panel').show();
        if (source === 'openai') jQuery('#et_openai_settings_panel').show();
    }

    function updateImageGenerationVisibility() {
        const imgEnabled = settings.imageGenerationEnabled === true;
        const hasChar = !!getCurrentCharacter();
        const inGroup = groupManager && groupManager.isGroupSession();
        jQuery('#et_image_generation_plugin_notice').toggle(imgEnabled);
        jQuery('#et_image_generation_plugin_notice_panel').toggle(imgEnabled);
        jQuery('#et-overflow-gallery').toggle(imgEnabled && hasChar && !inGroup);
    }

    // Initialize custom dropdowns for panel
    function initCustomDropdownsPanel() {
        jQuery(document).off('click.et-dd-panel').on('click.et-dd-panel', '#et_theme_panel_container .et-custom-dropdown .et-dd-trigger, #et_font_family_panel_container .et-custom-dropdown .et-dd-trigger, #et_fab_icon_panel .et-dd-trigger', function (e) {
            e.stopPropagation();
            const dropdown = jQuery(this).closest('.et-custom-dropdown');
            const isOpen = dropdown.hasClass('et-dd-open');

            // Close all other dropdowns
            jQuery('.et-custom-dropdown').removeClass('et-dd-open');

            if (!isOpen) {
                dropdown.addClass('et-dd-open');
            }
        });

        jQuery(document).off('click.et-dd-option-panel').on('click.et-dd-option-panel', '#et_theme_panel_container .et-dd-option, #et_font_family_panel_container .et-dd-option', function () {
            const option = jQuery(this);
            const dropdown = option.closest('.et-custom-dropdown');
            const value = option.data('value');
            const id = dropdown.attr('id');

            dropdown.attr('data-value', value);
            dropdown.find('.et-dd-option').removeClass('et-dd-selected');
            option.addClass('et-dd-selected');

            // Update display
            dropdown.find('.et-dd-display').html(option.html());
            dropdown.removeClass('et-dd-open');

            // Trigger change based on dropdown type
            if (id === 'et_theme_custom') {
                settings.theme = value;
                saveSettings();
                applyAppearanceSettings();
                updateThemePreview();
                // Also update modal dropdown if open
                updateCustomDropdown('et_theme_custom', value);
            } else if (id === 'et_font_family_custom') {
                settings.fontFamily = value;
                saveSettings();
                applyAppearanceSettings();
                updateFontPreview(value);
                // Also update modal dropdown if open
                updateCustomDropdown('et_font_family_custom', value);
            }
        });

        // Close dropdowns when clicking outside
        jQuery(document).off('click.et-dd-outside-panel').on('click.et-dd-outside-panel', function (e) {
            if (!jQuery(e.target).closest('.et-custom-dropdown').length) {
                jQuery('.et-custom-dropdown').removeClass('et-dd-open');
            }
        });
    }

    // Initialize accordion functionality
    function initPanelAccordion() {
        jQuery(document).off('click.et-accordion').on('click.et-accordion', '.et-accordion-header', function () {
            const section = jQuery(this).closest('.et-accordion-section');
            const isOpen = section.hasClass('open');

            // Close all other sections with animation
            jQuery('.et-accordion-section').not(section).each(function () {
                const otherSection = jQuery(this);
                if (otherSection.hasClass('open')) {
                    otherSection.addClass('closing');
                    otherSection.removeClass('open');
                    setTimeout(() => otherSection.removeClass('closing'), 350);
                }
            });

            // Toggle current section
            if (isOpen) {
                section.addClass('closing');
                section.removeClass('open');
                setTimeout(() => section.removeClass('closing'), 350);
            } else {
                section.addClass('open');
            }
        });

        // Bind panel settings event handlers
        bindPanelSettingsEvents();
        bindPlatformSelects();
    }

    // Bind settings change events from panel to settings
    function bindPanelSettingsEvents() {
        // General - Enable toggle
        jQuery('#et_enabled_panel').off('change.panel').on('change.panel', function () {
            const checked = jQuery(this).is(':checked');
            settings.enabled = checked;
            saveSettings();
            toggleEchoTextMaster();
            // Sync with quick toggle and modal toggle
            jQuery('#et_enabled_quick').prop('checked', checked);
            jQuery('#et_enabled').prop('checked', checked);
        });

        // Quick toggle also needs to sync with panel toggle
        jQuery('#et_enabled_quick').off('change.panel').on('change.panel', function () {
            const checked = jQuery(this).is(':checked');
            settings.enabled = checked;
            saveSettings();
            toggleEchoTextMaster();
            // Sync with panel toggle and modal toggle
            jQuery('#et_enabled_panel').prop('checked', checked);
            jQuery('#et_enabled').prop('checked', checked);
        });

        // Auto-Open on Reload
        jQuery('#et_auto_open_panel').off('change.panel').on('change.panel', function () {
            settings.autoOpenOnReload = jQuery(this).is(':checked');
            saveSettings();
            // Sync with modal
            jQuery('#et_auto_open').prop('checked', settings.autoOpenOnReload);
        });

        // Auto-Load Last Character
        jQuery('#et_auto_load_last_char_panel').off('change.panel').on('change.panel', function () {
            settings.autoLoadLastCharacter = jQuery(this).is(':checked');
            saveSettings();
            // Sync with modal
            jQuery('#et_auto_load_last_char').prop('checked', settings.autoLoadLastCharacter);
        });

        // Auto-scroll
        jQuery('#et_auto_scroll_panel').off('change.panel').on('change.panel', function () {
            settings.autoScroll = jQuery(this).is(':checked');
            saveSettings();
            // Sync with modal
            jQuery('#et_auto_scroll').prop('checked', settings.autoScroll);
        });

        // Verbosity Default
        jQuery('#et_verbosity_default_panel').off('change.panel').on('change.panel', function () {
            settings.verbosityDefault = jQuery(this).val();
            saveSettings();
            // Sync with modal
            jQuery('#et_verbosity_default').val(settings.verbosityDefault);
        });

        // Emotion mode and NSFW (panel)
        jQuery('#et_emotion_mode_panel').off('change.panel').on('change.panel', function () {
            setEmotionMode(jQuery(this).val());
            saveSettings();
            // Sync with modal
            jQuery('#et_emotion_mode').val(settings.emotionMode);
            updatePanelStatusRow();
        });

        jQuery('#et_nsfw_enabled_panel').off('change.panel').on('change.panel', function () {
            settings.nsfwEnabled = jQuery(this).is(':checked');
            saveSettings();
            // Sync with modal
            jQuery('#et_nsfw_enabled').prop('checked', settings.nsfwEnabled);
            updatePanelStatusRow();
        });

        // Swiped messages toggle (panel)
        jQuery('#et_swiped_messages_panel').off('change.panel').on('change.panel', function () {
            settings.swipedMessages = jQuery(this).is(':checked');
            saveSettings();
            // Sync with modal
            jQuery('#et_swiped_messages').prop('checked', settings.swipedMessages === true);
        });

        // Generation Engine - Source
        jQuery('#et_source_panel').off('change.panel').on('change.panel', function () {
            settings.source = jQuery(this).val();
            saveSettings();
            updateProviderVisibilityPanel();
            // Sync with modal
            jQuery('#et_source').val(settings.source);
            updateProviderVisibility();
            if (settings.source === 'profile') populateConnectionProfiles();
            if (settings.source === 'ollama') fetchOllamaModels();
        });

        // Profile select
        jQuery('#et_profile_select_panel').off('change.panel').on('change.panel', function () {
            settings.preset = jQuery(this).val();
            saveSettings();
            // Sync with modal
            jQuery('#et_profile_select').val(settings.preset);
        });

        // Ollama
        jQuery('#et_ollama_url_panel').off('change.panel').on('change.panel', function () {
            settings.ollama_url = jQuery(this).val();
            saveSettings();
            // Sync with modal
            jQuery('#et_ollama_url').val(settings.ollama_url);
            fetchOllamaModels();
        });

        jQuery('#et_ollama_model_select_panel').off('change.panel').on('change.panel', function () {
            settings.ollama_model = jQuery(this).val();
            saveSettings();
            // Sync with modal
            jQuery('#et_ollama_model_select').val(settings.ollama_model);
        });

        // OpenAI
        jQuery('#et_openai_preset_panel').off('change.panel').on('change.panel', function () {
            settings.openai_preset = jQuery(this).val();
            const presets = { lmstudio: 'http://localhost:1234/v1', kobold: 'http://localhost:5001/v1', textgen: 'http://localhost:5000/v1', vllm: 'http://localhost:8000/v1' };
            if (presets[settings.openai_preset]) {
                settings.openai_url = presets[settings.openai_preset];
                jQuery('#et_openai_url_panel').val(settings.openai_url);
            }
            saveSettings();
            // Sync with modal
            jQuery('#et_openai_preset').val(settings.openai_preset);
            jQuery('#et_openai_url').val(settings.openai_url);
        });

        jQuery('#et_openai_url_panel').off('change.panel').on('change.panel', function () {
            settings.openai_url = jQuery(this).val();
            saveSettings();
            // Sync with modal
            jQuery('#et_openai_url').val(settings.openai_url);
        });

        jQuery('#et_openai_key_panel').off('change.panel').on('change.panel', function () {
            settings.openai_key = jQuery(this).val();
            saveSettings();
            // Sync with modal
            jQuery('#et_openai_key').val(settings.openai_key);
        });

        jQuery('#et_openai_model_panel').off('change.panel').on('change.panel', function () {
            settings.openai_model = jQuery(this).val();
            saveSettings();
            // Sync with modal
            jQuery('#et_openai_model').val(settings.openai_model);
        });

        // Anti-Refusal Framing
        jQuery('#et_anti_refusal_panel').off('change.panel').on('change.panel', function () {
            settings.antiRefusal = jQuery(this).is(':checked');
            saveSettings();
            // Sync with modal
            jQuery('#et_anti_refusal').prop('checked', settings.antiRefusal);
        });

        // Image Generation toggle (panel)
        jQuery('#et_image_generation_enabled_panel').off('change.panel').on('change.panel', function () {
            settings.imageGenerationEnabled = jQuery(this).is(':checked');
            saveSettings();
            // Sync with modal
            jQuery('#et_image_generation_enabled').prop('checked', settings.imageGenerationEnabled);
            jQuery('#et_image_generation_plugin_notice').toggle(settings.imageGenerationEnabled === true);
            updateImageGenerationVisibility();
        });

        // Context settings
        jQuery('#et_ctx_description_panel').off('change.panel').on('change.panel', function () {
            settings.ctxDescription = jQuery(this).is(':checked');
            saveSettings();
            // Sync with modal
            jQuery('#et_ctx_description').prop('checked', settings.ctxDescription);
        });

        jQuery('#et_ctx_personality_panel').off('change.panel').on('change.panel', function () {
            settings.ctxPersonality = jQuery(this).is(':checked');
            saveSettings();
            // Sync with modal
            jQuery('#et_ctx_personality').prop('checked', settings.ctxPersonality);
        });

        jQuery('#et_ctx_scenario_panel').off('change.panel').on('change.panel', function () {
            settings.ctxScenario = jQuery(this).is(':checked');
            saveSettings();
            // Sync with modal
            jQuery('#et_ctx_scenario').prop('checked', settings.ctxScenario);
        });

        jQuery('#et_ctx_persona_panel').off('change.panel').on('change.panel', function () {
            settings.ctxPersona = jQuery(this).is(':checked');
            saveSettings();
            // Sync with modal
            jQuery('#et_ctx_persona').prop('checked', settings.ctxPersona);
        });

        jQuery('#et_ctx_authors_note_panel').off('change.panel').on('change.panel', function () {
            settings.ctxAuthorsNote = jQuery(this).is(':checked');
            saveSettings();
            // Sync with modal
            jQuery('#et_ctx_authors_note').prop('checked', settings.ctxAuthorsNote);
        });

        jQuery('#et_ctx_world_info_panel').off('change.panel').on('change.panel', function () {
            settings.ctxWorldInfo = jQuery(this).is(':checked');
            saveSettings();
            // Sync with modal
            jQuery('#et_ctx_world_info').prop('checked', settings.ctxWorldInfo);
            // Toggle sub-panel
            jQuery('#et-ctx-wi-sub_panel').toggle(settings.ctxWorldInfo);
            if (settings.ctxWorldInfo) {
                const _m = settings.ctxWorldInfoMode || 'min_order';
                jQuery('#et-ctx-wi-sub_panel .et-ctx-wi-mode-btn').removeClass('et-ctx-wi-mode-btn-active');
                jQuery('#et-ctx-wi-sub_panel .et-ctx-wi-mode-btn[data-mode="' + _m + '"]').addClass('et-ctx-wi-mode-btn-active');
                toggleWIPanelRows(_m);
            }
        });

        // World Info mode buttons (panel)
        jQuery('#et-ctx-wi-sub_panel').off('click.wi-panel').on('click.wi-panel', '.et-ctx-wi-mode-btn', function () {
            const mode = jQuery(this).data('mode');
            settings.ctxWorldInfoMode = mode;
            saveSettings();
            jQuery('#et-ctx-wi-sub_panel .et-ctx-wi-mode-btn').removeClass('et-ctx-wi-mode-btn-active');
            jQuery(this).addClass('et-ctx-wi-mode-btn-active');
            toggleWIPanelRows(mode);
        });

        // World Info input fields (panel)
        jQuery('#et_ctx_wi_min_panel').off('input.wi-panel').on('input.wi-panel', function () {
            const val = parseInt(jQuery(this).val(), 10);
            settings.ctxWorldInfoMinOrder = isNaN(val) ? 250 : val;
            saveSettings();
        });
        jQuery('#et_ctx_wi_max_panel').off('input.wi-panel').on('input.wi-panel', function () {
            const raw = jQuery(this).val().trim();
            const val = parseInt(raw, 10);
            settings.ctxWorldInfoMaxOrder = (raw === '' || isNaN(val)) ? null : val;
            saveSettings();
        });
        jQuery('#et_ctx_wi_targeted_panel').off('input.wi-panel').on('input.wi-panel', function () {
            const raw = jQuery(this).val().trim();
            settings.ctxWorldInfoTargetedOrders = !raw ? [] : raw.split(',').map(function (v) { return parseInt(v.trim(), 10); }).filter(function (n) { return !isNaN(n); });
            saveSettings();
        });

        jQuery('#et_ctx_st_messages_panel').off('change.panel').on('change.panel', function () {
            settings.ctxSTMessages = jQuery(this).is(':checked');
            saveSettings();
            // Sync with modal
            jQuery('#et_ctx_st_messages').prop('checked', settings.ctxSTMessages);
        });

        // Strip Reasoning Tags toggle
        jQuery('#et_strip_thinking_enabled_panel').off('change.panel').on('change.panel', function () {
            settings.stripThinkingTagsEnabled = jQuery(this).is(':checked');
            saveSettings();
            jQuery('#et_strip_thinking_enabled').prop('checked', settings.stripThinkingTagsEnabled);
            updateStripTagsSubsectionVisibility();
        });

        // Strip tag chip remove
        jQuery('#et_strip_tag_chips_panel').off('click.panel').on('click.panel', '.et-strip-tag-remove', function () {
            const idx = parseInt(jQuery(this).data('index'), 10);
            if (!Array.isArray(settings.stripThinkingTagList)) return;
            settings.stripThinkingTagList.splice(idx, 1);
            invalidateStripTagsCache();
            saveSettings();
            renderStripTagChips('et_strip_tag_chips_panel');
            renderStripTagChips('et_strip_tag_chips');
        });

        // Strip tag add button
        jQuery('#et_strip_tag_add_panel').off('click.panel').on('click.panel', function () {
            const input = jQuery('#et_strip_tag_input_panel');
            const val = (input.val() || '').trim().replace(/^<|>$/g, '');
            if (!val) return;
            if (!Array.isArray(settings.stripThinkingTagList)) settings.stripThinkingTagList = [];
            if (!settings.stripThinkingTagList.includes(val)) {
                settings.stripThinkingTagList.push(val);
                invalidateStripTagsCache();
                saveSettings();
                renderStripTagChips('et_strip_tag_chips_panel');
                renderStripTagChips('et_strip_tag_chips');
            }
            input.val('');
        });

        // Strip tag input enter key
        jQuery('#et_strip_tag_input_panel').off('keydown.panel').on('keydown.panel', function (e) {
            if (e.key === 'Enter') jQuery('#et_strip_tag_add_panel').trigger('click');
        });

        // Strip tag reset button
        jQuery('#et_strip_tag_reset_panel').off('click.panel').on('click.panel', function () {
            settings.stripThinkingTagList = [...STRIP_TAGS_DEFAULTS];
            invalidateStripTagsCache();
            saveSettings();
            renderStripTagChips('et_strip_tag_chips_panel');
            renderStripTagChips('et_strip_tag_chips');
        });

        // Custom pattern remove
        jQuery('#et_custom_pattern_list_panel').off('click.panel').on('click.panel', '.et-custom-pattern-remove', function () {
            const idx = parseInt(jQuery(this).data('index'), 10);
            if (!Array.isArray(settings.stripCustomPatterns)) return;
            settings.stripCustomPatterns.splice(idx, 1);
            invalidateStripTagsCache();
            saveSettings();
            renderCustomPatternRows('et_custom_pattern_list_panel');
            renderCustomPatternRows('et_custom_pattern_list');
        });

        // Custom pattern add
        jQuery('#et_custom_pattern_add_panel').off('click.panel').on('click.panel', function () {
            const start = (jQuery('#et_custom_pattern_start_panel').val() || '').trim();
            const end = (jQuery('#et_custom_pattern_end_panel').val() || '').trim();
            if (!start || !end) return;
            if (!Array.isArray(settings.stripCustomPatterns)) settings.stripCustomPatterns = [];
            settings.stripCustomPatterns.push({ start, end });
            invalidateStripTagsCache();
            saveSettings();
            renderCustomPatternRows('et_custom_pattern_list_panel');
            renderCustomPatternRows('et_custom_pattern_list');
            jQuery('#et_custom_pattern_start_panel').val('');
            jQuery('#et_custom_pattern_end_panel').val('');
        });

        // Font size
        jQuery('#et_font_size_panel').off('input.panel').on('input.panel', function () {
            settings.fontSize = parseInt(jQuery(this).val());
            jQuery('#et_font_size_val_panel').text(settings.fontSize + 'px');
            applyAppearanceSettings();
            saveSettings();
            // Sync with modal
            jQuery('#et_font_size').val(settings.fontSize);
            jQuery('#et_font_size_val').text(settings.fontSize + 'px');
        });

        // Line spacing
        jQuery('#et_line_spacing_panel').off('input.panel').on('input.panel', function () {
            settings.lineSpacing = parseFloat(jQuery(this).val());
            jQuery('#et_line_spacing_val_panel').text(settings.lineSpacing.toFixed(2));
            applyAppearanceSettings();
            saveSettings();
            jQuery('#et_line_spacing').val(settings.lineSpacing);
            jQuery('#et_line_spacing_val').text(settings.lineSpacing.toFixed(2));
        });

        // Message spacing
        jQuery('#et_paragraph_spacing_panel').off('input.panel').on('input.panel', function () {
            settings.paragraphSpacing = parseInt(jQuery(this).val());
            jQuery('#et_paragraph_spacing_val_panel').text(settings.paragraphSpacing + 'px');
            applyAppearanceSettings();
            saveSettings();
            jQuery('#et_paragraph_spacing').val(settings.paragraphSpacing);
            jQuery('#et_paragraph_spacing_val').text(settings.paragraphSpacing + 'px');
        });

        // Glass blur
        jQuery('#et_glass_blur_panel').off('input.panel').on('input.panel', function () {
            settings.glassBlur = parseInt(jQuery(this).val());
            jQuery('#et_glass_blur_val_panel').text(settings.glassBlur + 'px');
            applyAppearanceSettings();
            saveSettings();
            // Sync with modal
            jQuery('#et_glass_blur').val(settings.glassBlur);
            jQuery('#et_glass_blur_val').text(settings.glassBlur + 'px');
        });

        // Glass opacity
        jQuery('#et_glass_opacity_panel').off('input.panel').on('input.panel', function () {
            settings.glassOpacity = parseInt(jQuery(this).val());
            jQuery('#et_glass_opacity_val_panel').text(settings.glassOpacity + '%');
            applyAppearanceSettings();
            saveSettings();
            // Sync with modal
            jQuery('#et_glass_opacity').val(settings.glassOpacity);
            jQuery('#et_glass_opacity_val').text(settings.glassOpacity + '%');
        });



        // FAB Size
        jQuery('#et_fab_size_panel').off('input.panel').on('input.panel', function () {
            settings.fabSize = parseInt(jQuery(this).val());
            jQuery('#et_fab_size_val_panel').text(settings.fabSize + 'px');
            applyAppearanceSettings();
            positionFab();
            saveSettings();
            // Sync with modal
            jQuery('#et_fab_size').val(settings.fabSize);
            jQuery('#et_fab_size_val').text(settings.fabSize + 'px');
        });

        // FAB Opacity
        jQuery('#et_fab_opacity_panel').off('input.panel').on('input.panel', function () {
            settings.fabOpacity = parseInt(jQuery(this).val());
            jQuery('#et_fab_opacity_val_panel').text(settings.fabOpacity + '%');
            applyAppearanceSettings();
            positionFab();
            saveSettings();
        });

        // FAB Icon
        jQuery('#et_fab_icon_panel').off('click.panel', '.et-dd-option').on('click.panel', '#et_fab_icon_panel .et-dd-option', function () {
            const option = jQuery(this);
            const dropdown = option.closest('.et-custom-dropdown');
            const value = option.data('value');

            dropdown.attr('data-value', value);
            dropdown.find('.et-dd-option').removeClass('et-dd-selected');
            option.addClass('et-dd-selected');

            // Update display
            dropdown.find('.et-dd-display').html(option.html());
            dropdown.removeClass('et-dd-open');

            settings.fabIcon = value;
            applyAppearanceSettings();
            saveSettings();
            // Sync with modal
            jQuery('.et-icon-option').removeClass('selected');
            jQuery(`.et-icon-option[data-icon="${settings.fabIcon}"]`).addClass('selected');
        });

        // Activity mode selector (panel accordion)
        jQuery('#et_activity_mode_grid_panel').off('click.panel').on('click.panel', '.et-activity-btn', function () {
            const mode = jQuery(this).data('mode');
            applyActivityMode(mode,
                '#et_activity_mode_grid_panel', '#et_activity_custom_row_panel',
                '#et_proactive_rate_limit_panel', '#et_proactive_rate_limit_val_panel', '#et_activity_mode_hint_panel');
            // Mirror to modal if open
            applyActivityMode(mode,
                '#et_activity_mode_grid', '#et_activity_custom_row',
                '#et_proactive_rate_limit', '#et_proactive_rate_limit_val', '#et_activity_mode_hint');
        });

        jQuery('#et_proactive_rate_limit_panel').off('input.panel').on('input.panel', function () {
            const minutes = parseInt(jQuery(this).val(), 10) || 180;
            jQuery('#et_proactive_rate_limit_val_panel').text(minutes + ' min');
            settings.proactiveRateLimitMinutes = minutes;
            saveSettings();
            jQuery('#et_proactive_rate_limit').val(minutes);
            jQuery('#et_proactive_rate_limit_val').text(minutes + ' min');
        });

        jQuery('#et_proactive_emotion_urgency_panel').off('change.panel').on('change.panel', function () {
            settings.proactiveEmotionUrgency = jQuery(this).prop('checked');
            saveSettings();
            jQuery('#et_proactive_emotion_urgency').prop('checked', settings.proactiveEmotionUrgency);
        });

        jQuery('#et_proactive_refresh_panel').off('click.panel').on('click.panel', function () {
            refreshProactiveInsights();
        });

        jQuery('#et_proactive_toggle_panel').off('click.panel').on('click.panel', function () {
            // Toggle both proactiveMessagingEnabled and dynamicSystemsEnabled
            const newState = settings.proactiveMessagingEnabled === false ? true : false;
            settings.proactiveMessagingEnabled = newState;
            settings.dynamicSystemsEnabled = newState;
            saveSettings();
            updateProactiveToggleButtons();
            startProactiveScheduler();
            refreshProactiveInsights();
        });

        jQuery('#et_trigger_message_panel').off('click.panel').on('click.panel', function () {
            triggerTestProactiveMessage();
        });

        // Trigger pill click-to-copy (panel accordion)
        jQuery(document).off('click.pillcopy').on('click.pillcopy', '.et-imagetrig-pill-copyable', function () {
            const pill = jQuery(this);
            const text = pill.data('copy');
            if (!text) return;
            navigator.clipboard.writeText(text).then(() => {
                pill.addClass('et-imagetrig-pill-copied');
                setTimeout(() => pill.removeClass('et-imagetrig-pill-copied'), 1400);
            }).catch(() => {});
        });

        // iOS: patch panel sliders for touch. Called here — after the panel
        // HTML is guaranteed to be in the DOM and all jQuery input.panel
        // handlers above are already bound — so the touch handler's
        // dispatched 'input' events will trigger them correctly.
        if (window.EchoTextSettingsModal && window.EchoTextSettingsModal.patchIOSSliders) {
            window.EchoTextSettingsModal.patchIOSSliders(document);
        }

        // Custom theme editor button (panel drawer)
        jQuery(document).off('click.et-panel-te').on('click.et-panel-te', '#et-te-open-btn-panel', function () {
            if (themeEditor) themeEditor.openThemeEditor();
            moveModalToPortal('#et-theme-editor-overlay');
        });
    }

    // ── Background luminance detection for adaptive glassmorphism ──────────────
    // Extracts {r, g, b} integer components from a CSS rgb/rgba/hex color string.
    // Returns null if the string cannot be parsed (e.g. named colors, gradients).
    function extractRgbComponents(colorStr) {
        if (!colorStr) return null;
        const m = String(colorStr).match(/rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/);
        if (m) return { r: Math.round(+m[1]), g: Math.round(+m[2]), b: Math.round(+m[3]) };
        const hm = String(colorStr).match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
        if (hm) return { r: parseInt(hm[1], 16), g: parseInt(hm[2], 16), b: parseInt(hm[3], 16) };
        return null;
    }

    // Converts a parsed CSS rgb/rgba color string to WCAG relative luminance (0–1).
    // Returns null if the string cannot be parsed (e.g. named colors, gradients).
    function cssColorToRelativeLuminance(cssColor) {
        if (!cssColor) return null;
        const m = String(cssColor).match(/rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/);
        if (!m) return null;
        const lin = v => {
            const c = v / 255;
            return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * lin(+m[1]) + 0.7152 * lin(+m[2]) + 0.0722 * lin(+m[3]);
    }

    // Detects whether SillyTavern's current background is perceptually light.
    // Uses three independent signals in priority order so it works across the
    // full variety of ST themes and background image configurations.
    function detectSillyTavernBgIsLight() {
        const cs = getComputedStyle(document.documentElement);

        // 1. SmartThemeBlurTintColor — ST's tint for blurred-glass surfaces;
        //    closely tracks the underlying background lightness.
        const tint = cs.getPropertyValue('--SmartThemeBlurTintColor').trim();
        if (tint) {
            const lum = cssColorToRelativeLuminance(tint);
            if (lum !== null) return lum > 0.25;
        }

        // 2. Actual background-color on SillyTavern's body element.
        const bgEl = document.getElementById('body_2') || document.body;
        const bgColor = getComputedStyle(bgEl).backgroundColor;
        if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
            const lum = cssColorToRelativeLuminance(bgColor);
            if (lum !== null) return lum > 0.25;
        }

        // 3. SmartThemeBodyColor (text color) — inverted: dark text implies light bg.
        const textColor = cs.getPropertyValue('--SmartThemeBodyColor').trim();
        if (textColor) {
            const lum = cssColorToRelativeLuminance(textColor);
            if (lum !== null) return lum < 0.25;
        }

        return false; // safe default: treat as dark
    }

    // Adds or removes html.et-bg-light based on detected background luminance.
    // Reads SillyTavern's live CSS custom properties and maps them to EchoText
    // CSS variables. Only called when the 'sillytavern' theme preset is active.
    // Handles the values that cannot be expressed as pure CSS var() references
    // (e.g. RGB triplets, derived alpha variants).
    function applySillyTavernThemeColors() {
        const cs  = getComputedStyle(document.documentElement);
        const root = document.documentElement;

        // ── Panel glass background ──────────────────────────────────────────
        // --SmartThemeBlurTintColor is ST's "UI Background" tint.  We extract
        // its R/G/B so that --et-panel-bg-rgb can feed rgba(r,g,b,opacity).
        const blurTint = cs.getPropertyValue('--SmartThemeBlurTintColor').trim();
        const blurRgb  = extractRgbComponents(blurTint);
        if (blurRgb) {
            root.style.setProperty('--et-panel-bg-rgb', `${blurRgb.r}, ${blurRgb.g}, ${blurRgb.b}`);
        } else {
            root.style.removeProperty('--et-panel-bg-rgb');
        }

        // ── Accent / theme colour ───────────────────────────────────────────
        // --SmartThemeQuoteColor is ST's "Quote Text" highlight — typically the
        // most vivid accent in the palette, a good stand-in for ET's accent.
        const quoteColor = cs.getPropertyValue('--SmartThemeQuoteColor').trim();
        if (quoteColor) {
            root.style.setProperty('--et-theme-color', quoteColor);
        } else {
            root.style.removeProperty('--et-theme-color');
        }

        // ── Character bubble background ─────────────────────────────────────
        // --SmartThemeBotMesBlurTintColor is ST's "AI Message" tint.
        // We use a moderate alpha so it stays translucent on the glass panel.
        const botTint = cs.getPropertyValue('--SmartThemeBotMesBlurTintColor').trim();
        const botRgb  = extractRgbComponents(botTint);
        if (botRgb) {
            root.style.setProperty('--et-char-bubble-bg', `rgba(${botRgb.r}, ${botRgb.g}, ${botRgb.b}, 0.55)`);
        } else {
            root.style.removeProperty('--et-char-bubble-bg');
        }
    }

    // Only runs auto-detection for the 'sillytavern' theme preset (all other
    // presets are explicitly dark and never need the light variant).
    function applyAdaptiveGlass() {
        const theme = getAllThemePresets()[settings.theme] || THEME_PRESETS.sillytavern;
        if (theme.primary) {
            // Explicit dark theme selected — never apply light glass
            document.documentElement.classList.remove('et-bg-light');
            return;
        }
        if (detectSillyTavernBgIsLight()) {
            document.documentElement.classList.add('et-bg-light');
        } else {
            document.documentElement.classList.remove('et-bg-light');
        }
        jQuery('#et-panel').attr('data-et-scheme', getColorScheme());
    }

    /** 'light' when the panel uses its light glass (a light SillyTavern background), else 'dark'. */
    function getColorScheme() {
        return document.documentElement.classList.contains('et-bg-light') ? 'light' : 'dark';
    }

    function applyAppearanceSettings() {
        const theme = getAllThemePresets()[settings.theme] || THEME_PRESETS.sillytavern;

        if (theme.primary) {
            document.documentElement.style.setProperty('--et-bg', theme.primary);
            document.documentElement.style.setProperty('--et-header-bg', 'rgba(0,0,0,0.3)');
            document.documentElement.style.setProperty('--et-char-bubble-bg', 'rgba(255,255,255,0.08)');
            // Revert panel-bg-rgb to :root default so it matches the explicit theme's dark palette.
            document.documentElement.style.removeProperty('--et-panel-bg-rgb');
        } else {
            document.documentElement.style.removeProperty('--et-bg');
            document.documentElement.style.removeProperty('--et-header-bg');
            document.documentElement.style.removeProperty('--et-char-bubble-bg');
        }
        if (theme.text) {
            document.documentElement.style.setProperty('--et-text', theme.text);
            document.documentElement.style.setProperty('--et-text-muted', hexToRgba(theme.text, 0.55));
        } else {
            document.documentElement.style.removeProperty('--et-text');
            document.documentElement.style.removeProperty('--et-text-muted');
        }
        if (theme.accent) {
            document.documentElement.style.setProperty('--et-theme-color', theme.accent);
        } else {
            document.documentElement.style.removeProperty('--et-theme-color');
        }

        document.documentElement.style.setProperty('--et-glass-blur', settings.glassBlur + 'px');
        document.documentElement.style.setProperty('--et-glass-opacity', (settings.glassOpacity / 100).toFixed(2));
        document.documentElement.style.setProperty('--et-font-size', settings.fontSize + 'px');
        document.documentElement.style.setProperty('--et-font-family', `'${settings.fontFamily}', sans-serif`);
        // The font alone, for platform looks that put their own fonts after it
        document.documentElement.style.setProperty('--et-font-name', `'${settings.fontFamily}'`);
        document.documentElement.style.setProperty('--et-fab-size', settings.fabSize + 'px');
        document.documentElement.style.setProperty('--et-fab-opacity', (settings.fabOpacity || 100) / 100);
        document.documentElement.style.setProperty('--et-line-spacing', (settings.lineSpacing || 1.3).toFixed(2));
        document.documentElement.style.setProperty('--et-paragraph-spacing', (settings.paragraphSpacing || 12) + 'px');

        loadGoogleFont(settings.fontFamily);



        // Update FAB
        const fab = jQuery('#et-fab');
        if (fab.length) {
            fab.find('i').attr('class', `fa-solid ${settings.fabIcon}`);
            fab.css({ width: settings.fabSize + 'px', height: settings.fabSize + 'px' });
        }

        // Re-render messages if panel is open (to apply avatar visibility)
        if (panelOpen) {
            const history = getChatHistory();
            renderMessages(history);
        }

        // For the SillyTavern preset, pull live colors from ST's CSS variables.
        // Must run before applyAdaptiveGlass() so the correct tint is detected.
        if (!theme.primary) {
            applySillyTavernThemeColors();
        }

        applyAdaptiveGlass();
    }

    function hexToRgba(hex, alpha) {
        // Handle CSS var() or named colors — just return with opacity
        if (!hex || hex.startsWith('var(') || hex.startsWith('rgb')) {
            return `rgba(180,180,200,${alpha})`;
        }
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        if (isNaN(r)) return `rgba(180,180,200,${alpha})`;
        return `rgba(${r},${g},${b},${alpha})`;
    }

    function loadGoogleFont(fontFamily) {
        const googleFonts = ['Inter', 'Nunito', 'Poppins', 'Lato', 'Roboto', 'Source Sans Pro', 'Merriweather', 'Playfair Display'];
        if (!googleFonts.includes(fontFamily)) return;
        if (loadedFontFamily === fontFamily) return;

        jQuery('#et-google-font').remove();
        const fontSlug = fontFamily.replace(/ /g, '+');
        const link = document.createElement('link');
        link.id = 'et-google-font';
        link.rel = 'stylesheet';
        link.href = `https://fonts.googleapis.com/css2?family=${fontSlug}:wght@400;500;600;700&display=swap`;
        document.head.appendChild(link);
        loadedFontFamily = fontFamily;
    }

    function updateThemePreview() {
        const theme = getAllThemePresets()[settings.theme] || THEME_PRESETS.sillytavern;
        const preview = jQuery('#et_theme_preview');
        if (!preview.length) return;
        const swatches = theme.swatches || [];
        preview.html(swatches.map(c => `<span class="et-theme-swatch" style="background:${c};"></span>`).join(''));
    }

    function updateProviderVisibility() {
        const source = jQuery('#et_source').val() || settings.source;
        jQuery('#et_profile_settings').hide();
        jQuery('#et_ollama_settings').hide();
        jQuery('#et_openai_settings').hide();
        updateImageGenerationVisibility();
        if (source === 'profile') jQuery('#et_profile_settings').show();
        if (source === 'ollama') jQuery('#et_ollama_settings').show();
        if (source === 'openai') jQuery('#et_openai_settings').show();
    }

    // ============================================================
    // CHARACTER CARD HELPERS
    // ============================================================

    function getCurrentCharacter() {
        // In a group session, return the active group member instead of context.characterId
        if (groupManager && groupManager.isGroupSession()) {
            const groupChar = groupManager.getActiveGroupCharacter();
            if (groupChar) return groupChar;
        }

        const pickerChars = getAllCharactersForPicker();
        if (selectedCharacterKey) {
            const selectedChar = pickerChars.find(char => char.__key === selectedCharacterKey);
            if (selectedChar) return selectedChar;
        }

        const context = SillyTavern.getContext();
        if (context.characterId === undefined || context.characterId === null) return null;
        return context.characters?.[context.characterId] || null;
    }

    function getCharacterKey() {
        const char = getCurrentCharacter();
        if (!char) return null;
        return char.avatar || char.name || 'unknown';
    }

    function getCharacterName() {
        const char = getCurrentCharacter();
        return char?.name || 'Character';
    }

    function getCharacterByKey(characterKey) {
        if (!characterKey) return null;
        return getAllCharactersForPicker().find(char => char.__key === characterKey) || null;
    }

    function applySelectedCharacterToPanel() {
        if (!panelOpen) return;

        // ── Combine mode: show all members in header ──────────────────
        if (groupManager && groupManager.isGroupSession() && groupManager.isCombineMode()) {
            const members = groupManager.getGroupMembers();
            const charNames = members.map(c => c.name).join(', ');
            jQuery('#et-panel-drag-handle').removeClass('et-panel-header-no-char');
            jQuery('#et-panel').removeClass('et-panel-no-char');
            jQuery('#et-char-name').html(`Group: ${escapeHtml(charNames)}<i class="fa-solid fa-chevron-down et-char-name-caret" aria-hidden="true"></i>`);
            jQuery('#et-input').attr('placeholder', `Message all: ${charNames}...`).prop('disabled', false);
            jQuery('#et-send-btn, #et-attach-btn, #et-voice-btn').prop('disabled', false);
            setComposeMode(null);
            updatePanelStatusRow();
            updateImageGenerationVisibility();
            jQuery('#et-overflow-saveload, #et-overflow-char-divider, #et-overflow-clear').show();
            const history = getChatHistory();
            renderMessages(history);
            return;
        }

        // ── Normal / single-character path ───────────────────────────
        const charName = getCharacterName();
        const hasChar = !!getCurrentCharacter();
        const inGroup = groupManager && groupManager.isGroupSession();

        jQuery('#et-panel-drag-handle').toggleClass('et-panel-header-no-char', !hasChar);
        jQuery('#et-panel').toggleClass('et-panel-no-char', !hasChar);
        jQuery('#et-char-name').html(`${escapeHtml(hasChar ? charName : 'Choose A Character')}<i class="fa-solid fa-chevron-down et-char-name-caret" aria-hidden="true"></i>`);
        jQuery('#et-char-avatar-wrap').replaceWith(buildAvatarHtml(charName, '', 'et-char-avatar-wrap'));
        jQuery('#et-input').attr('placeholder', hasChar ? `Text ${charName}...` : 'Text a character...').prop('disabled', !hasChar);
        jQuery('#et-send-btn, #et-attach-btn, #et-voice-btn').prop('disabled', !hasChar);
        setComposeMode(null);
        updatePanelStatusRow();
        updateImageGenerationVisibility();

        // Show/hide character-dependent overflow menu items
        jQuery('#et-overflow-saveload, #et-overflow-char-divider, #et-overflow-clear').toggle(hasChar);

        const history = getChatHistory();
        renderMessages(history);
        const charKey = getCharacterKey();
        if (charKey && !inGroup) {
            syncProactiveStateWithHistory(charKey, history);
        }
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function getAllCharactersForPicker() { return characterPicker.getAllCharactersForPicker(); }
    function getAvatarUrlForCharacter(char) { return characterPicker.getAvatarUrlForCharacter(char); }
    function openCharacterPicker(centerInPanel = false) { characterPicker.openCharacterPicker(centerInPanel); }
    function openEmbeddedCharacterPicker() { characterPicker.openEmbeddedCharacterPicker(); }
    function closeCharacterPicker() { characterPicker.closeCharacterPicker(); }
    function toggleCharacterPicker() { characterPicker.toggleCharacterPicker(); }
    function _pickerAvatarBg(name) { return characterPicker ? characterPicker._pickerAvatarBg(name) : 'var(--et-theme-color)'; }

    function updatePanelStatusRow(options = {}) {
        const { typing = false } = options;
        const row = jQuery('#et-panel-status-trigger');
        const content = jQuery('#et-panel-status-content');
        if (!row.length || !content.length) return;

        // Note: typing state is indicated by the send/stop button — the status row
        // continues to show emotion/mood info during generation.

        // In group session the emotion system is off.
        // Show a static group indicator chip instead.
        if (groupManager && groupManager.isGroupSession()) {
            if (emotionSystem) emotionSystem.closeEmotionPopup();
            row.removeClass('et-panel-status-clickable');
            if (groupManager.isCombineMode()) {
                row.attr('title', 'Combined mode — all characters will reply in sequence');
                content.html('<span class="et-status-chip et-status-group-chip"><i class="fa-solid fa-layer-group"></i><span class="et-status-main">Combined</span></span>');
            } else {
                row.attr('title', 'Group Chat — the emotion system is paused');
                content.html('<span class="et-status-chip et-status-group-chip"><i class="fa-solid fa-users"></i><span class="et-status-main">Group Chat</span></span>');
            }
            return;
        }

        row.addClass('et-panel-status-clickable');
        row.attr('title', 'Open emotion details');
        content.html(emotionSystem ? emotionSystem.buildStatusHtml() : '');
        if (emotionSystem) emotionSystem.refreshEmotionPopup();
    }

    function getUserName() {
        return SillyTavern.getContext().name1 || 'You';
    }

    function isCombinedGroupMode() {
        return !!(groupManager && groupManager.isGroupSession() && groupManager.isCombineMode());
    }

    function getCombinedGroupMembers() {
        return groupManager ? groupManager.getGroupMembers() : [];
    }

    function buildCombinedHistoryContext(history, members) {
        const safeHistory = Array.isArray(history) ? history : [];
        const safeMembers = Array.isArray(members) ? members : [];
        if (!safeHistory.length) return '';

        const memberMap = new Map(safeMembers.map(member => [member.avatar || member.name, member.name || 'Character']));
        const lines = safeHistory.flatMap(msg => {
            const sender = msg.is_user
                ? getUserName()
                : (msg.charName || memberMap.get(msg.charKey) || getCharacterName());
            const text = getContextMessageText(msg.mes);
            if (text === null) return [];
            const line = `${sender}: ${text}`;
            const reactions = getUserReactionIds(msg);
            return reactions.length
                ? [line, `[${getUserName()} reacted ${reactions.join(', ')} to ${sender}'s message]`]
                : [line];
        }).filter(Boolean);

        return lines.length
            ? `\n\nRecent group chat history:\n${lines.join('\n')}`
            : '';
    }

    /**
     * Builds the shared group system prompt used as the first message in every
     * combined-mode API call. Intentionally brief — character cards and history
     * are injected at the message-turn level by buildCombinedGroupApiMessages.
     */
    function buildGroupSharedSystemPrompt() {
        const members = getCombinedGroupMembers();
        const memberNames = members.map(m => m.name || 'Character').join(', ');
        const userName = getUserName();
        const parts = [];

        // ── Group scene-setting (user-editable via Prompt Manager) ──────────
        const configDefaults = window.EchoTextConfig?.defaultSettings || {};
        let sceneFrame = replaceMacros(
            (settings.promptGroupSceneFrame != null && settings.promptGroupSceneFrame !== '')
                ? settings.promptGroupSceneFrame
                : (configDefaults.promptGroupSceneFrame || '')
        );
        // {{group_members}} is runtime-dynamic — substitute after replaceMacros
        sceneFrame = sceneFrame.replace(/\{\{group_members\}\}/g, memberNames);
        if (sceneFrame) parts.push(sceneFrame);

        // ── Anti-refusal framing ─────────────────────────────────────────────
        if (settings.antiRefusal === true) {
            const antiRefusal = replaceMacros(
                settings.promptAntiRefusalFrame ||
                window.EchoTextConfig?.defaultSettings?.promptAntiRefusalFrame || ''
            );
            if (antiRefusal) parts.push(antiRefusal);
        } else {
            parts.push('All participants are fictional. Stay fully in character and do not add disclaimers or refusals.');
        }

        return parts.filter(Boolean).join('\n\n');
    }

    /**
     * Builds the full API messages array for one character's turn in Combined Group Mode.
     *
     * Layout:
     *   [system]           Shared group prompt + anti-refusal framing
     *   [user / assistant] Prior history turns — assistant turns carry "[CharName]: " attribution
     *   [user]             Latest user message
     *                      + user persona description
     *                      + this character's Description & Personality card
     *                      + generation cue + verbosity instruction
     *
     * This keeps the three concerns — group framing, history context, and per-character
     * identity — in their optimal positions: framing at primacy, character card at recency,
     * history bridging the two so the model always knows who said what.
     *
     * @param {Array}  history - full combine history including the latest user message
     * @param {object} char    - the character object whose turn it is to reply
     * @returns {{ apiMessages, rawPrompt, systemPrompt }}
     */
    async function buildCombinedGroupApiMessages(history, char) {
        const charName  = char?.name || 'Character';
        const userName  = getUserName();
        const allHistory = Array.isArray(history) ? history : [];

        // ── 1. Shared system prompt (group scene + anti-refusal) ─────────────
        const systemPrompt = buildGroupSharedSystemPrompt();

        // ── 2. Split history: prior turns vs. latest user message ────────────
        const lastUserIdx = findLastUserMessageIndex(allHistory);
        const priorHistory = lastUserIdx >= 0 ? allHistory.slice(0, lastUserIdx) : allHistory;
        const latestUserMsg = lastUserIdx >= 0 ? allHistory[lastUserIdx] : null;

        // ── 3. Prior history as attributed message turns ──────────────────────
        // Assistant turns get "[CharName]: " prefixed so the model never mistakes
        // another character's line as its own prior output.
        const historyMessages = priorHistory.flatMap(msg => {
            const text = getContextMessageText(msg.mes);
            if (text === null) return [];
            if (msg.is_user) {
                return [{ role: 'user', content: text }];
            }
            const speaker = msg.charName || charName;
            return [{ role: 'assistant', content: `${speaker}: ${text}` },
                ...buildCombinedReactionTurns(msg, speaker)];
        });

        // ── 4. Final user turn: input + persona + character card + cue ────────
        const finalUserParts = [];

        // Latest user message
        if (latestUserMsg) {
            finalUserParts.push(getContextMessageText(latestUserMsg.mes) ?? '');
        }

        // User persona description
        if (settings.ctxPersona === true) {
            try {
                const powerUser = SillyTavern.getContext().powerUserSettings || {};
                const personaDesc = (powerUser.persona_description || '').trim();
                if (personaDesc) {
                    finalUserParts.push(`<user_persona>\n${userName}'s persona: ${expandTimeDateMacros(replaceMacros(personaDesc))}\n</user_persona>`);
                }
            } catch (e) { /* ignore */ }
        }

        // Character card — wrapped in XML so models treat it as reference data, not output
        const charDescription = (char?.description || char?.data?.description || '').trim();
        const charPersonality  = (char?.personality  || char?.data?.personality  || '').trim();
        const charCardParts = [];
        if (settings.ctxDescription !== false && charDescription) charCardParts.push(`${charName}'s description: ${expandTimeDateMacros(replaceMacros(charDescription))}`);
        if (settings.ctxPersonality !== false && charPersonality)  charCardParts.push(`${charName}'s personality: ${expandTimeDateMacros(replaceMacros(charPersonality))}`);  
        if (charCardParts.length > 0) finalUserParts.push(`<character_reference>\n${charCardParts.join('\n\n')}\n</character_reference>`);

        // Generation cue (user-editable via Prompt Manager — supports {{char}} macro)
        const charCueTemplate =
            (settings.promptGroupCharacterCue != null && settings.promptGroupCharacterCue !== '')
                ? settings.promptGroupCharacterCue
                : (window.EchoTextConfig?.defaultSettings?.promptGroupCharacterCue || '');
        // replaceMacros resolves {{char}} via the currently active character key
        // (set by generateEchoTextCombined before calling this function).
        const charCue = expandTimeDateMacros(replaceMacros(charCueTemplate));
        if (charCue) finalUserParts.push(charCue);

        // Verbosity
        const charKey = char?.avatar || char?.name || '';
        const verbosity = charKey && settings.verbosityByCharacter ? settings.verbosityByCharacter[charKey] : null;
        finalUserParts.push(getVerbosityPrompt(verbosity));

        const finalUserContent = finalUserParts.filter(Boolean).join('\n\n');

        // ── Assemble ──────────────────────────────────────────────────────────
        const apiMessages = [
            { role: 'system', content: systemPrompt },
            ...historyMessages,
            { role: 'user', content: finalUserContent }
        ];

        // rawPrompt for non-chat backends (KoboldAI, text-completion proxies)
        let rawPrompt = '';
        allHistory.forEach(msg => {
            const speaker = msg.is_user ? userName : (msg.charName || charName);
            rawPrompt += `${speaker}: ${msg.mes}\n`;
        });
        rawPrompt += `${charName}:`;

        return { apiMessages, rawPrompt, systemPrompt };
    }

    /**
     * @deprecated Combined mode now uses buildCombinedGroupApiMessages.
     * Kept as a thin wrapper so any external callers (e.g. proactive scheduler)
     * that still reference buildCombinedSystemPrompt don't break.
     */
    async function buildCombinedSystemPrompt(targetChar, history = []) {
        return buildGroupSharedSystemPrompt();
    }

    /**
     * Returns the verbosity instruction string for the given verbosity level.
     * Reads from user-editable settings first, falls back to config defaults.
     * @param {string|null} verbosity - 'short' | 'long' | null/undefined (medium)
     * @returns {string}
     */
    function getVerbosityPrompt(verbosity) {
        const cfg = window.EchoTextConfig && window.EchoTextConfig.defaultSettings || {};
        if (verbosity === 'short') {
            return (settings.promptVerbosityShort != null && settings.promptVerbosityShort !== '')
                ? settings.promptVerbosityShort
                : (cfg.promptVerbosityShort || 'VERBOSITY: Keep your reply to 1-2 short sentences maximum. Be concise and direct.');
        }
        if (verbosity === 'long') {
            return (settings.promptVerbosityLong != null && settings.promptVerbosityLong !== '')
                ? settings.promptVerbosityLong
                : (cfg.promptVerbosityLong || 'VERBOSITY: You may reply with 4-8 sentences with more detail, expressiveness, and depth.');
        }
        // medium / default
        return (settings.promptVerbosityMedium != null && settings.promptVerbosityMedium !== '')
            ? settings.promptVerbosityMedium
            : (cfg.promptVerbosityMedium || 'VERBOSITY: Keep your reply to 2-4 sentences, natural text-message length.');
    }

    async function buildSystemPrompt(targetCharOverride = null) {
        if (isCombinedGroupMode()) {
            const groupId = groupManager ? groupManager.getCurrentGroupId() : null;
            const combinedHistory = groupId ? groupManager.getCombineHistory(groupId) : [];
            return buildCombinedSystemPrompt(targetCharOverride || getCurrentCharacter(), combinedHistory);
        }

        const char = targetCharOverride || getCurrentCharacter();
        if (!char) return 'You are a helpful assistant. Reply concisely like in a text message. You may use Markdown formatting like **bold**, *italic*, and `code`.';

        const name = char.name || 'Character';
        const context = SillyTavern.getContext();

        // Helper: get prompt from settings with macro replacement.
        // expandTimeDateMacros is applied AFTER replaceMacros so that SillyTavern
        // time/date tokens ({{time}}, {{date}}, {{weekday}}) in character cards,
        // persona descriptions, or custom prompts are resolved to concrete strings
        // before the system prompt reaches the LLM. Without this, {{time}} survives
        // as a literal token and the model interprets it as a slot to fill — causing
        // it to output the clock time at the start of its generated message.
        function getPrompt(key) {
            const val = settings[key];
            if (val !== undefined && val !== null && val !== '') return expandTimeDateMacros(replaceMacros(val));
            // Fall back to config default
            const defaults = window.EchoTextConfig && window.EchoTextConfig.defaultSettings;
            return defaults && defaults[key] ? expandTimeDateMacros(replaceMacros(defaults[key])) : '';
        }

        // ── ORDERING RATIONALE ──────────────────────────────────────────────────
        // LLMs attend most strongly to content at the beginning (primacy) and end
        // (recency) of the context window.
        //
        //  1. IDENTITY   — who the character IS (primacy anchor)
        //  2. CHARACTER  — description, personality, scenario, persona, world info,
        //                  plus the story opening and recent ST roleplay (narrative
        //                  background kept far from the end so its prose style
        //                  doesn't leak into replies)
        //  3. MEMORY     — inside jokes (semi-static contextual colour)
        //  4. LOCK       — fiction frame + persona-lock reminder (recency anchor for
        //                  behaviour — last thing read before the model replies)
        //  4b. PERSONALITY AND FEELINGS — NSFW permission, texting style, behavior block
        //  5. VERBOSITY  — how many texts to send (moved a step by the behavior)
        //  6. FORMAT     — texting-medium anchor + message format (must be last)
        // ───────────────────────────────────────────────────────────────────────

        // ── 1. IDENTITY ─────────────────────────────────────────────────────────
        let prompt = getPrompt('promptSystemBase');

        // User's persona description
        if (settings.ctxPersona === true) {
            try {
                const powerUser = SillyTavern.getContext().powerUserSettings || {};
                const personaDescription = powerUser.persona_description || '';
                if (personaDescription && personaDescription.trim()) {
                    prompt += `\n\n<user_persona>\n${getUserName()}'s persona: ${expandTimeDateMacros(replaceMacros(personaDescription))}\n</user_persona>`;
                }
            } catch (e) { /* ignore */ }
        }

        // ── 2. CHARACTER KNOWLEDGE ───────────────────────────────────────────────
        // Support both V1 (top-level fields) and V2 (nested under char.data) card formats
        const charDescription = char.description || char.data?.description || '';
        const charPersonality  = char.personality  || char.data?.personality  || '';
        const charScenario     = char.scenario      || char.data?.scenario      || '';

        // Character card fields — wrapped in <character_reference> XML tags so models
        // treat them as scoped reference data rather than content to reproduce.
        const charRefParts = [];
        if (settings.ctxDescription !== false && charDescription) {
            charRefParts.push(`${name}'s description: ${expandTimeDateMacros(replaceMacros(charDescription))}`);
        }
        if (settings.ctxPersonality !== false && charPersonality) {
            charRefParts.push(`${name}'s personality: ${expandTimeDateMacros(replaceMacros(charPersonality))}`);
        }
        if (settings.ctxScenario !== false && charScenario) {
            charRefParts.push(`Scenario: ${expandTimeDateMacros(replaceMacros(charScenario))}`);  
        }
        if (settings.ctxWorldInfo === true) {
            try {
                const worldInfoData = await getActiveWorldInfoEntries();
                if (worldInfoData) {
                    charRefParts.push(`World Information:\n${worldInfoData}`);
                }
            } catch (e) { /* ignore */ }
        }
        if (charRefParts.length > 0) {
            prompt += `\n\n<character_reference>\n${charRefParts.join('\n\n')}\n</character_reference>`;
        }

        // ── 2b. STORY BACKGROUND ─────────────────────────────────────────────────
        // The greeting establishes the setting, the relationship with the user and —
        // through the character's spoken lines — their voice; the recent ST roleplay
        // keeps replies consistent with what has actually happened.
        // Both are narrative prose, so they sit with the stable character knowledge,
        // far from the end, and are framed as reference rather than text to continue.
        const userName = getUserName();
        const openingText = getEchoTextFirstMessage(char);
        if (openingText) {
            const openingUse = `This is how the roleplay between ${name} and ${userName} began. Treat its setting and relationships as established facts.`;
            prompt += `\n\n${openingUse} ${name}'s spoken lines in it show how ${name} talks — vocabulary, tone, attitude toward ${userName}, and speech quirks. It is reference material written as narrative prose: never continue it or copy its narration.\n<story_opening>\n${openingText}\n</story_opening>`;
        }
        const storyText = getSTStoryContext(char);
        if (storyText) {
            prompt += `\n\nRecent events in the roleplay, oldest first. ${name} remembers all of this, and the text messages must stay consistent with it. It is reference material written as narrative prose: never continue the scene — ${name} is now texting ${userName} by phone.\n<story_so_far>\n${storyText}\n</story_so_far>`;
        }

        // Author's Note — special per-character instructions from SillyTavern.
        // Reads from multiple sources in priority order:
        // Author's Note — reads from extensionSettings.note.chara, which is where
        // SillyTavern's "Character Author's Note (Private)" panel stores per-character
        // notes. The array is keyed by character filename without extension (e.g. "Joi",
        // not "Joi.png"). We include the note text whenever the EchoText toggle is on,
        // regardless of ST's own useChara flag (EchoText's toggle is the user's opt-in).
        if (settings.ctxAuthorsNote === true) {
            try {
                const context = SillyTavern.getContext();
                const charaFilename = (char.avatar || char.name || '').replace(/\.[^/.]+$/, '');
                const charaNote = context.extensionSettings?.note?.chara?.find(e => e.name === charaFilename);
                const authorNote = (charaNote?.prompt || '').trim();
                if (authorNote) {
                    prompt += `\n\n<authors_note>\n${expandTimeDateMacros(replaceMacros(authorNote))}\n</authors_note>`;
                }
            } catch (e) { /* ignore */ }
        }


        // ── 3. MEMORY ────────────────────────────────────────────────────────────
        // Shared memories (inside jokes, people, hobbies, etc.).
        prompt += buildInsideJokesContext();

        // ── 4. BEHAVIOUR LOCK ────────────────────────────────────────────────────
        // Fiction frame + persona-lock reminder land last so they act as the final
        // instruction the model reads before generating — maximising adherence.
        if (settings.antiRefusal === true) {
            prompt += '\n\n' + getPrompt('promptAntiRefusalFrame');
            prompt += `\n\n${getPrompt('promptTetheredReminder')}`;
        } else {
            prompt += `\n\n${getPrompt('promptTetheredNoFrame')}`;
        }

        // ── 4b. PERSONALITY AND FEELINGS ─────────────────────────────────────────
        // From the emotion popup, after the lock so they are among the last
        // instructions read: the NSFW permission, the character's own texting style
        // (Personality tab), and how the Big Five and current feelings make them text
        // (lib/texting-behavior.js), which also moves the reply length a step.
        const charKey = getCharacterKey();
        const behavior = buildBehaviorContext(char, charKey && settings.verbosityByCharacter ? settings.verbosityByCharacter[charKey] : null);
        prompt += behavior.nsfw;
        prompt += buildTextingStyleContext(char);
        prompt += behavior.text;

        // ── 5. VERBOSITY ─────────────────────────────────────────────────────────
        prompt += '\n\n' + getVerbosityPrompt(behavior.verbosity);

        // ── 6. TEXTING FORMAT ────────────────────────────────────────────────────
        // Final anchor: with narrative story context in the prompt, models drift into
        // roleplay narration and move stage directions into brackets when asterisks
        // are banned. Stating the medium last keeps every reply an actual text.
        const textingFormat = getPrompt('promptTextingFormat');
        if (textingFormat) prompt += '\n\n' + textingFormat;

        // ── 7. MESSAGE FORMAT ────────────────────────────────────────────────────
        prompt += '\n\n' + buildMessageFormatPrompt(name, userName);

        // ── 8. MOOD ──────────────────────────────────────────────────────────────
        // Auto mode: the hidden <mood> line the model reports changed feelings in.
        // After the format rules, the one line that isn't a text; readReply takes it out.
        prompt += buildMoodRules(char);

        return prompt;
    }

    /**
     * The reply-format rules the renderer depends on: each line is its own bubble,
     * plus the rules of each feature the platform supports (lib/features.js).
     * Built in code rather than kept as an editable prompt because it must match
     * lib/rich-messages.js exactly.
     */
    function buildMessageFormatPrompt(charName, userName) {
        const rules = Features.buildFeaturePrompts(getActiveFeatures(), { charName, userName, reactionIds: getReactionIds() });
        // What every tag below shares, said once
        const tags = rules.length ? ' Each tag below goes on a line of its own too, as one of the texts. Write the texts and what goes inside the tags in the language of the conversation.' : '';
        return [`MESSAGES: Put each text on its own line — every line reaches ${userName} as a separate message bubble.${tags}`, ...rules].join('\n');
    }

    async function getActiveWorldInfoEntries() {
        // Fetches lorebook entries for the current character via ST's /api/worldinfo/get
        // endpoint. Filter mode is driven by ctxWorldInfoMode (global setting).
        try {
            const char = getCurrentCharacter();
            if (!char) return null;

            // Resolve the lorebook name from the character card.
            // V2 cards: data.extensions.world  (preferred)
            // V1 cards: worldInfoName or world (fallback)
            const bookName = char?.data?.extensions?.world
                || char?.data?.world
                || char?.worldInfoName
                || char?.world
                || null;

            if (!bookName) return null;

            // Fetch the book data from Silly Tavern's world info API.
            // Response shape: { entries: { [uid]: entry } }
            const headers = SillyTavern.getContext().getRequestHeaders();
            const resp = await fetch('/api/worldinfo/get', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ name: bookName })
            });

            if (!resp.ok) return null;

            const bookData = await resp.json();
            const entryMap = bookData?.entries;
            if (!entryMap || typeof entryMap !== 'object') return null;

            // Filter entries based on the configured mode.
            const mode           = settings.ctxWorldInfoMode || 'min_order';
            const minOrder       = typeof settings.ctxWorldInfoMinOrder === 'number' ? settings.ctxWorldInfoMinOrder : 250;
            const maxOrder       = typeof settings.ctxWorldInfoMaxOrder === 'number' ? settings.ctxWorldInfoMaxOrder : null;
            const targetedOrders = Array.isArray(settings.ctxWorldInfoTargetedOrders)
                ? settings.ctxWorldInfoTargetedOrders.map(Number).filter(function (n) { return !isNaN(n); })
                : [];

            const texts = [];
            Object.values(entryMap).forEach(entry => {
                if (!entry) return;
                if (entry.disable || entry.disabled) return;
                const order = typeof entry.order === 'number' ? entry.order : 0;

                let include = false;
                if (mode === 'min_order') {
                    include = order >= minOrder;
                } else if (mode === 'range') {
                    include = order >= minOrder && (maxOrder === null || order <= maxOrder);
                } else if (mode === 'targeted') {
                    include = targetedOrders.includes(order);
                } else if (mode === 'custom') {
                    include = (order >= minOrder && (maxOrder === null || order <= maxOrder))
                        || (targetedOrders.length > 0 && targetedOrders.includes(order));
                } else {
                    include = order >= minOrder;
                }

                if (!include) return;
                const text = (entry.content || entry.text || '').trim();
                if (text) texts.push(text);
            });

            return texts.length > 0 ? texts.join('\n\n') : null;
        } catch (e) {
            return null;
        }
    }

    // How much of the live ST roleplay EchoText sees. Both caps apply
    // and the newest messages win; with long RP replies the character cap usually binds.
    const ST_STORY_MAX_MESSAGES = 20;
    const ST_STORY_MAX_CHARS = 6000;

    /** Whether the open ST chat is one the given character takes part in. */
    function isCharInCurrentSTChat(char) {
        const context = SillyTavern.getContext();
        if (context.groupId) {
            const group = (context.groups || []).find(g => String(g.id) === String(context.groupId));
            return !!(group && Array.isArray(group.members) && group.members.includes(char.avatar));
        }
        const stChar = context.characters?.[context.characterId];
        if (!stChar) return false;
        return (stChar.avatar && char.avatar) ? stChar.avatar === char.avatar : stChar.name === char.name;
    }

    /**
     * Index of the character's greeting in the live ST chat, or -1. The opening is the
     * leading run of character messages before the user's first message (one greeting
     * per member in group chats); hidden (is_system) messages are skipped.
     */
    function findSTOpeningIndex(char) {
        const chat = SillyTavern.getContext().chat;
        if (!Array.isArray(chat) || !isCharInCurrentSTChat(char)) return -1;
        for (let i = 0; i < chat.length; i++) {
            const msg = chat[i];
            if (!msg || msg.is_system) continue;
            if (msg.is_user) break;
            const own = msg.original_avatar ? msg.original_avatar === char.avatar : msg.name === char.name;
            if (own && (msg.mes || '').trim()) return i;
        }
        return -1;
    }

    /** Strips reasoning blocks, styles, scripts and HTML comments from ST message text. */
    function cleanSTMessageText(text) {
        return stripThinkingTags(String(text || ''))
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<!--[\s\S]*?-->/g, '')
            .trim();
    }

    /**
     * Returns the story opening for a character.
     * Prefers the greeting actually present in the live ST chat (reflects the chosen
     * alternate greeting / swipe), falling back to the card's first_mes.
     * @param {object|null} char - character object; defaults to the current character
     * @returns {string} the opening text with macros resolved, or ''
     */
    function getEchoTextFirstMessage(char = null) {
        const target = char || getCurrentCharacter();
        if (!target) return '';

        let text = target.first_mes || target.data?.first_mes || '';
        try {
            const idx = findSTOpeningIndex(target);
            if (idx !== -1) text = SillyTavern.getContext().chat[idx].mes;
        } catch (e) { /* keep the card's first_mes */ }

        return expandTimeDateMacros(cleanSTMessageText(text)
            .replace(/{{char}}/gi, target.name || 'Character')
            .replace(/{{user}}/gi, getUserName())).trim();
    }

    /**
     * Recent messages of the live ST roleplay as "Speaker: text" lines, oldest first.
     * Skips hidden messages and the character's greeting (injected separately as the
     * story opening). Returns '' when the open ST chat doesn't involve the character.
     */
    function getSTStoryContext(char) {
        try {
            const chat = SillyTavern.getContext().chat;
            if (!Array.isArray(chat) || !chat.length || !isCharInCurrentSTChat(char)) return '';

            const openingIdx = findSTOpeningIndex(char);
            const userName = getUserName();
            const lines = [];
            let budget = ST_STORY_MAX_CHARS;

            for (let i = chat.length - 1; i >= 0 && lines.length < ST_STORY_MAX_MESSAGES; i--) {
                const msg = chat[i];
                if (!msg || msg.is_system || i === openingIdx) continue;
                const text = cleanSTMessageText(msg.mes);
                if (!text) continue;
                const speaker = msg.is_user ? userName : (msg.name || char.name);
                const line = `${speaker}: ${text}`;
                if (line.length > budget) {
                    // Always keep the newest message, trimmed to its most recent part
                    if (!lines.length) lines.unshift(`${speaker}: …${text.slice(-budget)}`);
                    break;
                }
                lines.unshift(line);
                budget -= line.length;
            }

            return lines.join('\n\n');
        } catch (e) {
            return '';
        }
    }

    function getCurrentTimeMacroString() {
        return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function getCurrentDateMacroString() {
        return new Date().toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
    }

    function getCurrentWeekdayMacroString() {
        return new Date().toLocaleDateString([], { weekday: 'long' });
    }

    function expandTimeDateMacros(text) {
        if (!text) return '';
        return String(text)
            .replace(/{{\s*time\s*}}/gi, getCurrentTimeMacroString)
            .replace(/{{\s*date\s*}}/gi, getCurrentDateMacroString)
            .replace(/{{\s*weekday\s*}}/gi, getCurrentWeekdayMacroString);
    }

    function cleanGeneratedResponse(text) {
        if (!text) return '';
        return String(text).trim();
    }

    function replaceMacros(text) {
        if (!text) return text;
        const charName = getCharacterName();
        const userName = getUserName();
        return text.replace(/{{char}}/gi, charName).replace(/{{user}}/gi, userName);
    }


    // ============================================================
    // THINKING / REASONING TAG HELPER
    // ============================================================

    const STRIP_TAGS_DEFAULTS = ['thinking', 'think', 'thought', 'reasoning', 'reason', 'gemma4'];

    // Special non-XML patterns keyed by reserved name
    const SPECIAL_PATTERNS = {
        gemma4: {
            paired: /<\|channel>thought[\s\S]*?<channel\|>/gi,
            dangling: /<\|channel>thought[\s\S]*$/gi
        }
    };

    let _stripTagsRegex = null;
    let _stripTagsListHash = '';

    function getStripTagsRegex() {
        const allTags = (Array.isArray(settings.stripThinkingTagList) && settings.stripThinkingTagList.length)
            ? settings.stripThinkingTagList
            : STRIP_TAGS_DEFAULTS;
        const customPatterns = Array.isArray(settings.stripCustomPatterns) ? settings.stripCustomPatterns : [];
        const hash = allTags.join('\x00') + '\x01' + JSON.stringify(customPatterns);
        if (hash !== _stripTagsListHash || !_stripTagsRegex) {
            const xmlTags = allTags.filter(t => !SPECIAL_PATTERNS[t]);
            const specials = allTags.filter(t => !!SPECIAL_PATTERNS[t]).map(key => SPECIAL_PATTERNS[key]);
            const customs = customPatterns
                .filter(p => p && p.start && p.end)
                .map(p => {
                    const es = p.start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const ee = p.end.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    return {
                        paired: new RegExp(es + '[\\s\\S]*?' + ee, 'gi'),
                        dangling: new RegExp(es + '[\\s\\S]*$', 'gi')
                    };
                });
            let result = { paired: null, dangling: null, specials, customs };
            if (xmlTags.length) {
                const pattern = xmlTags.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
                result.paired = new RegExp(`<(${pattern})[^>]*>[\\s\\S]*?<\\/\\1>`, 'gi');
                result.dangling = new RegExp(`<(${pattern})[^>]*>[\\s\\S]*$`, 'gi');
            }
            _stripTagsRegex = result;
            _stripTagsListHash = hash;
        }
        return _stripTagsRegex;
    }

    function invalidateStripTagsCache() {
        _stripTagsRegex = null;
        _stripTagsListHash = '';
    }

    function stripThinkingTags(text) {
        if (!text) return text;
        if (settings.stripThinkingTagsEnabled === false) return String(text);
        const re = getStripTagsRegex();
        let result = String(text);
        if (re.paired) result = result.replace(re.paired, '');
        if (re.dangling) result = result.replace(re.dangling, '');
        for (const sp of re.specials) {
            result = result.replace(sp.paired, '').replace(sp.dangling, '');
        }
        for (const cp of re.customs) {
            result = result.replace(cp.paired, '').replace(cp.dangling, '');
        }
        return result.trim();
    }

    function renderStripTagChips(containerId) {
        const container = jQuery('#' + containerId);
        if (!container.length) return;
        const tags = Array.isArray(settings.stripThinkingTagList) ? settings.stripThinkingTagList : [];
        container.html(tags.map((tag, i) => {
            const safeTag = String(tag).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return `<span class="et-strip-tag-chip">${safeTag}<button class="et-strip-tag-remove" data-index="${i}" title="Remove" aria-label="Remove ${safeTag}"><i class="fa-solid fa-xmark"></i></button></span>`;
        }).join(''));
    }

    function renderCustomPatternRows(containerId) {
        const container = jQuery('#' + containerId);
        if (!container.length) return;
        const patterns = Array.isArray(settings.stripCustomPatterns) ? settings.stripCustomPatterns : [];
        if (!patterns.length) {
            container.html('');
            return;
        }
        container.html(patterns.map((p, i) => {
            const safeStart = String(p.start || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const safeEnd = String(p.end || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return `<div class="et-custom-pattern-row"><span class="et-custom-pattern-label"><code>${safeStart}</code> → <code>${safeEnd}</code></span><button class="et-custom-pattern-remove" data-index="${i}" title="Remove"><i class="fa-solid fa-xmark"></i></button></div>`;
        }).join(''));
    }

    function updateStripTagsSubsectionVisibility() {
        const visible = settings.stripThinkingTagsEnabled !== false;
        jQuery('.et-strip-tags-sub').toggle(visible);
    }

    function toggleWIPanelRows(mode) {
        jQuery('#et-ctx-wi-row-min_panel').toggle(mode === 'min_order' || mode === 'range' || mode === 'custom');
        jQuery('#et-ctx-wi-row-max_panel').toggle(mode === 'range' || mode === 'custom');
        jQuery('#et-ctx-wi-row-targeted_panel').toggle(mode === 'targeted' || mode === 'custom');
    }

    // ============================================================
    // CHAT HISTORY MANAGEMENT
    // ============================================================

    function getChatHistory() {
        // ── Group session: use group-scoped, independent storage ──────────
        if (groupManager && groupManager.isGroupSession()) {
            const group = groupManager.getCurrentGroup();
            const groupId = group ? String(group.id) : null;
            if (!groupId) return [];

            // Combine mode: single shared history for the whole group
            if (groupManager.isCombineMode()) {
                return groupManager.getCombineHistory(groupId);
            }

            // Per-character history, scoped to this groupId
            const char = getCurrentCharacter();
            if (!char) return [];
            const charKey = char.avatar || char.name || 'unknown';
            const history = groupManager.getGroupChatHistory(groupId, charKey);

            // Filter out the character's first_mes
            const firstMes = char.first_mes ? char.first_mes.trim() : null;
            if (firstMes && history.length > 0) {
                return history.filter(msg => msg.is_user || (msg.mes || '').trim() !== firstMes);
            }
            return history;
        }

        // ── Solo session: original logic ──────────────────────────────────
        const key = getCharacterKey();
        if (!key) return [];

        let history = settings.chatHistory[key] || [];

        // Filter out the character's first_mes to prevent it from appearing in EchoText
        const char = getCurrentCharacter();
        const firstMes = (char && char.first_mes) ? char.first_mes.trim() : null;
        if (firstMes && history.length > 0) {
            history = history.filter(msg =>
                msg.is_user || (msg.mes || '').trim() !== firstMes
            );
        }

        return history;
    }

    function saveChatHistory(history) {
        // ── Group session: write to group-scoped storage ──────────────────
        if (groupManager && groupManager.isGroupSession()) {
            const group = groupManager.getCurrentGroup();
            const groupId = group ? String(group.id) : null;
            if (!groupId) return;

            if (groupManager.isCombineMode()) {
                groupManager.saveCombineHistory(groupId, history);
                return;
            }

            const char = getCurrentCharacter();
            if (!char) return;
            const charKey = char.avatar || char.name || 'unknown';
            groupManager.saveGroupChatHistory(groupId, charKey, history);
            syncProactiveStateWithHistory(charKey, history);
            return;
        }

        // ── Solo session: original logic ──────────────────────────────────
        const key = getCharacterKey();
        if (!key) return;
        settings.chatHistory[key] = history;
        syncProactiveStateWithHistory(key, history);
        saveSettings();
        refreshAutoEmotions();
    }

    /** Auto mode's values come from the chat's replies: a changed chat (deleted, regenerated, swiped) redraws them. */
    function refreshAutoEmotions() {
        if (emotionSystem && emotionSystem.getMode() === 'auto') emotionSystem.refresh();
    }

    function clearChatHistory() {
        // ── Group session: clear group-scoped storage ─────────────────────
        if (groupManager && groupManager.isGroupSession()) {
            const group = groupManager.getCurrentGroup();
            const groupId = group ? String(group.id) : null;
            if (!groupId) return;

            if (groupManager.isCombineMode()) {
                groupManager.clearCombineHistory(groupId);
                return;
            }

            const char = getCurrentCharacter();
            if (!char) return;
            const charKey = char.avatar || char.name || 'unknown';
            groupManager.clearGroupChatHistory(groupId, charKey);
            clearEmotionState();
            return;
        }

        // ── Solo session: original logic ──────────────────────────────────
        const key = getCharacterKey();
        if (!key) return;
        settings.chatHistory[key] = [];
        // Also reset emotion state when clearing history
        clearEmotionState();
        saveSettings();
    }

    // ============================================================
    // ECHOTEXT MESSAGES IN THE STORY PROMPT
    // ============================================================

    /**
     * SillyTavern's generation interceptor (manifest.json). With the "EchoText
     * Messages" context toggle on, the texts with the story's character go into
     * the roleplay prompt, each run of texts where it happened in the story
     * (lib/story-texts.js). Group chats keep their own EchoText storage and are
     * left out.
     */
    globalThis.echoTextGenerateInterceptor = function (chat, contextSize, abort, type) {
        if (!settings.enabled || settings.ctxSTMessages !== true) return;
        try {
            const context = SillyTavern.getContext();
            if (context.groupId) return;
            const char = context.characters?.[context.characterId];
            const history = char && settings.chatHistory?.[char.avatar || char.name];
            if (!Array.isArray(history) || !history.length) return;

            // As getChatHistory: a stored copy of the greeting isn't a text
            const firstMes = (char.first_mes || '').trim();
            const texts = firstMes ? history.filter(msg => msg.is_user || (msg.mes || '').trim() !== firstMes) : history;
            const timeOf = (msg) => {
                const time = context.timestampToMoment?.(msg.send_date);
                if (time?.isValid?.()) return time.valueOf();
                return typeof msg.send_date === 'number' ? msg.send_date : Date.parse(msg.send_date);
            };
            const inserted = StoryTexts.insertTexts(chat, texts, {
                charName: char.name,
                userName: getUserName(),
                timeOf,
                keepLast: type === 'continue',
            });
            if (inserted) log(`Added EchoText messages to the prompt in ${inserted} place(s)`);
        } catch (e) {
            error('Could not add EchoText messages to the prompt:', e);
        }
    };

    // ============================================================
    // TEXT EXTRACTION
    // ============================================================

    function extractTextFromResponse(response) {
        if (!response) return '';
        if (typeof response === 'string') return response;

        if (Array.isArray(response)) {
            const textParts = response
                .filter(block => block && block.type === 'text' && typeof block.text === 'string')
                .map(block => block.text);
            if (textParts.length > 0) return textParts.join('\n');
            const stringParts = response.filter(item => typeof item === 'string');
            if (stringParts.length > 0) return stringParts.join('\n');
            return JSON.stringify(response);
        }

        if (response.content !== undefined && response.content !== null) {
            if (typeof response.content === 'string') return response.content;
            if (Array.isArray(response.content)) {
                const textParts = response.content
                    .filter(block => block && block.type === 'text' && typeof block.text === 'string')
                    .map(block => block.text);
                if (textParts.length > 0) return textParts.join('\n');
            }
        }

        if (response.choices?.[0]?.message?.content) {
            const choiceContent = response.choices[0].message.content;
            if (typeof choiceContent === 'string') return choiceContent;
            if (Array.isArray(choiceContent)) {
                const textParts = choiceContent
                    .filter(block => block && block.type === 'text' && typeof block.text === 'string')
                    .map(block => block.text);
                if (textParts.length > 0) return textParts.join('\n');
            }
        }

        if (typeof response.text === 'string') return response.text;
        if (typeof response.message === 'string') return response.message;
        if (response.message?.content && typeof response.message.content === 'string') return response.message.content;

        error('Could not extract text from response:', response);
        return JSON.stringify(response);
    }

    // ============================================================
    // GENERATION ENGINE
    // ============================================================

    async function requestEchoTextCompletion(params) {
        activeCompletionRequests++;
        try {
            return await sendCompletionRequest(params);
        } finally {
            activeCompletionRequests--;
        }
    }

    async function sendCompletionRequest({ apiMessages, rawPrompt, systemPrompt, prefillPrefix, signal }) {
        // Strip the pre-fill prefix only when the model echoed it as a chat-completion
        // artefact. Uses exact startsWith (case-insensitive) instead of regex to avoid
        // accidentally matching legitimate content that happens to begin with similar text.
        // Guard: only strip when the remainder starts with a letter — if it starts with a
        // digit, newline, or punctuation the prefix is likely genuine content (e.g. a
        // scoreboard "CharName: 1 / User: 0") rather than an echoed prefill.
        function stripPrefill(text) {
            if (!prefillPrefix || !text) return text;
            const prefix = prefillPrefix.toLowerCase();
            if (!text.toLowerCase().startsWith(prefix)) return text;
            const remainder = text.slice(prefix.length);
            if (!/^[a-z]/i.test(remainder.trimStart())) return text;
            return remainder.trimStart();
        }

        if (settings.source === 'profile') {
            if (!settings.preset) throw new Error('Please select a connection profile in Echogram settings.');
            const context = SillyTavern.getContext();
            const cm = context.extensionSettings?.connectionManager;
            const profile = cm?.profiles?.find(p => p.name === settings.preset);
            if (!profile) throw new Error(`Profile '${settings.preset}' not found.`);
            if (!context.ConnectionManagerRequestService) throw new Error('ConnectionManagerRequestService not available.');

            const response = await context.ConnectionManagerRequestService.sendRequest(
                profile.id, apiMessages, undefined,
                { stream: false, signal, extractData: true, includePreset: true, includeInstruct: true }
            );
            return stripPrefill(extractTextFromResponse(response));
        }

        if (settings.source === 'ollama') {
            const baseUrl = (settings.ollama_url || 'http://localhost:11434').replace(/\/$/, '');
            if (!settings.ollama_model) throw new Error('No Ollama model selected.');

            const response = await fetch(`${baseUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: settings.ollama_model, messages: apiMessages, stream: false }),
                signal
            });
            if (!response.ok) throw new Error(`Ollama API error: ${response.status}`);
            const data = await response.json();
            return stripPrefill(data.message?.content || data.response || '');
        }

        if (settings.source === 'openai') {
            const baseUrl = (settings.openai_url || 'http://localhost:1234/v1').replace(/\/$/, '');
            const headers = { 'Content-Type': 'application/json' };
            if (settings.openai_key) headers['Authorization'] = `Bearer ${settings.openai_key}`;

            const response = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST', headers,
                body: JSON.stringify({ model: settings.openai_model || 'local-model', messages: apiMessages, temperature: 0.8, stream: false }),
                signal
            });
            if (!response.ok) throw new Error(`API error: ${response.status}`);
            const data = await response.json();
            return stripPrefill(data.choices?.[0]?.message?.content || '');
        }

        const context = SillyTavern.getContext();
        const { generateRaw } = context;
        if (!generateRaw) throw new Error('generateRaw not available in context.');

        const abortPromise = new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        });

        return Promise.race([
            generateRaw({ systemPrompt, prompt: rawPrompt, streaming: false }),
            abortPromise
        ]);
    }

    // getActivePlatform() runs for every message while context is built, so its
    // answer is kept until the current task ends (and dropped when the choice changes)
    let activePlatformMemo = null;

    /**
     * The platform pack the current chat uses: the character's choice, else the
     * default, else EchoText's own look.
     */
    function getActivePlatform() {
        if (activePlatformMemo) return activePlatformMemo;
        const key = getCharacterKey();
        const id = (key && settings.platformByCharacter?.[key]) || settings.defaultPlatform;
        activePlatformMemo = Platforms[id] || Platforms.echotext;
        queueMicrotask(() => { activePlatformMemo = null; });
        return activePlatformMemo;
    }

    /** The features the current platform supports (see lib/features.js). */
    function getActiveFeatures() {
        return getActivePlatform().features;
    }

    /** Whether the current platform supports a feature, e.g. platformHas('react'). */
    function platformHas(featureId) {
        return getActiveFeatures().includes(featureId);
    }

    /**
     * A message's text as sent to the model: reasoning blocks stripped and
     * rich-content tags rewritten to their canonical form, so the model always
     * sees well-formed examples of its own past usage — minus the features this
     * platform doesn't support. null when that leaves nothing: the turn is left out.
     */
    function getContextMessageText(mes) {
        const text = RichMessages.normalizeMessageTags(stripThinkingTags(mes || ''));
        return Features.filterContextText(text, getActiveFeatures());
    }

    /** Combined mode has no format rules, so the user's tapbacks are spelled out in words. */
    function buildCombinedReactionTurns(msg, speaker) {
        const reactions = getUserReactionIds(msg);
        return reactions.length
            ? [{ role: 'user', content: `[${getUserName()} reacted ${reactions.join(', ')} to ${speaker}'s message]` }]
            : [];
    }

    /** Ids of the user's tapbacks on a character message (none on user messages). */
    function getUserReactionIds(msg) {
        if (!platformHas('react')) return [];
        return ChatViewModel.getStoredReactions(msg, getReactionIds())
            .filter(reaction => reaction.mine)
            .map(reaction => reaction.id);
    }

    /**
     * The user's tapbacks on a character message as the model sees them: a user
     * turn right after that message, using the same <react> tag the character
     * reacts with. '' when the user hasn't reacted.
     */
    function buildUserReactionText(msg) {
        return getUserReactionIds(msg).map(id => `<react>${id}</react>`).join('\n');
    }

    /**
     * Resolves the text to use for a history message when building API context.
     *
     * For assistant turns where image generation ran but no text reply was included
     * (mes is empty/whitespace), the AI would otherwise see a blank response to the
     * user's photo request — making sophisticated models (e.g. Claude Thinking, GLM-5)
     * interpret the request as "unfulfilled" and fixate on it in subsequent turns.
     *
     * This function synthesises a brief, natural acknowledgement stub for those turns
     * so the conversational loop is always closed in the model's context window.
     * The saved history is never modified — only the text sent to the API changes.
     *
     * @param {object} msg - a raw history message object
     * @returns {string|null} the text to inject into the API context for this turn,
     *   or null when the turn is left out (see getContextMessageText)
     */
    function resolveHistoryMessageText(msg) {
        const rawText = getContextMessageText(msg.mes);
        if (rawText === null) return null;
        if (!msg.is_user && !rawText.trim() && msg.imageAttachment?.status === 'ready') {
            // A silent image turn — give the model a compact, in-character stub so it
            // knows the action was completed.  The exact phrasing is deliberately terse
            // to avoid bloating the context with fabricated prose.
            return '*[shared a photo]*';
        }
        return rawText;
    }

    async function buildApiMessagesFromHistory(history, extraSystemMessages = [], targetCharOverride = null) {
        const systemPrompt = await buildSystemPrompt(targetCharOverride);
        const apiMessages = [{ role: 'system', content: systemPrompt }];

        for (const msg of extraSystemMessages) {
            if (msg) apiMessages.push({ role: 'system', content: msg });
        }

        history.forEach(msg => {
            // Strip thinking/reasoning tags from history messages before sending to context.
            // This prevents internal model reasoning blocks from inflating token budgets.
            // resolveHistoryMessageText also fills in a natural stub for silent image turns
            // so the model never sees an empty assistant response to a photo request.
            const contextText = resolveHistoryMessageText(msg);
            if (contextText !== null) apiMessages.push({ role: msg.is_user ? 'user' : 'assistant', content: contextText });
            const reactionText = buildUserReactionText(msg);
            if (reactionText) apiMessages.push({ role: 'user', content: reactionText });
        });

        // --- Layer 3: Pre-fill assistant turn (anti-refusal, chat-completion backends only) ---
        // Planting the assistant prefix forces the model to continue in-character rather than
        // starting fresh with a potential refusal. The prefix is stripped in requestEchoTextCompletion.
        let prefillPrefix = '';
        if (settings.antiRefusal === true && settings.source !== 'default') {
            prefillPrefix = `${getCharacterName()}: `;
            apiMessages.push({ role: 'assistant', content: prefillPrefix });
        }

        let rawPrompt = '';
        history.forEach(msg => {
            const contextText = resolveHistoryMessageText(msg);
            if (contextText !== null) rawPrompt += `${msg.is_user ? getUserName() : getCharacterName()}: ${contextText}\n`;
            const reactionText = buildUserReactionText(msg);
            if (reactionText) rawPrompt += `${getUserName()}: ${reactionText}\n`;
        });
        rawPrompt += `${getCharacterName()}:`;

        return { apiMessages, rawPrompt, systemPrompt, prefillPrefix };
    }

    /**
     * Like buildApiMessagesFromHistory but scoped to an arbitrary char object.
     * Used by generateEchoTextCombined and the proactive scheduler.
     *
     * In Combined Group Mode the request is built by buildCombinedGroupApiMessages,
     * which separates group framing, attributed history, and character-card injection
     * into distinct, correctly-ordered message slots instead of one system-prompt blob.
     */
    async function buildApiMessagesFromHistoryForChar(history, extraSystemMessages = [], char) {
        // ── Combined group mode: use the dedicated structured builder ─────────
        if (isCombinedGroupMode()) {
            const result = await buildCombinedGroupApiMessages(history, char);
            // Splice any extra system messages in after the first [system] block
            if (extraSystemMessages && extraSystemMessages.length) {
                const extras = extraSystemMessages
                    .filter(Boolean)
                    .map(m => ({ role: 'system', content: m }));
                result.apiMessages.splice(1, 0, ...extras);
            }
            return result;
        }

        // ── Solo / individual group-member mode ───────────────────────────────
        const systemPrompt = await buildSystemPrompt(char);
        const apiMessages = [{ role: 'system', content: systemPrompt }];

        for (const msg of extraSystemMessages) {
            if (msg) apiMessages.push({ role: 'system', content: msg });
        }

        history.forEach(msg => {
            // Apply the same silent-image-turn resolution used in buildApiMessagesFromHistory
            // so group-member context windows also see a closed loop for image turns.
            const contextText = resolveHistoryMessageText(msg);
            if (contextText !== null) apiMessages.push({ role: msg.is_user ? 'user' : 'assistant', content: contextText });
            const reactionText = buildUserReactionText(msg);
            if (reactionText) apiMessages.push({ role: 'user', content: reactionText });
        });

        const charName = (char && char.name) || getCharacterName();
        const userName = getUserName();
        let rawPrompt = '';
        history.forEach(msg => {
            const contextText = resolveHistoryMessageText(msg);
            if (contextText !== null) rawPrompt += `${msg.is_user ? userName : charName}: ${contextText}\n`;
            const reactionText = buildUserReactionText(msg);
            if (reactionText) rawPrompt += `${userName}: ${reactionText}\n`;
        });
        rawPrompt += `${charName}:`;

        return { apiMessages, rawPrompt, systemPrompt };
    }

    async function generateEchoText(history, backupHistory = null) {
        if (isGenerating) return;

        const char = getCurrentCharacter();
        if (!char) {
            toastr.warning('Please select a character card to start texting.');
            return;
        }

        isGenerating = true;
        abortController = new AbortController();
        updateSendButton(true);

        let workingHistory = Array.isArray(history) ? [...history] : [];
        const unreadIdx = getUnreadUserMessageIndices(workingHistory);
        const markUnread = (state, note) => unreadIdx.forEach(i => setUserMessageReceiptState(workingHistory, i, state, note));
        const timing = getEmotionReplyTimingModel();
        const latestUserMessage = Array.isArray(history) && history.length ? history[history.length - 1] : null;

        // Pre-detect image requests BEFORE building API messages so the triggering
        // user message can be hidden from the AI character. This prevents the character
        // from awkwardly commenting on "send me a photo" when an image silently appears.
        let pendingImageDetection = null;
        let apiHistory = history;
        if (imageGeneration && settings.imageGenerationEnabled === true && latestUserMessage?.is_user) {
            pendingImageDetection = imageGeneration.detectImageRequest(latestUserMessage.mes, history);
            if (pendingImageDetection.triggered) {
                // Strip the image-triggering message — the AI never sees it
                apiHistory = history.slice(0, -1);
            }
        }

        const { apiMessages, rawPrompt, systemPrompt } = await buildApiMessagesFromHistory(apiHistory);

        let result = '';

        try {
            if (unreadIdx.length) {
                await sleepWithAbort(timing.deliveredDelayMs, abortController.signal);
                markUnread('delivered', 'Delivered to character');
                saveChatHistory(workingHistory);

                await sleepWithAbort(timing.readDelayMs, abortController.signal);
                markUnread('read', 'Read by character');
                saveChatHistory(workingHistory);

                if (timing.ghostDelayMs > 0) {
                    markUnread('ghosted', 'Read — paused before replying');
                    saveChatHistory(workingHistory);
                    await sleepWithAbort(timing.ghostDelayMs, abortController.signal);
                    markUnread('read', 'Read by character');
                    saveChatHistory(workingHistory);
                }
            }

            await sleepWithAbort(timing.typingLeadMs, abortController.signal);
            
            const bypassTextGeneration = (imageGeneration && latestUserMessage?.is_user && pendingImageDetection?.triggered && settings.imageGenerationIncludeTextReply === false);

            if (!bypassTextGeneration) {
                setTypingIndicatorVisible(true);
                await sleepWithAbort(timing.replyDelayMs, abortController.signal);
                result = await requestEchoTextCompletion({ apiMessages, rawPrompt, systemPrompt, signal: abortController.signal });
            }

            let imageReply = null;
            if (imageGeneration && settings.imageGenerationEnabled === true && latestUserMessage?.is_user) {
                // Reuse the pre-detection result — no need to call detectImageRequest again
                if (pendingImageDetection?.triggered) {
                    // Replace typing indicator with the dedicated image-generating indicator
                    setTypingIndicatorVisible(false);
                    setImageGeneratingIndicatorVisible(true);
                }
                imageReply = await imageGeneration.maybeGenerateImageReply(latestUserMessage.mes, history, abortController.signal);
                setImageGeneratingIndicatorVisible(false);
            }

            const reply = readReply(result);
            const hasTextResponse = !!reply.mes;
            if (hasTextResponse || imageReply?.triggered) {
                const charReply = {
                    is_user: false,
                    mes: reply.mes,
                    send_date: Date.now(),
                    ...(reply.mood ? { mood: reply.mood } : {})
                };

                if (imageReply?.triggered) {
                    charReply.imageAttachment = imageReply.result?.ok
                        ? {
                            status: 'ready',
                            type: 'image',
                            url: imageReply.result.url,
                            mimeType: imageReply.result.mimeType || 'image/png',
                            prompt: imageReply.result.prompt || imageReply.promptPayload?.prompt || '',
                            triggerType: imageReply.detection?.type || 'direct_request'
                        }
                        : {
                            status: 'error',
                            type: 'image',
                            error: imageReply.result?.error || 'Sorry, I could not generate an image right now.',
                            triggerType: imageReply.detection?.type || 'direct_request'
                        };

                    if (imageReply.result?.ok && gallery) {
                        try {
                            gallery.addImage({
                                charKey: getCharacterKey(),
                                charName: getCharacterName(),
                                avatarUrl: getAvatarUrlForCharacter(getCurrentCharacter()),
                                url: imageReply.result.url,
                                mimeType: imageReply.result.mimeType || 'image/png',
                                prompt: imageReply.result.prompt || imageReply.promptPayload?.prompt || '',
                                triggerType: imageReply.detection?.type || 'direct_request',
                                createdAt: Date.now()
                            });
                        } catch (galleryErr) {
                            warn('Failed to save generated image to gallery:', galleryErr);
                        }
                    }

                    if (settings.imageGenerationIncludeTextReply === false && imageReply.result?.ok) {
                        charReply.mes = '';
                    }
                }

                const newHistory = [...withMessagesSentSince(workingHistory), charReply];
                pruneSwipesOnPrevLastChar(newHistory);
                saveChatHistory(newHistory);
                markProactiveCharacterActivity(getCharacterKey(), false, 'reply');
                try { if (memorySystem) memorySystem.incrementTurn(); } catch (e) { /* ignore */ }
                renderMessages(newHistory);
                setFabUnreadIndicator(panelOpen ? false : true);
                if (charReply.mood) noteMoodReport();
            }

        } catch (err) {
            if (err.name === 'AbortError' || (abortController && abortController.signal.aborted)) {
                log('Generation cancelled');
                if (backupHistory) {
                    saveChatHistory(backupHistory);
                    renderMessages(backupHistory);
                }
            } else {
                error('Generation failed:', err);
                toastr.error(`Echogram: ${err.message}`);
                if (backupHistory) {
                    saveChatHistory(backupHistory);
                    renderMessages(backupHistory);
                }
            }
        } finally {
            setTypingIndicatorVisible(false);
            setImageGeneratingIndicatorVisible(false);
            isGenerating = false;
            abortController = null;
            updateSendButton(false);
            onGenerationSettled();
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // SWIPE HELPERS — support functions for the Swiped Messages feature
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * After a new message is successfully appended, collapse the swipes on the
     * previous last character message so it only retains the selected swipe.
     * Pass the full history including the newly added message.
     * Only runs when `settings.swipedMessages` is true.
     */
    function pruneSwipesOnPrevLastChar(history) {
        if (!settings.swipedMessages) return;
        // Find the last TWO non-user messages — the second-to-last is the one to prune
        let lastCharIdx = -1;
        let prevCharIdx = -1;
        for (let i = history.length - 1; i >= 0; i--) {
            if (!history[i].is_user) {
                if (lastCharIdx === -1) { lastCharIdx = i; }
                else { prevCharIdx = i; break; }
            }
        }
        if (prevCharIdx === -1) return;
        const msg = history[prevCharIdx];
        if (!msg.swipes || msg.swipes.length <= 1) return;
        const chosen = msg.swipes[Math.max(0, Math.min(msg.swipeIndex ?? 0, msg.swipes.length - 1))];
        msg.swipes = [chosen];
        msg.swipeIndex = 0;
    }

    /**
     * Ensures a character message has a `swipes` array bootstrapped from its
     * current state so new swipes can be appended.
     */
    function initSwipesOnMessage(msg) {
        if (msg.swipes && msg.swipes.length > 0) return; // already initialised
        msg.swipes = [{
            mes: msg.mes || '',
            send_date: msg.send_date || Date.now(),
            imageAttachment: msg.imageAttachment ?? null,
            ...(msg.mood ? { mood: msg.mood } : {}),
        }];
        msg.swipeIndex = 0;
    }

    /**
     * Syncs the parent message's top-level fields (mes, send_date, reactions,
     * imageAttachment, Auto mode's mood) from the swipe slot at `msg.swipeIndex`.
     */
    function syncMsgFromSwipe(msg) {
        if (!msg.swipes || msg.swipes.length === 0) return;
        const idx = Math.max(0, Math.min(msg.swipeIndex ?? 0, msg.swipes.length - 1));
        msg.swipeIndex = idx;
        const swipe = msg.swipes[idx];
        msg.mes = swipe.mes;
        msg.send_date = swipe.send_date;
        // Reactions are message-level (not per-swipe) — never wiped by navigation
        if (swipe.imageAttachment !== undefined && swipe.imageAttachment !== null) {
            msg.imageAttachment = swipe.imageAttachment;
        } else {
            delete msg.imageAttachment;
        }
        // Each version's report goes with it, so a swipe moves the feelings back and forth
        if (swipe.mood) msg.mood = swipe.mood;
        else delete msg.mood;
    }

    /**
     * Updates the swipe nav row and bubble text for a single message in-place,
     * without triggering a full renderMessages() call.
     *
     * Scroll anchoring strategy: snapshot scrollHeight + scrollTop before any DOM
     * changes, then after changes offset scrollTop by the delta so the user's view
     * of the content stays pixel-perfect still.  smooth-scroll is suppressed for
     * this correction so no animated jump is visible.
     */
    function updateSwipeInPlace(msgIndex, h) {
        if (!h[msgIndex]) return;
        if (!findMessageElement(msgIndex).length) {
            renderMessages(h, true);
            return;
        }

        // ── Scroll anchor: snapshot before DOM changes ────────────────────
        const messagesEl = document.getElementById('et-messages');
        const scrollTopBefore    = messagesEl ? messagesEl.scrollTop    : 0;
        const scrollHeightBefore = messagesEl ? messagesEl.scrollHeight : 0;

        // The message, and the user message its reaction lands on, are re-rendered
        refreshMessages(h);

        // ── Scroll anchor: compensate for height delta ────────────────────
        // Any height change in the message shifts scrollHeight by the same amount.
        // Adding that delta to scrollTop keeps every pixel of content stationary.
        if (messagesEl) {
            const delta = messagesEl.scrollHeight - scrollHeightBefore;
            if (delta !== 0) {
                const prevBehavior = messagesEl.style.scrollBehavior;
                messagesEl.style.scrollBehavior = 'auto'; // suppress smooth-scroll for this correction
                messagesEl.scrollTop = scrollTopBefore + delta;
                messagesEl.style.scrollBehavior = prevBehavior;
            }
        }
    }

    /**
     * Generates a new AI reply and appends it as an additional swipe on the
     * character message at `history[msgIndex]`, without discarding the existing
     * swipes.  Used when `settings.swipedMessages` is true.
     *
     * @param {Array}  history        - full current chat history (contains the message to swipe)
     * @param {number} msgIndex       - index of the character message being regenerated
     * @param {Array}  contextHistory - history slice used as API context (history.slice(0, msgIndex))
     */
    async function generateEchoTextSwipe(history, msgIndex, contextHistory) {
        if (isGenerating) return;

        const char = getCurrentCharacter();
        if (!char) {
            toastr.warning('Please select a character card to start texting.');
            return;
        }

        isGenerating = true;
        abortController = new AbortController();
        updateSendButton(true);
        setTypingIndicatorVisible(true);

        // Work on a shallow copy so we don't mutate callers' array references
        const workingHistory = [...history];
        const msg = workingHistory[msgIndex];
        if (!msg) {
            isGenerating = false;
            abortController = null;
            updateSendButton(false);
            onGenerationSettled();
            setTypingIndicatorVisible(false);
            return;
        }

        // Ensure the message has a swipes array so we can push to it
        initSwipesOnMessage(msg);

        const timing = getEmotionReplyTimingModel();

        // Image detection on the last user message in the context slice
        let pendingImageDetection = null;
        let apiHistory = contextHistory;
        const lastContextMsg = contextHistory.length > 0 ? contextHistory[contextHistory.length - 1] : null;
        if (imageGeneration && settings.imageGenerationEnabled === true && lastContextMsg?.is_user) {
            pendingImageDetection = imageGeneration.detectImageRequest(lastContextMsg.mes, contextHistory);
            if (pendingImageDetection?.triggered) {
                apiHistory = contextHistory.slice(0, -1);
            }
        }

        let result = '';

        try {
            const { apiMessages, rawPrompt, systemPrompt } = await buildApiMessagesFromHistory(apiHistory);
            await sleepWithAbort(Math.min(timing.replyDelayMs, 1500), abortController.signal);

            const bypassTextGeneration = (imageGeneration && lastContextMsg?.is_user && pendingImageDetection?.triggered && settings.imageGenerationIncludeTextReply === false);

            if (!bypassTextGeneration) {
                result = await requestEchoTextCompletion({ apiMessages, rawPrompt, systemPrompt, signal: abortController.signal });
            }

            let imageReply = null;
            if (imageGeneration && settings.imageGenerationEnabled === true && lastContextMsg?.is_user) {
                if (pendingImageDetection?.triggered) {
                    setTypingIndicatorVisible(false);
                    setImageGeneratingIndicatorVisible(true);
                }
                imageReply = await imageGeneration.maybeGenerateImageReply(lastContextMsg.mes, contextHistory, abortController.signal);
                setImageGeneratingIndicatorVisible(false);
            }

            const reply = readReply(result);
            const hasTextResponse = !!reply.mes;
            if (hasTextResponse || imageReply?.triggered) {
                const newSwipe = {
                    mes: reply.mes,
                    send_date: Date.now(),
                    ...(reply.mood ? { mood: reply.mood } : {})
                };

                if (imageReply?.triggered) {
                    newSwipe.imageAttachment = imageReply.result?.ok
                        ? {
                            status: 'ready',
                            type: 'image',
                            url: imageReply.result.url,
                            mimeType: imageReply.result.mimeType || 'image/png',
                            prompt: imageReply.result.prompt || imageReply.promptPayload?.prompt || '',
                            triggerType: imageReply.detection?.type || 'direct_request'
                        }
                        : {
                            status: 'error',
                            type: 'image',
                            error: imageReply.result?.error || 'Sorry, I could not generate an image right now.',
                            triggerType: imageReply.detection?.type || 'direct_request'
                        };

                    if (imageReply.result?.ok && gallery) {
                        try {
                            gallery.addImage({
                                charKey: getCharacterKey(),
                                charName: getCharacterName(),
                                avatarUrl: getAvatarUrlForCharacter(getCurrentCharacter()),
                                url: imageReply.result.url,
                                mimeType: imageReply.result.mimeType || 'image/png',
                                prompt: imageReply.result.prompt || imageReply.promptPayload?.prompt || '',
                                triggerType: imageReply.detection?.type || 'direct_request',
                                createdAt: Date.now()
                            });
                        } catch (galleryErr) {
                            warn('Failed to save generated image to gallery:', galleryErr);
                        }
                    }

                    if (settings.imageGenerationIncludeTextReply === false && imageReply.result?.ok) {
                        newSwipe.mes = '';
                    }
                }

                // Append as a new swipe and navigate to it
                msg.swipes.push(newSwipe);
                msg.swipeIndex = msg.swipes.length - 1;
                syncMsgFromSwipe(msg);

                saveChatHistory(workingHistory);
                markProactiveCharacterActivity(getCharacterKey(), false, 'reply');
                try { if (memorySystem) memorySystem.incrementTurn(); } catch (e) { /* ignore */ }
                renderMessages(workingHistory);
                setFabUnreadIndicator(panelOpen ? false : true);
                if (newSwipe.mood) noteMoodReport();
            }

        } catch (err) {
            if (err.name === 'AbortError' || (abortController && abortController.signal.aborted)) {
                log('Swipe generation cancelled');
            } else {
                error('Swipe generation failed:', err);
                toastr.error(`Echogram: ${err.message}`);
            }
            // On any failure or cancel, re-render with the unmodified original history
            // (the new swipe was never pushed since we only push on success)
            renderMessages(history);
        } finally {
            setTypingIndicatorVisible(false);
            setImageGeneratingIndicatorVisible(false);
            isGenerating = false;
            abortController = null;
            updateSendButton(false);
            onGenerationSettled();
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // BUBBLE TOUCH-SWIPE GESTURE (mobile)
    // ──────────────────────────────────────────────────────────────────────────
    /**
     * Attaches a horizontal touch-swipe gesture to the last character bubble.
     * Swipe left  → next swipe / regenerate.
     * Swipe right → previous swipe (rubber-bands at the first).
     * Includes live tracking, elastic snap-back, and slide-in/out animation.
     */
    function bindBubbleTouchSwipe(inner, msgIndex) {
        if (msgIndex < 0) return;
        const msgEl = findMessageElement(msgIndex);
        if (!msgEl.length) return;
        const bubble = msgEl.find('[data-et-role~="main"]')[0];
        if (!bubble) return;

        const AXIS_LOCK_PX = 8;   // min movement before axis is committed
        const COMMIT_PX    = 55;  // min drag to trigger a swipe action

        let startX = 0, startY = 0, currentDx = 0;
        let isTracking = false;  // horizontal gesture confirmed
        let isRejected = false;  // vertical scroll — ignore this gesture

        function clearStyles() {
            bubble.style.transition = '';
            bubble.style.transform  = '';
            bubble.style.opacity    = '';
        }

        function snapBack() {
            bubble.style.transition = 'transform 0.30s cubic-bezier(0.34,1.56,0.64,1), opacity 0.20s ease-out';
            bubble.style.transform  = '';
            bubble.style.opacity    = '';
            setTimeout(clearStyles, 330);
        }

        function elasticDeny(dx) {
            // Tiny overshoot in the blocked direction signals "nothing here"
            const rebound = dx < 0 ? 10 : -10;
            bubble.style.transition = 'transform 0.10s ease-out';
            bubble.style.transform  = `translateX(${rebound}px)`;
            setTimeout(snapBack, 110);
        }

        function doCommit(direction) {
            const exitX  = direction === 'next' ? -(bubble.offsetWidth * 0.55) : (bubble.offsetWidth * 0.55);
            const enterX = -exitX;

            // ── Phase 1: slide out ─────────────────────────────────────────
            bubble.style.transition = 'transform 0.17s ease-in, opacity 0.17s ease-in';
            bubble.style.transform  = `translateX(${exitX}px)`;
            bubble.style.opacity    = '0';

            setTimeout(() => {
                const h   = getChatHistory();
                const msg = h[msgIndex];
                if (!msg) { clearStyles(); return; }

                if (direction === 'next') {
                    const currentIdx = msg.swipeIndex ?? 0;
                    if (!msg.swipes || currentIdx >= msg.swipes.length - 1) {
                        // Last swipe — trigger regen. Reset bubble and let the
                        // generation flow handle the typing indicator etc.
                        clearStyles();
                        const contextHistory = h.slice(0, msgIndex);
                        generateEchoTextSwipe(h, msgIndex, contextHistory);
                        return;
                    }
                    msg.swipeIndex = currentIdx + 1;
                } else {
                    const currentIdx = msg.swipeIndex ?? 0;
                    if (currentIdx <= 0) { snapBack(); return; }
                    msg.swipeIndex = currentIdx - 1;
                }

                syncMsgFromSwipe(msg);
                saveChatHistory(h);

                // Re-render the message while the bubble is off-screen
                updateSwipeInPlace(msgIndex, h);

                // ── Phase 2: place the new bubble at the enter-from side (invisible) ──
                const entering = findMessageElement(msgIndex).find('[data-et-role~="main"]')[0] || bubble;
                entering.style.transition = 'none';
                entering.style.transform  = `translateX(${enterX}px)`;
                entering.style.opacity    = '0';

                // ── Phase 3: animate in ────────────────────────────────────
                void entering.offsetHeight; // force reflow
                entering.style.transition = 'transform 0.24s cubic-bezier(0.22,1,0.36,1), opacity 0.18s ease-out';
                entering.style.transform  = '';
                entering.style.opacity    = '';
                setTimeout(() => { entering.style.transition = ''; }, 270);
            }, 185);
        }

        bubble.addEventListener('touchstart', (e) => {
            if (isGenerating || e.touches.length !== 1) return;
            const t = e.touches[0];
            startX = t.clientX;
            startY = t.clientY;
            currentDx   = 0;
            isTracking  = false;
            isRejected  = false;
            bubble.style.transition = 'none';
        }, { passive: true });

        bubble.addEventListener('touchmove', (e) => {
            if (isRejected || e.touches.length !== 1) return;
            const t  = e.touches[0];
            const dx = t.clientX - startX;
            const dy = t.clientY - startY;

            if (!isTracking) {
                // Haven't locked an axis yet
                if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
                if (Math.abs(dy) >= Math.abs(dx)) { isRejected = true; return; }
                isTracking = true;
            }

            e.preventDefault(); // suppress vertical scroll while swiping horizontally
            currentDx = dx;

            // Rubber-band when swiping past the first swipe
            const h   = getChatHistory();
            const msg = h[msgIndex];
            let effectiveDx = dx;
            if (msg && dx > 0 && (msg.swipeIndex ?? 0) === 0) {
                effectiveDx = dx * 0.22; // strong resistance — nothing to the left
            }

            const progress = Math.min(Math.abs(effectiveDx) / 180, 1);
            bubble.style.transform = `translateX(${effectiveDx}px)`;
            bubble.style.opacity   = String(1 - progress * 0.30);
        }, { passive: false });

        bubble.addEventListener('touchend', () => {
            if (!isTracking) { bubble.style.transition = ''; return; }
            const dx  = currentDx;
            const h   = getChatHistory();
            const msg = h[msgIndex];

            if (Math.abs(dx) >= COMMIT_PX) {
                if (dx < 0) {
                    doCommit('next'); // swipe left = advance
                } else {
                    const canGoPrev = msg && msg.swipes && (msg.swipeIndex ?? 0) > 0;
                    canGoPrev ? doCommit('prev') : elasticDeny(dx);
                }
            } else {
                snapBack();
            }
        }, { passive: true });

        bubble.addEventListener('touchcancel', () => {
            isTracking = false;
            clearStyles();
        }, { passive: true });
    }

    /**
     * Called when combine mode is toggled on/off in the group bar.
     * Updates the panel header, placeholder, status row, and history display.
     * @param {boolean} isActive - true if combine mode was just switched ON
     */
    function onCombineModeToggle(isActive) {
        if (isActive) {
            // Show combined header listing all member names
            const members = groupManager ? groupManager.getGroupMembers() : [];
            const charNames = members.map(c => c.name).join(', ');
            jQuery('#et-panel-drag-handle').removeClass('et-panel-header-no-char');
            jQuery('#et-char-name').html(`Group: ${escapeHtml(charNames)}<i class="fa-solid fa-chevron-down et-char-name-caret" aria-hidden="true"></i>`);
            jQuery('#et-input').attr('placeholder', `Message all: ${charNames}...`);
        } else {
            // Restore to the currently active individual character
            applySelectedCharacterToPanel();
        }
        updatePanelStatusRow();
        // Load and render the appropriate history (combine vs individual)
        const history = getChatHistory();
        renderMessages(history);
    }

    /**
     * Builds API messages for a manual character nudge in Combined Group Mode.
     *
     * Unlike buildCombinedGroupApiMessages (which splits history at the last user
     * message and drops everything after it), this function feeds the ENTIRE history
     * — including character responses that have already happened since the last user
     * message — as attributed context turns.  The stance hint becomes the generation
     * cue in the final user slot, so the model always sees what everyone has said.
     *
     * Layout:
     *   [system]           Shared group prompt + anti-refusal framing
     *   [user / assistant] Full attributed history (user msgs + all char replies)
     *   [user]             User persona + character card + stance hint + verbosity
     *
     * @param {Array}  history    - full combine history at the moment of the nudge
     * @param {object} char       - the character whose turn it is to respond
     * @param {string} stanceHint - randomly chosen nudge instruction
     * @returns {{ apiMessages, rawPrompt, systemPrompt }}
     */
    async function buildManualNudgeApiMessages(history, char, stanceHint) {
        const charName  = char?.name || 'Character';
        const userName  = getUserName();
        const allHistory = Array.isArray(history) ? history : [];

        // ── 1. Shared system prompt ───────────────────────────────────────────
        const systemPrompt = buildGroupSharedSystemPrompt();

        // ── 2. Full history as attributed turns (no splitting) ────────────────
        // Every message is included so the model can see all prior character
        // replies, even those that came after the last user message.
        const historyMessages = allHistory.flatMap(msg => {
            const text = getContextMessageText(msg.mes);
            if (text === null) return [];
            if (msg.is_user) {
                return [{ role: 'user', content: text }];
            }
            const speaker = msg.charName || charName;
            return [{ role: 'assistant', content: `${speaker}: ${text}` },
                ...buildCombinedReactionTurns(msg, speaker)];
        });

        // ── 3. Final user turn: persona + character card + stance + verbosity ──
        // There is no new user message here — the character is responding
        // spontaneously.  The stance hint is the only driver of the new reply.
        const finalUserParts = [];

        // User persona description
        try {
            const powerUser = SillyTavern.getContext().powerUserSettings || {};
            const personaDesc = (powerUser.persona_description || '').trim();
            if (personaDesc) {
                finalUserParts.push(`${userName}'s persona: ${expandTimeDateMacros(replaceMacros(personaDesc))}`);
            }
        } catch (e) { /* ignore */ }

        // Character card — wrapped in XML so models treat it as reference data, not output
        const charDescription = (char?.description || char?.data?.description || '').trim();
        const charPersonality  = (char?.personality  || char?.data?.personality  || '').trim();
        const charCardParts = [];
        if (charDescription) charCardParts.push(`${charName}'s description: ${expandTimeDateMacros(replaceMacros(charDescription))}`);
        if (charPersonality)  charCardParts.push(`${charName}'s personality: ${expandTimeDateMacros(replaceMacros(charPersonality))}`);
        if (charCardParts.length > 0) finalUserParts.push(`<character_reference>\n${charCardParts.join('\n\n')}\n</character_reference>`);

        const charKey = char?.avatar || char?.name || '';
        const verbosity = charKey && settings.verbosityByCharacter ? settings.verbosityByCharacter[charKey] : null;

        // Stance hint — the randomly chosen nudge instruction that tells the model
        // how to engage with the live conversation (react to others, address the user,
        // etc.).  This is the primary driver that prevents the character from
        // repeating their opening reply verbatim.
        if (stanceHint) finalUserParts.push(stanceHint);

        // Generation cue — mirrors what buildCombinedGroupApiMessages injects so the
        // model knows exactly whose turn it is and that it must not echo prior replies.
        const charCueTemplate =
            (settings.promptGroupCharacterCue != null && settings.promptGroupCharacterCue !== '')
                ? settings.promptGroupCharacterCue
                : (window.EchoTextConfig?.defaultSettings?.promptGroupCharacterCue || '');
        const charCue = expandTimeDateMacros(replaceMacros(charCueTemplate));
        if (charCue) finalUserParts.push(charCue);

        finalUserParts.push(getVerbosityPrompt(verbosity));

        const finalUserContent = finalUserParts.filter(Boolean).join('\n\n');

        const apiMessages = [
            { role: 'system', content: systemPrompt },
            ...historyMessages,
            { role: 'user', content: finalUserContent }
        ];

        // rawPrompt for non-chat backends (KoboldAI, text-completion proxies)
        let rawPrompt = '';
        allHistory.forEach(msg => {
            const speaker = msg.is_user ? userName : (msg.charName || charName);
            rawPrompt += `${speaker}: ${msg.mes}\n`;
        });
        rawPrompt += `${charName}:`;

        return { apiMessages, rawPrompt, systemPrompt };
    }

    /**
     * Called when the user clicks a character button in Combined Group Mode.
     * Triggers a one-off generation request for that specific character, appended
     * to the current shared combine history.
     *
     * The character randomly chooses one of three stances (weighted equally):
     *   1. Address the chat's general context / latest user message
     *   2. React to or respond to the other group members' most recent lines
     *   3. Speak directly to the user
     *
     * This is injected as an extra system instruction into buildCombinedGroupApiMessages
     * so the character card, history, and group framing are all preserved.
     *
     * @param {string} charKey  - avatar/name key of the triggered character
     * @param {object} charObj  - character object (may be null if lookup failed)
     */
    async function triggerManualCombineChar(charKey, charObj) {
        if (isGenerating) {
            toastr.info('Please wait for the current response to finish before nudging a character.');
            return;
        }
        if (!groupManager) return;

        const group = groupManager.getCurrentGroup();
        const groupId = group ? String(group.id) : null;
        if (!groupId) return;

        const targetChar = charObj || groupManager.getGroupMemberByKey(charKey);
        if (!targetChar) {
            error('triggerManualCombineChar: could not resolve char for key', charKey);
            return;
        }

        const history = getChatHistory();
        const charName = targetChar.name || 'Character';

        // Pick a random stance to guide the character's response.
        // Each hint references the full conversation — the model has the complete
        // attributed history in context, so "what was just said" is accurate.
        const otherMembers = groupManager.getGroupMembers()
            .filter(c => (c.avatar || c.name) !== charKey)
            .map(c => c.name)
            .filter(Boolean);
        const othersLabel = otherMembers.length
            ? otherMembers.join(' and ')
            : 'the others';
        const stances = [
            `You are now choosing to speak up in the group conversation. Look at everything that's been said — by ${getUserName()} and by ${othersLabel} — and respond in a way that feels natural given the full thread. React, continue a thought, or bring something new in.`,
            `You are chiming in. Read what ${othersLabel} most recently said and respond directly to one of them — agree, push back, tease, ask a follow-up, or riff on their point. Make it feel like a real group conversation, not a reply to the original message.`,
            `You are speaking up unprompted. Address ${getUserName()} directly, drawing on something from the conversation so far — a question, a reaction, an observation, or a follow-up to something they said. Keep it conversational.`
        ];
        const stanceHint = stances[Math.floor(Math.random() * stances.length)];

        isGenerating = true;
        abortController = new AbortController();
        updateSendButton(true);

        const prevActiveKey = groupManager.getActiveCharKey();
        groupManager.setActiveCharKey(charKey);

        const timing = { typingLeadMs: 180, replyDelayMs: 320 };

        try {
            setTypingIndicatorVisible(true);
            await sleepWithAbort(timing.typingLeadMs, abortController.signal);
            await sleepWithAbort(timing.replyDelayMs, abortController.signal);

            // Use the dedicated nudge builder so the full history — including
            // character replies that already happened after the last user message —
            // is present as context.  buildApiMessagesFromHistoryForChar would
            // silently drop those post-user-message turns.
            const { apiMessages, rawPrompt, systemPrompt } =
                await buildManualNudgeApiMessages(history, targetChar, stanceHint);

            const result = await requestEchoTextCompletion({
                apiMessages, rawPrompt, systemPrompt,
                signal: abortController.signal
            });

            setTypingIndicatorVisible(false);

            if (result && result.trim()) {
                const charReply = {
                    is_user: false,
                    mes: result.trim(),
                    charName: charName,
                    charKey: charKey,
                    send_date: Date.now()
                };
                const newHistory = [...history, charReply];
                groupManager.saveCombineHistory(groupId, newHistory);
                renderMessages(newHistory);
                setFabUnreadIndicator(panelOpen ? false : true);
            }
        } catch (err) {
            if (err.name === 'AbortError' || (abortController && abortController.signal.aborted)) {
                log('Manual combine nudge cancelled');
            } else {
                error('Manual combine nudge failed:', err);
                toastr.error(`Echogram: ${err.message}`);
            }
        } finally {
            setTypingIndicatorVisible(false);
            groupManager.setActiveCharKey(prevActiveKey);
            isGenerating = false;
            abortController = null;
            updateSendButton(false);
            onGenerationSettled();
        }
    }

    /**
     * Combined response generation: every group member replies in sequence.
     * Each response is stored in the group's shared combine history with
     * charName + charKey fields for per-bubble attribution in renderMessages.
     * @param {Array} history - current combine history (including the new user message)
     */
    async function generateEchoTextCombined(history) {
        if (isGenerating) return;
        if (!groupManager) return;

        const members = groupManager.getGroupMembers();
        if (!members.length) return;

        const group = groupManager.getCurrentGroup();
        const groupId = group ? String(group.id) : null;
        if (!groupId) return;

        isGenerating = true;
        abortController = new AbortController();
        updateSendButton(true);

        let workingHistory = Array.isArray(history) ? [...history] : [];

        // Mark the latest user message as delivered / read
        const unreadIdx = getUnreadUserMessageIndices(workingHistory);
        const markUnread = (state, note) => unreadIdx.forEach(i => setUserMessageReceiptState(workingHistory, i, state, note));
        const timing = { deliveredDelayMs: 350, readDelayMs: 850, ghostDelayMs: 0, typingLeadMs: 250, replyDelayMs: 450 };

        try {
            if (unreadIdx.length) {
                await sleepWithAbort(timing.deliveredDelayMs, abortController.signal);
                markUnread('delivered', 'Delivered to group');
                groupManager.saveCombineHistory(groupId, workingHistory);

                await sleepWithAbort(timing.readDelayMs, abortController.signal);
                markUnread('read', 'Read by group');
                groupManager.saveCombineHistory(groupId, workingHistory);
            }

            // Generate a reply from each group member in order
            for (const char of members) {
                if (abortController.signal.aborted) break;

                const charKey = char.avatar || char.name;
                let prevActiveKey = groupManager.getActiveCharKey();

                // Temporarily set active key so buildSystemPrompt uses the right verbosity
                groupManager.setActiveCharKey(charKey);

                try {
                    setTypingIndicatorVisible(true);
                    await sleepWithAbort(timing.typingLeadMs, abortController.signal);
                    await sleepWithAbort(timing.replyDelayMs, abortController.signal);

                    const { apiMessages, rawPrompt, systemPrompt } =
                        await buildApiMessagesFromHistoryForChar(workingHistory, [], char);

                    const result = await requestEchoTextCompletion({
                        apiMessages, rawPrompt, systemPrompt,
                        signal: abortController.signal
                    });

                    setTypingIndicatorVisible(false);

                    if (result && result.trim()) {
                        const charReply = {
                            is_user: false,
                            mes: cleanGeneratedResponse(result),
                            charName: char.name,
                            charKey: charKey,
                            send_date: Date.now()
                        };
                        workingHistory = [...withMessagesSentSince(workingHistory), charReply];
                        groupManager.saveCombineHistory(groupId, workingHistory);
                        renderMessages(workingHistory);
                        setFabUnreadIndicator(panelOpen ? false : true);
                    }
                } finally {
                    setTypingIndicatorVisible(false);
                    groupManager.setActiveCharKey(prevActiveKey);
                }

                // Brief pause between characters so responses feel staggered
                if (!abortController.signal.aborted && char !== members[members.length - 1]) {
                    await sleepWithAbort(350, abortController.signal);
                }
            }

        } catch (err) {
            if (err.name === 'AbortError' || (abortController && abortController.signal.aborted)) {
                log('Combined generation cancelled');
            } else {
                error('Combined generation failed:', err);
                toastr.error(`Echogram: ${err.message}`);
            }
        } finally {
            setTypingIndicatorVisible(false);
            isGenerating = false;
            abortController = null;
            updateSendButton(false);
            onGenerationSettled();
        }
    }

    /**
     * Regenerate a single character's response in Combined Group Mode.
     *
     * Unlike generateEchoTextCombined (which iterates every member), this only
     * regenerates `targetCharKey`.  It receives the history split into two parts:
     *
     *   historyBefore — everything up to (not including) the target message.
     *                   Used as the generation context so the model sees the right
     *                   conversation up to that point.
     *   historyAfter  — messages that came AFTER the target message (e.g. Iris's
     *                   response when regenerating Joi's).  These are preserved
     *                   verbatim and stitched back in after the new reply.
     *
     * Final saved history: [...historyBefore, newReply, ...historyAfter]
     *
     * @param {Array}  historyBefore  - history up to (excl.) the message being regenerated
     * @param {Array}  historyAfter   - history after the message being regenerated
     * @param {string} targetCharKey  - avatar/name key of the character to regenerate
     */
    async function generateEchoTextCombinedForChar(historyBefore, historyAfter, targetCharKey, backupHistory = null) {
        if (isGenerating) return;
        if (!groupManager) return;

        const group = groupManager.getCurrentGroup();
        const groupId = group ? String(group.id) : null;
        if (!groupId) return;

        const targetChar = groupManager.getGroupMemberByKey(targetCharKey);
        if (!targetChar) {
            error('generateEchoTextCombinedForChar: could not resolve char for key', targetCharKey);
            return;
        }

        isGenerating = true;
        abortController = new AbortController();
        updateSendButton(true);

        const prevActiveKey = groupManager.getActiveCharKey();
        // Temporarily point active key at the target so verbosity/system prompt are scoped correctly
        groupManager.setActiveCharKey(targetCharKey);

        const timing = { typingLeadMs: 250, replyDelayMs: 450 };

        try {
            setTypingIndicatorVisible(true);
            await sleepWithAbort(timing.typingLeadMs, abortController.signal);
            await sleepWithAbort(timing.replyDelayMs, abortController.signal);

            // Build the API messages using only the pre-target history as context
            const { apiMessages, rawPrompt, systemPrompt } =
                await buildApiMessagesFromHistoryForChar(historyBefore, [], targetChar);

            const result = await requestEchoTextCompletion({
                apiMessages, rawPrompt, systemPrompt,
                signal: abortController.signal
            });

            setTypingIndicatorVisible(false);

            if (result && result.trim()) {
                const charReply = {
                    is_user: false,
                    mes: cleanGeneratedResponse(result),
                    charName: targetChar.name,
                    charKey: targetCharKey,
                    send_date: Date.now()
                };
                // Stitch: preserve everything before, insert new reply, preserve everything after
                const finalHistory = [...historyBefore, charReply, ...historyAfter];
                pruneSwipesOnPrevLastChar(finalHistory);
                groupManager.saveCombineHistory(groupId, finalHistory);
                renderMessages(finalHistory);
                setFabUnreadIndicator(panelOpen ? false : true);
            }
        } catch (err) {
            if (err.name === 'AbortError' || (abortController && abortController.signal.aborted)) {
                log('Combined single-char regen cancelled');
                if (backupHistory) {
                    saveChatHistory(backupHistory);
                    renderMessages(backupHistory);
                }
            } else {
                error('Combined single-char regen failed:', err);
                toastr.error(`Echogram: ${err.message}`);
                if (backupHistory) {
                    saveChatHistory(backupHistory);
                    renderMessages(backupHistory);
                }
            }
        } finally {
            setTypingIndicatorVisible(false);
            groupManager.setActiveCharKey(prevActiveKey);
            isGenerating = false;
            abortController = null;
            updateSendButton(false);
            onGenerationSettled();
        }
    }

    function getDateKeyLocal(d = new Date()) {
        return proactiveMessaging ? proactiveMessaging.getDateKeyLocal(d) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function sleepWithAbort(ms, signal) {
        return new Promise((resolve, reject) => {
            if (!ms || ms <= 0) return resolve();
            if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));

            const timer = setTimeout(() => {
                if (signal) signal.removeEventListener('abort', onAbort);
                resolve();
            }, ms);

            const onAbort = () => {
                clearTimeout(timer);
                if (signal) signal.removeEventListener('abort', onAbort);
                reject(new DOMException('Aborted', 'AbortError'));
            };

            if (signal) signal.addEventListener('abort', onAbort);
        });
    }

    function findLastUserMessageIndex(history) {
        if (!Array.isArray(history)) return -1;
        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i]?.is_user) return i;
        }
        return -1;
    }

    function setTypingIndicatorVisible(visible) {
        showTypingIndicator = !!visible;
        if (!panelOpen) return;
        // For platforms that say it in the header ("对方正在输入…") rather than in the list
        jQuery('#et-panel').attr('data-et-typing', showTypingIndicator ? '' : null);

        const inner = jQuery('#et-messages-inner');
        if (!inner.length) return;

        if (visible) {
            if (!inner.find('[data-et-role~="typing"]').length) {
                const el = jQuery(getActivePlatform().templates.typing(getMessageRenderContext()).trim());
                inner.append(el);
                if (settings.autoScroll) {
                    const messagesEl = document.getElementById('et-messages');
                    if (messagesEl) {
                        messagesEl.scrollTop = messagesEl.scrollHeight;
                        el.find('img').on('load', function() {
                            if (settings.autoScroll) {
                                messagesEl.scrollTop = messagesEl.scrollHeight;
                            }
                        });
                    }
                }
            }
        } else {
            inner.find('[data-et-role~="typing"]').remove();
        }
    }

    // ── Image generating indicator ────────────────────────────────────────────
    // Shown INSTEAD of the typing indicator while SD image generation is in
    // progress. Distinct appearance: camera icon + aperture-spin ring + label.
    function setImageGeneratingIndicatorVisible(visible) {
        if (!panelOpen) return;
        const inner = jQuery('#et-messages-inner');
        if (!inner.length) return;

        if (visible) {
            if (!inner.find('[data-et-role~="image-generating"]').length) {
                const el = jQuery(getActivePlatform().templates.imageGenerating(getMessageRenderContext()).trim());
                inner.append(el);
                if (settings.autoScroll) {
                    const messagesEl = document.getElementById('et-messages');
                    if (messagesEl) {
                        messagesEl.scrollTop = messagesEl.scrollHeight;
                        el.find('img').on('load', function() {
                            if (settings.autoScroll) {
                                messagesEl.scrollTop = messagesEl.scrollHeight;
                            }
                        });
                    }
                }
            }
        } else {
            inner.find('[data-et-role~="image-generating"]').remove();
        }
    }

    function setFabUnreadIndicator(hasUnread) {
        hasUnreadCharacterMessage = !!hasUnread;
        const fab = jQuery('#et-fab');
        if (!fab.length) return;
        fab.toggleClass('et-fab-unread', hasUnreadCharacterMessage);
        fab.attr('title', hasUnreadCharacterMessage ? 'Open Echogram (new message)' : 'Open Echogram');
    }

    function setUserMessageReceiptState(history, msgIndex, state, note = '') {
        if (!Array.isArray(history) || msgIndex < 0 || !history[msgIndex] || !history[msgIndex].is_user) return history;
        history[msgIndex].meta = history[msgIndex].meta || {};
        history[msgIndex].meta.receipt = {
            state,
            note,
            at: Date.now()
        };

        // Re-render just that message rather than the whole chat
        if (panelOpen) refreshMessages(history);

        return history;
    }

    function getEmotionReplyTimingModel() {
        return emotionSystem
            ? emotionSystem.getEmotionReplyTimingModel()
            : { deliveredDelayMs: 500, readDelayMs: 1200, ghostDelayMs: 0, typingLeadMs: 300, replyDelayMs: 600 };
    }

    function syncProactiveStateWithHistory(characterKey, history) {
        if (proactiveMessaging) proactiveMessaging.syncProactiveStateWithHistory(characterKey, history);
    }

    function markProactiveUserActivity(characterKey, timestamp = Date.now()) {
        if (proactiveMessaging) proactiveMessaging.markProactiveUserActivity(characterKey, timestamp);
    }

    function markProactiveCharacterActivity(characterKey, proactive = false, outboundType = 'reply', timestamp = Date.now()) {
        if (proactiveMessaging) proactiveMessaging.markProactiveCharacterActivity(characterKey, proactive, outboundType, timestamp);
    }

    function refreshProactiveInsights() {
        if (proactiveMessaging) proactiveMessaging.refreshProactiveInsights();
    }

    async function triggerTestProactiveMessage() {
        if (proactiveMessaging) await proactiveMessaging.triggerTestProactiveMessage();
    }

    function startProactiveScheduler() {
        if (proactiveMessaging) proactiveMessaging.startProactiveScheduler();
    }

    function stopProactiveScheduler() {
        if (proactiveMessaging) proactiveMessaging.stopProactiveScheduler();
    }

    // ============================================================
    // CONNECTION PROFILE HELPERS
    // ============================================================

    function populateConnectionProfiles() {
        try {
            const context = SillyTavern.getContext();
            const connectionManager = context?.extensionSettings?.connectionManager;
            const select = jQuery('#et_profile_select');
            const currentValue = select.val() || settings.preset;

            select.empty();
            select.append('<option value="">-- Select Profile --</option>');

            if (connectionManager?.profiles?.length) {
                connectionManager.profiles.forEach(profile => {
                    const safeName = profile.name.replace(/"/g, '&quot;');
                    const isSelected = currentValue === profile.name ? ' selected' : '';
                    select.append(`<option value="${safeName}"${isSelected}>${safeName}</option>`);
                });
            } else {
                select.append('<option value="" disabled>No profiles found</option>');
            }
        } catch (err) {
            warn('Error loading connection profiles:', err);
        }
    }

    function populateConnectionProfilesPanel() {
        try {
            const context = SillyTavern.getContext();
            const connectionManager = context?.extensionSettings?.connectionManager;
            const select = jQuery('#et_profile_select_panel');
            const currentValue = settings.preset;

            select.empty();
            select.append('<option value="">-- Select Profile --</option>');

            if (connectionManager?.profiles?.length) {
                connectionManager.profiles.forEach(profile => {
                    const safeName = profile.name.replace(/"/g, '&quot;');
                    const isSelected = currentValue === profile.name ? ' selected' : '';
                    select.append(`<option value="${safeName}"${isSelected}>${safeName}</option>`);
                });
            } else {
                select.append('<option value="" disabled>No profiles found</option>');
            }
        } catch (err) {
            warn('Error loading connection profiles for panel:', err);
        }
    }

    async function fetchOllamaModels() {
        try {
            const baseUrl = (settings.ollama_url || 'http://localhost:11434').replace(/\/$/, '');
            const response = await fetch(`${baseUrl}/api/tags`, { method: 'GET' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            const models = data.models || [];

            const select = jQuery('#et_ollama_model_select');
            const currentModel = settings.ollama_model || (models.length > 0 ? models[0].name : '');
            select.empty();
            models.forEach(m => {
                select.append(`<option value="${m.name}"${m.name === currentModel ? ' selected' : ''}>${m.name}</option>`);
            });
            if (currentModel) { settings.ollama_model = currentModel; saveSettings(); }
            jQuery('#et_ollama_status').text(`Loaded ${models.length} model(s).`).css('color', '#a8ffaa');
        } catch (err) {
            jQuery('#et_ollama_status').text(`Error: ${err.message}`).css('color', '#ff8888');
        }
    }

    async function fetchMultimodalModels() {
        jQuery('#et_multimodal_model_status').text('Model discovery is now managed by the SillyTavern Image Generation plugin.').css('color', '#a8ffaa');
        jQuery('#et_multimodal_model_status_panel').text('Model discovery is now managed by the SillyTavern Image Generation plugin.').css('color', '#a8ffaa');
    }

    // ============================================================
    // FLOATING ACTION BUTTON (FAB)
    // ============================================================

    function buildFabHtml() {
        const icon = settings.fabIcon || 'fa-message';
        return `<div id="et-fab" title="Open Echogram"><i class="fa-solid ${icon}"></i></div>`;
    }

    function positionFab() {
        const fab = jQuery('#et-fab');
        if (!fab.length) return;

        const size = settings.fabSize;
        fab.css({ width: size + 'px', height: size + 'px' });

        // 24 px on mobile clears the home indicator; 16 px on desktop.
        const margin = isMobileDevice() ? 24 : 16;
        const vw = getViewportWidth();
        const vh = getViewportHeight();

        // Free-floating position (not snapped to any edge).
        if (settings.fabFreeX != null && settings.fabFreeY != null) {
            const left = Math.max(margin, Math.min(vw - size - margin, (settings.fabFreeX / 100) * vw));
            const top  = Math.max(margin, Math.min(vh - size - margin, (settings.fabFreeY / 100) * vh));
            fab.css({ left: left + 'px', top: top + 'px', right: '', bottom: '' });
            return;
        }

        // On mobile the FAB is position:absolute inside the fixed portal, so
        // left/top/right/bottom are relative to the portal's top-left (= viewport 0,0).
        // We run the same edge-snap logic as desktop but with a larger margin that
        // clears the iOS home indicator and notch safe areas.
        const edge = settings.fabEdge || 'right';
        const pos  = settings.fabPosition != null ? settings.fabPosition : 80;

        if (edge === 'right') {
            const top = Math.max(margin, Math.min(vh - size - margin, (pos / 100) * vh));
            fab.css({ right: margin + 'px', bottom: '', left: '', top: top + 'px' });
        } else if (edge === 'left') {
            const top = Math.max(margin, Math.min(vh - size - margin, (pos / 100) * vh));
            fab.css({ left: margin + 'px', right: '', bottom: '', top: top + 'px' });
        } else if (edge === 'bottom') {
            const left = Math.max(margin, Math.min(vw - size - margin, (pos / 100) * vw));
            fab.css({ bottom: margin + 'px', top: '', left: left + 'px', right: '' });
        } else if (edge === 'top') {
            const left = Math.max(margin, Math.min(vw - size - margin, (pos / 100) * vw));
            fab.css({ top: margin + 'px', bottom: '', left: left + 'px', right: '' });
        }
    }

    function makeFabDraggable() {
        const fab = document.getElementById('et-fab');
        if (!fab) return;

        let isDragging = false;
        let startX, startY, startLeft, startTop;
        let hasMoved = false;

        function onStart(clientX, clientY) {
            isDragging = true;
            hasMoved = false;
            fabDragging = false;
            const rect = fab.getBoundingClientRect();
            startX = clientX;
            startY = clientY;
            startLeft = rect.left;
            startTop = rect.top;
            fab.style.transition = 'none';
        }

        function onMove(clientX, clientY) {
            if (!isDragging) return;
            const dx = clientX - startX;
            const dy = clientY - startY;
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) { hasMoved = true; fabDragging = true; }
            if (!hasMoved) return;
            const size = fab.offsetWidth;
            const newLeft = Math.max(0, Math.min(getViewportWidth() - size, startLeft + dx));
            const newTop = Math.max(0, Math.min(getViewportHeight() - size, startTop + dy));
            fab.style.left = newLeft + 'px';
            fab.style.top = newTop + 'px';
            fab.style.right = '';
            fab.style.bottom = '';
        }

        function onEnd() {
            if (!isDragging) return;
            isDragging = false;
            fab.style.transition = '';
            if (hasMoved) snapFabToEdge();
            setTimeout(() => { fabDragging = false; }, 50);
        }

        fab.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            onStart(e.clientX, e.clientY);
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            e.preventDefault();
        });

        function onMouseMove(e) { onMove(e.clientX, e.clientY); }
        function onMouseUp() {
            onEnd();
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }

        fab.addEventListener('touchstart', (e) => {
            const t = e.touches[0];
            onStart(t.clientX, t.clientY);
        }, { passive: true });

        fab.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            // Must be non-passive to call preventDefault(),
            // which stops the page from scrolling while the FAB is being dragged.
            e.preventDefault();
            const t = e.touches[0];
            onMove(t.clientX, t.clientY);
        }, { passive: false });

        fab.addEventListener('touchend', () => { onEnd(); });
    }

    function snapFabToEdge() {
        const fab = document.getElementById('et-fab');
        if (!fab) return;

        const rect = fab.getBoundingClientRect();
        const size = fab.offsetWidth;
        // Match the margin used in positionFab(): 24 px on mobile (clears home
        // indicator), 16 px on desktop.
        const margin = isMobileDevice() ? 24 : 16;
        const cx = rect.left + size / 2;
        const cy = rect.top + size / 2;
        // Use visual viewport so snap calculations are correct on iOS
        // (window.innerWidth/Height may include collapsed browser chrome).
        const vw = getViewportWidth();
        const vh = getViewportHeight();

        // Only snap to an edge when the FAB center is within 15% of the viewport
        // edge in that axis.  Outside that zone the button floats freely wherever
        // the user dropped it.
        const SNAP_ZONE = 0.07;
        const nearLeft   = cx < SNAP_ZONE * vw;
        const nearRight  = cx > (1 - SNAP_ZONE) * vw;
        const nearTop    = cy < SNAP_ZONE * vh;
        const nearBottom = cy > (1 - SNAP_ZONE) * vh;

        if (!nearLeft && !nearRight && !nearTop && !nearBottom) {
            // Free-float: store position as % of viewport so it survives resizes.
            settings.fabFreeX = Math.round(((rect.left) / vw) * 100 * 10) / 10;
            settings.fabFreeY = Math.round(((rect.top)  / vh) * 100 * 10) / 10;
            // Clear any previously saved edge state.
            settings.fabEdge = null;
            settings.fabPosition = null;
            saveSettings();
            // No animation — the button is already in the right place from the drag.
            return;
        }

        // Near an edge: snap to the closest one.
        // Clear any previously saved free-float position.
        settings.fabFreeX = null;
        settings.fabFreeY = null;

        const distLeft   = cx;
        const distRight  = vw - cx;
        const distTop    = cy;
        const distBottom = vh - cy;
        const minDist = Math.min(distLeft, distRight, distTop, distBottom);

        let edge, pos;
        if (minDist === distRight)       { edge = 'right';  pos = Math.round((cy / vh) * 100); }
        else if (minDist === distLeft)   { edge = 'left';   pos = Math.round((cy / vh) * 100); }
        else if (minDist === distBottom) { edge = 'bottom'; pos = Math.round((cx / vw) * 100); }
        else                             { edge = 'top';    pos = Math.round((cx / vw) * 100); }

        settings.fabEdge = edge;
        settings.fabPosition = pos;
        saveSettings();

        fab.style.transition = 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)';
        positionFab();
    }

    // ============================================================
    // FLOATING PANEL
    // ============================================================

    function getCharAvatarColor(charName) {
        let hash = 0;
        for (let i = 0; i < charName.length; i++) {
            hash = charName.charCodeAt(i) + ((hash << 5) - hash);
        }
        return `hsl(${Math.abs(hash) % 360}, 65%, 60%)`;
    }

    // SillyTavern keeps the user's persona avatar in its personas module rather
    // than in getContext(); it's imported once at startup, and until then (or if
    // that fails) user avatars fall back to initials
    let personasModule = null;

    function loadPersonasModule() {
        import(new URL('scripts/personas.js', document.baseURI).href)
            .then(module => { personasModule = module; })
            .catch(err => warn('Could not read the persona avatar:', err));
    }

    /** The user's persona avatar URL, or null. */
    function getUserAvatarUrl() {
        const file = personasModule?.user_avatar;
        if (!file) return null;
        try {
            return SillyTavern.getContext().getThumbnailUrl('persona', file);
        } catch (e) {
            return null;
        }
    }

    /**
     * Get the character's avatar image URL from SillyTavern.
     * Returns null if no image is available.
     */
    /** The current character's avatar in EchoText: one picked here, else the card's. */
    function getCharAvatarUrl() {
        return getCustomCharAvatarUrl() || getCardAvatarUrl();
    }

    function getCardAvatarUrl() {
        try {
            const char = getCurrentCharacter();
            if (!char || !char.avatar || char.avatar === 'none') return null;
            const context = SillyTavern.getContext();
            return context.getThumbnailUrl('avatar', char.avatar);
        } catch (e) {
            return null;
        }
    }

    /**
     * An avatar picked in EchoText for the current character, as a URL, or null.
     * settings.avatarByCharacter maps a character key to the image's path in the
     * user's images (as /api/images/upload returned it, e.g. user/images/Mira/…).
     */
    function getCustomCharAvatarUrl() {
        const charKey = getCharacterKey();
        const path = charKey && settings.avatarByCharacter?.[charKey];
        if (!path) return null;
        return /^(\/|[a-z][a-z0-9+.-]*:)/i.test(path) ? path : `/${path}`;
    }

    /**
     * Build avatar HTML: image if available, else initial circle with theme color.
     * @param {string} charName - character name
     * @param {string} extraClass - additional CSS classes
     * @param {string} id - element id (optional)
     * @param {boolean} small - use small size class
     */
    function buildAvatarHtml(charName, extraClass = '', id = '', small = false) {
        const avatarUrl = getCharAvatarUrl();
        const initial = charName.charAt(0).toUpperCase();
        const escapedInitial = escapeHtml(initial);
        const idAttr = id ? ` id="${id}"` : '';
        const sizeClass = small ? 'et-char-avatar-small' : 'et-char-avatar';

        // Derive initial-circle background from name (same palette as character picker)
        const bgColor = _pickerAvatarBg ? _pickerAvatarBg(charName) : 'var(--et-theme-color)';

        // Special placeholder when no character is loaded (name is the fallback 'Character' and no image)
        const isNoChar = !getCurrentCharacter();
        if (isNoChar && !avatarUrl && !small) {
            return `<div class="${sizeClass} et-no-char-avatar et-echo-logo${extraClass ? ' ' + extraClass : ''}"${idAttr} title="Echogram"><svg width="62%" height="62%" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="4" width="2.6" height="16" rx="1.3" fill="rgba(255,255,255,0.92)"/><rect x="5" y="4" width="13.5" height="2.6" rx="1.3" fill="rgba(255,255,255,0.92)"/><rect x="5" y="10.7" width="10.5" height="2.6" rx="1.3" fill="rgba(255,255,255,0.92)"/><rect x="5" y="17.4" width="13.5" height="2.6" rx="1.3" fill="rgba(255,255,255,0.92)"/></svg></div>`;
        }

        if (avatarUrl) {
            // Render the initial circle as the base layer; the <img> floats above it.
            // After the image loads we canvas-fingerprint it — if it matches the ST default
            // silhouette (near-black or grey-purple [149,127,143] at px 50,50) we remove the
            // image and reveal the styled initial circle underneath.
            const html = `<div class="${sizeClass}${extraClass ? ' ' + extraClass : ''}"${idAttr} style="background:${bgColor};">
                <span class="et-char-avatar-initial" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1rem;color:#fff;border-radius:50%;pointer-events:none;">${escapedInitial}</span>
                <img src="${avatarUrl}" alt="${escapedInitial}" class="et-avatar-img" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.remove();">
            </div>`;
            // Schedule fingerprinting after DOM insertion via a non-blocking timeout
            // A picked avatar is never ST's default (and a dark photo could pass for it)
            if (id && !getCustomCharAvatarUrl()) {
                setTimeout(() => _fingerprintAvatarImg(document.getElementById(id)), 0);
            }
            return html;
        }
        return `<div class="${sizeClass}${extraClass ? ' ' + extraClass : ''}"${idAttr} style="background:${bgColor};position:relative;">
            <span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1rem;color:#fff;">${escapedInitial}</span>
        </div>`;
    }

    /**
     * Canvas-fingerprint the <img> inside an avatar wrapper element.
     * If the loaded image matches the ST default silhouette, removes it to
     * reveal the styled initial circle rendered underneath.
     */
    function _fingerprintAvatarImg(wrapperEl) {
        if (!wrapperEl) return;
        const img = wrapperEl.querySelector('img.et-avatar-img');
        if (!img) return;

        function _check() {
            try {
                const naturalW = img.naturalWidth;
                const naturalH = img.naturalHeight;
                if (!naturalW || !naturalH) return; // not loaded yet
                const sampleX = Math.min(50, naturalW - 1);
                const sampleY = Math.min(50, naturalH - 1);
                const c = document.createElement('canvas');
                c.width = naturalW; c.height = naturalH;
                const ctx = c.getContext('2d');
                ctx.drawImage(img, 0, 0);
                const px = ctx.getImageData(sampleX, sampleY, 1, 1).data;
                const brightness = px[0] + px[1] + px[2];
                const isNearBlack = brightness <= 15;
                const TOL = 12;
                const isGreyPurple = Math.abs(px[0] - 149) <= TOL &&
                                     Math.abs(px[1] - 127) <= TOL &&
                                     Math.abs(px[2] - 143) <= TOL;
                if (isNearBlack || isGreyPurple) img.remove();
            } catch (_e) { /* cross-origin — keep the image */ }
        }

        if (img.complete && img.naturalWidth > 0) {
            _check();
        } else {
            img.addEventListener('load', _check, { once: true });
        }
    }

    /**
     * Refreshes the unread pulse class on group bar buttons based on groupManager state.
     */
    function renderGroupUnreadIndicators() {
        if (!groupManager) return;
        const unread = groupManager.getUnreadCharKeys();
        jQuery('.et-group-char-btn').each(function () {
            const key = jQuery(this).data('char-key');
            jQuery(this).toggleClass('et-group-unread', unread.has(key));
        });
    }

    /**
     * Switch the EchoText panel to focus on a different group member.
     * Called when the user clicks a character button in the group bar.
     */
    function switchGroupChar(charKey, charObj) {
        if (!charObj) return;
        groupManager.setActiveCharKey(charKey);

        // Clear unread for the newly selected char and refresh indicators
        if (groupManager.clearGroupCharUnread) groupManager.clearGroupCharUnread(charKey);
        renderGroupUnreadIndicators();

        // In combine mode, switching single chars doesn't affect the panel display
        if (groupManager.isCombineMode()) return;

        const charName = charObj.name || 'Character';

        // Update panel header
        jQuery('#et-panel-drag-handle').removeClass('et-panel-header-no-char');
        jQuery('#et-panel').removeClass('et-panel-no-char');
        jQuery('#et-char-name').html(`${escapeHtml(charName)}<i class="fa-solid fa-chevron-down et-char-name-caret" aria-hidden="true"></i>`);
        jQuery('#et-input').attr('placeholder', `Text ${charName}...`).prop('disabled', false);
        jQuery('#et-send-btn, #et-attach-btn, #et-voice-btn').prop('disabled', false);
        setComposeMode(null);
        cancelScheduledReply();

        // Rebuild avatar in the header using the group module's builder
        const newAvatarHtml = groupManager.buildAvatarHtmlForChar(charObj, '', 'et-char-avatar-wrap');
        jQuery('#et-char-avatar-wrap').replaceWith(newAvatarHtml);

        updatePanelStatusRow();

        // Render this character's history
        const history = getChatHistory();
        renderMessages(history);

        // Update proactive state sync
        syncProactiveStateWithHistory(charKey, history);
    }

    function buildPanelHtml() {
        const inGroup = groupManager && groupManager.isGroupSession();
        // Combined Group Mode: the header must list all member names, not just the active char.
        // buildPanelHtml is called by openPanel() before applySelectedCharacterToPanel() runs,
        // so without this check the header would show only the first active member (e.g. "Amy")
        // instead of "Group: Amy, Joi, Iris" — making it appear combine mode was exited.
        const inCombine = inGroup && groupManager && groupManager.isCombineMode();

        let charName, hasChar, displayName;
        if (inCombine) {
            const members = groupManager.getGroupMembers();
            const memberNames = members.map(c => c.name).join(', ');
            charName = memberNames;
            hasChar = members.length > 0;
            displayName = `Group: ${memberNames}`;
        } else {
            charName = getCharacterName();
            hasChar = !!getCurrentCharacter();
            displayName = hasChar ? charName : 'Choose A Character';
        }
        const noCharClass = hasChar ? '' : ' et-panel-header-no-char';
        const panelNoCharClass = hasChar ? '' : ' et-panel-no-char';

        return `
        <div id="et-panel" class="et-panel${panelNoCharClass}">
            <div class="et-resize-handle" data-corner="nw"></div>
            <div class="et-resize-handle" data-corner="ne"></div>
            <div class="et-resize-handle" data-corner="sw"></div>
            <div class="et-resize-handle" data-corner="se"></div>

            <div class="et-panel-header${noCharClass}" id="et-panel-drag-handle" data-et-role="header">
                <div class="et-header-left">
                    ${buildAvatarHtml(charName, '', 'et-char-avatar-wrap')}
                    <span class="et-panel-echotext-title">Echogram</span>
                    <div class="et-header-info">
                        <div class="et-char-name-row">
                            <div class="et-char-name" id="et-char-name" title="Select character">${escapeHtml(displayName)}<i class="fa-solid fa-chevron-down et-char-name-caret" aria-hidden="true"></i></div>
                        </div>
                        <div class="et-char-status-row${inGroup ? '' : ' et-panel-status-clickable'}" id="et-panel-status-trigger" title="Open details">
                            <div id="et-panel-status-content" class="et-panel-status-content"><span class="et-status-placeholder">Loading...</span></div>
                        </div>
                    </div>
                </div>
                <div class="et-header-right">
                    <div class="et-header-btn" id="et-overflow-btn" title="More options">
                        <i class="fa-solid fa-ellipsis-vertical"></i>
                    </div>
                    <div class="et-overflow-menu" id="et-overflow-menu">
                        <div class="et-overflow-menu-item" id="et-overflow-settings">
                            <i class="fa-solid fa-gear"></i>
                            <span>Settings</span>
                        </div>
                        <!-- Stand-ins for the header's character picker and status row, for platform headers without them -->
                        <div class="et-overflow-menu-item et-overflow-header-only" id="et-overflow-character">
                            <i class="fa-solid fa-user-group"></i>
                            <span>Switch Character</span>
                        </div>
                        <div class="et-overflow-menu-item et-overflow-header-only" id="et-overflow-status">
                            <i class="fa-solid fa-heart-pulse"></i>
                            <span>Status</span>
                        </div>
                        <div class="et-overflow-menu-item" id="et-overflow-gallery" style="display:none">
                            <i class="fa-regular fa-images"></i>
                            <span>Gallery</span>
                        </div>
                        <div class="et-overflow-menu-item" id="et-overflow-saveload" style="display:none">
                            <i class="fa-solid fa-floppy-disk"></i>
                            <span>Archives</span>
                        </div>
                        <div class="et-overflow-menu-divider" id="et-overflow-char-divider" style="display:none"></div>
                        <div class="et-overflow-menu-item" id="et-overflow-clear" style="display:none">
                            <i class="fa-solid fa-trash-can"></i>
                            <span>Clear History</span>
                        </div>
                    </div>
                    <div class="et-header-btn et-close-btn" id="et-close-btn" title="Close Echogram">
                        <i class="fa-solid fa-xmark"></i>
                    </div>
                </div>
            </div>

            <div class="et-panel-content">
                <div class="et-messages" id="et-messages" data-et-role="messages">
                    <div class="et-messages-inner" id="et-messages-inner" data-et-role="message-list"></div>
                </div>
            </div>

            <div class="et-input-bar" data-et-role="input-bar">
                <div class="et-input-wrap">
                    <button class="et-voice-btn" id="et-voice-btn" type="button" title="Voice message" hidden${hasChar ? '' : ' disabled'}><i class="fa-solid fa-microphone"></i></button>
                    <button class="et-attach-btn" id="et-attach-btn" type="button" title="Attach"${hasChar ? '' : ' disabled'}><i class="fa-solid fa-plus"></i></button>
                    <button class="et-share-type" id="et-share-type" type="button" title="File type" hidden></button>
                    <textarea class="et-input" id="et-input" enterkeyhint="send" placeholder="${inCombine ? `Message all: ${charName}...` : (hasChar ? `Text ${charName}...` : 'Text a character...')}" rows="1"${hasChar ? '' : ' disabled'}></textarea>
                </div>
                <button class="et-send-btn" id="et-send-btn" title="Send message"${hasChar ? '' : ' disabled'}>
                    <i class="fa-solid fa-paper-plane"></i>
                </button>
            </div>
        </div>`;
    }

    function openPanel() {
        if (panelOpen) return;

        const fab = jQuery('#et-fab');
        if (!fab.length) return;

        // Re-check background luminance on every open so that a SillyTavern
        // theme switch made while the panel was closed is picked up immediately.
        applyAdaptiveGlass();

        jQuery('#et-panel').remove();
        // Build the panel HTML into body first (jQuery needs it in the DOM
        // to resolve selectors), then immediately move it into the portal so
        // position:fixed works correctly on iOS (body is position:fixed on
        // mobile viewports in SillyTavern's mobile-styles.css).
        jQuery('body').append(buildPanelHtml());
        const panelEl = document.getElementById('et-panel');
        if (panelEl) {
            const portal = ensurePortal();
            portal.appendChild(panelEl);
        }
        const panel = jQuery('#et-panel');

        if (isMobileDevice()) {
            // Mobile: CSS (mobile-style.css) handles full-screen sizing via inset/width/height.
            // Skip saved panelLeft/panelTop/panelWidth/panelHeight — desktop values are
            // unsuitable for a phone viewport. Use fade-only animation (no scale, which
            // causes compositor jank on iOS).
            panel.css({ opacity: 0 });
            requestAnimationFrame(() => {
                panel.css({ transition: 'opacity 0.22s ease' });
                requestAnimationFrame(() => panel.css({ opacity: 1 }));
            });
        } else {
            // Desktop: restore saved size and position, use spring-scale animation.
            const panelW = settings.panelWidth || 380;
            const panelH = settings.panelHeight || 600;
            const defaultLeft = Math.max(20, window.innerWidth - panelW - 24);
            const defaultTop = Math.max(20, (window.innerHeight - panelH) / 2);

            const startLeft = settings.panelLeft != null
                ? Math.max(0, Math.min(window.innerWidth - panelW, settings.panelLeft))
                : defaultLeft;
            const startTop = settings.panelTop != null
                ? Math.max(0, Math.min(window.innerHeight - 60, settings.panelTop))
                : defaultTop;

            panel.css({ width: panelW + 'px', height: panelH + 'px', left: startLeft + 'px', top: startTop + 'px', opacity: 0, transform: 'scale(0.85)' });

            requestAnimationFrame(() => {
                panel.css({ transition: 'opacity 0.25s ease, transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)' });
                requestAnimationFrame(() => { panel.css({ opacity: 1, transform: 'scale(1)' }); });
            });
        }

        panelOpen = true;
        settings.panelWasOpen = true;
        saveSettings();
        fab.addClass('et-fab-hidden');
        setFabUnreadIndicator(false);
        bindPanelEvents();

        // Group bar: ensure active char is set, then render bar and bind events
        if (groupManager) {
            groupManager.ensureActiveChar();
            groupManager.renderGroupBar(groupManager.getActiveCharKey());
            groupManager.bindGroupBarEvents(switchGroupChar, onCombineModeToggle, triggerManualCombineChar);
            renderGroupUnreadIndicators();
        }

        // Apply character state now that panelOpen = true.
        // This shows/hides overflow menu items, avatar, status row, etc. for whichever
        // character is currently selected — including when the user re-opens the panel
        // with a pinned character (CHAT_CHANGED is suppressed in that case, so without
        // this call the overflow items would remain hidden after every panel rebuild).
        applySelectedCharacterToPanel();

        setTimeout(() => { if (!isMobileDevice()) jQuery('#et-input').focus(); }, 300);
    }

    function closePanel() {
        if (!panelOpen) return;

        // Remove visualViewport resize/scroll listeners that were attached in
        // bindPanelEvents() to keep the panel above the iOS on-screen keyboard.
        const _panelEl = document.getElementById('et-panel');
        if (_panelEl && typeof _panelEl._vvCleanup === 'function') {
            _panelEl._vvCleanup();
            _panelEl._vvCleanup = null;
        }

        closeCharacterPicker();
        // On a computer the emotion popup sits beside the panel, so it doesn't go with it
        if (emotionSystem) emotionSystem.closeEmotionPopup();

        // Close any open emoji overlays
        jQuery('.et-react-overlay').remove();

        // Remove document event listeners
        jQuery(document).off('click.et-react');
        jQuery(document).off('click.et-overflow');
        jQuery('#et-overflow-menu').removeClass('et-overflow-menu-open');

        const panel = jQuery('#et-panel');
        const fab = jQuery('#et-fab');

        panel.css({ transition: 'opacity 0.2s ease, transform 0.2s ease', opacity: 0, transform: 'scale(0.85)' });
        setTimeout(() => {
            panel.remove();
            panelOpen = false;
            settings.panelWasOpen = false;
            saveSettings();
            fab.removeClass('et-fab-hidden');
        }, 220);
    }

    function showNoCharacterMessage() {
        openEmbeddedCharacterPicker();
    }



    function bindPanelEvents() {
        makePanelDraggable();
        makePanelResizable();

        jQuery('#et-close-btn').on('click', closePanel);

        // ── Overflow menu (three-dot) ──────────────────────────────
        jQuery('#et-overflow-btn').on('click', function (e) {
            e.stopPropagation();
            const menu = jQuery('#et-overflow-menu');
            const isOpen = menu.hasClass('et-overflow-menu-open');
            menu.toggleClass('et-overflow-menu-open', !isOpen);
        });

        function closeOverflowMenu() {
            jQuery('#et-overflow-menu').removeClass('et-overflow-menu-open');
        }

        // Two-click inline confirmation for Clear History (no modal)
        let clearHistoryConfirmPending = false;
        let clearHistoryConfirmTimer = null;

        jQuery('#et-overflow-clear').on('click', (e) => {
            e.stopPropagation();

            if (clearHistoryConfirmPending) {
                // Second click: execute the clear
                clearTimeout(clearHistoryConfirmTimer);
                clearHistoryConfirmTimer = null;
                clearHistoryConfirmPending = false;

                // Reset button UI back to its default state
                const item = jQuery('#et-overflow-clear');
                item.find('i').attr('class', 'fa-solid fa-trash-can');
                item.find('span').text('Clear History');
                item.removeClass('et-overflow-item-confirm');

                clearChatHistory();
                renderMessages([]);
                updatePanelStatusRow();
                closeOverflowMenu();
            } else {
                // First click: enter confirm state
                clearHistoryConfirmPending = true;
                const item = jQuery('#et-overflow-clear');
                item.find('i').attr('class', 'fa-solid fa-triangle-exclamation');
                item.find('span').text('Tap Again to Confirm');
                item.addClass('et-overflow-item-confirm');

                clearHistoryConfirmTimer = setTimeout(() => {
                    clearHistoryConfirmPending = false;
                    item.find('i').attr('class', 'fa-solid fa-trash-can');
                    item.find('span').text('Clear History');
                    item.removeClass('et-overflow-item-confirm');
                }, 3000);
            }
        });

        jQuery('#et-overflow-saveload').on('click', (e) => {
            e.stopPropagation();
            closeOverflowMenu();
            openSaveLoadModal();
        });

        jQuery('#et-overflow-settings').on('click', (e) => {
            e.stopPropagation();
            closeOverflowMenu();
            settingsModal.openSettingsModal();
            moveModalToPortal('.et-settings-modal');
        });

        jQuery('#et-overflow-gallery').on('click', (e) => {
            e.stopPropagation();
            closeOverflowMenu();
            if (gallery) gallery.openGalleryModal();
            moveModalToPortal('.et-gallery-overlay');
        });

        // Shown only by platforms whose header hides the picker caret and status row
        jQuery('#et-overflow-character').on('click', (e) => {
            e.stopPropagation();
            closeOverflowMenu();
            jQuery('#et-char-name').trigger('click');
        });

        jQuery('#et-overflow-status').on('click', (e) => {
            e.stopPropagation();
            closeOverflowMenu();
            jQuery('#et-panel-status-trigger').trigger('click');
        });

        jQuery(document).on('click.et-overflow', function (e) {
            if (!jQuery(e.target).closest('#et-overflow-btn, #et-overflow-menu').length) {
                closeOverflowMenu();
            }
        });
        // ─────────────────────────────────────────────────────────

        // Character picker: click char name row (includes caret)
        jQuery('#et-char-name').on('click', function (e) {
            e.stopPropagation();
            toggleCharacterPicker();
        });

        // Character picker: click caret also opens picker
        jQuery('#et-panel').on('click', '.et-char-name-caret', function (e) {
            e.stopPropagation();
            toggleCharacterPicker();
        });

        // No-char select button: removed (picker is now embedded inline when no char selected)

        // Status row opens the emotion popup (disabled in group sessions)
        jQuery('#et-panel').on('click', '#et-panel-status-trigger', function (e) {
            e.stopPropagation();
            // In group session the status row is informational only — no popup
            if (groupManager && groupManager.isGroupSession()) return;
            closeCharacterPicker();
            openEmotionPopup();
        });

        updatePanelStatusRow();

        jQuery('#et-send-btn').on('click', handleSend);

        composeMode = null;
        bindAttachPanel();

        jQuery('#et-share-type').on('click', function (e) {
            e.stopPropagation();
            toggleShareTypeMenu(jQuery(this));
        });

        // The voice button switches between typing a text and a voice message
        jQuery('#et-voice-btn').on('click', function (e) {
            e.stopPropagation();
            setComposeMode(composeMode === 'voice' ? null : 'voice');
            jQuery('#et-input').trigger('focus');
        });

        // "+" opens the attach menu; while composing a photo/transfer it cancels instead
        jQuery('#et-attach-btn').on('click', function (e) {
            e.stopPropagation();
            if (composeMode && !isVoiceButtonMode()) {
                setComposeMode(null);
                jQuery('#et-input').trigger('focus');
            } else {
                toggleAttachMenu(jQuery(this));
            }
        });

        jQuery('#et-input').on('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
            }
        }).on('input', function () {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight + 2, 92) + 'px';
            // Still typing — the character keeps waiting
            if (replyTimer) scheduleCharacterReply();
            if (isGenerating) updateSendButton(true);
        });

        // Close emoji overlays when clicking outside
        jQuery(document).on('click.et-react', function (e) {
            if (!jQuery(e.target).closest('.et-react-overlay, [data-et-action="react"]').length) {
                closeAllReactOverlays();
            }
        });

        // Avatar: logo only — no picker on click. Lightbox when a character is selected.
        jQuery('#et-panel').on('click', '#et-char-avatar-wrap', function (e) {
            e.stopPropagation();
            if (getCurrentCharacter()) {
                openAvatarMenu(this);
            }
        });

        bindMessageActions();

        // ── iOS / mobile: keep the panel height in sync with the visual viewport ──
        // When the on-screen keyboard opens, visualViewport.height shrinks. We update
        // the panel height & top so the input bar stays visible above the keyboard.
        if (window.visualViewport && isMobileDevice()) {
            const panelEl = document.getElementById('et-panel');
            if (panelEl) {
                const onVVResize = () => {
                    if (!panelOpen) return;
                    panelEl.style.height = window.visualViewport.height + 'px';
                    panelEl.style.top    = window.visualViewport.offsetTop  + 'px';
                };
                window.visualViewport.addEventListener('resize', onVVResize);
                window.visualViewport.addEventListener('scroll', onVVResize);
                // Store a cleanup callback on the element so closePanel() can
                // remove the listeners when the panel is destroyed.
                panelEl._vvCleanup = () => {
                    window.visualViewport.removeEventListener('resize', onVVResize);
                    window.visualViewport.removeEventListener('scroll', onVVResize);
                };
            }
        }
    }

    // ── Character avatar for EchoText ─────────────────────────────────────────
    // The card's avatar by default; the user can pick another just for EchoText.
    // The image goes to the user's images (user/images/<character>/), its path to
    // settings.avatarByCharacter; the card itself is never touched.

    const AVATAR_SIZE = 512;

    /** The avatar's menu, under (or over) the avatar: view it, change it, or go back to the card's. */
    function openAvatarMenu(anchor) {
        if (!getCharacterKey()) return;
        if (jQuery('.et-avatar-menu').length) {
            closeAllDotMenus();
            return;
        }
        closeAllDotMenus();
        const items = [];
        if (getCharAvatarUrl()) items.push(['view', 'fa-expand', 'View Avatar']);
        items.push(['change', 'fa-image', 'Change Avatar']);
        if (getCustomCharAvatarUrl()) items.push(['reset', 'fa-rotate-left', 'Use Card Avatar']);
        const menu = jQuery(`<div class="et-dots-menu et-avatar-menu">${items.map(([id, icon, label]) =>
            `<button class="et-dots-item" data-avatar="${id}"><i class="fa-solid ${icon}"></i><span>${label}</span></button>`).join('')}</div>`);
        jQuery('#et-panel').append(menu);

        const a = anchor.getBoundingClientRect();
        const p = document.getElementById('et-panel').getBoundingClientRect();
        const left = Math.max(8, Math.min(a.left - p.left, p.width - menu.outerWidth() - 8));
        const height = menu.outerHeight();
        const below = a.bottom - p.top + 6;
        const fitsBelow = below + height < p.height - 8;
        const top = Math.max(8, Math.min(fitsBelow ? below : a.top - p.top - 6 - height, p.height - height - 8));
        menu.css({ left: left + 'px', top: top + 'px', bottom: 'auto', 'transform-origin': fitsBelow ? 'top left' : 'bottom left' });
        requestAnimationFrame(() => menu.addClass('et-dots-menu-open'));

        setTimeout(() => {
            jQuery(document).one('click.et-avatar-outside', function (e) {
                if (!jQuery(e.target).closest('.et-avatar-menu').length) closeAllDotMenus();
            });
        }, 0);

        menu.find('.et-dots-item').on('click', function (e) {
            e.stopPropagation();
            const choice = this.dataset.avatar;
            closeAllDotMenus();
            if (choice === 'view') openAvatarLightbox();
            else if (choice === 'change') changeCharacterAvatar();
            else setCustomCharAvatar(getCharacterKey(), null);
        });
    }

    /**
     * Picks an image, crops it square in SillyTavern's own crop dialog, saves it to
     * the user's images and makes it the character's avatar in EchoText.
     */
    async function changeCharacterAvatar() {
        const char = getCurrentCharacter();
        const charKey = getCharacterKey();
        if (!char || !charKey) return;
        // Before any await: a file dialog must open within the tap
        const file = await pickImageFile();
        if (!file) return;
        try {
            const context = SillyTavern.getContext();
            const cropped = await context.callGenericPopup('', context.POPUP_TYPE.CROP, '',
                { cropAspect: 1, cropImage: await readFileAsDataUrl(file) });
            if (!cropped) return;
            const image = await shrinkImageDataUrl(cropped, AVATAR_SIZE);
            const response = await fetch('/api/images/upload', {
                method: 'POST',
                headers: context.getRequestHeaders(),
                body: JSON.stringify({
                    image: image.split(',')[1],
                    format: 'jpeg',
                    ch_name: char.name,
                    filename: `echotext-avatar-${Date.now()}`,
                }),
            });
            if (!response.ok) throw new Error(`upload failed (${response.status})`);
            const { path } = await response.json();
            if (!path) throw new Error('no path returned');
            setCustomCharAvatar(charKey, path);
        } catch (err) {
            error('Could not change the avatar:', err);
            toastr.error(`Could not change the avatar: ${err.message}`, 'Echogram');
        }
    }

    /** Sets (or with null, clears) a character's EchoText avatar; the image it replaces is deleted. */
    function setCustomCharAvatar(charKey, path) {
        if (!charKey) return;
        settings.avatarByCharacter = settings.avatarByCharacter || {};
        const previous = settings.avatarByCharacter[charKey];
        if (path) settings.avatarByCharacter[charKey] = path;
        else delete settings.avatarByCharacter[charKey];
        saveSettings();
        if (previous && previous !== path) deleteUserImage(previous);
        if (!panelOpen) return;
        jQuery('#et-char-avatar-wrap').replaceWith(buildAvatarHtml(getCharacterName(), '', 'et-char-avatar-wrap'));
        renderMessages(getChatHistory(), true);
    }

    function deleteUserImage(path) {
        fetch('/api/images/delete', {
            method: 'POST',
            headers: SillyTavern.getContext().getRequestHeaders(),
            body: JSON.stringify({ path }),
        }).catch(err => warn('Could not delete the old avatar:', err));
    }

    /** Opens the file dialog for one image; resolves with it, or null if cancelled. */
    function pickImageFile() {
        return new Promise((resolve) => {
            // In the document: iOS won't open the dialog for a detached input
            const input = jQuery('<input type="file" accept="image/*" style="display:none">').appendTo('body');
            const done = (file) => { input.remove(); resolve(file); };
            input.on('change', () => done(input[0].files?.[0] || null));
            input.on('cancel', () => done(null));
            input[0].click();
        });
    }

    function readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });
    }

    /** A square image no larger than `size` px, as a JPEG data URL (a phone photo would be megabytes). */
    function shrinkImageDataUrl(dataUrl, size) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const side = Math.min(size, img.naturalWidth, img.naturalHeight) || size;
                const canvas = document.createElement('canvas');
                canvas.width = canvas.height = side;
                canvas.getContext('2d').drawImage(img, 0, 0, side, side);
                resolve(canvas.toDataURL('image/jpeg', 0.9));
            };
            img.onerror = () => reject(new Error('could not read the image'));
            img.src = dataUrl;
        });
    }

    function openAvatarLightbox() {
        const avatarUrl = getCharAvatarUrl();
        if (!avatarUrl) return; // Only show lightbox if there is an image

        jQuery('#et-avatar-lightbox').remove();
        const lightbox = jQuery(`
            <div id="et-avatar-lightbox" class="et-avatar-lightbox">
                <img src="${avatarUrl}" class="et-avatar-lightbox-img" />
            </div>
        `);

        jQuery('#et-panel').append(lightbox);

        // Animate in
        requestAnimationFrame(() => lightbox.addClass('et-avatar-lightbox-open'));

        // Close on click anywhere
        lightbox.on('click', function (e) {
            e.stopPropagation();
            lightbox.removeClass('et-avatar-lightbox-open');
            setTimeout(() => lightbox.remove(), 250);
        });
    }

    function handleSend() {
        const input = jQuery('#et-input');
        const text = input.val().trim();

        if (isGenerating) {
            // An empty send — or any send during a regeneration/swipe — cancels, as before
            if (!replyInProgress || !text) {
                if (abortController) abortController.abort();
                return;
            }
            // A reply still in its read/typing delays hasn't reached the model yet:
            // drop it so the rescheduled reply covers this text too. Once the model
            // is writing, let it finish; the character follows up afterwards.
            if (activeCompletionRequests === 0 && abortController) abortController.abort();
        }

        const char = getCurrentCharacter();
        if (!char) {
            toastr.warning('Please select a character card to start texting.');
            return;
        }

        // Photo / transfer mode needs content; an empty send doesn't fall through to a nudge
        const mode = composeMode;
        if (mode && !text) return;
        let mes = text;
        if (mode === 'photo') {
            mes = `<photo>${text.replace(/\s*\n\s*/g, ' ')}</photo>`;
        } else if (mode === 'voice') {
            mes = `<voice>${text.replace(/\s*\n\s*/g, ' ')}</voice>`;
        } else if (mode === 'file') {
            // "title | description", as the kind picked on the chip
            mes = RichMessages.shareTag(text, shareType);
        } else if (mode === 'transfer') {
            const amount = RichMessages.parseAmount(text);
            if (!amount) {
                toastr.warning('Enter an amount greater than 0, like 52, $20 or 13.14元.');
                return;
            }
            // No currency typed: use the chat's, written out so this transfer keeps it
            mes = `<transfer>${amount.symbol || getChatCurrency()}${amount.value}</transfer>`;
        }

        // Empty send — reply right away (skipping any pending pause), or nudge a
        // continuation from the last message
        if (!text) {
            clearTimeout(replyTimer);
            startCharacterReply();
            return;
        }

        input.val('').css('height', 'auto');
        // A photo or transfer is one message; voice from the voice button stays on until switched back, as in WeChat
        if (mode && !isVoiceButtonMode()) setComposeMode(null);
        if (isGenerating) updateSendButton(true);

        const userMsg = createUserMessage(mes);
        // Detect memory-worthy spans in the user's message for manual highlighting
        if (!mode && memorySystem && settings.memoryEnabled && settings.memoryAutoExtract) {
            try {
                const candidates = memorySystem.detectHighlightableText(text);
                if (candidates && candidates.length > 0) userMsg.memoryHighlights = candidates;
            } catch (e) { /* ignore detection errors */ }
        }
        postUserMessage(userMsg);
    }

    function createUserMessage(mes) {
        return {
            is_user: true,
            mes,
            send_date: Date.now(),
            meta: {
                receipt: {
                    state: 'sent',
                    note: 'Sent'
                }
            }
        };
    }

    /** Appends a user message, renders it, and schedules the character's reply. */
    function postUserMessage(userMsg) {
        const newHistory = [...getChatHistory(), userMsg];
        saveChatHistory(newHistory);
        setFabUnreadIndicator(false);
        markProactiveUserActivity(getCharacterKey(), Date.now());
        renderMessages(newHistory);
        scheduleCharacterReply();
        return newHistory;
    }

    /**
     * Accepts or declines the character's transfer from its card: posts the user's
     * response message, which settles the card, and lets the character react.
     */
    function respondToTransfer(accept, amount) {
        if (isGenerating && !replyInProgress) {
            toastr.info('Wait for the current reply to finish.');
            return;
        }
        // Same as a new text: a reply still in its read/typing delays restarts
        if (isGenerating && activeCompletionRequests === 0 && abortController) abortController.abort();
        const tag = accept ? 'transfer_accept' : 'transfer_decline';
        postUserMessage(createUserMessage(`<${tag}>${amount}</${tag}>`));
    }

    // ── Reply scheduling ─────────────────────────────────────────────────────
    // The user can send several texts in a row; the character answers once they
    // pause. A reply the model is already writing finishes first, then the
    // character follows up on whatever arrived meanwhile.

    const REPLY_PAUSE_MS = 3000;

    /** (Re)starts the pause before the character replies; each new text or keystroke resets it. */
    function scheduleCharacterReply(delayMs = REPLY_PAUSE_MS) {
        clearTimeout(replyTimer);
        replyTimer = setTimeout(startCharacterReply, delayMs);
    }

    function cancelScheduledReply() {
        clearTimeout(replyTimer);
        replyTimer = null;
        replyQueued = false;
    }

    function startCharacterReply() {
        replyTimer = null;
        if (isGenerating) {
            replyQueued = true;
            return;
        }
        replyQueued = false;
        replyInProgress = true;
        const history = getChatHistory();
        if (groupManager && groupManager.isGroupSession() && groupManager.isCombineMode()) {
            generateEchoTextCombined(history);
        } else {
            generateEchoText(history);
        }
        // Both generators set isGenerating synchronously when they actually start
        if (!isGenerating) replyInProgress = false;
    }

    /** Called when a generation settles: runs a follow-up reply queued while it was busy. */
    function onGenerationSettled() {
        replyInProgress = false;
        if (replyQueued) {
            replyQueued = false;
            scheduleCharacterReply(600);
        }
    }

    /**
     * `snapshot` plus any messages appended to the stored history since it was
     * taken. The user can keep texting while a reply is generated, so a generation
     * must save on top of those messages rather than over them.
     */
    function withMessagesSentSince(snapshot) {
        const latest = getChatHistory();
        if (latest.length <= snapshot.length) return snapshot;
        const anchor = snapshot[snapshot.length - 1];
        if (anchor && latest[snapshot.length - 1]?.send_date !== anchor.send_date) return snapshot;
        return [...snapshot, ...latest.slice(snapshot.length)];
    }

    /**
     * Indices of the user's messages the character hasn't read yet, newest first —
     * after a burst of texts, all of them get delivered/read together.
     */
    function getUnreadUserMessageIndices(history) {
        const indices = [];
        for (let i = history.length - 1; i >= 0; i--) {
            const msg = history[i];
            if (!msg?.is_user) continue;
            const state = msg.meta?.receipt?.state;
            if (!state || state === 'read' || state === 'ghosted') break;
            indices.push(i);
        }
        return indices;
    }

    /**
     * Enters a compose mode ('photo' | 'transfer') or leaves it (null): the attach
     * button shows the mode's icon (tap to cancel) and the placeholder asks for
     * the description / amount.
     */
    function setComposeMode(mode) {
        const modes = Features.getComposerModes(getActiveFeatures());
        composeMode = modes[mode] ? mode : null;
        const config = modes[composeMode];
        const input = jQuery('#et-input');
        // Voice from the voice button is that button's mode; anything else is "+"'s, which cancels it
        const voiceButton = isVoiceButtonMode();
        const attachConfig = voiceButton ? null : config;
        jQuery('#et-attach-btn')
            .toggleClass('et-attach-btn-active', !!attachConfig)
            .attr('title', attachConfig ? `Cancel ${attachConfig.label.toLowerCase()}` : 'Attach')
            .html(`<i class="fa-solid ${attachConfig ? attachConfig.icon : 'fa-plus'}"></i>`);
        jQuery('#et-voice-btn')
            .toggleClass('et-voice-btn-active', voiceButton)
            .attr('title', voiceButton ? 'Back to typing' : 'Voice message');
        jQuery('.et-input-wrap').toggleClass('et-input-wrap-compose', !!config).attr('data-et-compose', composeMode);
        // Sharing a file: what kind, picked from the chip in front of the text
        jQuery('#et-share-type').prop('hidden', composeMode !== 'file');
        if (composeMode === 'file') renderShareTypeChip();
        const composePlaceholder = input.data('et-compose-placeholder');
        if (config) {
            if (input.attr('placeholder') !== composePlaceholder) input.data('et-placeholder', input.attr('placeholder'));
            // The platform's own wording first (WeChat's, in Chinese)
            const platform = getActivePlatform();
            const wording = (voiceButton ? platform.voiceButton.placeholder : platform.composerPanel?.[composeMode]?.placeholder) || config.placeholder;
            const placeholder = composeMode === 'transfer' ? `${wording} (${getChatCurrency()})` : wording;
            input.attr('placeholder', placeholder).data('et-compose-placeholder', placeholder);
        } else {
            // Restore only if nothing (e.g. a character switch) has replaced the placeholder meanwhile
            if (input.attr('placeholder') === composePlaceholder && input.data('et-placeholder') !== undefined) {
                input.attr('placeholder', input.data('et-placeholder'));
            }
            input.removeData('et-placeholder').removeData('et-compose-placeholder');
        }
    }

    /** A share type's name, in the platform's wording (WeChat's are Chinese). */
    function shareTypeLabel(type) {
        return getActivePlatform().composerPanel?.file?.typeLabels?.[type.id] || type.label;
    }

    function renderShareTypeChip() {
        const type = RichMessages.SHARE_TYPES.find(t => t.id === shareType) || RichMessages.SHARE_TYPES[0];
        jQuery('#et-share-type').html(`<span>${escapeHtml(shareTypeLabel(type))}</span><i class="fa-solid fa-chevron-down"></i>`);
    }

    /** The kinds of file to share, in a menu over the chip (styled like the attach menu). */
    function toggleShareTypeMenu(chip) {
        if (jQuery('.et-share-type-menu').length) {
            closeAllDotMenus();
            return;
        }
        closeAllDotMenus();
        const items = RichMessages.SHARE_TYPES.map(type =>
            `<button class="et-dots-item${type.id === shareType ? ' et-dots-item-current' : ''}" data-share-type="${type.id}"><i class="fa-solid ${type.icon}"></i><span>${escapeHtml(shareTypeLabel(type))}</span></button>`
        ).join('');
        const menu = jQuery(`<div class="et-dots-menu et-attach-menu et-share-type-menu">${items}</div>`);
        jQuery('#et-panel').append(menu);
        const chipRect = chip[0].getBoundingClientRect();
        const panelRect = document.getElementById('et-panel').getBoundingClientRect();
        const left = Math.max(8, Math.min(panelRect.width - menu.outerWidth() - 8, chipRect.left - panelRect.left));
        menu.css({ left: left + 'px', bottom: (panelRect.bottom - chipRect.top + 8) + 'px', top: 'auto', 'transform-origin': 'bottom left' });
        requestAnimationFrame(() => menu.addClass('et-dots-menu-open'));

        setTimeout(() => {
            jQuery(document).one('click.et-share-type-outside', function (e) {
                if (!jQuery(e.target).closest('.et-share-type-menu').length) closeAllDotMenus();
            });
        }, 0);

        menu.find('.et-dots-item').on('click', function (e) {
            e.stopPropagation();
            shareType = jQuery(this).data('share-type');
            closeAllDotMenus();
            renderShareTypeChip();
            jQuery('#et-input').trigger('focus');
        });
    }

    /** Composing a voice message from the platform's voice button (WeChat), rather than from "+". */
    function isVoiceButtonMode() {
        return composeMode === 'voice' && !!getActivePlatform().voiceButton;
    }

    /** Opens the attach menu (Photo / Voice / Transfer) above the "+" button, styled like the message menu. */
    function toggleAttachMenu(btn) {
        if (getActivePlatform().composerPanel) {
            toggleAttachPanel();
            return;
        }
        if (jQuery('.et-attach-menu').length) {
            closeAllDotMenus();
            return;
        }
        closeAllDotMenus();
        const itemsHtml = Object.entries(Features.getComposerModes(getActiveFeatures())).map(([id, m]) =>
            `<button class="et-dots-item" data-mode="${id}"><i class="fa-solid ${m.icon}"></i><span>${m.label}</span></button>`
        ).join('');
        // A platform without photos or transfers has nothing to attach
        if (!itemsHtml) return;
        const menu = jQuery(`<div class="et-dots-menu et-attach-menu">${itemsHtml}</div>`);
        jQuery('#et-panel').append(menu);

        const btnRect = btn[0].getBoundingClientRect();
        const panelRect = document.getElementById('et-panel').getBoundingClientRect();
        const left = Math.max(8, btnRect.left - panelRect.left - 6);
        const bottom = panelRect.bottom - btnRect.top + 10;
        // Opens to the right of the "+", or to its left when "+" sits at the right edge (WeChat)
        if (left + menu.outerWidth() > panelRect.width - 8) {
            const right = Math.max(8, panelRect.right - btnRect.right - 6);
            menu.css({ left: 'auto', right: right + 'px', bottom: bottom + 'px', top: 'auto', 'transform-origin': 'bottom right' });
        } else {
            menu.css({ left: left + 'px', bottom: bottom + 'px', top: 'auto', 'transform-origin': 'bottom left' });
        }
        btn.addClass('et-attach-open');
        requestAnimationFrame(() => menu.addClass('et-dots-menu-open'));

        setTimeout(() => {
            jQuery(document).one('click.et-attach-outside', function (e) {
                if (!jQuery(e.target).closest('.et-attach-menu').length) closeAllDotMenus();
            });
        }, 0);

        menu.find('.et-dots-item').on('click', function (e) {
            e.stopPropagation();
            const mode = jQuery(this).data('mode');
            closeAllDotMenus();
            setComposeMode(mode);
            jQuery('#et-input').trigger('focus');
        });
    }

    /**
     * The attach entries as a panel that rises under the input bar, for platforms
     * whose "+" works that way (`composerPanel`, WeChat). Ported from box-im's
     * .chat-tab-bar / .chat-tools: a row of tiles, the message list gives up
     * the room, and it closes on "+" again, a tile, the message list or the input.
     */
    function toggleAttachPanel() {
        if (jQuery('#et-attach-panel').length) {
            closeAttachPanel();
            return;
        }
        closeAllDotMenus();
        const looks = getActivePlatform().composerPanel;
        // The platform's own tiles (WeChat records voice from the input bar instead)
        const tiles = Object.entries(Features.getComposerModes(getActiveFeatures())).filter(([id]) => looks[id]).map(([id, mode]) => {
            const look = { ...mode, ...looks[id] };
            return `<button class="et-attach-panel-item" type="button" data-mode="${id}"><span class="et-attach-panel-icon"><i class="fa-solid ${look.icon}"></i></span><span class="et-attach-panel-label">${escapeHtml(look.label)}</span></button>`;
        }).join('');
        if (!tiles) return;
        const panel = jQuery(`<div class="et-attach-panel" id="et-attach-panel" data-et-role="attach-panel"><div class="et-attach-panel-list">${tiles}</div></div>`);
        // Where the list stands before the panel takes any room
        const fromBottom = messagesFromBottom();
        jQuery('#et-panel [data-et-role~="input-bar"]').after(panel);
        // Grows from nothing (paced by the platform's height transition), so the
        // input bar and the tiles rise together
        const fullHeight = panel.outerHeight();
        panel.css('height', '0px');
        void panel[0].offsetHeight;
        panel.css('height', fullHeight + 'px');
        followAttachPanel(panel, fromBottom);
    }

    /** A tile picks its mode; tapping the message list or the input puts the panel away. */
    function bindAttachPanel() {
        jQuery('#et-panel').on('click', '#et-attach-panel .et-attach-panel-item', function (e) {
            e.stopPropagation();
            const mode = jQuery(this).data('mode');
            closeAttachPanel();
            setComposeMode(mode);
            jQuery('#et-input').trigger('focus');
        }).on('click', '[data-et-role~="messages"]', closeAttachPanel)
            .on('focus', '#et-input', closeAttachPanel);
    }

    function closeAttachPanel() {
        const panel = jQuery('#et-attach-panel');
        if (!panel.length) return;
        // Shrinks away the same way, then goes; a new "+" meanwhile opens a fresh one
        const fromBottom = messagesFromBottom();
        panel.removeAttr('id').css('height', '0px');
        followAttachPanel(panel, fromBottom);
        setTimeout(() => panel.remove(), attachPanelDuration(panel) + 30);
    }

    /** How far the message list is scrolled up from its end, in px (null without a list). */
    function messagesFromBottom() {
        const messagesEl = document.getElementById('et-messages');
        return messagesEl ? messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight : null;
    }

    /** How long the platform's CSS takes to raise or lower the panel, in ms. */
    function attachPanelDuration(panel) {
        return (parseFloat(getComputedStyle(panel[0]).transitionDuration) || 0) * 1000;
    }

    /**
     * While the panel's height changes, the message list keeps the distance
     * from its end it had before (`fromBottom`, measured before the panel moved),
     * so its last lines rise and fall with the input bar — animated or not: a
     * panel without a transition snaps, and is still followed.
     * Smooth scrolling stays off for the whole animation, or each per-frame
     * correction would become a smooth scroll restarted every frame.
     */
    function followAttachPanel(panel, fromBottom) {
        const messagesEl = document.getElementById('et-messages');
        if (!messagesEl || fromBottom === null) return;
        const run = (messagesEl._etFollowRun || 0) + 1;
        messagesEl._etFollowRun = run;
        const until = performance.now() + attachPanelDuration(panel) + 80;
        messagesEl.style.scrollBehavior = 'auto';
        const follow = () => {
            messagesEl.scrollTop = messagesEl.scrollHeight - messagesEl.clientHeight - fromBottom;
        };
        const step = (now) => {
            // A newer open / close took over
            if (messagesEl._etFollowRun !== run) return;
            follow();
            if (now < until && panel[0].isConnected) requestAnimationFrame(step);
            else messagesEl.style.scrollBehavior = '';
        };
        follow();
        requestAnimationFrame(step);
    }

    /** Accept / Decline menu for a pending transfer from the character, anchored to its card. */
    function openTransferResponseMenu(card) {
        closeAllDotMenus();
        const amount = card.attr('data-amount') || '';
        const menu = jQuery(`
            <div class="et-dots-menu et-transfer-menu">
                <button class="et-dots-item" data-accept="1"><i class="fa-solid fa-circle-check"></i><span>Accept ${escapeHtml(RichMessages.formatAmount(amount))}</span></button>
                <button class="et-dots-item et-dots-item-delete" data-accept="0"><i class="fa-solid fa-arrow-rotate-left"></i><span>Decline</span></button>
            </div>`);
        jQuery('#et-panel').append(menu);

        const cardRect = card[0].getBoundingClientRect();
        const panelRect = document.getElementById('et-panel').getBoundingClientRect();
        const menuW = 160;
        const menuH = menu.outerHeight() || 90;
        const left = Math.max(8, Math.min(panelRect.width - menuW - 8, cardRect.left - panelRect.left));
        let top = cardRect.bottom - panelRect.top + 6;
        if (top + menuH > panelRect.height - 8) {
            top = cardRect.top - panelRect.top - menuH - 6;
            menu.css('transform-origin', 'bottom left');
        } else {
            menu.css('transform-origin', 'top left');
        }
        menu.css({ left: left + 'px', top: Math.max(8, top) + 'px' });
        requestAnimationFrame(() => menu.addClass('et-dots-menu-open'));

        setTimeout(() => {
            jQuery(document).one('click.et-transfer-outside', function (e) {
                if (!jQuery(e.target).closest('.et-transfer-menu').length) closeAllDotMenus();
            });
        }, 0);

        menu.find('.et-dots-item').on('click', function (e) {
            e.stopPropagation();
            closeAllDotMenus();
            respondToTransfer(jQuery(this).data('accept') === 1, amount);
        });
    }

    function updateSendButton(generating) {
        const btn = jQuery('#et-send-btn');
        // While a reply is being written the button cancels it — unless the user
        // has typed another text, which they can send without interrupting
        const hasDraft = !!String(jQuery('#et-input').val() || '').trim();
        if (generating && !(replyInProgress && hasDraft)) {
            btn.addClass('et-send-stop').attr('title', 'Cancel generation');
            btn.html('<i class="fa-solid fa-stop"></i>');
        } else {
            btn.removeClass('et-send-stop').attr('title', 'Send message');
            btn.html('<i class="fa-solid fa-paper-plane"></i>');
        }
        if (generating) updatePanelStatusRow({ typing: true });
        else updatePanelStatusRow();
    }

    // ============================================================
    // PANEL DRAG & RESIZE
    // ============================================================

    function makePanelDraggable() {
        // Dragging is disabled on mobile — the panel fills the full viewport
        // and is not a floating window. CSS also removes the grab cursor.
        if (isMobileDevice()) return;

        const panel = document.getElementById('et-panel');
        const handle = document.getElementById('et-panel-drag-handle');
        if (!panel || !handle) return;

        let isDragging = false;
        let startX, startY, origLeft, origTop;

        handle.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            if (e.target.closest('.et-header-btn, button, input, select, textarea, #et-char-name, #et-panel-status-trigger')) return;
            isDragging = true;
            startX = e.clientX; startY = e.clientY;
            const rect = panel.getBoundingClientRect();
            origLeft = rect.left; origTop = rect.top;
            panel.style.transition = 'none';
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
            e.preventDefault();
        });

        handle.addEventListener('touchstart', (e) => {
            if (e.target.closest('.et-header-btn, button, input, select, textarea, #et-char-name, #et-panel-status-trigger')) return;
            const t = e.touches[0];
            isDragging = true;
            startX = t.clientX; startY = t.clientY;
            const rect = panel.getBoundingClientRect();
            origLeft = rect.left; origTop = rect.top;
            panel.style.transition = 'none';
        }, { passive: true });

        handle.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            const t = e.touches[0];
            const dx = t.clientX - startX, dy = t.clientY - startY;
            panel.style.left = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, origLeft + dx)) + 'px';
            panel.style.top = Math.max(0, Math.min(window.innerHeight - 60, origTop + dy)) + 'px';
        }, { passive: true });

        handle.addEventListener('touchend', () => {
            if (!isDragging) return;
            isDragging = false;
            panel.style.transition = '';
            settings.panelLeft = parseInt(panel.style.left) || 0;
            settings.panelTop = parseInt(panel.style.top) || 0;
            saveSettings();
        });

        function onMove(e) {
            if (!isDragging) return;
            const dx = e.clientX - startX, dy = e.clientY - startY;
            panel.style.left = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, origLeft + dx)) + 'px';
            panel.style.top = Math.max(0, Math.min(window.innerHeight - 60, origTop + dy)) + 'px';
        }

        function onUp() {
            if (!isDragging) return;
            isDragging = false;
            panel.style.transition = '';
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            settings.panelLeft = parseInt(panel.style.left) || 0;
            settings.panelTop = parseInt(panel.style.top) || 0;
            saveSettings();
        }
    }

    function makePanelResizable() {
        // Resizing is disabled on mobile — the panel is full-screen.
        // Resize handles are also hidden via mobile-style.css.
        if (isMobileDevice()) return;

        const panel = jQuery('#et-panel');
        if (!panel.length) return;

        panel.find('.et-resize-handle').each(function () {
            const handle = this;
            const corner = handle.dataset.corner;
            let active = false;
            let startX, startY, startW, startH, startLeft, startTop;

            handle.addEventListener('mousedown', (e) => {
                active = true;
                startX = e.clientX; startY = e.clientY;
                startW = panel[0].offsetWidth; startH = panel[0].offsetHeight;
                startLeft = parseInt(panel.css('left')) || 0;
                startTop = parseInt(panel.css('top')) || 0;
                e.preventDefault(); e.stopPropagation();
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });

            function onMove(e) {
                if (!active) return;
                const dx = e.clientX - startX, dy = e.clientY - startY;
                const MIN_W = 300, MIN_H = 400;
                let newW = startW, newH = startH, newL = startLeft, newT = startTop;

                if (corner === 'se') { newW = Math.max(MIN_W, startW + dx); newH = Math.max(MIN_H, startH + dy); }
                else if (corner === 'sw') { newW = Math.max(MIN_W, startW - dx); newH = Math.max(MIN_H, startH + dy); newL = startLeft + (startW - newW); }
                else if (corner === 'ne') { newW = Math.max(MIN_W, startW + dx); newH = Math.max(MIN_H, startH - dy); newT = startTop + (startH - newH); }
                else if (corner === 'nw') { newW = Math.max(MIN_W, startW - dx); newH = Math.max(MIN_H, startH - dy); newL = startLeft + (startW - newW); newT = startTop + (startH - newH); }

                panel.css({ width: newW + 'px', height: newH + 'px', left: newL + 'px', top: newT + 'px' });
            }

            function onUp() {
                if (!active) return;
                active = false;
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                settings.panelWidth = parseInt(panel.css('width')) || 380;
                settings.panelHeight = parseInt(panel.css('height')) || 600;
                settings.panelLeft = parseInt(panel.css('left')) || 0;
                settings.panelTop = parseInt(panel.css('top')) || 0;
                saveSettings();
            }
        });
    }

    // ============================================================
    // MESSAGE RENDERING
    // ============================================================

    // Emotion and reaction logic moved to lib/emotion-system.js
    function getEmotionState() {
        return emotionSystem ? emotionSystem.getEmotionState() : null;
    }

    function clearEmotionState() {
        if (emotionSystem) emotionSystem.clearEmotionState();
    }

    /** The chat's emotion state as an archive saves it. */
    function getEmotionSnapshot() {
        return emotionSystem ? emotionSystem.getEmotionSnapshot() : null;
    }

    /** A character's texting style (emotion popup, Personality tab) for its system prompt. */
    function buildTextingStyleContext(char) {
        return emotionSystem ? emotionSystem.buildTextingStyleContext(char.avatar || char.name, char.name || 'Character') : '';
    }

    /** The NSFW permission, the behavior block and the reply length it moves to (see buildSystemPrompt). */
    function buildBehaviorContext(char, verbosity) {
        if (!emotionSystem) return { nsfw: '', text: '', verbosity };
        return emotionSystem.buildBehaviorContext(char.avatar || char.name, {
            charName: char.name || 'Character', userName: getUserName(), features: getActiveFeatures(), verbosity });
    }

    // Auto mode (docs/emotion-plan.md 3.8) runs in a character's own chat; group chats
    // leave the emotion system paused, so they neither ask for nor keep reports.
    const inGroupSession = () => !!(groupManager && groupManager.isGroupSession());

    /** Auto mode's rule for the <mood> line (see buildSystemPrompt); '' in the other modes. */
    function buildMoodRules(char) {
        if (!emotionSystem || inGroupSession()) return '';
        return emotionSystem.buildMoodRules(char.avatar || char.name, { charName: char.name || 'Character', userName: getUserName() });
    }

    /**
     * A generated reply as it is kept: { mes, mood } — the text without its <mood>
     * line, and in Auto mode the feelings that line reports (stored as msg.mood).
     */
    function readReply(text) {
        const mes = cleanGeneratedResponse(text);
        if (!emotionSystem) return { mes, mood: null };
        const reply = emotionSystem.readReply(mes);
        return inGroupSession() ? { mes: reply.mes, mood: null } : reply;
    }

    /** After a reply with a <mood> line for the open character: the values redrawn, the change shown. */
    function noteMoodReport() {
        if (emotionSystem) emotionSystem.noteReport();
    }

    /** A character's own chat, whose replies carry Auto mode's reports. */
    function getEmotionHistory(key) {
        return settings.chatHistory?.[key] || [];
    }

    /** Changes the emotion mode, keeping every chat's values as they are. */
    function setEmotionMode(mode) {
        if (emotionSystem) emotionSystem.setMode(mode);
        else settings.emotionMode = mode;
    }

    // ============================================================
    // AI CHARACTER REACTIONS TO USER MESSAGES
    // ============================================================
    // The model reacts by writing <react>name</react> in its reply; the reaction
    // shows on the user's latest message before that reply (charReaction in
    // lib/chat-view-model.js; the platform's message template draws it).
    // Older chats may still carry a stored msg.charReaction from the former
    // keyword-based auto-reaction, which is shown the same way.

    function updateEmotionIndicator() {
        if (emotionSystem) emotionSystem.updateEmotionIndicator();
        if (panelOpen) updatePanelStatusRow();
    }

    function openEmotionPopup() {
        if (emotionSystem) emotionSystem.openEmotionPopup();
    }

    function convertEmoticonsToEmojis(text) {
        if (!text) return text;

        const emoticonsMap = {
            '😂': ["':-)", "':)", ':"D', ":'-)", ":')"],
            '😁': [":-))", ": ))"],
            '😃': [":-D", ":D", "8-D", "8D", "=D", "B^D", "c:", "C:"],
            '😆': ["x-D", "xD", "X-D", "XD"],
            '🙂': [":-)", ":)", ":-]", ":]", ":->", ":>", "8-)", "8)", ":-}", "}", ":^)", "=]", "=)"],
            '😢': [":'-(", ":'(", ":=("],
            '😧': ["D-':", "D:<", "D:", "D8", "D;", "D=", "DX"],
            '😠': [">:(", ">:["],
            '🤢': [":-###..", ":###.."],
            '☠️': ["8-X", "8=X", "x-3", "x=3"],
            '😈': [">:-)", ">:)", "}:-)", "}:)", "3:-)", "3:)", ">;-)", ">;)", ">;3", ">:3"],
            '😞': [":-(", ":(", ":-c", ":c", ":-<", ":<", ":-[", ":[", ":-||", ":{", ":@", ";("],
            '😺': [":-3", ":3", "=3", "x3", "X3"],
            '😛': [":-P", ":P", "X-P", "XP", "x-p", "xp", ":-p", ":p", ":-Þ", ":Þ", ":-þ", ":þ", ":-b", ":b", "d:", "=p", ">:b"],
            '😉': [";-)", ";)", "*-)", "*)", ";-]", ";]", ";^)", ";>", ":-,", ";D", ";3"],
            '😘': [":-*", ":*", ":x"],
            '😼': [":-J"],
            '😮': [":-O", ":O", ":-o", ":o", ":-0", ":0", "8-0", ">:O", "=O", "=o", "=0"],
            '🤨': ["',:-|", "',:-l"],
            '😕': [":-/", ":/", "',:^I", ">:\\", ">:/", ":\\", "=/", "=\\", ":L", "=L", ":S"],
            '😐': [":-|", ":|"],
            '😳': [":$", "://)", "://3"],
            '🤐': [":-X", ":X", ":-#", ":#", ":-&", ":&"],
            '😎': ["|;-)", "|-O", "B-)"],
            '😵': ["#-)"],
            '🥴': ["%-)", "%)"],
            '😬': [":E"],
            '😇': ["O:-)", "O:)", "0:-3", "0:3", "0:-)", "0:)", "0;^)"],
            '🤡': ["<:-|"], // Dumb, dunce-like
            '🐔': ["~:>"]
        };

        const replacements = [];
        for (const [emoji, codes] of Object.entries(emoticonsMap)) {
            for (const code of codes) replacements.push({ code, emoji });
        }
        replacements.sort((a, b) => b.code.length - a.code.length);

        const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        let result = text;
        for (const { code, emoji } of replacements) {
            const regex = new RegExp(`(?<=^|\\s)${escapeRegExp(code)}(?=\\s|$)`, 'g');
            result = result.replace(regex, emoji);
        }

        return result;
    }

    function formatMessageText(rawText) {
        const { DOMPurify } = SillyTavern.libs;
        let raw = rawText || '';

        // Convert text emoticons to visual emojis
        raw = convertEmoticonsToEmojis(raw);

        // Step 1: Apply inline markdown on raw text (before any HTML sanitization)
        // so that \n characters are still intact for paragraph splitting.
        let formatted = raw
            .replace(/\*\*\*(.*?)\*\*\*/gs, '<strong><em>$1</em></strong>')
            .replace(/\*\*(.*?)\*\*/gs, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/gs, '<em>$1</em>')
            .replace(/__(.*?)__/gs, '<u>$1</u>')
            .replace(/_(.*?)_/gs, '<em>$1</em>')
            .replace(/~~(.*?)~~/gs, '<del>$1</del>')
            .replace(/`(.+?)`/g, '<code>$1</code>');

        // Step 2: Split into paragraphs. LLMs use single \n for paragraph breaks
        // in chat contexts, so treat every \n as a paragraph separator.
        const lines = formatted.split(/\n/);
        const html = lines
            .map(line => `<p>${line}</p>`)
            .join('');

        // Step 3: Sanitize the final HTML (now allowing <p> so paragraph tags survive)
        return DOMPurify.sanitize(html, {
            ALLOWED_TAGS: ['p', 'strong', 'em', 'del', 'code', 'br', 'u'],
            ALLOWED_ATTR: []
        });
    }

    /** Display parts for a message, one per bubble (see ChatViewModel.getMessageDisplayParts). */
    function getMessageDisplayParts(msg) {
        return ChatViewModel.getMessageDisplayParts(msg, getCharacterName());
    }

    /** Ids of the reactions this panel can show. */
    function getReactionIds() {
        return FA_REACTIONS.map(r => r.id);
    }

    /** Reaction ids a character's message applies with <react> tags. */
    function getMessageReactions(msg) {
        return ChatViewModel.getMessageReactions(msg, getReactionIds());
    }

    /** The currency a new transfer defaults to: the last one named in this chat, else the default. */
    function getChatCurrency() {
        const history = getChatHistory();
        for (let i = history.length - 1; i >= 0; i--) {
            const parts = getMessageDisplayParts(history[i]);
            for (let j = parts.length - 1; j >= 0; j--) {
                const symbol = parts[j].amount ? RichMessages.splitAmount(parts[j].amount).symbol : '';
                if (symbol) return symbol;
            }
        }
        return RichMessages.DEFAULT_CURRENCY;
    }

    // Character messages whose bubbles already played their arrival sequence,
    // keyed by send_date, so later re-renders show them at once.
    const staggeredMessageKeys = new Set();

    /**
     * A freshly arrived multi-bubble reply is revealed one bubble at a time;
     * anything older (re-renders, reopening the panel, history) appears at once.
     */
    function shouldStaggerReveal(view) {
        if (view.isUser || view.parts.length < 2 || !view.timestamp) return false;
        if (staggeredMessageKeys.has(view.timestamp)) return false;
        staggeredMessageKeys.add(view.timestamp);
        return Date.now() - view.timestamp < 15000;
    }

    /**
     * Shows a character message's bubbles one after another, with a typing
     * indicator in between paced by each bubble's length. Stops quietly if the
     * message is re-rendered mid-sequence (the re-render shows every bubble).
     */
    function staggerRevealParts(msgEl) {
        const bubbles = msgEl.find('[data-et-role~="bubble"]');
        if (bubbles.length < 2) return;
        bubbles.slice(1).hide();

        const messagesEl = document.getElementById('et-messages');
        const scrollToEnd = () => {
            if (settings.autoScroll && messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
        };

        let next = 1;
        const revealNext = () => {
            if (!msgEl[0].isConnected) return;
            const bubble = bubbles.eq(next);
            const typing = jQuery(getActivePlatform().templates.bubbleTyping());
            bubbles.eq(next - 1).after(typing);
            scrollToEnd();
            const length = bubble.find('[data-et-role~="text"], [data-et-role~="caption"]').text().trim().length;
            setTimeout(() => {
                typing.remove();
                if (!msgEl[0].isConnected) return;
                bubble.show().attr('data-et-arrive', '');
                scrollToEnd();
                next++;
                if (next < bubbles.length) setTimeout(revealNext, 220);
            }, Math.min(1800, 450 + length * 35));
        };
        setTimeout(revealNext, 260);
    }

    function openGeneratedImageLightbox(imageUrl, promptText, options) {
        if (!imageUrl) return;
        jQuery('#et-generated-image-lightbox').remove();
        const titleText = String(options?.title || '').trim();

        // Navigation context — provided when caller has multiple images to step through
        const navItems = Array.isArray(options?.navItems) && options.navItems.length > 1 ? options.navItems : null;
        let currentNavIndex = navItems
            ? Math.max(0, Math.min(Number(options?.navIndex) || 0, navItems.length - 1))
            : 0;

        // Read persisted accordion state (default: open)
        let promptOpen = true;
        try { promptOpen = localStorage.getItem('et_lightbox_prompt_open') !== 'false'; } catch (e) {}

        const safePrompt = String(promptText || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const safeTitle = titleText ? String(titleText).replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';

        // Prompt panel — always rendered so navigateTo can update it in-place;
        // hidden via class when the current item has no prompt.
        const promptPanelClass = `et-lightbox-prompt-panel${safePrompt ? (promptOpen ? ' et-lightbox-prompt-open' : '') : ' et-lightbox-prompt-hidden'}`;
        const promptHtml = `
            <div class="${promptPanelClass}">
                <button class="et-lightbox-prompt-toggle" title="${promptOpen ? 'Hide prompt' : 'Show prompt'}">
                    <i class="fa-solid fa-wand-magic-sparkles"></i>
                    <span>Image Prompt</span>
                    <i class="fa-solid fa-chevron-down et-lightbox-prompt-chevron"></i>
                </button>
                <div class="et-lightbox-prompt-body">
                    <p class="et-lightbox-prompt-text">${safePrompt}</p>
                </div>
            </div>`;

        const navHtml = navItems ? `
                    <button class="et-lightbox-nav et-lightbox-nav-prev" title="Previous image" aria-label="Previous image"${currentNavIndex === 0 ? ' disabled' : ''}><i class="fa-solid fa-chevron-left"></i></button>
                    <button class="et-lightbox-nav et-lightbox-nav-next" title="Next image" aria-label="Next image"${currentNavIndex === navItems.length - 1 ? ' disabled' : ''}><i class="fa-solid fa-chevron-right"></i></button>` : '';

        const counterHtml = navItems
            ? `<span class="et-lightbox-nav-counter">${currentNavIndex + 1} / ${navItems.length}</span>`
            : '';

        const lightbox = jQuery(`
            <div id="et-generated-image-lightbox" class="et-generated-image-lightbox-overlay">
                <div class="et-lightbox-container">
                    <button class="et-lightbox-close" title="Close"><i class="fa-solid fa-xmark"></i></button>
                    ${counterHtml}
                    <div class="et-lightbox-img-wrap">
                        <img src="${imageUrl}" class="et-lightbox-img" alt="Generated image" />
                        ${navHtml}
                    </div>
                    <div class="et-lightbox-title-bar${safeTitle ? '' : ' et-lightbox-title-bar-hidden'}"><i class="fa-regular fa-image"></i><span>${safeTitle}</span></div>
                    ${promptHtml}
                </div>
            </div>
        `);

        // On mobile the panel lives inside the portal on <html>, so anything
        // appended to <body> renders behind it. Append the lightbox to the
        // portal directly so it stacks above the panel.
        (isMobileDevice() ? jQuery(ensurePortal()) : jQuery('body')).append(lightbox);
        requestAnimationFrame(() => lightbox.addClass('et-generated-image-lightbox-open'));

        // ── Navigation ────────────────────────────────────────────────────────
        function navigateTo(idx) {
            if (!navItems) return;
            const clamped = Math.max(0, Math.min(idx, navItems.length - 1));
            if (clamped === currentNavIndex) return;
            const dir = idx > currentNavIndex ? 'fwd' : 'bck';
            currentNavIndex = clamped;
            const item = navItems[currentNavIndex];

            const wrap = lightbox.find('.et-lightbox-img-wrap');
            const img = lightbox.find('.et-lightbox-img');
            wrap.attr('data-nav-dir', dir);
            img.addClass('et-lightbox-img-nav-fade');
            setTimeout(() => {
                img.attr('src', item.url)
                   .removeClass('et-lightbox-img-nav-fade')
                   .addClass('et-lightbox-img-nav-in');
                setTimeout(() => img.removeClass('et-lightbox-img-nav-in'), 300);

                lightbox.find('.et-lightbox-nav-counter').text(`${currentNavIndex + 1} / ${navItems.length}`);

                const titleBar = lightbox.find('.et-lightbox-title-bar');
                if (item.title) {
                    titleBar.removeClass('et-lightbox-title-bar-hidden').find('span').text(item.title);
                } else {
                    titleBar.addClass('et-lightbox-title-bar-hidden');
                }

                const promptPanel = lightbox.find('.et-lightbox-prompt-panel');
                if (item.prompt) {
                    promptPanel.removeClass('et-lightbox-prompt-hidden');
                    promptPanel.find('.et-lightbox-prompt-text').text(item.prompt);
                } else {
                    promptPanel.addClass('et-lightbox-prompt-hidden');
                }

                lightbox.find('.et-lightbox-nav-prev').prop('disabled', currentNavIndex === 0);
                lightbox.find('.et-lightbox-nav-next').prop('disabled', currentNavIndex === navItems.length - 1);
            }, 150);
        }

        if (navItems) {
            lightbox.find('.et-lightbox-nav-prev').on('click', function (e) {
                e.stopPropagation();
                navigateTo(currentNavIndex - 1);
            });
            lightbox.find('.et-lightbox-nav-next').on('click', function (e) {
                e.stopPropagation();
                navigateTo(currentNavIndex + 1);
            });
        }

        // Accordion toggle
        lightbox.find('.et-lightbox-prompt-toggle').on('click', function (e) {
            e.stopPropagation();
            const panel = lightbox.find('.et-lightbox-prompt-panel');
            const isOpen = panel.hasClass('et-lightbox-prompt-open');
            panel.toggleClass('et-lightbox-prompt-open', !isOpen);
            lightbox.find('.et-lightbox-prompt-toggle').attr('title', isOpen ? 'Show prompt' : 'Hide prompt');
            try { localStorage.setItem('et_lightbox_prompt_open', String(!isOpen)); } catch (e) {}
        });

        // ── Close helpers ─────────────────────────────────────────────────────
        function closeLightbox() {
            lightbox.removeClass('et-generated-image-lightbox-open');
            setTimeout(() => lightbox.remove(), 280);
            jQuery(document).off('keydown', keyHandler);
        }

        // Close on click anywhere outside the prompt, title bar, or nav buttons
        const closeHandler = (e) => {
            const $t = jQuery(e.target);
            if ($t.closest('.et-lightbox-prompt-panel').length ||
                $t.closest('.et-lightbox-title-bar').length ||
                $t.closest('.et-lightbox-nav').length) return;
            closeLightbox();
        };
        lightbox.on('click', closeHandler);

        // ── Keyboard navigation ───────────────────────────────────────────────
        const keyHandler = (e) => {
            if (e.key === 'Escape') {
                closeLightbox();
            } else if (e.key === 'ArrowLeft') {
                navigateTo(currentNavIndex - 1);
            } else if (e.key === 'ArrowRight') {
                navigateTo(currentNavIndex + 1);
            }
        };
        jQuery(document).on('keydown', keyHandler);

        // ── Touch swipe navigation (mobile) ──────────────────────────────────
        if (navItems) {
            let touchStartX = 0, touchStartY = 0;
            lightbox[0].addEventListener('touchstart', function (e) {
                touchStartX = e.touches[0].clientX;
                touchStartY = e.touches[0].clientY;
            }, { passive: true });
            lightbox[0].addEventListener('touchend', function (e) {
                const dx = e.changedTouches[0].clientX - touchStartX;
                const dy = e.changedTouches[0].clientY - touchStartY;
                if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 45) {
                    if (dx < 0) navigateTo(currentNavIndex + 1); // swipe left → next
                    else        navigateTo(currentNavIndex - 1); // swipe right → prev
                }
            }, { passive: true });
        }
    }

    // ============================================================
    // MESSAGE ACTIONS
    // ============================================================

    /** Shows the previous version of a character message. */
    function showPrevSwipe(msgIndex) {
        const h = getChatHistory();
        const msg = h[msgIndex];
        if (!msg || !msg.swipes) return;
        const newIdx = (msg.swipeIndex ?? 0) - 1;
        if (newIdx < 0) return;
        msg.swipeIndex = newIdx;
        syncMsgFromSwipe(msg);
        saveChatHistory(h);
        updateSwipeInPlace(msgIndex, h);
    }

    /** Shows the next version of a character message, generating one past the last. */
    function showNextSwipe(msgIndex) {
        const h = getChatHistory();
        const msg = h[msgIndex];
        if (!msg) return;
        const currentIdx = msg.swipeIndex ?? 0;
        // If no swipes array yet, or we're at the last swipe → generate a new one
        if (!msg.swipes || currentIdx >= msg.swipes.length - 1) {
            const contextHistory = h.slice(0, msgIndex);
            generateEchoTextSwipe(h, msgIndex, contextHistory);
            return;
        }
        msg.swipeIndex = currentIdx + 1;
        syncMsgFromSwipe(msg);
        saveChatHistory(h);
        updateSwipeInPlace(msgIndex, h);
    }

    /** Opens a message's generated image, with every image in the chat to step through. */
    function openImageAttachment(msgIndex) {
        const history = getChatHistory();
        const msg = history[msgIndex];
        const navItems = history
            .filter(m => m?.imageAttachment?.url)
            .map(m => ({ url: m.imageAttachment.url, prompt: m.imageAttachment.prompt || '' }));
        const currentUrl = msg?.imageAttachment?.url || '';
        const navIndex = navItems.findIndex(x => x.url === currentUrl);
        openGeneratedImageLightbox(
            currentUrl,
            msg?.imageAttachment?.prompt || '',
            { navItems, navIndex: navIndex >= 0 ? navIndex : 0 }
        );
    }

    /**
     * What a click on a message element does, keyed by its data-et-action. Each
     * handler gets { el, msgIndex, isUser, partIndex }: the nearest data-index /
     * data-is-user / data-part at or around the clicked element.
     */
    const MESSAGE_ACTIONS = {
        'react': ({ el, msgIndex }) => {
            closeAllDotMenus();
            toggleReactOverlay(jQuery(el), msgIndex);
        },
        'reaction-toggle': ({ el, msgIndex }) => addReaction(msgIndex, el.dataset.reaction),
        // The footer menu acts on the whole message, a bubble's menu on that bubble
        'menu': ({ el, msgIndex, isUser }) => {
            closeAllReactOverlays();
            toggleDotsMenu(jQuery(el), msgIndex, isUser, null);
        },
        'part-menu': ({ el, msgIndex, isUser, partIndex }) => {
            closeAllReactOverlays();
            toggleDotsMenu(jQuery(el), msgIndex, isUser, partIndex);
        },
        'swipe-prev': ({ msgIndex }) => {
            closeAllDotMenus();
            showPrevSwipe(msgIndex);
        },
        'swipe-next': ({ msgIndex }) => {
            closeAllDotMenus();
            showNextSwipe(msgIndex);
        },
        'photo-toggle': ({ el }) => el.setAttribute('aria-expanded', String(el.getAttribute('aria-expanded') !== 'true')),
        'voice-toggle': ({ el, msgIndex }) => toggleVoiceTranscript(el, msgIndex),
        // A shared file's summary (and any card that opens the same way)
        'card-toggle': ({ el }) => toggleExpanded(el, '[data-et-role~="summary"]'),
        // The character's avatar beside a message (platforms that draw one)
        'avatar': ({ el }) => openAvatarMenu(el),
        'transfer-respond': ({ el }) => openTransferResponseMenu(jQuery(el)),
        'image-open': ({ msgIndex }) => openImageAttachment(msgIndex),
        // A remembered phrase opens the save modal, or the remove modal once saved
        'memory-highlight': ({ el }) => {
            if (el.classList.contains('et-mem-highlight-saved')) showMemoryRemoveModal(el);
            else showMemorySaveModal(el);
        },
    };

    /**
     * Shows or hides a voice message's words. Opening one of the character's for the
     * first time marks it heard in the chat (msg.voiceHeard lists the message's heard
     * voice parts), so its unread dot stays gone.
     */
    function toggleVoiceTranscript(el, msgIndex) {
        toggleExpanded(el, '[data-et-role~="transcript"]');
        const dot = el.querySelector('[data-et-role~="unread"]');
        if (!dot) return;
        dot.remove();
        const history = getChatHistory();
        const msg = history[msgIndex];
        const voiceIndex = Number(el.dataset.voice);
        if (!msg || !Number.isInteger(voiceIndex)) return;
        msg.voiceHeard = [...new Set([...(Array.isArray(msg.voiceHeard) ? msg.voiceHeard : []), voiceIndex])];
        saveChatHistory(history);
        syncRenderedView(history, msgIndex);
    }

    /**
     * Opens or closes what a voice message or card shows when tapped (`selector`: inside
     * it, or the element just after it). Opened under the input bar, it scrolls up into view.
     */
    function toggleExpanded(el, selector) {
        const open = el.getAttribute('aria-expanded') !== 'true';
        el.setAttribute('aria-expanded', String(open));
        const content = el.querySelector(selector) || (el.nextElementSibling?.matches(selector) ? el.nextElementSibling : null);
        const list = document.getElementById('et-messages');
        if (open && content && list) {
            const hidden = content.getBoundingClientRect().bottom - list.getBoundingClientRect().bottom;
            if (hidden > 0) list.scrollTop += hidden + 8;
        }
    }

    /**
     * After a change the list already shows (a voice message opened), records the
     * message's new view as drawn, so the next in-place update leaves it as it is.
     */
    function syncRenderedView(history, msgIndex) {
        const entry = renderedViews.get(msgIndex);
        const view = ChatViewModel.buildChatViewModel(history, getChatViewOptions()).messages.find(m => m.index === msgIndex);
        if (entry && view) entry.signature = JSON.stringify(view);
    }

    /** Delegated click handler for every [data-et-action] in the message list. */
    function onMessageAction(e) {
        const el = e.currentTarget;
        const action = MESSAGE_ACTIONS[el.dataset.etAction];
        if (!action) return;
        e.stopPropagation();
        const indexEl = el.closest('[data-index]');
        const partEl = el.closest('[data-part]');
        action({
            el,
            msgIndex: indexEl ? parseInt(indexEl.dataset.index, 10) : -1,
            isUser: el.closest('[data-is-user]')?.dataset.isUser === '1',
            partIndex: partEl ? parseInt(partEl.dataset.part, 10) : null,
        });
    }

    function bindMessageActions() {
        const inner = jQuery('#et-messages-inner');
        inner.off('click.et-actions').on('click.et-actions', '[data-et-action]', onMessageAction);
        // Capture phase: a tap on a photo or card inside a bubble counts too, though
        // its own action stops the click from bubbling
        const el = inner[0];
        if (el && !el._etBubbleTapBound) {
            el._etBubbleTapBound = true;
            el.addEventListener('click', onBubbleTap, true);
        }
    }

    /**
     * A tap on a bubble marks it data-et-revealed (and unmarks the rest); a second
     * tap on it, or a tap elsewhere in the list, unmarks it. Platforms use it to show
     * a bubble's controls on touch screens only when asked (WeChat's "⋯").
     */
    function onBubbleTap(e) {
        // A revealed control itself
        if (e.target.closest('[data-et-action="menu"], [data-et-action="part-menu"], [data-et-action="react"], [data-et-action="avatar"]')) return;
        const bubble = e.target.closest('[data-et-role~="bubble"]');
        const wasRevealed = !!bubble?.hasAttribute('data-et-revealed');
        this.querySelectorAll('[data-et-revealed]').forEach(b => b.removeAttribute('data-et-revealed'));
        if (bubble && !wasRevealed) bubble.setAttribute('data-et-revealed', '');
    }

    /**
     * Puts the active platform on the panel: its id in data-platform (its CSS is
     * scoped under it), its stylesheet loaded only while in use, the "+" button
     * only when it has something to attach, and the pickers in settings.
     */
    function syncPlatformChrome() {
        const platform = getActivePlatform();
        jQuery('#et-panel').attr({
            'data-platform': platform.id,
            'data-et-scheme': getColorScheme(),
            'data-et-typing': showTypingIndicator ? '' : null,
        });

        const href = platform.stylesheet
            ? `${BASE_URL}/platforms/${platform.id}/${platform.stylesheet}${VERSION_QUERY}`
            : null;
        let link = document.getElementById('et-platform-css');
        if (link && link.getAttribute('href') !== href) {
            link.remove();
            link = null;
        }
        if (href && !link) {
            link = document.createElement('link');
            link.id = 'et-platform-css';
            link.rel = 'stylesheet';
            link.href = href;
            document.head.appendChild(link);
        }

        const modes = Features.getComposerModes(platform.features);
        // An attribute, not jQuery's show/hide: show() run while the platform's CSS
        // hides "+" (WeChat, while typing) would pin it visible with an inline style
        jQuery('#et-attach-btn').prop('hidden', Object.keys(modes).length === 0);
        // A platform that records voice from the input bar (WeChat) shows its voice button
        jQuery('#et-voice-btn').prop('hidden', !(platform.voiceButton && modes.voice));
        // A mode the platform lacks ends; one it has is redrawn (voice moves between "+" and the voice button)
        if (composeMode) setComposeMode(modes[composeMode] ? composeMode : null);
        if (!platform.composerPanel) closeAttachPanel();
        populatePlatformSelects();
    }

    /** Fills the platform pickers in both settings views: the default, and the current character's. */
    function populatePlatformSelects() {
        const options = PLATFORM_IDS.filter(id => Platforms[id])
            .map(id => `<option value="${id}">${escapeHtml(Platforms[id].name)}</option>`).join('');
        const charKey = getCharacterKey();
        const charChoice = charKey ? settings.platformByCharacter?.[charKey] : null;
        jQuery('#et_platform_default, #et_platform_default_panel')
            .html(options)
            .val(Platforms[settings.defaultPlatform] ? settings.defaultPlatform : 'echotext');
        jQuery('#et_platform_character, #et_platform_character_panel')
            .html(`<option value="">Use default</option>${options}`)
            .val(Platforms[charChoice] ? charChoice : '')
            .prop('disabled', !charKey);
        jQuery('#et_platform_character_label, #et_platform_character_label_panel')
            .text(charKey ? `Platform for ${getCharacterName()}` : 'Platform for this character');
    }

    function bindPlatformSelects() {
        jQuery(document).off('change.et-platform')
            .on('change.et-platform', '#et_platform_default, #et_platform_default_panel', function () {
                settings.defaultPlatform = this.value;
                onPlatformChoiceChanged();
            })
            .on('change.et-platform', '#et_platform_character, #et_platform_character_panel', function () {
                const charKey = getCharacterKey();
                if (!charKey) return;
                settings.platformByCharacter = settings.platformByCharacter || {};
                if (this.value) settings.platformByCharacter[charKey] = this.value;
                else delete settings.platformByCharacter[charKey];
                onPlatformChoiceChanged();
            });
    }

    /** A platform choice changed: re-render the chat with it (the history stays as it is). */
    function onPlatformChoiceChanged() {
        saveSettings();
        activePlatformMemo = null;
        populatePlatformSelects();
        if (panelOpen) renderMessages(getChatHistory(), true);
    }

    // The view of each message on screen, by index, so refreshMessages() replaces only what changed
    let renderedViews = new Map();

    /** View-model options for the chat on screen. */
    function getChatViewOptions() {
        return {
            charName: getCharacterName(),
            userName: getUserName(),
            reactionIds: getReactionIds(),
            features: getActiveFeatures(),
            combineMode: !!(groupManager && groupManager.isGroupSession() && groupManager.isCombineMode()),
            swipes: !!settings.swipedMessages,
            memoryHighlights: !!(settings.memoryEnabled && settings.memoryAutoExtract),
        };
    }

    /** What platform templates get besides a message's own view (see platforms/echotext/platform.js). */
    function getMessageRenderContext() {
        const { DOMPurify } = SillyTavern.libs;
        const charKey = getCharacterKey();
        return {
            verbosity: charKey && settings.verbosityByCharacter ? settings.verbosityByCharacter[charKey] : null,
            charName: getCharacterName(),
            animateReaction: true,
            has: platformHas,
            escapeHtml,
            sanitize: text => DOMPurify.sanitize(text, { ALLOWED_TAGS: [] }),
            formatText: formatMessageText,
            reaction: id => FA_REACTIONS.find(r => r.id === id) || null,
            groupChat: isCombinedGroupMode(),
            // A message sender's avatar as data, for templates that draw their own
            avatar: (m) => {
                const name = m.senderName || '';
                const member = !m.isUser && m.charKey && groupManager ? groupManager.getGroupMemberByKey(m.charKey) : null;
                const url = m.isUser ? getUserAvatarUrl() : member ? getAvatarUrlForCharacter(member) : getCharAvatarUrl();
                return { url, initial: name.charAt(0).toUpperCase(), color: _pickerAvatarBg(name) };
            },
        };
    }

    /** A rendered message's element, by history index. */
    function findMessageElement(msgIndex) {
        return jQuery(`#et-messages-inner [data-et-role~="message"][data-index="${msgIndex}"]`);
    }

    /** What a message's markup doesn't carry: its arrival sequence and memory marks. */
    function decorateMessage(msgEl, m) {
        if (shouldStaggerReveal(m)) {
            staggerRevealParts(msgEl);
        }

        if (m.memoryHighlights.length) {
            try { applyMemoryHighlights(msgEl, m); } catch (e) { /* ignore */ }
        }
    }

    /**
     * Re-renders in place every message on screen whose view changed — after a
     * reaction, read receipt or swipe. Each is replaced whole and marked
     * data-et-refreshed so its entrance animation doesn't replay; open photos stay
     * open. Adding or removing messages still takes renderMessages().
     */
    function refreshMessages(history) {
        if (!Array.isArray(history) || !history.length) return;
        const inner = jQuery('#et-messages-inner');
        if (!inner.length) return;

        const view = ChatViewModel.buildChatViewModel(history, getChatViewOptions());
        let ctx = null;
        for (const m of view.messages) {
            const signature = JSON.stringify(m);
            const prev = renderedViews.get(m.index);
            if (prev?.signature === signature) continue;
            const oldEl = findMessageElement(m.index);
            if (!oldEl.length) continue;

            ctx = ctx || getMessageRenderContext();
            replaceMessageElement(oldEl, m, prev, ctx);
            if (settings.swipedMessages && isMobileDevice() && m.index === view.lastCharIndex) {
                bindBubbleTouchSwipe(inner, m.index);
            }
            renderedViews.set(m.index, { signature, charReaction: m.charReaction });
        }
    }

    /** Swaps a rendered message for its new view: no entrance animation, open photos stay open. */
    function replaceMessageElement(oldEl, m, prev, ctx) {
        const expanded = oldEl.find('[aria-expanded]').map((i, el) => el.getAttribute('aria-expanded')).get();
        // The character's reaction pops in only when it's new
        const html = getActivePlatform().templates.message(m, { ...ctx, animateReaction: m.charReaction !== prev?.charReaction });
        const msgEl = jQuery(html.trim()).attr('data-et-refreshed', '');
        msgEl.find('[aria-expanded]').each((i, el) => {
            if (expanded[i]) el.setAttribute('aria-expanded', expanded[i]);
        });
        oldEl.replaceWith(msgEl);
        decorateMessage(msgEl, m);
        return msgEl;
    }

    // What the rendered list was drawn with besides each message's view; when it
    // changes (another chat, platform or avatar), renderMessages() starts over
    let renderedFrame = null;

    function getRenderFrame(platform, ctx) {
        return JSON.stringify([platform.id, platform.features, getCharacterKey(), ctx.charName, ctx.verbosity, ctx.groupChat,
            getUserAvatarUrl(), getCharAvatarUrl(), settings.memoryHighlightStyle]);
    }

    /**
     * Brings the rendered list up to date with `view` without clearing it: messages
     * whose view is unchanged stay as they are, changed ones are replaced in place,
     * new ones are added where they belong and gone ones removed. Clearing the list
     * would reset its scroll position and replay every message's entrance.
     * @returns {boolean} false when the list holds no messages or something else
     *   (empty-chat placeholder, character picker…) and needs a full render instead
     */
    function updateMessageList(inner, view, ctx) {
        const children = inner.children();
        const messageEls = children.filter('[data-et-role~="message"]');
        const onlyMessages = children.toArray().every(el =>
            /(^|\s)(message|typing|image-generating)(\s|$)/.test(el.getAttribute('data-et-role') || ''));
        if (!onlyMessages || !messageEls.length) return false;

        const platform = getActivePlatform();
        const existing = new Map(messageEls.toArray().map(el => [el.getAttribute('data-index'), jQuery(el)]));
        const rebuilt = new Set();
        let prevEl = null;
        for (const m of view.messages) {
            const signature = JSON.stringify(m);
            const prev = renderedViews.get(m.index);
            let msgEl = existing.get(String(m.index));
            existing.delete(String(m.index));
            if (msgEl && prev?.signature === signature) {
                // unchanged
            } else if (msgEl) {
                msgEl = replaceMessageElement(msgEl, m, prev, ctx);
                rebuilt.add(m.index);
            } else {
                msgEl = jQuery(platform.templates.message(m, ctx).trim());
                if (prevEl) prevEl.after(msgEl);
                else inner.prepend(msgEl);
                decorateMessage(msgEl, m);
                rebuilt.add(m.index);
                // Re-scroll when a new message's images load
                msgEl.find('img').on('load', scrollMessagesToEnd);
            }
            renderedViews.set(m.index, { signature, charReaction: m.charReaction });
            prevEl = msgEl;
        }
        for (const [index, el] of existing) {
            el.remove();
            renderedViews.delete(Number(index));
        }

        // Indicators as a full render leaves them: the typing indicator last, if on
        children.filter('[data-et-role~="image-generating"]').remove();
        const typing = inner.children('[data-et-role~="typing"]');
        if (!showTypingIndicator) typing.remove();
        else if (!typing.length) inner.append(platform.templates.typing(ctx));

        if (settings.swipedMessages && isMobileDevice() && rebuilt.has(view.lastCharIndex)) {
            bindBubbleTouchSwipe(inner, view.lastCharIndex);
        }
        return true;
    }

    function scrollMessagesToEnd() {
        const messagesEl = document.getElementById('et-messages');
        if (settings.autoScroll && messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    // Track which delete button is pending 2nd click
    let deleteConfirmIndex = -1;
    let deleteConfirmTimer = null;

    function renderMessages(history, preserveScroll = false) {
        const inner = jQuery('#et-messages-inner');
        if (!inner.length) return;

        const messagesEl = document.getElementById('et-messages');
        const savedScrollTop = (preserveScroll && messagesEl) ? messagesEl.scrollTop : null;

        syncPlatformChrome();

        if (!history || history.length === 0) {
            inner.empty();
            renderedViews = new Map();
            renderedFrame = null;
            const char = getCurrentCharacter();
            if (!char) { showNoCharacterMessage(); return; }
            inner.html(getActivePlatform().templates.emptyChat());
            return;
        }

        const platform = getActivePlatform();
        const view = ChatViewModel.buildChatViewModel(history, getChatViewOptions());
        const ctx = getMessageRenderContext();
        const frame = getRenderFrame(platform, ctx);

        // Same chat drawn the same way (a message sent or received, an edit):
        // update in place, so the list keeps its scroll position
        if (frame === renderedFrame && updateMessageList(inner, view, ctx)) {
            if (preserveScroll && messagesEl && savedScrollTop !== null) messagesEl.scrollTop = savedScrollTop;
            else scrollMessagesToEnd();
            return;
        }

        inner.empty();
        renderedViews = new Map();
        renderedFrame = frame;
        view.messages.forEach((m) => {
            inner.append(platform.templates.message(m, ctx));
            decorateMessage(inner.children().last(), m);
            renderedViews.set(m.index, { signature: JSON.stringify(m), charReaction: m.charReaction });
        });

        if (showTypingIndicator) {
            inner.append(platform.templates.typing(ctx));
        }

        // Bind touch-swipe gesture on the last char bubble (mobile only)
        if (settings.swipedMessages && isMobileDevice() && view.lastCharIndex >= 0) {
            bindBubbleTouchSwipe(inner, view.lastCharIndex);
        }

        if (preserveScroll && messagesEl && savedScrollTop !== null) {
            // Restore the scroll position the user was at before the edit re-render
            messagesEl.scrollTop = savedScrollTop;
        } else if (settings.autoScroll) {
            if (messagesEl) {
                // A new list jumps straight to its end; smooth scrolling would
                // glide there from the top
                messagesEl.style.scrollBehavior = 'auto';
                messagesEl.scrollTop = messagesEl.scrollHeight;
                messagesEl.style.scrollBehavior = '';

                // Re-scroll when images (specifically generated images) finish loading
                // so they don't break the auto-scroll flow by pushing text up.
                inner.find('img').on('load', scrollMessagesToEnd);
            }
        }
    }

    // ============================================================
    // EMOJI REACTION OVERLAY (iOS-style)
    // ============================================================

    function closeAllReactOverlays() {
        jQuery('.et-react-overlay').each(function () {
            const overlay = jQuery(this);
            overlay.addClass('et-react-overlay-closing');
            setTimeout(() => overlay.remove(), 200);
        });
    }

    // ============================================================
    // 3-DOT BUBBLE MENU
    // ============================================================

    function closeAllDotMenus() {
        jQuery('#et-attach-btn').removeClass('et-attach-open');
        jQuery('.et-dots-menu').each(function () {
            const menu = jQuery(this);
            menu.addClass('et-dots-menu-closing');
            setTimeout(() => menu.remove(), 180);
        });
        // Reset any pending delete confirm
        if (deleteConfirmTimer) { clearTimeout(deleteConfirmTimer); deleteConfirmTimer = null; }
        deleteConfirmIndex = -1;
    }

    /**
     * @param {number|null} partIndex - set when opened from a single bubble of a
     *   multi-bubble message; the footer menu (null) acts on the whole message,
     *   except that its Delete removes only the last bubble
     */
    function toggleDotsMenu(btn, msgIndex, isUser, partIndex = null) {
        const partKey = partIndex === null ? 'main' : partIndex;
        const existing = jQuery(`.et-dots-menu[data-for="${msgIndex}"][data-is-user="${isUser ? 1 : 0}"][data-part="${partKey}"]`);
        if (existing.length) { closeAllDotMenus(); return; }
        closeAllDotMenus();

        const msg = getChatHistory()[msgIndex];
        const partCount = msg ? getMessageDisplayParts(msg).length : 1;
        const deleteAllLabel = `Delete all (${partCount})`;

        // Build menu items
        const items = [];
        if (partIndex !== null) {
            items.push({ id: 'copy_part', icon: 'fa-copy', label: 'Copy', cls: '' });
            items.push({ id: 'delete', icon: 'fa-trash', label: 'Delete', cls: 'et-dots-item-delete' });
        } else if (isUser) {
            items.push({ id: 'edit', icon: 'fa-pen', label: 'Edit', cls: '' });
            items.push({ id: 'copy', icon: 'fa-copy', label: 'Copy', cls: '' });
            items.push({ id: 'regen', icon: 'fa-rotate-right', label: 'Regenerate', cls: '' });
            if (memorySystem && settings.memoryEnabled) {
                items.push({ id: 'add_memory', icon: 'fa-brain', label: 'Add Memory', cls: '' });
            }
            items.push({ id: 'delete', icon: 'fa-trash', label: partCount > 1 ? 'Delete this' : 'Delete', cls: 'et-dots-item-delete' });
            if (partCount > 1) items.push({ id: 'delete_all', icon: 'fa-trash-can', label: deleteAllLabel, cls: 'et-dots-item-delete' });
        } else {
            items.push({ id: 'edit', icon: 'fa-pen', label: 'Edit', cls: '' });
            items.push({ id: 'regen', icon: 'fa-rotate-right', label: 'Regenerate', cls: '' });
            items.push({ id: 'verbosity', icon: 'fa-align-left', label: 'Verbosity', cls: 'et-dots-item-submenu' });
            items.push({ id: 'delete', icon: 'fa-trash', label: partCount > 1 ? 'Delete this' : 'Delete', cls: 'et-dots-item-delete' });
            if (partCount > 1) items.push({ id: 'delete_all', icon: 'fa-trash-can', label: deleteAllLabel, cls: 'et-dots-item-delete' });
        }
        // The footer menu's "Delete this" removes the main (last) bubble
        const targetPart = partIndex !== null ? partIndex : (partCount > 1 ? partCount - 1 : null);

        const itemsHtml = items.map(item => {
            const hasSubmenu = item.id === 'verbosity';
            return `<button class="et-dots-item ${item.cls}" data-action="${item.id}">
                <i class="fa-solid ${item.icon}"></i><span>${item.label}</span>${hasSubmenu ? '<i class="fa-solid fa-chevron-left et-dots-submenu-arrow"></i>' : ''}
            </button>`;
        }).join('');

        const menu = jQuery(`
            <div class="et-dots-menu" data-for="${msgIndex}" data-is-user="${isUser ? 1 : 0}" data-part="${partKey}">
                ${itemsHtml}
            </div>
        `);

        jQuery('#et-panel').append(menu);

        // Position relative to button
        const btnRect = btn[0].getBoundingClientRect();
        const panelRect = document.getElementById('et-panel').getBoundingClientRect();
        const menuW = 160;
        const menuH = menu.outerHeight() || 160;

        let left = btnRect.left - panelRect.left - menuW + btnRect.width + 4;
        let top = btnRect.top - panelRect.top - 8;

        left = Math.max(8, Math.min(panelRect.width - menuW - 8, left));

        if (top + menuH > panelRect.height) {
            top = btnRect.bottom - panelRect.top - menuH + 4;
            menu.css('transform-origin', 'bottom right');
        } else {
            menu.css('transform-origin', 'top right');
        }

        top = Math.max(8, top);

        menu.css({ left: left + 'px', top: top + 'px' });
        requestAnimationFrame(() => menu.addClass('et-dots-menu-open'));

        // Close on outside click (once)
        setTimeout(() => {
            jQuery(document).one('click.et-dots-outside', function (e) {
                if (!jQuery(e.target).closest('.et-dots-menu, [data-et-action="menu"], [data-et-action="part-menu"]').length) {
                    closeAllDotMenus();
                }
            });
        }, 0);

        // Bind actions
        menu.find('.et-dots-item').on('click', function (e) {
            e.stopPropagation();
            const action = jQuery(this).data('action');
            handleDotsAction(action, msgIndex, isUser, jQuery(this), targetPart);
        });
    }

    /**
     * Removes one bubble from a message by rebuilding its text from the remaining
     * parts (the current swipe too, so switching swipes doesn't bring it back).
     * Removing the last bubble removes the message.
     */
    function deleteMessagePart(history, msgIndex, partIndex) {
        const msg = history[msgIndex];
        const remaining = getMessageDisplayParts(msg).filter((part, j) => j !== partIndex
            && part.type !== 'reaction_note' && (part.type !== 'text' || part.text));
        // <react> tags aren't bubbles, so they survive deleting one
        const reactions = RichMessages.parseMessageParts(msg.mes).filter(part => part.type === 'react');
        if (!remaining.length && !reactions.length && !msg.imageAttachment) {
            history.splice(msgIndex, 1);
            return;
        }
        msg.mes = RichMessages.serializeParts([...remaining, ...reactions]);
        const swipe = Array.isArray(msg.swipes) ? msg.swipes[msg.swipeIndex ?? 0] : null;
        if (swipe) swipe.mes = msg.mes;
    }

    /**
     * Edits a message in place as one raw text (tags included): the message is
     * re-rendered as a single text bubble — the platform's own text bubble — and
     * its text becomes editable. Save writes the text back; Cancel restores the
     * message.
     */
    function startInlineEdit(history, msgIndex) {
        const msg = history[msgIndex];
        const oldEl = findMessageElement(msgIndex);
        if (!msg || !oldEl.length) return;

        // Already editing?
        if (oldEl.find('[contenteditable="true"]').length) return;

        // By history index: hidden messages (e.g. reaction-only replies on WeChat) leave gaps in the list
        const view = ChatViewModel.buildChatViewModel(history, getChatViewOptions()).messages.find(m => m.index === msgIndex);
        if (!view) return;
        const html = getActivePlatform().templates.message({ ...view, parts: [{ type: 'text', text: '' }] },
            { ...getMessageRenderContext(), animateReaction: false });
        const msgEl = jQuery(html.trim()).attr('data-et-refreshed', '');
        oldEl.replaceWith(msgEl);
        // Not the message's real view any more, so the next refresh restores it
        renderedViews.delete(msgIndex);

        const bubble = msgEl.find('[data-et-role~="main"]');
        const textEl = bubble.find('[data-et-role~="text"]');

        // Set the content to raw markdown so it's editable and preserved
        textEl.text(msg.mes);
        textEl.attr('contenteditable', 'true');
        // The browser doesn't scroll the list to it; keepEditInView does, below
        textEl[0].focus({ preventScroll: true });

        // Move cursor to end
        const range = document.createRange();
        const sel = window.getSelection();
        range.selectNodeContents(textEl[0]);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);

        // Save / cancel under the message, in the platform's look
        const toolbar = jQuery(getActivePlatform().templates.editToolbar().trim());
        bubble.after(toolbar);

        // iOS: the on-screen keyboard scrolls the message list by itself to reveal the
        // caret, and leaves the caret and taps where the text was before (the caret
        // drifts below the text, the buttons only answer taps below them). So the list
        // scrolls itself once the keyboard is up (which also resyncs it), and the
        // selection is set again to redraw the caret.
        const viewport = window.visualViewport;
        let viewportTimer = null;
        const keepEditInView = () => {
            clearTimeout(viewportTimer);
            viewportTimer = setTimeout(() => {
                const list = document.getElementById('et-messages');
                if (!list || !toolbar[0].isConnected) return;
                const visibleBottom = Math.min(list.getBoundingClientRect().bottom, viewport.offsetTop + viewport.height);
                const overflow = toolbar[0].getBoundingClientRect().bottom + 8 - visibleBottom;
                const behavior = list.style.scrollBehavior;
                list.style.scrollBehavior = 'auto';
                list.scrollTop += Math.max(0, overflow);
                list.style.scrollBehavior = behavior;
                const current = sel.rangeCount ? sel.getRangeAt(0) : null;
                if (current && textEl[0].contains(current.startContainer)) {
                    sel.removeAllRanges();
                    sel.addRange(current);
                }
            }, 120);
        };
        if (viewport && isMobileDevice()) {
            viewport.addEventListener('resize', keepEditInView);
            viewport.addEventListener('scroll', keepEditInView);
        }

        const finishEdit = () => {
            clearTimeout(viewportTimer);
            if (viewport) {
                viewport.removeEventListener('resize', keepEditInView);
                viewport.removeEventListener('scroll', keepEditInView);
            }
            textEl.removeAttr('contenteditable');
            toolbar.remove();
        };

        toolbar.find('[data-et-role="edit-save"]').on('click', () => {
            // Extract plain text from contenteditable
            const newText = textEl[0].innerText.trim();
            if (!newText) { finishEdit(); renderMessages(history); return; }
            history[msgIndex].mes = newText;
            saveChatHistory(history);
            finishEdit();
            renderMessages(history, true);
        });

        toolbar.find('[data-et-role="edit-cancel"]').on('click', () => {
            finishEdit();
            refreshMessages(history);
        });

        // Also save on Enter (without shift), cancel on Escape
        textEl.on('keydown.edit', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                toolbar.find('[data-et-role="edit-save"]').trigger('click');
            } else if (e.key === 'Escape') {
                toolbar.find('[data-et-role="edit-cancel"]').trigger('click');
            }
        });
    }

    /**
     * @param {number|null} partIndex - the bubble a part-level action targets (Copy /
     *   Delete on one bubble of a multi-bubble message); null for the whole message
     */
    function handleDotsAction(action, msgIndex, isUser, btn, partIndex = null) {
        const history = getChatHistory();
        const msg = history[msgIndex];
        if (!msg) return;

        if (action === 'copy') {
            try { navigator.clipboard.writeText(msg.mes); } catch (e) { /* noop */ }
            closeAllDotMenus();
            return;
        }

        if (action === 'copy_part') {
            const part = getMessageDisplayParts(msg)[partIndex];
            const text = !part ? '' : part.type === 'text' || part.type === 'voice' ? part.text : RichMessages.toPlainText(RichMessages.serializeParts([part]));
            try { navigator.clipboard.writeText(text); } catch (e) { /* noop */ }
            closeAllDotMenus();
            return;
        }

        if (action === 'delete' || action === 'delete_all') {
            // Only this message (or one of its bubbles) goes — later messages stay
            const wholeMessage = action === 'delete_all' || partIndex === null;
            const confirmKey = `${msgIndex}:${wholeMessage ? 'all' : partIndex}`;
            if (deleteConfirmIndex === confirmKey) {
                // Second click — execute delete
                clearTimeout(deleteConfirmTimer);
                deleteConfirmTimer = null;
                deleteConfirmIndex = -1;

                if (wholeMessage) history.splice(msgIndex, 1);
                else deleteMessagePart(history, msgIndex, partIndex);

                saveChatHistory(history);
                closeAllDotMenus();
                renderMessages(history, true);
            } else {
                // First click — highlight red and change text
                const originalLabel = btn.find('span').text();
                deleteConfirmIndex = confirmKey;
                btn.addClass('et-dots-item-delete-confirm');
                btn.find('span').text('Are You Sure?');

                deleteConfirmTimer = setTimeout(() => {
                    deleteConfirmIndex = -1;
                    btn.removeClass('et-dots-item-delete-confirm');
                    btn.find('span').text(originalLabel);
                }, 3000);
            }
            return;
        }

        if (action === 'edit') {
            closeAllDotMenus();
            startInlineEdit(history, msgIndex);
            return;
        }

        if (action === 'verbosity') {
            // Show verbosity submenu
            const charKey = getCharacterKey();
            const currentVerbosity = (charKey && settings.verbosityByCharacter && settings.verbosityByCharacter[charKey]) || 'medium';
            const dotsMenu = jQuery(`.et-dots-menu[data-for="${msgIndex}"]`);

            // Remove any existing verbosity submenu
            jQuery('.et-dots-submenu').remove();

            const options = [
                { id: 'short', label: 'Short', icon: 'fa-compress' },
                { id: 'medium', label: 'Medium', icon: 'fa-align-center' },
                { id: 'long', label: 'Long', icon: 'fa-expand' }
            ];

            const optionsHtml = options.map(o => {
                const selected = o.id === currentVerbosity ? ' et-dots-item-selected' : '';
                const check = o.id === currentVerbosity ? '<i class="fa-solid fa-check et-dots-check"></i>' : '';
                return `<button class="et-dots-item${selected}" data-verbosity="${o.id}">
                    <i class="fa-solid ${o.icon}"></i><span>${o.label}</span>${check}
                </button>`;
            }).join('');

            const submenu = jQuery(`<div class="et-dots-menu et-dots-submenu">${optionsHtml}</div>`);
            jQuery('#et-panel').append(submenu);

            // Position submenu to the left of the main menu
            const menuEl = dotsMenu[0];
            const panelRect = document.getElementById('et-panel').getBoundingClientRect();
            if (menuEl) {
                const subMenuH = submenu.outerHeight() || 120;
                const menuRect = menuEl.getBoundingClientRect();

                let subLeft = menuRect.left - panelRect.left - 164;
                let subTop = menuRect.top - panelRect.top;

                subLeft = Math.max(8, subLeft);

                if (subTop + subMenuH > panelRect.height) {
                    subTop = menuRect.bottom - panelRect.top - subMenuH;
                    submenu.css('transform-origin', 'bottom right');
                } else {
                    submenu.css('transform-origin', 'top right');
                }

                subTop = Math.max(8, subTop);

                submenu.css({ left: subLeft + 'px', top: subTop + 'px' });
            }

            requestAnimationFrame(() => submenu.addClass('et-dots-menu-open'));

            submenu.find('.et-dots-item').on('click', function (e) {
                e.stopPropagation();
                const v = jQuery(this).data('verbosity');
                if (!settings.verbosityByCharacter) settings.verbosityByCharacter = {};
                settings.verbosityByCharacter[charKey] = v;
                saveSettings();
                closeAllDotMenus();
                const label = v.charAt(0).toUpperCase() + v.slice(1);
                toastr.info(`Verbosity set to <b>${label}</b> for ${getCharacterName()}.`, '', { timeOut: 2500 });
            });
            return;
        }

        if (action === 'add_memory') {
            closeAllDotMenus();
            showManualMemorySaveModal(msg.mes);
            return;
        }

        if (action === 'regen') {
            closeAllDotMenus();

            const inCombineMode = !!(groupManager && groupManager.isGroupSession() && groupManager.isCombineMode());

            if (isUser) {
                // Re-send: truncate to just before this user message and regenerate all
                const truncated = history.slice(0, msgIndex + 1);
                saveChatHistory(truncated);
                renderMessages(truncated);
                if (inCombineMode) {
                    generateEchoTextCombined(truncated);
                } else {
                    generateEchoText(truncated);
                }
            } else {
                if (inCombineMode) {
                    // ── Combined mode: regenerate only the specific character whose
                    // bubble was clicked, leaving all other characters' responses intact.
                    //
                    // History around the target (e.g. Joi at msgIndex 2):
                    //   [0] user msg
                    //   [1] Amy's response   ← historyBefore
                    //   [2] Joi's response   ← removed (being regenerated)
                    //   [3] Iris's response  ← historyAfter
                    //
                    // We pass historyBefore as the generation context and historyAfter
                    // so the new reply can be stitched back into the correct position.
                    const historyBefore = history.slice(0, msgIndex);
                    const historyAfter  = history.slice(msgIndex + 1);

                    // Show the gap immediately (target message disappears, others stay)
                    const previewHistory = [...historyBefore, ...historyAfter];
                    saveChatHistory(previewHistory);
                    renderMessages(previewHistory);

                    const targetCharKey = history[msgIndex]?.charKey
                        || groupManager.getActiveCharKey();
                    generateEchoTextCombinedForChar(historyBefore, historyAfter, targetCharKey, history);
                } else {
                    // Solo/group-non-combine mode regen
                    if (settings.swipedMessages) {
                        // Swipe regen: keep the message in history and append a new variant
                        const contextHistory = history.slice(0, msgIndex);
                        generateEchoTextSwipe(history, msgIndex, contextHistory);
                    } else {
                        // Standard regen: remove message and regenerate
                        const truncated = history.slice(0, msgIndex);
                        saveChatHistory(truncated);
                        renderMessages(truncated);
                        generateEchoText(truncated, history);
                    }
                }
            }
            return;
        }
    }

    function toggleReactOverlay(reactBtn, msgIndex) {
        // If overlay already open for this message, close it
        const existing = jQuery(`.et-react-overlay[data-for="${msgIndex}"]`);
        if (existing.length) {
            closeAllReactOverlays();
            return;
        }

        closeAllReactOverlays();

        const emojiHtml = FA_REACTIONS.map(r =>
            `<button class="et-overlay-emoji" data-emoji="${r.id}" data-index="${msgIndex}" title="${r.label}" style="--react-color:${r.color}">
                <i class="${r.icon}"></i>
                <span class="et-overlay-emoji-label">${r.label}</span>
            </button>`
        ).join('');

        const overlay = jQuery(`
            <div class="et-react-overlay" data-for="${msgIndex}">
                <div class="et-react-overlay-inner">
                    ${emojiHtml}
                </div>
            </div>
        `);

        // Position overlay above the react button
        jQuery('#et-panel').append(overlay);

        const btnRect = reactBtn[0].getBoundingClientRect();
        const panelRect = document.getElementById('et-panel').getBoundingClientRect();
        const overlayW = 340;
        const overlayH = 72;

        let left = btnRect.left - panelRect.left - overlayW + btnRect.width;
        let top = btnRect.top - panelRect.top - overlayH - 8;

        // Clamp within panel
        left = Math.max(8, Math.min(panelRect.width - overlayW - 8, left));
        if (top < 8) top = btnRect.top - panelRect.top + btnRect.height + 8;

        overlay.css({ left: left + 'px', top: top + 'px' });

        // Animate in
        requestAnimationFrame(() => {
            overlay.addClass('et-react-overlay-open');
        });

        // Bind emoji clicks
        overlay.find('.et-overlay-emoji').on('click', function (e) {
            e.stopPropagation();
            const emoji = jQuery(this).data('emoji');
            addReaction(msgIndex, emoji);
            closeAllReactOverlays();
        });
    }

    function addReaction(msgIndex, reactionId) {
        // Look up the reaction definition
        const reactDef = FA_REACTIONS.find(r => r.id === reactionId);
        if (!reactDef) return;

        const history = getChatHistory();
        if (!Array.isArray(history) || !history[msgIndex]) return;

        const msg = history[msgIndex];
        if (!msg || msg.is_user) return;

        msg.reactions = ChatViewModel.normalizeReactionStore(msg.reactions);
        const current = msg.reactions[reactionId] || { count: 0, mine: false };

        if (current.mine) {
            current.mine = false;
            current.count = Math.max(0, (parseInt(current.count, 10) || 1) - 1);
        } else {
            // Check the 3-reaction limit
            const activeMineCount = Object.values(msg.reactions).filter(r => r.mine === true).length;
            if (activeMineCount >= 3) {
                toastr.info('You can only have 3 active reactions per message.');
                return;
            }
            current.mine = true;
            current.count = Math.max(0, parseInt(current.count, 10) || 0) + 1;
        }

        if (current.count <= 0) {
            delete msg.reactions[reactionId];
        } else {
            msg.reactions[reactionId] = current;
        }

        if (Object.keys(msg.reactions).length === 0) {
            delete msg.reactions;
        }

        saveChatHistory(history);

        // Re-render just this message
        refreshMessages(history);

        // Smoothly scroll the reaction bar into view
        setTimeout(() => {
            const reactionBar = findMessageElement(msgIndex).find('[data-et-role~="reactions"]')[0];
            if (reactionBar) {
                reactionBar.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }, 50);
    }

    // ============================================================
    // CUSTOM DROPDOWN COMPONENT
    // ============================================================

    const FONT_OPTIONS = [
        { value: 'Inter', label: 'Inter', desc: 'Modern, Clean' },
        { value: 'Nunito', label: 'Nunito', desc: 'Friendly, Rounded' },
        { value: 'Poppins', label: 'Poppins', desc: 'Geometric, Bold' },
        { value: 'Lato', label: 'Lato', desc: 'Humanist, Readable' },
        { value: 'Roboto', label: 'Roboto', desc: 'Android, Neutral' },
        { value: 'Source Sans Pro', label: 'Source Sans Pro', desc: 'Adobe, Clean' },
        { value: 'Merriweather', label: 'Merriweather', desc: 'Serif, Elegant' },
        { value: 'Playfair Display', label: 'Playfair Display', desc: 'Serif, Dramatic' }
    ];

    /**
     * Build a custom dropdown HTML.
     * @param {string} id - unique id for the dropdown
     * @param {Array} options - [{value, html, label}]
     * @param {string} currentValue - currently selected value
     */
    function buildCustomDropdown(id, options, currentValue) {
        const selected = options.find(o => o.value === currentValue) || options[0];
        const optionsHtml = options.map(o => `
            <div class="et-dd-option${o.value === currentValue ? ' et-dd-selected' : ''}" data-value="${o.value}">
                ${o.html || `<span>${o.label}</span>`}
            </div>
        `).join('');

        return `
        <div class="et-custom-dropdown" id="${id}" data-value="${currentValue}">
            <div class="et-dd-trigger">
                <div class="et-dd-display">
                    ${selected.html || `<span>${selected.label}</span>`}
                </div>
                <i class="fa-solid fa-chevron-down et-dd-arrow"></i>
            </div>
            <div class="et-dd-menu">
                ${optionsHtml}
            </div>
        </div>`;
    }

    function buildThemeDropdownHtml(currentValue) {
        const options = Object.entries(getAllThemePresets()).map(([key, theme]) => {
            const swatchHtml = (theme.swatches || []).map(c =>
                `<span class="et-dd-swatch" style="background:${c};"></span>`
            ).join('');
            return {
                value: key,
                label: theme.label,
                html: `<div class="et-dd-theme-item">
                    <div class="et-dd-swatches">${swatchHtml}</div>
                    <div class="et-dd-theme-info">
                        <span class="et-dd-theme-label">${theme.label}</span>
                        <span class="et-dd-theme-desc">${theme.description || ''}</span>
                    </div>
                </div>`
            };
        });
        return buildCustomDropdown('et_theme_custom', options, currentValue);
    }

    function buildFontDropdownHtml(currentValue) {
        // Preload all Google Fonts for preview
        const allFonts = FONT_OPTIONS.map(f => f.value.replace(/ /g, '+')).join('|');
        const preloadLink = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${FONT_OPTIONS.map(f => `family=${f.value.replace(/ /g, '+')}`).join('&')}&display=swap" id="et-all-fonts-preview">`;

        const options = FONT_OPTIONS.map(f => ({
            value: f.value,
            label: f.label,
            html: `<div class="et-dd-font-item" style="font-family: '${f.value}', sans-serif;">
                <span class="et-dd-font-name">${f.label}</span>
                <span class="et-dd-font-preview">The quick brown fox</span>
            </div>`
        }));

        return preloadLink + buildCustomDropdown('et_font_family_custom', options, currentValue);
    }

    function initCustomDropdowns() {
        // Bind all custom dropdowns in the settings modal
        jQuery(document).on('click.et-dd', '.et-custom-dropdown .et-dd-trigger', function (e) {
            e.stopPropagation();
            const dd = jQuery(this).closest('.et-custom-dropdown');
            const isOpen = dd.hasClass('et-dd-open');

            // Close all other dropdowns
            jQuery('.et-custom-dropdown').not(dd).removeClass('et-dd-open');

            dd.toggleClass('et-dd-open', !isOpen);
        });

        jQuery(document).on('click.et-dd', '.et-custom-dropdown .et-dd-option', function (e) {
            e.stopPropagation();
            const option = jQuery(this);
            const dd = option.closest('.et-custom-dropdown');
            const value = option.data('value');
            const ddId = dd.attr('id');

            // Update selected state
            dd.find('.et-dd-option').removeClass('et-dd-selected');
            option.addClass('et-dd-selected');

            // Update display
            dd.find('.et-dd-display').html(option.html());
            dd.attr('data-value', value);
            dd.removeClass('et-dd-open');

            // Fire change event
            if (ddId === 'et_theme_custom') {
                settings.theme = value;
                updateThemePreview();
                applyAppearanceSettings();
                saveSettings();
            } else if (ddId === 'et_font_family_custom') {
                settings.fontFamily = value;
                applyAppearanceSettings();
                saveSettings();
            }
        });

        // Close dropdowns when clicking outside
        jQuery(document).on('click.et-dd', function (e) {
            if (!jQuery(e.target).closest('.et-custom-dropdown').length) {
                jQuery('.et-custom-dropdown').removeClass('et-dd-open');
            }
        });
    }

    function updateCustomDropdown(ddId, value) {
        const dd = jQuery(`#${ddId}`);
        if (!dd.length) return;
        const option = dd.find(`.et-dd-option[data-value="${value}"]`);
        if (option.length) {
            dd.find('.et-dd-option').removeClass('et-dd-selected');
            option.addClass('et-dd-selected');
            dd.find('.et-dd-display').html(option.html());
            dd.attr('data-value', value);
        }
    }
    // Settings Modal extracted to lib/settings-modal.js


    // ============================================================
    // CONFIRM MODAL
    // ============================================================

    function showConfirmModal(message) {
        return new Promise((resolve) => {
            jQuery('#et-confirm-modal').remove();

            const html = `
            <div id="et-confirm-modal" class="et-confirm-overlay">
                <div class="et-confirm-card">
                    <div class="et-confirm-icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
                    <div class="et-confirm-message">${message}</div>
                    <div class="et-confirm-actions">
                        <button class="et-confirm-btn et-confirm-cancel" id="et-confirm-cancel">Cancel</button>
                        <button class="et-confirm-btn et-confirm-ok" id="et-confirm-ok">Clear</button>
                    </div>
                </div>
            </div>`;

            // Inject into the panel so it stays bounded by the panel's size and border-radius
            const panel = jQuery('#et-panel');
            panel.append(html);
            requestAnimationFrame(() => jQuery('#et-confirm-modal').addClass('et-confirm-visible'));

            const cleanup = (result) => {
                const overlay = jQuery('#et-confirm-modal');
                overlay.removeClass('et-confirm-visible');
                setTimeout(() => overlay.remove(), 200);
                document.removeEventListener('keydown', onKey);
                resolve(result);
            };

            jQuery('#et-confirm-ok').on('click', () => cleanup(true));
            jQuery('#et-confirm-cancel').on('click', () => cleanup(false));
            jQuery('#et-confirm-modal').on('click', function (e) { if (e.target === this) cleanup(false); });

            const onKey = (e) => {
                if (e.key === 'Escape') cleanup(false);
                if (e.key === 'Enter') cleanup(true);
            };
            document.addEventListener('keydown', onKey);
        });
    }

    // ============================================================
    // MEMORY SYSTEM — THIN WRAPPERS
    // ============================================================

    function buildInsideJokesContext() {
        if (!memorySystem) return '';
        return memorySystem.buildInsideJokesContext();
    }

    /**
     * Walk all text nodes inside `element`, find the first occurrence of
     * `searchStr`, and wrap it with a styled <mark> tag for memory highlighting.
     */
    function _highlightTextNode(element, searchStr, category, label, style) {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while ((node = walker.nextNode())) {
            const idx = node.nodeValue.indexOf(searchStr);
            if (idx === -1) continue;
            const before = node.nodeValue.substring(0, idx);
            const after  = node.nodeValue.substring(idx + searchStr.length);
            const mark   = document.createElement('mark');
            mark.className = `et-mem-highlight et-mem-hl-${style}`;
            mark.dataset.etAction = 'memory-highlight';
            mark.dataset.memCategory = category;
            mark.dataset.memLabel    = label;
            mark.dataset.memContent  = searchStr;
            mark.textContent = searchStr;
            const parent = node.parentNode;
            if (before) parent.insertBefore(document.createTextNode(before), node);
            parent.insertBefore(mark, node);
            if (after)  parent.insertBefore(document.createTextNode(after),  node);
            parent.removeChild(node);
            return true; // first occurrence only
        }
        return false;
    }

    /**
     * Apply memory highlight marks to the first text (data-et-role="text") in `bubbleEl`
     * for the given message's highlight candidates.
     */
    function applyMemoryHighlights(bubbleEl, msg) {
        if (!bubbleEl || !msg.memoryHighlights || !msg.memoryHighlights.length) return;
        const style      = (settings.memoryHighlightStyle || 'underline');
        const bubbleText = bubbleEl.find('[data-et-role~="text"]')[0];
        if (!bubbleText) return;
        msg.memoryHighlights.forEach(function (hl) {
            try { _highlightTextNode(bubbleText, hl.text, hl.category, hl.label, style); } catch (e) { /* ignore */ }
        });
    }

    /**
     * Update the highlight style class on existing marks live (called when the
     * user changes their preferred highlight style in settings).
     */
    function updateMemoryHighlightStyleInPanel(newStyle) {
        const allStyles = ['et-mem-hl-underline', 'et-mem-hl-glow', 'et-mem-hl-shimmer', 'et-mem-hl-border'];
        jQuery('#et-messages-inner .et-mem-highlight').each(function () {
            const el = jQuery(this);
            el.removeClass(allStyles.join(' '));
            el.addClass('et-mem-hl-' + newStyle);
        });
    }

    const _MEM_CATEGORY_LABELS = {
        inside_joke:    'Inside Joke',
        person:         'Important Person',
        hobby:          'Hobby / Interest',
        favorite_thing: 'Favorite Thing',
        shared_moment:  'Shared Moment',
        custom:         'Custom'
    };

    /**
     * Show the "Save as Memory?" glassmorphism modal when a user clicks a
     * highlighted memory span.
     */
    function showMemorySaveModal(el) {
        const $el     = jQuery(el);
        const category = $el.data('mem-category') || 'custom';
        const label    = $el.data('mem-label')    || '';
        const content  = $el.data('mem-content')  || $el.text();

        jQuery('#et-mem-save-modal').remove();
        jQuery('#et-mem-save-modal-overlay').remove();

        const { DOMPurify } = SillyTavern.libs;
        const safeContent   = DOMPurify.sanitize(content, { ALLOWED_TAGS: [] });
        const safeLabelHint = DOMPurify.sanitize(label,   { ALLOWED_TAGS: [] }); // used as placeholder only

        // Pill scope toggle — always defaults to per-character
        const charNameFn = window._etGetCharacterName;
        const charName   = typeof charNameFn === 'function' ? charNameFn() : null;
        const safeCharName = DOMPurify.sanitize(charName || 'Character', { ALLOWED_TAGS: [] });

        const scopePillHtml = `
            <div class="et-mem-scope-pill-wrap">
                <button class="et-mem-scope-seg et-mem-scope-seg-active" data-scope="per-character" type="button">
                    <i class="fa-solid fa-user"></i> ${safeCharName}
                </button>
                <button class="et-mem-scope-seg" data-scope="global" type="button">
                    <i class="fa-solid fa-globe"></i> Global
                </button>
            </div>`;

        const catOptions = Object.entries(_MEM_CATEGORY_LABELS).map(([k, v]) =>
            `<option value="${k}"${k === category ? ' selected' : ''}>${v}</option>`
        ).join('');

        const html = `
        <div id="et-mem-save-modal-overlay" class="et-mem-save-modal-overlay"></div>
        <div id="et-mem-save-modal" class="et-mem-save-modal">
            <div class="et-mem-save-header">
                <i class="fa-solid fa-brain"></i>
                <span>Save as Memory?</span>
            </div>
            <div class="et-mem-save-snippet">${safeContent}</div>
            ${scopePillHtml}
            <div class="et-mem-save-fields">
                <div class="et-select-wrapper">
                    <select class="et-select et-mem-save-category">${catOptions}</select>
                    <i class="fa-solid fa-chevron-down et-select-arrow"></i>
                </div>
                <input type="text" class="et-input-text et-mem-save-label" value="" placeholder="${safeLabelHint || 'Give it a name (optional)'}">
            </div>
            <label class="et-mem-form-pin-row" style="margin:10px 0 4px;">
                <input type="checkbox" class="checkbox et-mem-save-pin">
                <span><i class="fa-solid fa-thumbtack"></i> Pin — always inject this memory</span>
            </label>
            <div class="et-mem-save-actions">
                <button class="et-mem-save-btn et-mem-save-btn-save" id="et-mem-save-confirm" type="button">
                    <i class="fa-solid fa-check"></i> Save Memory
                </button>
                <button class="et-mem-save-btn et-mem-save-btn-dismiss" id="et-mem-save-dismiss" type="button">
                    Dismiss
                </button>
            </div>
        </div>`;

        const panel = jQuery('#et-panel');
        panel.append(html);
        requestAnimationFrame(() => jQuery('#et-mem-save-modal').addClass('et-mem-save-modal-open'));

        // Pill scope toggle
        jQuery('#et-mem-save-modal').on('click', '.et-mem-scope-seg', function () {
            jQuery('#et-mem-save-modal .et-mem-scope-seg').removeClass('et-mem-scope-seg-active');
            jQuery(this).addClass('et-mem-scope-seg-active');
        });

        function closeModal() {
            const modal   = jQuery('#et-mem-save-modal');
            const overlay = jQuery('#et-mem-save-modal-overlay');
            modal.removeClass('et-mem-save-modal-open');
            setTimeout(() => { modal.remove(); overlay.remove(); }, 220);
        }

        jQuery('#et-mem-save-confirm').on('click', function () {
            const cat         = jQuery('#et-mem-save-modal .et-mem-save-category').val();
            const lbl         = jQuery('#et-mem-save-modal .et-mem-save-label').val().trim();
            const pin         = jQuery('#et-mem-save-modal .et-mem-save-pin').is(':checked');
            const chosenScope = jQuery('#et-mem-save-modal .et-mem-scope-seg-active').data('scope') || 'per-character';
            if (memorySystem) {
                const saved = memorySystem.addMemory({ category: cat, label: lbl, content: content, pinned: pin, scope: chosenScope });
                if (saved) {
                    $el.attr('data-mem-id', saved.id).attr('data-mem-scope', chosenScope);
                }
            }
            $el.addClass('et-mem-highlight-saved');
            // Refresh open memory lists
            if (settingsModal && typeof settingsModal.renderMemoryListInto === 'function') {
                settingsModal.renderMemoryListInto('#et_memory_list',       '#et_memory_empty',       '#et_memory_list_label');
                settingsModal.renderMemoryListInto('#et_memory_list_panel', '#et_memory_empty_panel', '#et_memory_list_label_panel');
            }
            toastr.success('Memory saved!');
            closeModal();
        });

        jQuery('#et-mem-save-dismiss').on('click', closeModal);
        jQuery('#et-mem-save-modal-overlay').on('click', closeModal);

        // Escape key
        const onKey = (e) => { if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); closeModal(); } };
        document.addEventListener('keydown', onKey);
    }

    /**
     * Show a small "Remove Memory?" modal when the user re-clicks a saved highlight.
     */
    function showMemoryRemoveModal(el) {
        const $el     = jQuery(el);
        const memId   = $el.attr('data-mem-id') || null;
        const content = $el.data('mem-content') || $el.text();

        jQuery('#et-mem-save-modal').remove();
        jQuery('#et-mem-save-modal-overlay').remove();

        const { DOMPurify } = SillyTavern.libs;
        const safeContent = DOMPurify.sanitize(content, { ALLOWED_TAGS: [] });

        const html = `
        <div id="et-mem-save-modal-overlay" class="et-mem-save-modal-overlay"></div>
        <div id="et-mem-save-modal" class="et-mem-save-modal">
            <div class="et-mem-save-header">
                <i class="fa-solid fa-circle-check" style="color:#4ade80;"></i>
                <span>Memory Saved</span>
            </div>
            <div class="et-mem-save-snippet">${safeContent}</div>
            <div class="et-mem-remove-hint">This phrase is already saved as a memory. Would you like to remove it?</div>
            <div class="et-mem-save-actions">
                <button class="et-mem-save-btn et-mem-save-btn-remove" id="et-mem-remove-confirm" type="button">
                    <i class="fa-solid fa-trash-can"></i> Remove Memory
                </button>
                <button class="et-mem-save-btn et-mem-save-btn-dismiss" id="et-mem-save-dismiss" type="button">
                    Keep It
                </button>
            </div>
        </div>`;

        jQuery('#et-panel').append(html);
        requestAnimationFrame(() => jQuery('#et-mem-save-modal').addClass('et-mem-save-modal-open'));

        function closeModal() {
            const modal   = jQuery('#et-mem-save-modal');
            const overlay = jQuery('#et-mem-save-modal-overlay');
            modal.removeClass('et-mem-save-modal-open');
            setTimeout(() => { modal.remove(); overlay.remove(); }, 220);
        }

        jQuery('#et-mem-remove-confirm').on('click', function () {
            if (memorySystem && memId) {
                memorySystem.deleteMemory(memId);
            }
            $el.removeClass('et-mem-highlight-saved').removeAttr('data-mem-id').removeAttr('data-mem-scope');
            if (settingsModal && typeof settingsModal.renderMemoryListInto === 'function') {
                settingsModal.renderMemoryListInto('#et_memory_list',       '#et_memory_empty',       '#et_memory_list_label');
                settingsModal.renderMemoryListInto('#et_memory_list_panel', '#et_memory_empty_panel', '#et_memory_list_label_panel');
            }
            toastr.success('Memory removed.');
            closeModal();
        });

        jQuery('#et-mem-save-dismiss').on('click', closeModal);
        jQuery('#et-mem-save-modal-overlay').on('click', closeModal);
        const onKey = (e) => { if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); closeModal(); } };
        document.addEventListener('keydown', onKey);
    }

    /**
     * Opens the memory save modal triggered manually from the message dot-menu.
     * Unlike showMemorySaveModal (which operates on a highlight element), this
     * takes the raw message text and lets the user categorise and save it freely.
     * @param {string} messageText - raw user message text
     */
    function showManualMemorySaveModal(messageText) {
        if (!messageText || !messageText.trim()) return;

        jQuery('#et-mem-save-modal').remove();
        jQuery('#et-mem-save-modal-overlay').remove();

        const { DOMPurify } = SillyTavern.libs;
        const content     = messageText.trim();
        // Trim to 300 chars as a sensible default for the editable field
        const snippetText = content.length > 300 ? content.substring(0, 300) : content;

        const charNameFn   = window._etGetCharacterName;
        const charName     = typeof charNameFn === 'function' ? charNameFn() : null;
        const safeCharName = DOMPurify.sanitize(charName || 'Character', { ALLOWED_TAGS: [] });

        const scopePillHtml = `
            <div class="et-mem-scope-pill-wrap">
                <button class="et-mem-scope-seg et-mem-scope-seg-active" data-scope="per-character" type="button">
                    <i class="fa-solid fa-user"></i> ${safeCharName}
                </button>
                <button class="et-mem-scope-seg" data-scope="global" type="button">
                    <i class="fa-solid fa-globe"></i> Global
                </button>
            </div>`;

        const catOptions = Object.entries(_MEM_CATEGORY_LABELS).map(([k, v]) =>
            `<option value="${k}"${k === 'custom' ? ' selected' : ''}>${v}</option>`
        ).join('');

        const html = `
        <div id="et-mem-save-modal-overlay" class="et-mem-save-modal-overlay"></div>
        <div id="et-mem-save-modal" class="et-mem-save-modal">
            <div class="et-mem-save-header">
                <i class="fa-solid fa-brain"></i>
                <span>Add Memory</span>
            </div>
            <textarea id="et-mem-save-content-edit" class="et-mem-save-snippet et-mem-save-snippet-edit" rows="4" spellcheck="false" placeholder="Edit to keep just what matters..."></textarea>
            ${scopePillHtml}
            <div class="et-mem-save-fields">
                <div class="et-select-wrapper">
                    <select class="et-select et-mem-save-category">${catOptions}</select>
                    <i class="fa-solid fa-chevron-down et-select-arrow"></i>
                </div>
                <input type="text" class="et-input-text et-mem-save-label" value="" placeholder="Give it a name (optional)">
            </div>
            <label class="et-mem-form-pin-row" style="margin:10px 0 4px;">
                <input type="checkbox" class="checkbox et-mem-save-pin">
                <span><i class="fa-solid fa-thumbtack"></i> Pin — always inject this memory</span>
            </label>
            <div class="et-mem-save-actions">
                <button class="et-mem-save-btn et-mem-save-btn-save" id="et-mem-save-confirm" type="button">
                    <i class="fa-solid fa-check"></i> Save Memory
                </button>
                <button class="et-mem-save-btn et-mem-save-btn-dismiss" id="et-mem-save-dismiss" type="button">
                    Dismiss
                </button>
            </div>
        </div>`;

        const panel = jQuery('#et-panel');
        panel.append(html);
        // Set textarea value via JS (not innerHTML) to preserve special characters safely
        jQuery('#et-mem-save-content-edit').val(snippetText);
        requestAnimationFrame(() => jQuery('#et-mem-save-modal').addClass('et-mem-save-modal-open'));

        jQuery('#et-mem-save-modal').on('click', '.et-mem-scope-seg', function () {
            jQuery('#et-mem-save-modal .et-mem-scope-seg').removeClass('et-mem-scope-seg-active');
            jQuery(this).addClass('et-mem-scope-seg-active');
        });

        function closeModal() {
            const modal   = jQuery('#et-mem-save-modal');
            const overlay = jQuery('#et-mem-save-modal-overlay');
            modal.removeClass('et-mem-save-modal-open');
            setTimeout(() => { modal.remove(); overlay.remove(); }, 220);
        }

        jQuery('#et-mem-save-confirm').on('click', function () {
            const saveContent = jQuery('#et-mem-save-content-edit').val().trim();
            if (!saveContent) { toastr.warning('Memory content cannot be empty.'); return; }
            const cat         = jQuery('#et-mem-save-modal .et-mem-save-category').val();
            const lbl         = jQuery('#et-mem-save-modal .et-mem-save-label').val().trim();
            const pin         = jQuery('#et-mem-save-modal .et-mem-save-pin').is(':checked');
            const chosenScope = jQuery('#et-mem-save-modal .et-mem-scope-seg-active').data('scope') || 'per-character';
            if (memorySystem) {
                memorySystem.addMemory({ category: cat, label: lbl, content: saveContent, pinned: pin, scope: chosenScope });
            }
            if (settingsModal && typeof settingsModal.renderMemoryListInto === 'function') {
                settingsModal.renderMemoryListInto('#et_memory_list',       '#et_memory_empty',       '#et_memory_list_label');
                settingsModal.renderMemoryListInto('#et_memory_list_panel', '#et_memory_empty_panel', '#et_memory_list_label_panel');
            }
            toastr.success('Memory saved!');
            closeModal();
        });

        jQuery('#et-mem-save-dismiss').on('click', closeModal);
        jQuery('#et-mem-save-modal-overlay').on('click', closeModal);
        const onKey = (e) => { if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); closeModal(); } };
        document.addEventListener('keydown', onKey);
    }

    // ============================================================
    // SAVE/LOAD MODAL — THIN WRAPPERS
    // ============================================================

    function openSaveLoadModal() {
        if (saveLoadModal) saveLoadModal.openSaveLoadModal();
        moveModalToPortal('#et-sl-overlay');
    }

    // ============================================================
    // MASTER TOGGLE
    // ============================================================

    function toggleEchoTextMaster() {
        const fab = jQuery('#et-fab');
        if (settings.enabled) {
            fab.removeClass('et-fab-disabled');
        } else {
            fab.addClass('et-fab-disabled');
            if (panelOpen) closePanel();
        }
    }

    // ============================================================
    // INITIALIZATION
    // ============================================================

    async function initEchoText() {
        log('Initializing EchoText...');

        try {
            const resp = await fetch(`${BASE_URL}/settings.html`);
            if (resp.ok) {
                const html = await resp.text();
                jQuery('#extensions_settings').append(html);
            }
        } catch (err) {
            error('Failed to load settings.html:', err);
        }

        emotionSystem = window.EchoTextEmotionSystem.createEmotionSystem({
            getSettings: () => settings,
            saveSettings,
            getCharacterKey,
            getCharacterName,
            getChatHistory: getEmotionHistory,
            isPanelOpen,
            isMobileDevice,
            onEmotionStateUpdated: ({ dominant, dominantChanged }) => {
                if (!panelOpen) return;
                updatePanelStatusRow();
                if (dominantChanged) {
                    requestAnimationFrame(() => {
                        const chip = document.querySelector('.et-status-chip-emotion');
                        if (!chip) return;
                        chip.style.setProperty('--dominant-shift-color', dominant.color);
                        chip.classList.remove('et-dominant-shift');
                        void chip.offsetWidth; // force reflow
                        chip.classList.add('et-dominant-shift');
                    });
                }
            }
        });

        settingsModal = window.EchoTextSettingsModal.createSettingsModal({
            getSettings: () => settings,
            saveSettings,
            getThemePresets: () => getAllThemePresets(),
            applySettingsToUI,
            applyAppearanceSettings,
            populateConnectionProfiles,
            fetchOllamaModels,
            fetchMultimodalModels,
            initCustomDropdowns,
            initCustomDropdownPanel,
            toggleEchoTextMaster,
            updateProviderVisibility,
            updateProviderVisibilityPanel,
            updateImageGenerationVisibility,
            getChatHistory,
            renderMessages,
            isPanelOpen,
            setEmotionMode,
            refreshProactiveInsights,
            updateProactiveToggleButtons,
            startProactiveScheduler,
            triggerTestProactiveMessage,
            applyActivityMode,
            positionFab,
            buildThemeDropdownHtml,
            buildFontDropdownHtml,
            loadGoogleFont,
            updatePanelStatusRow,
            openThemeEditor: () => { if (themeEditor) themeEditor.openThemeEditor(); moveModalToPortal('#et-theme-editor-overlay'); },
            renderStripTagChips,
            renderCustomPatternRows,
            invalidateStripTagsCache
        });

        themeEditor = window.EchoTextThemeEditor.createThemeEditor({
            getSettings: () => settings,
            saveSettings,
            applyAppearanceSettings,
            // Rebuilds the theme dropdown in all open UI surfaces after custom theme changes.
            refreshThemeDropdown: () => {
                const current = settings.theme;
                jQuery('#et_theme_panel_container').html(buildThemeDropdownHtml(current));
                // Use a scoped selector so we target only the settings modal's dropdown,
                // not the panel-drawer's #et_theme_custom which was just rebuilt above.
                const ddModal = jQuery('.et-settings-modal #et_theme_custom');
                if (ddModal.length) {
                    ddModal.closest('.et-field').html(
                        '<label class="et-field-label"><i class="fa-solid fa-swatchbook"></i> Theme</label>' +
                        buildThemeDropdownHtml(current) +
                        '<button class="et-te-open-btn" id="et-te-open-btn-modal" title="Create and manage custom colour themes">' +
                        '<i class="fa-solid fa-wand-magic-sparkles"></i> Edit Custom Themes</button>'
                    );
                    // Re-bind the button inside the re-rendered field
                    jQuery('.et-settings-modal #et-te-open-btn-modal').on('click', function () {
                        if (themeEditor) themeEditor.openThemeEditor();
                        moveModalToPortal('#et-theme-editor-overlay');
                    });
                }
                updateThemePreview();
            },
            onThemeListChanged: () => {
                // Re-apply in case active theme was mutated
                applyAppearanceSettings();
            }
        });

        memorySystem = window.EchoTextMemorySystem.createMemorySystem({
            getSettings: () => settings,
            saveSettings,
            getCharacterKey
        });

        // Expose character accessor helpers for the settings-modal memory UI
        window._etGetCharacterKey  = getCharacterKey;
        window._etGetCharacterName = getCharacterName;
        // Expose live highlight style updater for settings-modal delegation
        window._etUpdateMemoryHlStyle = updateMemoryHighlightStyleInPanel;

        saveLoadModal = window.EchoTextSaveLoadModal.createSaveLoadModal({
            getSettings: () => settings,
            saveSettings,
            getCharacterKey,
            getCharacterName,
            getChatHistory,
            saveChatHistory,
            renderMessages,
            getEmotionSnapshot,
            isPanelOpen,
            isGroupSession: () => groupManager ? groupManager.isGroupSession() : false,
            captureGroupSnapshot: () => groupManager ? groupManager.captureGroupSnapshot(settings) : null,
            restoreGroupSnapshot: (snap) => { if (groupManager) groupManager.restoreGroupSnapshot(snap, settings); },
            isCombineMode: () => groupManager ? groupManager.isCombineMode() : false,
            getCurrentGroupId: () => groupManager ? groupManager.getCurrentGroupId() : null
        });

        imageGeneration = window.EchoTextImageGeneration.createImageGeneration({
            getSettings,
            getCurrentCharacter,
            getCharacterName,
            getCharacterKey,
            getUserName,
            requestSillyTavernImageGeneration,
            requestEchoTextCompletion,
            saveSettings,
            log,
            warn
        });

        characterPicker = window.EchoTextCharacterPicker.createCharacterPicker({
            getSettings: getSettings,
            saveSettings,
            escapeHtml,
            getCharacterKey,
            getGroupManager: () => groupManager,
            applySelectedCharacterToPanel,
            setSelectedCharacterKey: (key) => {
                // A reply pending for the previous character would go to the new one
                if (key !== selectedCharacterKey) cancelScheduledReply();
                selectedCharacterKey = key;
                if (key) {
                    settings.lastCharacterKey = key;
                    saveSettings();
                }
            },
            getSelectedCharacterKey: () => selectedCharacterKey,
            isPanelOpen: () => panelOpen,
            isMobileDevice: () => isMobileDevice(),
            renderGroupUnreadIndicators: () => { if (typeof renderGroupUnreadIndicators === 'function') renderGroupUnreadIndicators(); },
            getSwitchGroupCharFn: () => (typeof switchGroupChar === 'function' ? switchGroupChar : null),
            getOnCombineModeToggleFn: () => (typeof onCombineModeToggle === 'function' ? onCombineModeToggle : null),
            getTriggerManualCombineCharFn: () => (typeof triggerManualCombineChar === 'function' ? triggerManualCombineChar : null)
        });

        gallery = window.EchoTextGallery.createGallery({
            getSettings,
            saveSettings,
            getCurrentCharacter,
            getCharacterKey,
            getCharacterName,
            getAvatarUrlForCharacter,
            openGeneratedImageLightbox
        });

        groupManager = window.EchoTextGroupManager.createGroupManager({
            getSettings: () => settings,
            saveSettings
        });

        proactiveMessaging = window.EchoTextProactiveMessaging.createProactiveMessaging({
            getSettings: () => settings,
            saveSettings,
            warn,
            getCurrentCharacter,
            getCharacterKey,
            getUserName,
            getActiveFeatures,
            getChatHistory,
            saveChatHistory,
            renderMessages,
            setTypingIndicatorVisible,
            setFabUnreadIndicator,
            getEmotionState,
            readReply,
            noteMoodReport,
            findLastUserMessageIndex,
            requestEchoTextCompletion,
            buildApiMessagesFromHistory,
            buildApiMessagesFromHistoryForChar,
            // Exposes image-request detection so proactive messaging can also hide
            // image-triggering user messages from the character's context window.
            detectImageRequest: (msg, hist) => imageGeneration
                ? imageGeneration.detectImageRequest(msg, hist)
                : { triggered: false },
            expandTimeDateMacros,
            replaceMacros,
            isPanelOpen,
            getIsGenerating,
            // Group session helpers for multi-character proactive scheduling
            isGroupSession: () => groupManager ? groupManager.isGroupSession() : false,
            getActiveGroupCharKey: () => groupManager ? groupManager.getActiveCharKey() : null,
            getGroupMemberKeys: () => groupManager ? groupManager.getGroupMemberKeys() : [],
            getGroupMemberByKey: (key) => groupManager ? groupManager.getGroupMemberByKey(key) : null,
            markGroupCharUnread: (key) => {
                if (groupManager && groupManager.markGroupCharUnread) {
                    groupManager.markGroupCharUnread(key);
                    renderGroupUnreadIndicators();
                }
            },
            // Combined mode flag and group-scoped history accessors.
            // These allow the proactive scheduler to read/write the correct
            // history store regardless of session type.
            isCombineMode:        () => groupManager ? groupManager.isCombineMode()          : false,
            getCurrentGroupId:    () => groupManager ? groupManager.getCurrentGroupId()       : null,
            getGroupChatHistory:  (groupId, charKey) =>
                groupManager ? groupManager.getGroupChatHistory(groupId, charKey) : [],
            saveGroupChatHistory: (groupId, charKey, history) => {
                if (groupManager) groupManager.saveGroupChatHistory(groupId, charKey, history);
            },
            getCombineHistory:    (groupId) =>
                groupManager ? groupManager.getCombineHistory(groupId) : [],
            saveCombineHistory:   (groupId, history) => {
                if (groupManager) groupManager.saveCombineHistory(groupId, history);
            }
        });

        FA_REACTIONS = Features.REACTIONS;

        loadSettings();
        loadPersonasModule();

        // Inject mobile-specific stylesheet when running on a touch device.
        // Done AFTER loadSettings() so BASE_URL is guaranteed to be resolved.
        if (isMobileDevice() && !document.getElementById('et-mobile-styles')) {
            const mobileLink = document.createElement('link');
            mobileLink.rel  = 'stylesheet';
            mobileLink.id   = 'et-mobile-styles';
            mobileLink.href = `${BASE_URL}/mobile-style.css${VERSION_QUERY}`;
            document.head.appendChild(mobileLink);
        }

        startProactiveScheduler();

        jQuery('body').append(buildFabHtml());
        positionFab();
        makeFabDraggable();
        setFabUnreadIndicator(false);

        // Ensure the portal exists so the FAB is a sibling of <body>, not a
        // child. This escapes SillyTavern's mobile-styles.css rule:
        //   body { position: fixed; overflow: hidden; }
        // which would otherwise make position:fixed children mis-positioned.
        ensurePortal();
        const fabEl = document.getElementById('et-fab');
        if (fabEl) document.getElementById(ET_PORTAL_ID).appendChild(fabEl);

        jQuery('#et-fab').on('click', function () {
            if (fabDragging) return;
            if (panelOpen) closePanel();
            else openPanel();
        });

        jQuery(document).on('click', '#et-open-settings-btn', () => {
            settingsModal.openSettingsModal();
            moveModalToPortal('.et-settings-modal');
        });

        toggleEchoTextMaster();

        if (settings.enabled && settings.autoOpenOnReload && settings.panelWasOpen !== false) {
            openPanel();
        }

        // Setup a polling mechanism to auto-load the last character since CHAT_CHANGED may never fire
        // if SillyTavern starts without an active chat.
        if (settings.enabled && settings.autoLoadLastCharacter && settings.lastCharacterKey) {
            let loadAttempts = 0;
            const autoLoadInterval = setInterval(() => {
                loadAttempts++;
                const chars = getAllCharactersForPicker();
                if (chars && chars.length > 0) {
                    clearInterval(autoLoadInterval);
                    if (!selectedCharacterKey) {
                        const match = chars.find(c => c.__key === settings.lastCharacterKey);
                        if (match) {
                            selectedCharacterKey = settings.lastCharacterKey;
                            if (panelOpen) {
                                applySelectedCharacterToPanel();
                            }
                        }
                    }
                } else if (loadAttempts > 40) { // Give up after 10 seconds
                    clearInterval(autoLoadInterval);
                }
            }, 250);
        }

        const context = SillyTavern.getContext();

        _onChatChanged = async () => {
            cancelScheduledReply();
            if (!settings.enabled) return;

            closeCharacterPicker();

            // If EchoText already has an independent character or group selected, don't follow ST's change.
            // This allows the user to have a different character/group open in each app simultaneously.
            if (selectedCharacterKey) return;
            if (groupManager && groupManager.getOverrideGroupId() != null) return;

            // Reset group active char when chat changes so we re-select the first member
            if (groupManager) groupManager.setActiveCharKey(null);
            if (groupManager) groupManager.ensureActiveChar();

            const key = getCharacterKey();
            if (key) syncProactiveStateWithHistory(key, getChatHistory());
            if (panelOpen) {
                applySelectedCharacterToPanel();

                // Re-render group bar (shows for group chats, hidden for solo)
                if (groupManager) {
                    groupManager.renderGroupBar(groupManager.getActiveCharKey());
                    groupManager.bindGroupBarEvents(switchGroupChar, onCombineModeToggle, triggerManualCombineChar);
                }
            }
        };
        context.eventSource.on(context.event_types.CHAT_CHANGED, _onChatChanged);

        // Also listen for GROUP_UPDATED to refresh the bar if membership changes
        if (context.event_types.GROUP_UPDATED) {
            _onGroupUpdated = () => {
                if (panelOpen && groupManager) {
                    groupManager.renderGroupBar(groupManager.getActiveCharKey());
                    groupManager.bindGroupBarEvents(switchGroupChar, onCombineModeToggle, triggerManualCombineChar);
                }
            };
            context.eventSource.on(context.event_types.GROUP_UPDATED, _onGroupUpdated);
        }

        log('EchoText initialized successfully');

        // ── Live ST theme sync ──────────────────────────────────────────────
        // SillyTavern changes theme by calling setProperty() on
        // document.documentElement.style — there is no dedicated event.
        // We observe the 'style' attribute and re-sync whenever the sillytavern
        // preset is active, debounced so burst updates (ST sets ~10 props at once)
        // only trigger a single re-apply.
        let _stThemeSyncTimeout = null;
        new MutationObserver(() => {
            const theme = getAllThemePresets()[settings.theme] || THEME_PRESETS.sillytavern;
            if (theme.primary) return; // explicit ET theme — nothing to sync
            clearTimeout(_stThemeSyncTimeout);
            _stThemeSyncTimeout = setTimeout(() => {
                applySillyTavernThemeColors();
                applyAdaptiveGlass();
            }, 200);
        }).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    }

    function destroyEchoText() {
        const context = SillyTavern.getContext();
        if (context && context.eventSource) {
            if (_onChatChanged) {
                context.eventSource.removeListener(context.event_types.CHAT_CHANGED, _onChatChanged);
                _onChatChanged = null;
            }
            if (_onGroupUpdated && context.event_types.GROUP_UPDATED) {
                context.eventSource.removeListener(context.event_types.GROUP_UPDATED, _onGroupUpdated);
                _onGroupUpdated = null;
            }
        }
        if (proactiveMessaging && typeof proactiveMessaging.stopProactiveScheduler === 'function') {
            proactiveMessaging.stopProactiveScheduler();
        }
        removePortal();
    }

    // Register extension with SillyTavern
    function registerExtension() {
        const context = SillyTavern.getContext();
        if (context && context.extensionSettings) {
            if (!context.extensionSettings.echotext) {
                context.extensionSettings.echotext = {};
            }
        }
        // Clean up event listeners and portal on re-registration / hot-reload
        destroyEchoText();
    }

    // ============================================================
    // ENTRY POINT
    // ============================================================

    // Start using a resilient polling mechanism like Larson
    function startExtension() {
        if (typeof SillyTavern === 'undefined' || !SillyTavern.getContext) {
            setTimeout(startExtension, 500);
            return;
        }
        const context = SillyTavern.getContext();
        if (!context || !context.extensionSettings || !document.getElementById('extensions_settings')) {
            setTimeout(startExtension, 500);
            return;
        }

        try {
            registerExtension();
            initEchoText();
        } catch (error) {
            console.error('[EchoText] Initialization failed:', error);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startExtension);
    } else {
        startExtension();
    }

})();
