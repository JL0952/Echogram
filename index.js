// EchoText Extension - A floating text messaging panel for SillyTavern
// Uses SillyTavern.getContext() global pattern (no ES6 imports from ST internals)

(function () {
    'use strict';

    const MODULE_NAME = 'EchoText';
    const EXTENSION_NAME = 'EchoText';

    // BASE_URL and cache-buster from this file's own URL (SillyTavern loads it as a
    // module), so any install folder name works
    const ownUrl = new URL(import.meta.url);
    const BASE_URL = ownUrl.origin + ownUrl.pathname.split('/').slice(0, -1).join('/');
    let VERSION_QUERY = ownUrl.search;
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
    loadEchoTextModule('lib/daily-life.js', 'EchoTextDailyLife');
    loadEchoTextModule('lib/proactive-rounds.js', 'EchoTextProactiveRounds');
    loadEchoTextModule('lib/catch-up.js', 'EchoTextCatchUp');
    loadEchoTextModule('lib/character-data.js', 'EchoTextCharacterData');
    loadEchoTextModule('lib/emotion-system.js', 'EchoTextEmotionSystem');
    loadEchoTextModule('lib/proactive-messaging.js', 'EchoTextProactiveMessaging');
    loadEchoTextModule('lib/settings-modal.js', 'EchoTextSettingsModal');
    loadEchoTextModule('lib/memory-recall.js', 'EchoTextMemoryRecall');
    loadEchoTextModule('lib/chat-summaries.js', 'EchoTextChatSummaries');
    loadEchoTextModule('lib/memory-system.js', 'EchoTextMemorySystem');
    loadEchoTextModule('lib/saveload-modal.js', 'EchoTextSaveLoadModal');
    loadEchoTextModule('lib/group.js', 'EchoTextGroupManager');
    loadEchoTextModule('lib/image-generation.js', 'EchoTextImageGeneration');
    loadEchoTextModule('lib/gallery.js', 'EchoTextGallery');
    loadEchoTextModule('lib/character-picker.js', 'EchoTextCharacterPicker');
    loadEchoTextModule('lib/theme-editor.js', 'EchoTextThemeEditor');
    loadEchoTextModule('lib/rich-messages.js', 'EchoTextRichMessages');
    loadEchoTextModule('lib/features.js', 'EchoTextFeatures');
    loadEchoTextModule('lib/stickers.js', 'EchoTextStickers');
    loadEchoTextModule('lib/chat-view-model.js', 'EchoTextChatViewModel');
    loadEchoTextModule('lib/music-lookup.js', 'EchoTextMusicLookup');
    loadEchoTextModule('lib/story-texts.js', 'EchoTextStoryTexts');
    loadEchoTextModule('lib/social.js', 'EchoTextSocial');

    // Platform packs (platforms/<id>/platform.js), in menu order. Their scripts are
    // small and all load now; a pack's stylesheet loads only while it's in use.
    // EchoText's own look must load, the others are optional.
    const PLATFORM_IDS = ['echotext', 'wechat', 'instagram'];
    for (const id of PLATFORM_IDS) {
        try {
            if (!window.EchoTextPlatforms?.[id]) runEchoTextScript(`platforms/${id}/platform.js`);
        } catch (e) {
            if (id === 'echotext') throw e;
            console.error(`[EchoText] Failed to load platform '${id}':`, e);
        }
    }

    // Social account themes (social/<id>/theme.js); a theme's stylesheet loads only while its page is open
    const SOCIAL_THEME_IDS = ['x'];
    for (const id of SOCIAL_THEME_IDS) {
        try {
            if (!window.EchoTextSocialThemes?.[id]) runEchoTextScript(`social/${id}/theme.js`);
        } catch (e) {
            console.error(`[EchoText] Failed to load social theme '${id}':`, e);
        }
    }

    const RichMessages = window.EchoTextRichMessages;
    const Features = window.EchoTextFeatures;
    const Stickers = window.EchoTextStickers;
    const ChatViewModel = window.EchoTextChatViewModel;
    const ChatSummaries = window.EchoTextChatSummaries;
    const StoryTexts = window.EchoTextStoryTexts;
    const Social = window.EchoTextSocial;
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
    // The chat "typing" is for
    let typingTarget = null;
    // When set ('photo' | 'voice' | 'location' | 'transfer' | 'file' | 'link' | 'music'), the next message
    // the user sends is that kind of content and the typed text is its description / words / place / amount / song
    let composeMode = null;
    // Replying (feature 'reply'): { charKey, name, text } of the bubble picked, until the next send
    let replyDraft = null;
    // The kind of file the user shares (RichMessages.SHARE_TYPES), kept between shares
    let shareType = 'pdf';
    // Reply scheduling: the user can send several texts in a row and the character
    // answers once they pause (see scheduleCharacterReply)
    let replyTimer = null;
    // When you last typed in the box (an input method's composing too): text left there holds the reply
    let lastTypedAt = 0;
    let replyQueued = false;
    let replyInProgress = false;
    // The chat the generation under way is for (generatingHere)
    let generatingTarget = null;
    // Completion requests in flight — once the model is writing, a new user text
    // waits for a follow-up reply instead of cancelling it
    let activeCompletionRequests = 0;
    let hasUnreadCharacterMessage = false;
    let emotionSystem = null;
    let proactiveMessaging = null;
    let settingsModal = null;
    let memorySystem = null;
    // Shared songs' covers, looked up on iTunes (lib/music-lookup.js)
    let songArt = null;
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
            // Fixed fullscreen, tracking dynamic viewport (dvh/dvw). On a phone the max z-index;
            // on a computer above SillyTavern's top bar (3005, 4005 while one of its drawers is open)
            // We use color:initial and text-align:initial to ensureST defaults don't bleed in.
            portal.style.cssText = `position:fixed; top:0; left:0; width:100dvw; height:100dvh; z-index:${isMobileDevice() ? '2147483647' : '4010'}; pointer-events:none; display:block !important; border:none !important; margin:0 !important; padding:0 !important;`;
            
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
        // A second switch for proactive texts, always set with the first: one that was off stays off
        if (s.dynamicSystemsEnabled === false) s.proactiveMessagingEnabled = false;
        // Settings of removed features
        for (const key of window.EchoTextConfig.REMOVED_SETTINGS || []) delete s[key];
        if (s.savedChats) delete s.savedChats.untethered;
        if (!s.chatHistory || typeof s.chatHistory !== 'object' || Array.isArray(s.chatHistory)) {
            s.chatHistory = {};
        }
        if (!s.emotionState || typeof s.emotionState !== 'object' || Array.isArray(s.emotionState)) {
            s.emotionState = {};
        }
        if (!s.characterSchedules || typeof s.characterSchedules !== 'object' || Array.isArray(s.characterSchedules)) {
            s.characterSchedules = {};
        }
        if (!s.lifeState || typeof s.lifeState !== 'object' || Array.isArray(s.lifeState)) {
            s.lifeState = {};
        }
        if (!s.pendingReplies || typeof s.pendingReplies !== 'object' || Array.isArray(s.pendingReplies)) {
            s.pendingReplies = {};
        }
        if (!s.phoneOverrides || typeof s.phoneOverrides !== 'object' || Array.isArray(s.phoneOverrides)) {
            s.phoneOverrides = {};
        }
        // With you used to stay here once it was over and noted
        for (const [key, plan] of Object.entries(s.phoneOverrides)) if (plan?.noted) delete s.phoneOverrides[key];
        window.EchoTextMemorySystem?.moveLifeMemories(s);
        if (!s.chatMemories || typeof s.chatMemories !== 'object' || Array.isArray(s.chatMemories)) {
            s.chatMemories = {};
        }
        if (!s.characterNames || typeof s.characterNames !== 'object' || Array.isArray(s.characterNames)) {
            s.characterNames = {};
        }
        for (const field of ['socialAccounts', 'socialPosts', 'socialArchives']) {
            if (!s[field] || typeof s[field] !== 'object' || Array.isArray(s[field])) s[field] = {};
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
    function loadSettings() {
        settings = getSettings();
        applySettingsToUI();
        applyAppearanceSettings();
        bindPlatformSelects();
        // The switch in SillyTavern's extensions drawer
        jQuery('#et_enabled_quick').off('change.et').on('change.et', function () {
            settings.enabled = jQuery(this).is(':checked');
            saveSettings();
            toggleEchoTextMaster();
            jQuery('#et_enabled').prop('checked', settings.enabled);
        });
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
        jQuery('#et_daily_life').prop('checked', settings.dailyLifeEnabled === true);
        jQuery('#et_daily_life_made_up').prop('checked', settings.dailyLifeMadeUp === true);
        jQuery('#et_catch_up').prop('checked', settings.catchUpEnabled !== false);
        jQuery('#et_story_pause').prop('checked', settings.storyPauseEnabled !== false);
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
        jQuery('#et_ctx_main_chat').prop('checked', settings.ctxMainChat !== false);
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

        updateImageGenerationVisibility();
        populatePlatformSelects();
    }

    function updateProactiveToggleButtons() {
        const enabled = settings.proactiveMessagingEnabled !== false;

        const syncButton = (selector) => {
            const btn = jQuery(selector);
            if (!btn.length) return;
            btn.toggleClass('et-proactive-paused', !enabled);
            btn.find('i').attr('class', `fa-solid ${enabled ? 'fa-toggle-on' : 'fa-toggle-off'}`);
            btn.find('span').text(`Proactive: ${enabled ? 'Enabled' : 'Paused'}`);
        };

        syncButton('#et_proactive_toggle');
        window.EchoTextSettingsModal?.syncDependentControls(settings);
    }

    function updateImageGenerationVisibility() {
        const imgEnabled = settings.imageGenerationEnabled === true;
        const hasChar = !!getCurrentCharacter();
        const inGroup = groupManager && groupManager.isGroupSession();
        jQuery('#et_image_generation_plugin_notice').toggle(imgEnabled);
        jQuery('#et-overflow-gallery').toggle(imgEnabled && hasChar && !inGroup);
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
        // The font and its size change where lines break
        queueFitTexts();

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
        closeSocial();
        closeMenus();

        // ── Combine mode: show all members in header ──────────────────
        if (groupManager && groupManager.isGroupSession() && groupManager.isCombineMode()) {
            const members = groupManager.getGroupMembers();
            const charNames = members.map(c => c.name).join(', ');
            jQuery('#et-panel-drag-handle').removeClass('et-panel-header-no-char');
            jQuery('#et-panel').removeClass('et-panel-no-char');
            jQuery('#et-char-name').html(`Group: ${escapeHtml(charNames)}<i class="fa-solid fa-chevron-down et-char-name-caret" aria-hidden="true"></i>`);
            setInputPlaceholder(`Message all: ${charNames}...`);
            jQuery('#et-input').prop('disabled', false);
            jQuery('#et-send-btn, #et-attach-btn, #et-voice-btn, #et-photo-btn, #et-sticker-btn').prop('disabled', false);
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
        setInputPlaceholder(hasChar ? `Text ${charName}...` : 'Text a character...');
        jQuery('#et-input').prop('disabled', !hasChar);
        renderRecoverRows();
        jQuery('#et-send-btn, #et-attach-btn, #et-voice-btn, #et-photo-btn, #et-sticker-btn').prop('disabled', !hasChar);
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

    /** What the input says: the platform's own wording (Instagram's "Message...", none on WeChat), else `text`. */
    function inputPlaceholder(text) {
        const own = getActivePlatform().inputPlaceholder;
        return typeof own === 'string' ? own : text;
    }

    /**
     * Sets the input's placeholder from what it says without a platform's own ("Text Mira..."),
     * kept so a platform switch can word it again (onPlatformChoiceChanged).
     */
    /**
     * The field grows with what's typed, up to 92px; the bar is marked while it's past one
     * line (et-input-bar-tall), so a look can centre its send button on a one-line field
     * whatever that field's height and keep it at the bottom once it grows.
     */
    function fitInputHeight(el) {
        if (!el) return;
        el.style.height = 'auto';
        const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
        const tall = el.value !== '' && el.scrollHeight > lineHeight * 1.5;
        el.style.height = el.value === '' ? 'auto' : Math.min(el.scrollHeight + 2, 92) + 'px';
        jQuery(el).closest('[data-et-role~="input-bar"]').toggleClass('et-input-bar-tall', tall);
    }

    function setInputPlaceholder(text) {
        jQuery('#et-input').attr('placeholder', inputPlaceholder(text)).data('et-text-placeholder', text);
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
    function openCharacterPicker(centerInPanel = false) {
        closeMenus();
        characterPicker.openCharacterPicker(centerInPanel);
    }
    function openEmbeddedCharacterPicker() { characterPicker.openEmbeddedCharacterPicker(); }
    function closeCharacterPicker() { characterPicker.closeCharacterPicker(); }
    function toggleCharacterPicker() {
        if (!jQuery('#et-char-picker').length) closeMenus();
        characterPicker.toggleCharacterPicker();
    }
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
        // The username in the mood's place (still opening the emotion details)
        const username = settings.showUsername && getActivePlatform().username ? getCharacterUsername() : '';
        content.html(username
            ? `<span class="et-status-chip et-status-chip-username"><span class="et-status-main">${escapeHtml(username)}</span></span>`
            : emotionSystem ? emotionSystem.buildStatusRowHtml() : '');
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
        const verbosity = getCharacterVerbosity(charKey);
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

    /** A character's reply length: their own (Personality tab), else the default in the settings. */
    function getCharacterVerbosity(charKey) {
        return (charKey && settings.verbosityByCharacter?.[charKey]) || settings.verbosityDefault || 'medium';
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

    // The most texts a reply keeps, by its length: the prompt's range, two more at most
    const MAX_TEXTS = { short: 4, medium: 6, long: 9 };

    /** @param {Array} [history] - the chat the reply follows (the stored one when left out), for the memories */
    /**
     * The character's card (description, personality, scenario) and the world info, as the
     * Context page's switches allow, in <character_reference> tags so models treat them as
     * scoped reference data rather than content to reproduce; '' with none of them.
     * The chat's prompt and the social account's posts (lib/social.js) both use it.
     */
    async function buildCharacterReference(char, name) {
        // Support both V1 (top-level fields) and V2 (nested under char.data) card formats
        const charDescription = char.description || char.data?.description || '';
        const charPersonality  = char.personality  || char.data?.personality  || '';
        const charScenario     = char.scenario      || char.data?.scenario      || '';

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
        return charRefParts.length > 0 ? `<character_reference>\n${charRefParts.join('\n\n')}\n</character_reference>` : '';
    }

    async function buildSystemPrompt(targetCharOverride = null, history = null) {
        const { stable, live } = await buildPromptParts(targetCharOverride, history);
        return stable + live;
    }

    /**
     * The system prompt in two parts: what stays the same from one reply to the next, and
     * what doesn't (`live`). A provider's prompt cache only matches from the start of the
     * request up to the first thing that differs, so with what changes up front the chat
     * after it is never cached (see placeLiveContext). Without `verbosity` (a proactive text,
     * whose own instruction says how many) the reply length is left out. `scheduleFrom`: the
     * schedule starts that day instead of today (a catch-up, for the days it tells).
     * @returns {Promise<{ stable: string, live: string, maxTexts?: number }>} maxTexts: the most the reply keeps
     */
    async function buildPromptParts(targetCharOverride = null, history = null, { verbosity = true, scheduleFrom = null } = {}) {
        if (isCombinedGroupMode()) {
            const groupId = groupManager ? groupManager.getCurrentGroupId() : null;
            const combinedHistory = groupId ? groupManager.getCombineHistory(groupId) : [];
            return { stable: await buildCombinedSystemPrompt(targetCharOverride || getCurrentCharacter(), combinedHistory), live: '' };
        }

        const char = targetCharOverride || getCurrentCharacter();
        if (!char) return { stable: 'You are a helpful assistant. Reply concisely like in a text message.', live: '' };

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
        // (recency) of the context window. What stays the same comes first, so a
        // prompt cache holds:
        //
        //  1. IDENTITY   — who the character IS (primacy anchor)
        //  2. CHARACTER  — description, personality, scenario, persona, world info, the
        //                  character's usual schedule today and tomorrow (Daily Life),
        //                  plus the story opening and, where the request isn't split
        //                  (splitsLiveContext), the recent ST roleplay. Split, the roleplay
        //                  goes between the texts by time instead, so the model can tell
        //                  what came first and the story moving on changes nothing before it
        //  3. LOCK       — fiction frame + persona-lock reminder
        //  4. PERSONALITY — NSFW permission, texting style
        //  5. FORMAT     — texting-medium anchor, message format, the <life> rule
        //
        // Then what changes from reply to reply (`live`), closest to the reply:
        //
        //  6. MEMORY     — pinned memories and the ones the recent messages bring up
        //  7. DAILY LIFE — the day, date and time, and the line of their week they're in now
        //  8. FEELINGS   — the behavior block, and the reply length it moves a step
        //  9. MOOD       — Auto mode's rule, with the feelings as they stand
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
        const characterReference = await buildCharacterReference(char, name);
        if (characterReference) prompt += `\n\n${characterReference}`;
        // Daily Life: their usual schedule today and tomorrow, the same all day (where they are in it now is live)
        prompt += buildScheduleContext(name, scheduleFrom);

        // ── 2b. STORY BACKGROUND ─────────────────────────────────────────────────
        // The greeting establishes the setting, the relationship with the user and —
        // through the character's spoken lines — their voice; the recent ST roleplay
        // keeps replies consistent with what has actually happened.
        // Both are narrative prose, so they are framed as reference rather than text to continue.
        const userName = getUserName();
        const openingText = getEchoTextFirstMessage(char);
        if (openingText) {
            const openingUse = `This is how the roleplay between ${name} and ${userName} began. Treat its setting and relationships as established facts.`;
            prompt += `\n\n${openingUse} ${name}'s spoken lines in it show how ${name} talks — vocabulary, tone, attitude toward ${userName}, and speech quirks. It is reference material written as narrative prose: never continue it or copy its narration.\n<story_opening>\n${openingText}\n</story_opening>`;
        }
        const storyText = splitsLiveContext() ? '' : getSTStoryContext(char);
        if (splitsLiveContext() && getSTStoryMessages(char).length) {
            prompt += `\n\nThe roleplay's recent events are in the chat below, in <story_events>, where they happened between the texts: what comes after one happened after it. ${name} remembers all of this, and the text messages must stay consistent with it.`;
        }
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

        // ── 3. BEHAVIOUR LOCK ────────────────────────────────────────────────────
        // Fiction frame + persona-lock reminder.
        if (settings.antiRefusal === true) {
            prompt += '\n\n' + getPrompt('promptAntiRefusalFrame');
            prompt += `\n\n${getPrompt('promptTetheredReminder')}`;
        } else {
            prompt += `\n\n${getPrompt('promptTetheredNoFrame')}`;
        }

        // ── 4. PERSONALITY ───────────────────────────────────────────────────────
        // From the emotion popup: the NSFW permission and the character's own texting
        // style (Personality tab).
        const charKey = getCharacterKey();
        const behavior = buildBehaviorContext(char, getCharacterVerbosity(charKey));
        prompt += behavior.nsfw;
        prompt += buildTextingStyleContext(char);

        // ── 5. TEXTING FORMAT ────────────────────────────────────────────────────
        // With narrative story context in the prompt, models drift into roleplay
        // narration and move stage directions into brackets when asterisks are banned.
        // Stating the medium keeps every reply an actual text.
        const textingFormat = getPrompt('promptTextingFormat');
        if (textingFormat) prompt += '\n\n' + textingFormat;

        // ── 5b. MESSAGE FORMAT ───────────────────────────────────────────────────
        prompt += '\n\n' + buildMessageFormatPrompt(name, userName);

        // ── 5c. LIFE ─────────────────────────────────────────────────────────────
        // Daily Life: the hidden <life> line the model reports changes to the errands in.
        prompt += buildLifeRules(char);

        // ── 6. MEMORY ────────────────────────────────────────────────────────────
        // Pinned memories and the ones the recent messages bring up (lib/memory-recall.js).
        let live = buildMemoryContext(history || getChatHistory());

        // ── 7. DAILY LIFE ────────────────────────────────────────────────────────
        // The day, date and time, and where the character is in their week right now (lib/daily-life.js).
        live += buildDailyLifeContext(name);

        // ── 8. FEELINGS ──────────────────────────────────────────────────────────
        // How the Big Five and current feelings make them text (lib/texting-behavior.js),
        // which also moves the reply length a step.
        live += behavior.text;
        if (verbosity) live += '\n\n' + getVerbosityPrompt(behavior.verbosity);

        // ── 9. MOOD ──────────────────────────────────────────────────────────────
        // Auto mode: the hidden <mood> line the model reports changed feelings in, with
        // the feelings as they stand; readReply takes it out.
        live += buildMoodRules(char);

        return { stable: prompt, live, maxTexts: MAX_TEXTS[behavior.verbosity] || MAX_TEXTS.medium };
    }

    /**
     * Whether what changes goes after the chat. With a connection profile, yes: that's
     * where a remote provider's prompt cache is. Not on the default connection, which takes
     * no message list, or on Ollama and custom endpoints, whose local chat templates
     * often refuse a system message after the first.
     */
    function splitsLiveContext() {
        return settings.source === 'profile';
    }

    /**
     * A chat's messages as turns for the model, each with when it was sent: a message, and
     * your tapbacks on it right after.
     */
    function buildChatTurns(sent) {
        return sent.flatMap(msg => {
            // Strip thinking/reasoning tags from history messages before sending to context.
            // This prevents internal model reasoning blocks from inflating token budgets.
            // resolveHistoryMessageText also fills in a natural stub for silent image turns
            // so the model never sees an empty assistant response to a photo request.
            const time = Number(msg.send_date) || Date.parse(msg.send_date);
            const contextText = resolveHistoryMessageText(msg);
            const reactionText = buildUserReactionText(msg);
            return [
                ...(contextText !== null ? [{ role: msg.is_user ? 'user' : 'assistant', content: contextText, time }] : []),
                ...(reactionText ? [{ role: 'user', content: reactionText, time }] : []),
            ];
        });
    }

    /** The chat's turns as sent; split, with the story between them, and what to remind the model of then. */
    function buildChatMessages(sent, char, apart) {
        const turns = buildChatTurns(sent);
        const story = apart && char ? getSTStoryMessages(char) : [];
        if (!story.length) return { messages: turns.map(({ role, content }) => ({ role, content })), reminder: '' };
        const name = char.name || 'Character';
        return {
            messages: StoryTexts.weaveStory(turns, story),
            reminder: `${name} is texting ${getUserName()} by phone: reply only with the texts ${name} sends, in the usual format, never in the story's narrative prose.`,
        };
    }

    /**
     * Puts what changes from reply to reply after the chat, before the texts you've just
     * sent: next time the request is the same up to there. It says it isn't from you:
     * a profile's "strict" prompt post-processing turns it into a user message and merges
     * it with your texts.
     */
    function placeLiveContext(apiMessages, parts) {
        let at = apiMessages.length;
        while (at > 1 && apiMessages[at - 1].role === 'user') at--;
        const context = parts.filter(Boolean).map(part => part.trim()).join('\n\n');
        apiMessages.splice(at, 0, { role: 'system', content: `<context_for_this_reply>\nNot written by ${getUserName()}: never quote or answer it.\n\n${context}\n</context_for_this_reply>` });
    }

    /**
     * The reply-format rules the renderer depends on: each line is its own bubble,
     * plus the rules of each feature the platform supports (lib/features.js).
     * Built in code rather than kept as an editable prompt because it must match
     * lib/rich-messages.js exactly.
     */
    function buildMessageFormatPrompt(charName, userName) {
        const rules = Features.buildFeaturePrompts(getModelFeatures(), { charName, userName, reactionIds: getReactionIds(), stickerNames: getCharacterStickerNames() });
        // What every tag below shares, said once
        const tags = rules.length ? ` Each tag below goes on a line of its own too, as one of the texts. Write the texts and what goes inside the tags in the language of the conversation. Use a tag only when ${charName} really would — most replies need none. A tag from ${userName} is something they sent: respond to it.` : '';
        return [`MESSAGES: Put each text on its own line — every line reaches ${userName} as a separate message bubble. Only what ${charName} would actually send: never their unspoken thoughts.${tags}`, ...rules].join('\n');
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
    // Sent between the texts it leaves a chunk at a time, so a prompt cache holds
    const ST_STORY_CHUNK_MESSAGES = 10;
    const ST_STORY_CHUNK_CHARS = 2000;
    // For putting a stretch of it in a sentence (13a), where the start of it counts too
    const ST_STRETCH_MAX_MESSAGES = 60;
    const ST_STRETCH_MAX_CHARS = 16000;

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
     * story opening). Returns '' with the Main Chat setting off, or when the open ST chat
     * doesn't involve the character. With `from` and `until` (ms): only what was sent between them.
     */
    function getSTStoryContext(char, { from = null, until = null, maxMessages = ST_STORY_MAX_MESSAGES, maxChars = ST_STORY_MAX_CHARS } = {}) {
        if (settings.ctxMainChat === false) return '';
        try {
            const chat = SillyTavern.getContext().chat;
            if (!Array.isArray(chat) || !chat.length || !isCharInCurrentSTChat(char)) return '';

            const openingIdx = findSTOpeningIndex(char);
            const userName = getUserName();
            const lines = [];
            let budget = maxChars;

            for (let i = chat.length - 1; i >= 0 && lines.length < maxMessages; i--) {
                const msg = chat[i];
                if (!msg || msg.is_system || i === openingIdx) continue;
                if (from !== null && !(stMessageTime(msg) >= from && stMessageTime(msg) <= until)) continue;
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

    /**
     * The live ST roleplay to send between the texts (lib/story-texts.js), oldest first:
     * { speaker, text, time }. Skips what getSTStoryContext does. Empty when the open ST
     * chat doesn't involve the character, or with the Main Chat setting off.
     */
    function getSTStoryMessages(char) {
        if (settings.ctxMainChat === false) return [];
        try {
            const chat = SillyTavern.getContext().chat;
            if (!Array.isArray(chat) || !chat.length || !isCharInCurrentSTChat(char)) return [];
            const openingIdx = findSTOpeningIndex(char);
            const userName = getUserName();
            const story = chat.flatMap((msg, i) => {
                if (!msg || msg.is_system || i === openingIdx) return [];
                const text = cleanSTMessageText(msg.mes);
                return text ? [{ speaker: msg.is_user ? userName : (msg.name || char.name), text, time: stMessageTime(msg) }] : [];
            });
            return StoryTexts.storyWindow(story, { maxMessages: ST_STORY_MAX_MESSAGES, maxChars: ST_STORY_MAX_CHARS,
                chunkMessages: ST_STORY_CHUNK_MESSAGES, chunkChars: ST_STORY_CHUNK_CHARS });
        } catch (e) {
            return [];
        }
    }

    /** When a message of the ST chat was sent, in ms; NaN when unknown. */
    function stMessageTime(msg) {
        const time = SillyTavern.getContext().timestampToMoment?.(msg.send_date);
        if (time?.isValid?.()) return time.valueOf();
        return typeof msg.send_date === 'number' ? msg.send_date : Date.parse(msg.send_date);
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

    // ============================================================
    // CHAT HISTORY MANAGEMENT
    // ============================================================

    // A request belongs to the chat open when it started (its target), whatever is open
    // when it answers: it reads and writes that chat, draws only while it's on screen, and
    // writes only while the last message it saw is still there (not cleared, replaced or
    // cut back meanwhile).

    /** The chat open now: a character's own { key }, or a group's { group, combine, key } (no key when combined); null without one. */
    function chatTarget() {
        if (groupManager && groupManager.isGroupSession()) {
            const group = groupManager.getCurrentGroup();
            if (!group) return null;
            const combine = !!groupManager.isCombineMode();
            const char = combine ? null : getCurrentCharacter();
            return { group: String(group.id), combine, key: char ? (char.avatar || char.name || 'unknown') : null };
        }
        const key = getCharacterKey();
        return key ? { group: null, combine: false, key } : null;
    }

    /** A character's own chat as a target. */
    function soloTarget(key) {
        return { group: null, combine: false, key };
    }

    /** Whether a target is the chat open now. */
    function isViewing(target) {
        const now = chatTarget();
        return !!target && !!now && now.group === target.group && now.combine === target.combine && now.key === target.key;
    }

    /** A target's chat as it is now with `reply` after it, while `anchor` (the last message the request saw) is in it; else null. */
    function withReply(target, anchor, reply) {
        const latest = getChatHistory(target);
        if (anchor && !latest.includes(anchor)) return null;
        return [...latest, reply];
    }

    function getChatHistory(target = chatTarget()) {
        if (!target || (target.group && !target.combine && !target.key)) return [];
        // The character whose greeting is left out: the one on screen, as ever, or the target's own
        const char = isViewing(target) ? getCurrentCharacter()
            : target.group ? (target.key ? groupManager.getGroupMemberByKey(target.key) : null) : getCharacterByKey(target.key);

        // ── Group session: use group-scoped, independent storage ──────────
        if (target.group) {
            // Combine mode: single shared history for the whole group
            if (target.combine) {
                return groupManager.getCombineHistory(target.group);
            }

            // Per-character history, scoped to this groupId
            if (!char) return [];
            const history = groupManager.getGroupChatHistory(target.group, target.key);

            // Filter out the character's first_mes
            const firstMes = char.first_mes ? char.first_mes.trim() : null;
            if (firstMes && history.length > 0) {
                return history.filter(msg => msg.is_user || (msg.mes || '').trim() !== firstMes);
            }
            return history;
        }

        // ── Solo session: original logic ──────────────────────────────────
        let history = settings.chatHistory[target.key] || [];

        // Filter out the character's first_mes to prevent it from appearing in EchoText
        const firstMes = (char && char.first_mes) ? char.first_mes.trim() : null;
        if (firstMes && history.length > 0) {
            history = history.filter(msg =>
                msg.is_user || (msg.mes || '').trim() !== firstMes
            );
        }

        return history;
    }

    function saveChatHistory(history, target = chatTarget()) {
        if (!target) return;
        // ── Group session: write to group-scoped storage ──────────────────
        if (target.group) {
            if (target.combine) {
                groupManager.saveCombineHistory(target.group, history);
                return;
            }

            if (!target.key) return;
            groupManager.saveGroupChatHistory(target.group, target.key, history);
            syncProactiveStateWithHistory(target.key, history);
            return;
        }

        // ── Solo session: original logic ──────────────────────────────────
        settings.chatHistory[target.key] = history;
        syncProactiveStateWithHistory(target.key, history);
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
        // Also reset emotion state and Daily Life's errands and what happened when clearing history
        clearEmotionState();
        delete settings.lifeState[key];
        delete settings.phoneOverrides?.[key];
        delete settings.chatMemories?.[key];
        delete settings.catchUpLast?.[key];
        forgetChatPosts(key);
        saveSettings();
    }

    // ============================================================
    // ECHOTEXT MESSAGES IN THE STORY PROMPT
    // ============================================================

    /**
     * The story's character's day for the roleplay prompt, with Daily Life on: whoever
     * that is, not the character open in Echogram. '' with nothing to say.
     */
    function buildCharacterToday(char) {
        if (settings.dailyLifeEnabled !== true) return '';
        const key = char.avatar || char.name;
        const date = new Date();
        return DailyLife.describeToday({
            schedule: DailyLife.normalizeSchedule(settings.characterSchedules?.[key]),
            life: DailyLife.currentLife(settings.lifeState?.[key], date, getEmotionHistory(key)),
            date, charName: char.name || 'Character', userName: getUserName(), override: settings.phoneOverrides?.[key] || null,
        });
    }

    /**
     * What Echogram adds to the roleplay prompt: the texts with the story's character,
     * each run where it happened in the story, then the time now and the character's day
     * at the very end (lib/story-texts.js). Group chats keep their own EchoText storage and
     * are left out.
     */
    function addEchogramToStory(chat, type) {
        const context = SillyTavern.getContext();
        if (context.groupId) return;
        const char = context.characters?.[context.characterId];
        if (!char || !Array.isArray(chat) || !chat.length) return;
        const history = settings.chatHistory?.[char.avatar || char.name];
        // As getChatHistory: a stored copy of the greeting isn't a text
        const firstMes = (char.first_mes || '').trim();
        const texts = (Array.isArray(history) ? history : []).filter(msg => msg.is_user || !firstMes || (msg.mes || '').trim() !== firstMes);
        const keepLast = type === 'continue';
        const inserted = StoryTexts.insertTexts(chat, texts, { charName: char.name, userName: getUserName(), timeOf: stMessageTime, keepLast });
        const today = buildCharacterToday(char);
        if (inserted || today) StoryTexts.addToEnd(chat, { today, keepLast });
        if (inserted) log(`Added EchoText messages to the prompt in ${inserted} place(s)`);
    }

    /** SillyTavern's generation interceptor (manifest.json), with the "Echogram Messages" context toggle on. */
    globalThis.echoTextGenerateInterceptor = function (chat, contextSize, abort, type) {
        if (!settings.enabled || settings.ctxSTMessages !== true) return;
        try {
            addEchogramToStory(chat, type);
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

    // A streamed answer silent this long is given up on (sendCompletionRequest)
    const STREAM_SILENCE_MS = 3 * 60000;

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

            // Streamed, then put together: a thinking model can take minutes, and a gateway
            // drops a connection that long without a byte (socket hang up); the main chat streams too.
            // Nothing at all for STREAM_SILENCE_MS (the reasoning counts) and it's given up on,
            // so a request that never ends doesn't hold everything waiting on it
            const own = new AbortController();
            const passOn = () => own.abort(signal.reason);
            if (signal?.aborted) passOn();
            else signal?.addEventListener('abort', passOn, { once: true });
            let silent = false;
            let timer = null;
            const wait = () => {
                clearTimeout(timer);
                timer = setTimeout(() => { silent = true; own.abort(); }, STREAM_SILENCE_MS);
            };
            wait();
            try {
                const response = await context.ConnectionManagerRequestService.sendRequest(
                    profile.id, apiMessages, undefined,
                    { stream: true, signal: own.signal, extractData: true, includePreset: true, includeInstruct: true }
                );
                if (typeof response !== 'function') return stripPrefill(extractTextFromResponse(response));
                let text = '';
                let reasoning = '';
                // Each chunk carries the text so far (the reasoning apart, in its state)
                for await (const chunk of response()) {
                    wait();
                    if (typeof chunk?.text === 'string') text = chunk.text;
                    if (typeof chunk?.state?.reasoning === 'string') reasoning = chunk.state.reasoning;
                }
                // Nothing written: SillyTavern skips an error the provider sends inside a stream
                // (tryParseStreamingError catches its own throw), so it ends up empty, not failed
                if (!text.trim()) throw new Error(reasoning.trim() ? 'the model only thought, it wrote no reply' : 'no answer (the provider may have sent an error)');
                return stripPrefill(text);
            } catch (err) {
                if (silent) throw new Error(`no answer for ${STREAM_SILENCE_MS / 60000} minutes`);
                throw err;
            } finally {
                clearTimeout(timer);
                signal?.removeEventListener('abort', passOn);
            }
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

    // The built-in sticker sets (lib/stickers.js), their images in this folder
    const stickerPresets = Stickers.presetSets(BASE_URL);

    // The library as last built; dropped whenever the imported sets change (invalidateStickerLibrary)
    let stickerLibrary = null;

    /** The sticker sets, in tab order: the built-in ones, then the imported ones. */
    function getStickerLibrary() {
        if (!stickerLibrary) stickerLibrary = [...stickerPresets, ...Stickers.importedSets(settings.stickerSets)];
        return stickerLibrary;
    }

    /** The imported sets changed: the library, the sticker panel, the chat's stickers and the settings list follow. */
    function invalidateStickerLibrary() {
        stickerLibrary = null;
        refreshStickerPanel();
        renderStickerSets();
        if (panelOpen) renderMessages(getChatHistory());
    }

    // ── Sticker sets (Settings → Stickers) ─────────────────────────────────
    // An imported set comes from a ZIP: its images go to the user's images, one folder
    // per set, and its stickers are named after their files (docs/platform-plan.md 16).

    /** SillyTavern's own JSZip (public/lib), loaded the first time a ZIP is imported. */
    function loadJSZip() {
        if (window.JSZip) return Promise.resolve(window.JSZip);
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = '/lib/jszip.min.js';
            script.onload = () => (window.JSZip ? resolve(window.JSZip) : reject(new Error('JSZip missing')));
            script.onerror = () => reject(new Error('could not load JSZip'));
            document.head.appendChild(script);
        });
    }

    /** Saves one sticker image (base64) to the set's folder in the user's images; resolves with its path. */
    async function uploadStickerImage(base64, format, setId, index) {
        const response = await fetch('/api/images/upload', {
            method: 'POST',
            headers: SillyTavern.getContext().getRequestHeaders(),
            body: JSON.stringify({ image: base64, format, ch_name: `Echogram stickers ${setId}`, filename: String(index).padStart(3, '0') }),
        });
        if (!response.ok) throw new Error(`upload failed (${response.status})`);
        const { path } = await response.json();
        if (!path) throw new Error('no path returned');
        return path;
    }

    /**
     * Imports a ZIP as a new set, named after the file: its images become stickers named
     * after their files (made unique in the library), other files are skipped. A failed
     * upload keeps nothing.
     */
    async function importStickerZip(file) {
        const button = jQuery('#et-sticker-import');
        jQuery('#et-sticker-import, .et-sticker-add').prop('disabled', true);
        const uploaded = [];
        try {
            const JSZip = await loadJSZip();
            const zip = await JSZip.loadAsync(file, { decodeFileName: Stickers.decodeZipName });
            const taken = new Set(getStickerLibrary().flatMap(set => set.stickers.map(sticker => sticker.name)));
            const { files, skipped } = Stickers.zipStickerFiles(Object.keys(zip.files), taken);
            if (!files.length) {
                toastr.warning('No images in this ZIP.', 'Echogram');
                return;
            }
            const id = `s${Date.now().toString(36)}`;
            for (const [i, entry] of files.entries()) {
                button.text(`${i + 1} / ${files.length}`);
                const base64 = await zip.file(entry.path).async('base64');
                uploaded.push({ name: entry.name, path: await uploadStickerImage(base64, entry.format, id, i) });
            }
            const name = String(file.name || 'Stickers').replace(/\.zip$/i, '').trim() || 'Stickers';
            settings.stickerSets = [...(settings.stickerSets || []), { id, name, stickers: uploaded }];
            saveSettings();
            stickerTab = id;
            invalidateStickerLibrary();
            toastr.success(skipped ? `${uploaded.length} stickers, ${skipped} other files skipped` : `${uploaded.length} stickers`, name);
        } catch (err) {
            warn('Sticker import failed:', err);
            for (const sticker of uploaded) deleteUserImage(sticker.path);
            toastr.error('Could not import this ZIP.', 'Echogram');
        } finally {
            jQuery('.et-sticker-add').prop('disabled', false);
            button.prop('disabled', false).html('<i class="fa-solid fa-file-zipper"></i> Import ZIP');
        }
    }

    // The set whose stickers are shown in the settings list (one at a time)
    let stickerSetOpen = null;

    /** The sticker sets a character can use (set ids; none until turned on for them). */
    function stickerSetsFor(charKey) {
        const ids = charKey && settings.stickerSetsByCharacter?.[charKey];
        return Array.isArray(ids) ? ids : [];
    }

    /** Turns a set on or off for a character; with none left, the character's entry goes. */
    function setStickerSetFor(charKey, setId, on) {
        if (!charKey || !setId) return;
        const map = settings.stickerSetsByCharacter = settings.stickerSetsByCharacter || {};
        const ids = stickerSetsFor(charKey).filter(id => id !== setId);
        if (on) ids.push(setId);
        if (ids.length) map[charKey] = ids;
        else delete map[charKey];
        saveSettings();
    }

    /** Every card in SillyTavern as { key, name }, by name. */
    function stickerCharacters() {
        return (SillyTavern.getContext().characters || [])
            .map(char => ({ key: char.avatar || char.name, name: char.name || char.avatar }))
            .filter(char => char.key)
            .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    }

    /**
     * Settings → Stickers: a row per set: its cover (shows its stickers under it), its name
     * (an imported one's turns into a field when clicked), how many, which characters it's
     * on for (a list with a checkbox each and a search, opened from the row) and Delete.
     */
    function renderStickerSets() {
        const list = jQuery('#et-sticker-sets');
        if (!list.length) return;
        list.html(getStickerLibrary().map(set => {
            const cover = set.stickers[0] ? `<img src="${escapeHtml(set.stickers[0].url)}" alt="" draggable="false">` : '';
            const name = set.builtIn
                ? `<span class="et-sticker-set-name">${escapeHtml(set.name)}</span>`
                : `<button type="button" class="et-sticker-set-name et-sticker-editable" data-sticker-edit-set title="Rename">${escapeHtml(set.name)}</button>`;
            const remove = set.builtIn ? '' : '<button type="button" class="et-sticker-delete" data-sticker-delete-set title="Delete"><i class="fa-solid fa-trash-can"></i></button>';
            const open = set.id === stickerSetOpen;
            const stickers = !open ? '' : `<div class="et-sticker-set-items">${set.stickers.map(sticker => set.builtIn
                ? `<div class="et-sticker-set-item"><img src="${escapeHtml(sticker.url)}" alt="" loading="lazy" draggable="false"><span>${escapeHtml(sticker.name)}</span></div>`
                : `<div class="et-sticker-set-item" data-sticker="${escapeHtml(sticker.name)}"><img src="${escapeHtml(sticker.url)}" alt="" loading="lazy" draggable="false"><button type="button" class="et-sticker-editable" data-sticker-edit title="Rename">${escapeHtml(sticker.name)}</button><button type="button" class="et-sticker-delete" data-sticker-delete title="Delete"><i class="fa-solid fa-xmark"></i></button></div>`).join('')}</div>`;
            return `<div class="et-sticker-set${open ? ' et-sticker-set-open' : ''}" data-sticker-set="${escapeHtml(set.id)}">`
                + `<div class="et-sticker-set-row"><button type="button" class="et-sticker-set-cover" data-sticker-set-toggle title="${open ? 'Hide' : 'Show'}">${cover}</button>${name}`
                + `<span class="et-sticker-set-count">${set.stickers.length}</span>${stickerCharsButton(set.id)}${remove}</div>${stickers}</div>`;
        }).join(''));
    }

    /** The characters a set is on for, by key. */
    function stickerSetKeys(setId) {
        return Object.keys(settings.stickerSetsByCharacter || {}).filter(key => stickerSetsFor(key).includes(setId));
    }

    /** A character's name by key: the card's, or the one remembered for a card that's gone. */
    function stickerCharacterName(key, characters = stickerCharacters()) {
        return characters.find(char => char.key === key)?.name || CharacterData.nameOf(settings, key);
    }

    /** The button that opens a set's characters: how many it's on for, their names on hover. */
    function stickerCharsButton(setId) {
        const keys = stickerSetKeys(setId);
        const characters = stickerCharacters();
        const names = keys.map(key => stickerCharacterName(key, characters)).join(', ');
        return `<button type="button" class="et-sticker-chars-btn${keys.length ? ' et-sticker-chars-some' : ''}" data-sticker-chars title="${escapeHtml(names)}"><i class="fa-solid fa-user"></i><span>${keys.length}</span><i class="fa-solid fa-chevron-down"></i></button>`;
    }

    /** A set's characters: a search, then every card with a checkbox (and any it's on for whose card is gone). */
    function openStickerChars(button) {
        jQuery('.et-sticker-chars-menu').remove();
        const setEl = button.closest('[data-sticker-set]');
        const setId = setEl.attr('data-sticker-set');
        const on = stickerSetKeys(setId);
        const characters = stickerCharacters();
        const gone = on.filter(key => !characters.some(char => char.key === key)).map(key => ({ key, name: stickerCharacterName(key, characters) }));
        const items = [...gone, ...characters].map(char =>
            `<label class="et-sticker-chars-item" data-name="${escapeHtml(String(char.name).toLowerCase())}"><input type="checkbox" class="checkbox" data-sticker-char="${escapeHtml(char.key)}"${on.includes(char.key) ? ' checked' : ''}><span>${escapeHtml(char.name)}</span></label>`).join('');
        const menu = jQuery(`<div class="et-sticker-chars-menu" data-et-own-escape><input type="text" class="et-input-text" data-sticker-chars-search placeholder="Search"><div class="et-sticker-chars-list">${items}</div></div>`);
        setEl.find('.et-sticker-set-row').append(menu);
        menu.find('[data-sticker-chars-search]').trigger('focus');
    }

    /** An imported set's stored entry, by id. */
    const storedStickerSet = id => (settings.stickerSets || []).find(set => set.id === id);

    // Settings → Stickers: import, the character's switch, renaming, and deleting (a second click within a few seconds)
    function bindStickerSets() {
        let disarm = null;
        const disarmAll = () => jQuery('.et-sticker-delete.et-recover-armed').removeClass('et-recover-armed');
        jQuery(document).off('.et-stickers')
            .on('click.et-stickers', '#et-sticker-import', () => jQuery('#et-sticker-import-file').trigger('click'))
            .on('change.et-stickers', '#et-sticker-import-file', function () {
                const file = this.files?.[0];
                this.value = '';
                if (file) importStickerZip(file);
            })
            .on('click.et-stickers', '[data-sticker-set-toggle]', function () {
                const id = jQuery(this).closest('[data-sticker-set]').attr('data-sticker-set');
                stickerSetOpen = stickerSetOpen === id ? null : id;
                renderStickerSets();
            })
            // Which characters: the list opens under the row, and closes on a click anywhere else or Escape
            .on('click.et-stickers', '[data-sticker-chars]', function (e) {
                e.stopPropagation();
                const open = jQuery(this).siblings('.et-sticker-chars-menu').length;
                jQuery('.et-sticker-chars-menu').remove();
                if (!open) openStickerChars(jQuery(this));
            })
            .on('click.et-stickers', function (e) {
                if (!jQuery(e.target).closest('.et-sticker-chars-menu, [data-sticker-chars]').length) jQuery('.et-sticker-chars-menu').remove();
            })
            .on('keydown.et-stickers', '.et-sticker-chars-menu', function (e) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    jQuery(this).remove();
                }
            })
            .on('input.et-stickers', '[data-sticker-chars-search]', function () {
                const query = this.value.trim().toLowerCase();
                jQuery(this).siblings('.et-sticker-chars-list').children().each(function () {
                    this.hidden = !!query && !this.dataset.name.includes(query);
                });
            })
            .on('change.et-stickers', '[data-sticker-char]', function () {
                const setEl = jQuery(this).closest('[data-sticker-set]');
                const id = setEl.attr('data-sticker-set');
                setStickerSetFor(this.dataset.stickerChar, id, this.checked);
                // The count and names in place, the list staying open
                setEl.find('[data-sticker-chars]').replaceWith(stickerCharsButton(id));
            })
            // A name is a field only while it's being edited: Enter or leaving it keeps it, Escape doesn't
            .on('click.et-stickers', '[data-sticker-edit-set], [data-sticker-edit]', function () {
                const button = jQuery(this);
                const setName = button.is('[data-sticker-edit-set]');
                const input = jQuery(`<input type="text" class="et-input-text${setName ? ' et-sticker-set-name' : ''}" maxlength="40" data-et-own-escape ${setName ? 'data-sticker-set-name' : 'data-sticker-rename'}>`).attr('value', button.text());
                button.replaceWith(input);
                input.trigger('focus').trigger('select');
            })
            .on('keydown.et-stickers', '[data-sticker-set-name], [data-sticker-rename]', function (e) {
                if (e.key === 'Enter') this.blur();
                else if (e.key === 'Escape') {
                    e.preventDefault();
                    this.value = this.defaultValue;
                    renderStickerSets();
                }
            })
            .on('blur.et-stickers', '[data-sticker-set-name], [data-sticker-rename]', function () {
                if (this.isConnected) renderStickerSets();
            })
            .on('change.et-stickers', '[data-sticker-set-name]', function () {
                const set = storedStickerSet(jQuery(this).closest('[data-sticker-set]').attr('data-sticker-set'));
                const name = this.value.trim();
                if (set && name) {
                    set.name = name;
                    saveSettings();
                }
                invalidateStickerLibrary();
            })
            .on('change.et-stickers', '[data-sticker-rename]', function () {
                const set = storedStickerSet(jQuery(this).closest('[data-sticker-set]').attr('data-sticker-set'));
                const old = jQuery(this).closest('[data-sticker]').attr('data-sticker');
                const sticker = set?.stickers.find(s => s.name === old);
                const name = this.value.trim();
                const taken = getStickerLibrary().some(other => other.stickers.some(s => s.name === name));
                if (sticker && name && name !== old) {
                    if (taken) toastr.warning(`${name} is taken.`, 'Echogram');
                    else {
                        sticker.name = name;
                        saveSettings();
                    }
                }
                invalidateStickerLibrary();
            })
            .on('click.et-stickers', '[data-sticker-delete-set], [data-sticker-delete]', function () {
                const button = jQuery(this);
                clearTimeout(disarm);
                if (!button.hasClass('et-recover-armed')) {
                    disarmAll();
                    button.addClass('et-recover-armed');
                    disarm = setTimeout(disarmAll, 3000);
                    return;
                }
                const id = button.closest('[data-sticker-set]').attr('data-sticker-set');
                const set = storedStickerSet(id);
                if (!set) return;
                if (button.is('[data-sticker-delete-set]')) {
                    for (const sticker of set.stickers) deleteUserImage(sticker.path);
                    settings.stickerSets = settings.stickerSets.filter(other => other !== set);
                    for (const key of Object.keys(settings.stickerSetsByCharacter || {})) {
                        const ids = stickerSetsFor(key).filter(other => other !== id);
                        if (ids.length) settings.stickerSetsByCharacter[key] = ids;
                        else delete settings.stickerSetsByCharacter[key];
                    }
                } else {
                    const name = button.closest('[data-sticker]').attr('data-sticker');
                    const sticker = set.stickers.find(s => s.name === name);
                    if (sticker) deleteUserImage(sticker.path);
                    set.stickers = set.stickers.filter(s => s !== sticker);
                }
                saveSettings();
                invalidateStickerLibrary();
            });
    }

    /** The names of the stickers the open character can use: those of the sets turned on for them. */
    function getCharacterStickerNames() {
        return Stickers.characterNames(getStickerLibrary(), stickerSetsFor(getCharacterKey()));
    }

    /**
     * The features as the model sees them: the platform's, but stickers only while the
     * character has some to use. Without, the tags become plain-text notes as on a
     * platform without stickers: the user's still read as what they are, and there's
     * no tag to copy.
     */
    function getModelFeatures() {
        const features = getActiveFeatures();
        return features.includes('sticker') && !getCharacterStickerNames().length ? features.filter(id => id !== 'sticker') : features;
    }

    /**
     * A message's text as sent to the model: reasoning blocks stripped and
     * rich-content tags rewritten to their canonical form, so the model always
     * sees well-formed examples of its own past usage — minus the features this
     * platform doesn't support. null when that leaves nothing: the turn is left out.
     */
    function getContextMessageText(mes) {
        const text = RichMessages.normalizeMessageTags(stripThinkingTags(mes || ''));
        return Features.filterContextText(Stickers.canonicalNames(getStickerLibrary(), text), getModelFeatures());
    }

    /** Combined mode has no format rules, so the user's tapbacks are spelled out in words. */
    function buildCombinedReactionTurns(msg, speaker) {
        const reactions = getUserReactionIds(msg);
        return reactions.length
            ? [{ role: 'user', content: `[${getUserName()} reacted ${reactions.join(', ')} to ${speaker}'s message]` }]
            : [];
    }

    /** Ids of the user's tapbacks on a character message, any bubble (none on user messages). */
    function getUserReactionIds(msg) {
        if (!platformHas('react')) return [];
        return ChatViewModel.getUserTapbackIds(msg, getReactionIds());
    }

    /**
     * The user's tapbacks on a character message as the model sees them: a user
     * turn right after that message, in the form the character reacts with: each
     * tapback after the <reply> quoting its bubble. '' when the user hasn't reacted.
     */
    function buildUserReactionText(msg) {
        if (!platformHas('react') || !msg || msg.is_user) return '';
        const partCount = getMessageDisplayParts(msg).length;
        const tapbacks = ChatViewModel.getUserTapbacks(msg, partCount, getReactionIds());
        const tags = ids => ids.map(id => `<react>${id}</react>`);
        // Each with the bubble it's on quoted, the last one too: the one form the character writes
        return Object.keys(tapbacks).map(Number).sort((a, b) => a - b).flatMap(j => {
            const quote = `<reply>${RichMessages.replyContent(quoteForBubble(msg, j))}</reply>`;
            return [platformHas('reply') ? quote : RichMessages.toPlainText(quote), ...tags(tapbacks[j])];
        }).join('\n');
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

    async function buildApiMessagesFromHistory(history, extraSystemMessages = [], targetCharOverride = null, options = {}) {
        const { stable, live, maxTexts } = await buildPromptParts(targetCharOverride, history, options);
        const systemPrompt = stable + live;
        const apart = splitsLiveContext();
        const apiMessages = [{ role: 'system', content: apart ? stable : systemPrompt }];

        if (!apart) {
            for (const msg of extraSystemMessages) {
                if (msg) apiMessages.push({ role: 'system', content: msg });
            }
        }

        // Summarized early messages go in the system prompt instead
        const sent = historyToSend(history);
        const { messages, reminder } = buildChatMessages(sent, targetCharOverride || getCurrentCharacter(), apart);
        apiMessages.push(...messages);
        if (apart) placeLiveContext(apiMessages, [live, reminder, ...extraSystemMessages]);

        // --- Layer 3: Pre-fill assistant turn (anti-refusal, chat-completion backends only) ---
        // Planting the assistant prefix forces the model to continue in-character rather than
        // starting fresh with a potential refusal. The prefix is stripped in requestEchoTextCompletion.
        let prefillPrefix = '';
        if (settings.antiRefusal === true && settings.source !== 'default') {
            prefillPrefix = `${getCharacterName()}: `;
            apiMessages.push({ role: 'assistant', content: prefillPrefix });
        }

        let rawPrompt = '';
        sent.forEach(msg => {
            const contextText = resolveHistoryMessageText(msg);
            if (contextText !== null) rawPrompt += `${msg.is_user ? getUserName() : getCharacterName()}: ${contextText}\n`;
            const reactionText = buildUserReactionText(msg);
            if (reactionText) rawPrompt += `${getUserName()}: ${reactionText}\n`;
        });
        rawPrompt += `${getCharacterName()}:`;

        return { apiMessages, rawPrompt, systemPrompt, prefillPrefix, maxTexts };
    }

    /**
     * Like buildApiMessagesFromHistory but scoped to an arbitrary char object.
     * Used by generateEchoTextCombined and the proactive scheduler.
     *
     * In Combined Group Mode the request is built by buildCombinedGroupApiMessages,
     * which separates group framing, attributed history, and character-card injection
     * into distinct, correctly-ordered message slots instead of one system-prompt blob.
     */
    async function buildApiMessagesFromHistoryForChar(history, extraSystemMessages = [], char, options = {}) {
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
        const { stable, live, maxTexts } = await buildPromptParts(char, history, options);
        const systemPrompt = stable + live;
        const apart = splitsLiveContext();
        const apiMessages = [{ role: 'system', content: apart ? stable : systemPrompt }];

        if (!apart) {
            for (const msg of extraSystemMessages) {
                if (msg) apiMessages.push({ role: 'system', content: msg });
            }
        }

        const sent = historyToSend(history);
        const { messages, reminder } = buildChatMessages(sent, char, apart);
        apiMessages.push(...messages);
        if (apart) placeLiveContext(apiMessages, [live, reminder, ...extraSystemMessages]);

        const charName = (char && char.name) || getCharacterName();
        const userName = getUserName();
        let rawPrompt = '';
        sent.forEach(msg => {
            const contextText = resolveHistoryMessageText(msg);
            if (contextText !== null) rawPrompt += `${msg.is_user ? userName : charName}: ${contextText}\n`;
            const reactionText = buildUserReactionText(msg);
            if (reactionText) rawPrompt += `${userName}: ${reactionText}\n`;
        });
        rawPrompt += `${charName}:`;

        return { apiMessages, rawPrompt, systemPrompt, maxTexts };
    }

    /**
     * @param {object} [options]
     * @param {boolean} [options.noticed] the character has already seen the texts (a parked reply
     *   resuming): with Daily Life, no roll on whether a busy or sleeping character notices them
     */
    async function generateEchoText(history, backupHistory = null, { noticed = false } = {}) {
        if (isGenerating) return;

        const char = getCurrentCharacter();
        if (!char) {
            toastr.warning('Please select a character card to start texting.');
            return;
        }

        isGenerating = true;
        generatingTarget = chatTarget();
        abortController = new AbortController();
        updateSendButton(true);

        // The chat this reply is for, and the last message it answers
        const target = chatTarget();
        let workingHistory = Array.isArray(history) ? [...history] : [];
        const anchor = workingHistory[workingHistory.length - 1] || null;
        const unreadIdx = getUnreadUserMessageIndices(workingHistory);
        // The receipts are on the messages themselves: the chat as it is now keeps them
        const markUnread = (state, note) => {
            unreadIdx.forEach(i => setUserMessageReceiptState(workingHistory, i, state, note, false));
            if (panelOpen && isViewing(target)) refreshMessages(getChatHistory(target));
        };
        const keepReceipts = () => {
            const latest = getChatHistory(target);
            if (!anchor || latest.includes(anchor)) saveChatHistory(latest, target);
        };
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

        let result = '';

        try {
            const { apiMessages, rawPrompt, systemPrompt, maxTexts } = await buildApiMessagesFromHistory(apiHistory);
            // Built from what's open now: another chat by then (World Info is fetched on the way),
            // it isn't sent. Your texts wait for the reply when you're back (resumePendingReply).
            if (!isViewing(target)) {
                if (target && !target.group && unreadIdx.length) {
                    settings.pendingReplies = settings.pendingReplies || {};
                    settings.pendingReplies[target.key] = Date.now();
                    saveSettings();
                }
                return;
            }

            if (unreadIdx.length) {
                await sleepWithAbort(timing.deliveredDelayMs, abortController.signal);
                markUnread('delivered', 'Delivered to character');
                keepReceipts();

                // Daily Life: busy or asleep, the texts may wait unseen; the reply is parked
                // until they look (resumePendingReply), or until another text gets through.
                // Their day is read from what's open, so only while it's still them.
                if (!noticed && isViewing(target) && parkUnseenReply(unreadIdx.length)) return;

                await sleepWithAbort(timing.readDelayMs, abortController.signal);
                markUnread('read', 'Read by character');
                keepReceipts();

                if (timing.ghostDelayMs > 0) {
                    markUnread('ghosted', 'Read — paused before replying');
                    keepReceipts();
                    await sleepWithAbort(timing.ghostDelayMs, abortController.signal);
                    markUnread('read', 'Read by character');
                    keepReceipts();
                }
            }

            await sleepWithAbort(timing.typingLeadMs, abortController.signal);
            
            const bypassTextGeneration = (imageGeneration && latestUserMessage?.is_user && pendingImageDetection?.triggered && settings.imageGenerationIncludeTextReply === false);

            if (!bypassTextGeneration) {
                setTypingIndicatorVisible(true, target);
                await sleepWithAbort(timing.replyDelayMs, abortController.signal);
                result = await requestEchoTextCompletion({ apiMessages, rawPrompt, systemPrompt, signal: abortController.signal });
            }

            let imageReply = null;
            // The picture is drawn from the character open now: only while that's still them
            if (imageGeneration && settings.imageGenerationEnabled === true && latestUserMessage?.is_user && isViewing(target)) {
                // Reuse the pre-detection result — no need to call detectImageRequest again
                if (pendingImageDetection?.triggered) {
                    // Replace typing indicator with the dedicated image-generating indicator
                    setTypingIndicatorVisible(false);
                    setImageGeneratingIndicatorVisible(true);
                }
                imageReply = await imageGeneration.maybeGenerateImageReply(latestUserMessage.mes, history, abortController.signal);
                setImageGeneratingIndicatorVisible(false);
            }

            const reply = readReply(result, target, { maxTexts });
            const hasTextResponse = !!reply.mes;
            if (hasTextResponse || imageReply?.triggered) {
                const charReply = {
                    is_user: false,
                    mes: reply.mes,
                    send_date: Date.now(),
                    ...(reply.mood ? { mood: reply.mood } : {}),
                    ...(reply.life ? { life: reply.life } : {})
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
                                charKey: target.key,
                                charName: char.name || 'Character',
                                avatarUrl: getAvatarUrlForCharacter(char),
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

                // Cleared, replaced or cut back meanwhile: the reply is to a chat that's gone
                const newHistory = withReply(target, anchor, charReply);
                if (!newHistory) return;
                pruneSwipesOnPrevLastChar(newHistory);
                saveChatHistory(newHistory, target);
                markProactiveCharacterActivity(target.key, false, 'reply');
                if (isViewing(target)) {
                    renderMessages(newHistory);
                    setFabUnreadIndicator(panelOpen ? false : true);
                    if (charReply.mood || charReply.life) noteMoodReport();
                } else {
                    setFabUnreadIndicator(true);
                }
            }

        } catch (err) {
            const aborted = err.name === 'AbortError' || (abortController && abortController.signal.aborted);
            // Back to the chat as it was, while it's still the one this started from
            const restored = backupHistory && (!anchor || getChatHistory(target).includes(anchor));
            if (restored) {
                saveChatHistory(backupHistory, target);
                if (isViewing(target)) renderMessages(backupHistory);
            }
            if (aborted) log('Generation cancelled');
            else {
                error('Generation failed:', err);
                // A tap asks again, from the chat as it is then (its chat open, nothing else on its way)
                toastr.error(`Echogram: ${String(err.message).replace(/[.。]\s*$/, '')}. Tap to retry.`, '', {
                    timeOut: 15000,
                    onclick: () => {
                        if (isGenerating || !isViewing(target)) return;
                        const chat = getChatHistory(target);
                        if (restored) generateEchoText(chat.slice(0, chat.map(m => !!m?.is_user).lastIndexOf(true) + 1), chat);
                        else generateEchoText(chat);
                    },
                });
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
            ...(msg.life ? { life: msg.life } : {}),
            ...(msg.bubbleReactions ? { bubbleReactions: { ...msg.bubbleReactions } } : {}),
            ...(msg.photoImages ? { photoImages: { ...msg.photoImages } } : {}),
        }];
        msg.swipeIndex = 0;
    }

    /**
     * Syncs the parent message's top-level fields (mes, send_date, imageAttachment,
     * Auto mode's mood, Daily Life's changes, the user's per-bubble tapbacks, the photos' images) from the swipe slot at
     * `msg.swipeIndex`. The former whole-message reactions stay with the message.
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
        // and Daily Life's changes (lib/daily-life.js)
        if (swipe.life) msg.life = swipe.life;
        else delete msg.life;
        // The user's tapbacks are on this version's bubbles
        if (swipe.bubbleReactions) msg.bubbleReactions = swipe.bubbleReactions;
        else delete msg.bubbleReactions;
        // and the photos' images
        if (swipe.photoImages) msg.photoImages = swipe.photoImages;
        else delete msg.photoImages;
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
        generatingTarget = chatTarget();
        abortController = new AbortController();
        updateSendButton(true);
        setTypingIndicatorVisible(true);

        // Work on a shallow copy so we don't mutate callers' array references
        const workingHistory = [...history];
        const msg = workingHistory[msgIndex];
        // The chat it's for; the new version goes on `msg` while that's still in it
        const target = chatTarget();
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
            const { apiMessages, rawPrompt, systemPrompt, maxTexts } = await buildApiMessagesFromHistory(apiHistory);
            // Built from what's open now: another chat by then, it isn't sent
            if (!isViewing(target)) return;
            await sleepWithAbort(Math.min(timing.replyDelayMs, 1500), abortController.signal);

            const bypassTextGeneration = (imageGeneration && lastContextMsg?.is_user && pendingImageDetection?.triggered && settings.imageGenerationIncludeTextReply === false);

            if (!bypassTextGeneration) {
                result = await requestEchoTextCompletion({ apiMessages, rawPrompt, systemPrompt, signal: abortController.signal });
            }

            let imageReply = null;
            if (imageGeneration && settings.imageGenerationEnabled === true && lastContextMsg?.is_user && isViewing(target)) {
                if (pendingImageDetection?.triggered) {
                    setTypingIndicatorVisible(false);
                    setImageGeneratingIndicatorVisible(true);
                }
                imageReply = await imageGeneration.maybeGenerateImageReply(lastContextMsg.mes, contextHistory, abortController.signal);
                setImageGeneratingIndicatorVisible(false);
            }

            const reply = readReply(result, target, { maxTexts });
            const hasTextResponse = !!reply.mes;
            if (hasTextResponse || imageReply?.triggered) {
                const newSwipe = {
                    mes: reply.mes,
                    send_date: Date.now(),
                    ...(reply.mood ? { mood: reply.mood } : {}),
                    ...(reply.life ? { life: reply.life } : {})
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
                                charKey: target.key,
                                charName: char.name || 'Character',
                                avatarUrl: getAvatarUrlForCharacter(char),
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

                // The message deleted, or the chat cleared or replaced meanwhile: nothing to add it to
                const latest = getChatHistory(target);
                if (!latest.includes(msg)) return;

                // Append as a new swipe and navigate to it
                msg.swipes.push(newSwipe);
                msg.swipeIndex = msg.swipes.length - 1;
                syncMsgFromSwipe(msg);

                saveChatHistory(latest, target);
                markProactiveCharacterActivity(target.key, false, 'reply');
                if (isViewing(target)) {
                    renderMessages(latest);
                    setFabUnreadIndicator(panelOpen ? false : true);
                    if (newSwipe.mood || newSwipe.life) noteMoodReport();
                } else {
                    setFabUnreadIndicator(true);
                }
            }

        } catch (err) {
            if (err.name === 'AbortError' || (abortController && abortController.signal.aborted)) {
                log('Swipe generation cancelled');
            } else {
                error('Swipe generation failed:', err);
                toastr.error(`Echogram: ${err.message}`);
            }
            // On any failure or cancel, re-render the chat as it is
            // (the new swipe was never pushed since we only push on success)
            if (isViewing(target)) renderMessages(getChatHistory(target));
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
            setInputPlaceholder(`Message all: ${charNames}...`);
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
        const verbosity = getCharacterVerbosity(charKey);

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
        // The group chat it's for, and the last message it saw
        const target = chatTarget();
        const anchor = history[history.length - 1] || null;

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
        generatingTarget = chatTarget();
        abortController = new AbortController();
        updateSendButton(true);

        const prevActiveKey = groupManager.getActiveCharKey();
        groupManager.setActiveCharKey(charKey);

        const timing = { typingLeadMs: 180, replyDelayMs: 320 };

        try {
            setTypingIndicatorVisible(true, target);
            await sleepWithAbort(timing.typingLeadMs, abortController.signal);
            await sleepWithAbort(timing.replyDelayMs, abortController.signal);

            // Use the dedicated nudge builder so the full history — including
            // character replies that already happened after the last user message —
            // is present as context.  buildApiMessagesFromHistoryForChar would
            // silently drop those post-user-message turns.
            const { apiMessages, rawPrompt, systemPrompt } =
                await buildManualNudgeApiMessages(history, targetChar, stanceHint);
            // Built from what's open now: another chat by then, it isn't sent
            if (!isViewing(target)) return;

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
                // Cleared or replaced meanwhile: left that way
                const newHistory = withReply(target, anchor, charReply);
                if (!newHistory) return;
                saveChatHistory(newHistory, target);
                if (isViewing(target)) renderMessages(newHistory);
                setFabUnreadIndicator(panelOpen && isViewing(target) ? false : true);
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
        generatingTarget = chatTarget();
        abortController = new AbortController();
        updateSendButton(true);

        let workingHistory = Array.isArray(history) ? [...history] : [];
        // The group chat it's for, and the last message it answers
        const target = chatTarget();
        const anchor = workingHistory[workingHistory.length - 1] || null;

        // Mark the latest user message as delivered / read
        const unreadIdx = getUnreadUserMessageIndices(workingHistory);
        // The receipts are on the messages themselves: the chat as it is now keeps them
        const markUnread = (state, note) => {
            unreadIdx.forEach(i => setUserMessageReceiptState(workingHistory, i, state, note, false));
            if (panelOpen && isViewing(target)) refreshMessages(getChatHistory(target));
        };
        const keepReceipts = () => {
            const latest = getChatHistory(target);
            if (!anchor || latest.includes(anchor)) saveChatHistory(latest, target);
        };
        const timing = { deliveredDelayMs: 350, readDelayMs: 850, ghostDelayMs: 0, typingLeadMs: 250, replyDelayMs: 450 };

        try {
            if (unreadIdx.length) {
                await sleepWithAbort(timing.deliveredDelayMs, abortController.signal);
                markUnread('delivered', 'Delivered to group');
                keepReceipts();

                await sleepWithAbort(timing.readDelayMs, abortController.signal);
                markUnread('read', 'Read by group');
                keepReceipts();
            }

            // Generate a reply from each group member in order
            for (const char of members) {
                if (abortController.signal.aborted) break;

                const charKey = char.avatar || char.name;
                let prevActiveKey = groupManager.getActiveCharKey();

                // Temporarily set active key so buildSystemPrompt uses the right verbosity
                groupManager.setActiveCharKey(charKey);

                try {
                    setTypingIndicatorVisible(true, target);
                    await sleepWithAbort(timing.typingLeadMs, abortController.signal);
                    await sleepWithAbort(timing.replyDelayMs, abortController.signal);

                    const { apiMessages, rawPrompt, systemPrompt, maxTexts } =
                        await buildApiMessagesFromHistoryForChar(workingHistory, [], char);
                    // Built from what's open now: away from this group, the rest don't answer
                    if (!isViewing(target)) break;

                    const result = await requestEchoTextCompletion({
                        apiMessages, rawPrompt, systemPrompt,
                        signal: abortController.signal
                    });

                    setTypingIndicatorVisible(false);

                    if (result && result.trim()) {
                        const charReply = {
                            is_user: false,
                            mes: RichMessages.capTexts(cleanGeneratedResponse(result), maxTexts || MAX_TEXTS.medium),
                            charName: char.name,
                            charKey: charKey,
                            send_date: Date.now()
                        };
                        // Cleared or replaced meanwhile: no more replies to it
                        const next = withReply(target, anchor, charReply);
                        if (!next) break;
                        workingHistory = next;
                        saveChatHistory(workingHistory, target);
                        if (isViewing(target)) renderMessages(workingHistory);
                        setFabUnreadIndicator(panelOpen && isViewing(target) ? false : true);
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
        generatingTarget = chatTarget();
        abortController = new AbortController();
        updateSendButton(true);

        // The group chat it's for; the reply goes back right after the message it follows, while that's there
        const target = chatTarget();
        const anchor = historyBefore[historyBefore.length - 1] || null;
        const stillThere = () => !anchor || getChatHistory(target).includes(anchor);

        const prevActiveKey = groupManager.getActiveCharKey();
        // Temporarily point active key at the target so verbosity/system prompt are scoped correctly
        groupManager.setActiveCharKey(targetCharKey);

        const timing = { typingLeadMs: 250, replyDelayMs: 450 };

        try {
            setTypingIndicatorVisible(true, target);
            await sleepWithAbort(timing.typingLeadMs, abortController.signal);
            await sleepWithAbort(timing.replyDelayMs, abortController.signal);

            // Build the API messages using only the pre-target history as context
            const { apiMessages, rawPrompt, systemPrompt, maxTexts } =
                await buildApiMessagesFromHistoryForChar(historyBefore, [], targetChar);
            // Built from what's open now: another chat by then, it isn't sent
            if (!isViewing(target)) return;

            const result = await requestEchoTextCompletion({
                apiMessages, rawPrompt, systemPrompt,
                signal: abortController.signal
            });

            setTypingIndicatorVisible(false);

            if (result && result.trim()) {
                const charReply = {
                    is_user: false,
                    mes: RichMessages.capTexts(cleanGeneratedResponse(result), maxTexts || MAX_TEXTS.medium),
                    charName: targetChar.name,
                    charKey: targetCharKey,
                    send_date: Date.now()
                };
                // Stitch into the chat as it is now: the new reply right after the message it follows
                const latest = getChatHistory(target);
                const at = anchor ? latest.indexOf(anchor) : -1;
                if (anchor && at === -1) return;
                const finalHistory = [...latest.slice(0, at + 1), charReply, ...latest.slice(at + 1)];
                pruneSwipesOnPrevLastChar(finalHistory);
                saveChatHistory(finalHistory, target);
                if (isViewing(target)) renderMessages(finalHistory);
                setFabUnreadIndicator(panelOpen && isViewing(target) ? false : true);
            }
        } catch (err) {
            if (err.name === 'AbortError' || (abortController && abortController.signal.aborted)) {
                log('Combined single-char regen cancelled');
            } else {
                error('Combined single-char regen failed:', err);
                toastr.error(`Echogram: ${err.message}`);
            }
            // Back to the chat as it was, while it's still the one this started from
            if (backupHistory && stillThere()) {
                saveChatHistory(backupHistory, target);
                if (isViewing(target)) renderMessages(backupHistory);
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

    /** Whether "typing" shows now: it's on, and its chat is the one open. */
    function typingShown() {
        return showTypingIndicator && isViewing(typingTarget);
    }

    /** "Typing" for a chat (`target`): shown only while that chat is open (renderMessages draws it again on the way back). */
    function setTypingIndicatorVisible(visible, target = chatTarget()) {
        showTypingIndicator = !!visible;
        typingTarget = visible ? target : null;
        if (!panelOpen) return;
        // For platforms that say it in the header ("对方正在输入…") rather than in the list
        jQuery('#et-panel').attr('data-et-typing', typingShown() ? '' : null);

        const inner = jQuery('#et-messages-inner');
        if (!inner.length) return;

        if (typingShown()) {
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

    function setUserMessageReceiptState(history, msgIndex, state, note = '', render = true) {
        if (!Array.isArray(history) || msgIndex < 0 || !history[msgIndex] || !history[msgIndex].is_user) return history;
        history[msgIndex].meta = history[msgIndex].meta || {};
        history[msgIndex].meta.receipt = {
            state,
            note,
            at: Date.now()
        };

        // Re-render just that message rather than the whole chat
        if (render && panelOpen) refreshMessages(history);

        return history;
    }

    function getEmotionReplyTimingModel() {
        const timing = emotionSystem
            ? emotionSystem.getEmotionReplyTimingModel()
            : { deliveredDelayMs: 500, readDelayMs: 1200, ghostDelayMs: 0, typingLeadMs: 300, replyDelayMs: 600 };
        // Daily Life: busy or asleep, they read and answer more slowly
        const phone = phoneNow()?.phone;
        if (phone !== 'busy' && phone !== 'asleep') return timing;
        return { ...timing, readDelayMs: timing.readDelayMs * BUSY_SLOWDOWN, replyDelayMs: timing.replyDelayMs * BUSY_SLOWDOWN };
    }

    function syncProactiveStateWithHistory(characterKey, history) {
        if (!proactiveMessaging) return;
        proactiveMessaging.syncProactiveStateWithHistory(characterKey, history);
        // The open character changed or their chat loaded: their follow-up round's timer,
        // and a catch-up if one is due
        proactiveMessaging.armProactiveTimer();
        setTimeout(() => maybeCatchUp(), 0);
        keepLifeMemories();
    }

    function markProactiveUserActivity(characterKey, timestamp = Date.now()) {
        if (proactiveMessaging) proactiveMessaging.markProactiveUserActivity(characterKey, timestamp);
    }

    function markProactiveCharacterActivity(characterKey, proactive = false, outboundType = 'reply', timestamp = Date.now()) {
        if (proactiveMessaging) proactiveMessaging.markProactiveCharacterActivity(characterKey, proactive, outboundType, timestamp);
    }

    /** The proactive insights, wherever they're on screen (the settings window, the extension panel). */
    function refreshVisibleInsights() {
        const shown = [...document.querySelectorAll('.et-proactive-insights-grid')].some(el => el.offsetParent !== null);
        if (shown) refreshProactiveInsights();
    }

    function refreshProactiveInsights() {
        if (proactiveMessaging) proactiveMessaging.refreshProactiveInsights();
        jQuery('#et_proactive_life').text(scheduleInsight());
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
        closeSocial();
        closeMenus();
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
        setInputPlaceholder(`Text ${charName}...`);
        jQuery('#et-input').prop('disabled', false);
        jQuery('#et-send-btn, #et-attach-btn, #et-voice-btn, #et-photo-btn, #et-sticker-btn').prop('disabled', false);
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
        const inputText = inCombine ? `Message all: ${charName}...` : (hasChar ? `Text ${charName}...` : 'Text a character...');
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
                        <div class="et-overflow-menu-item" id="et-overflow-together" style="display:none">
                            <i class="fa-solid fa-user-group"></i>
                            <span></span>
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
                <div class="et-reply-draft" id="et-reply-draft" data-et-role="reply-draft" hidden></div>
                <div class="et-input-wrap">
                    <button class="et-voice-btn" id="et-voice-btn" type="button" title="Voice message" hidden${hasChar ? '' : ' disabled'}><i class="fa-solid fa-microphone"></i></button>
                    <button class="et-attach-btn" id="et-attach-btn" type="button" title="Attach"${hasChar ? '' : ' disabled'}><i class="fa-solid fa-plus"></i></button>
                    <button class="et-share-type" id="et-share-type" type="button" title="File type" hidden></button>
                    <textarea class="et-input" id="et-input" enterkeyhint="send" placeholder="${escapeHtml(inputPlaceholder(inputText))}" data-et-text-placeholder="${escapeHtml(inputText)}" rows="1"${hasChar ? '' : ' disabled'}></textarea>
                    <button class="et-photo-btn" id="et-photo-btn" type="button" title="Photo" hidden${hasChar ? '' : ' disabled'}><i class="fa-regular fa-image"></i></button>
                    <button class="et-sticker-btn" id="et-sticker-btn" type="button" title="Stickers" hidden${hasChar ? '' : ' disabled'}><i class="fa-regular fa-face-smile"></i></button>
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
        resumePendingReply();
        maybeCatchUp();

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

        closeMenus();
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
            if (!isOpen) closeMenus();
            menu.toggleClass('et-overflow-menu-open', !isOpen);
            updateTogetherItem();
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
            closeMenus();
            settingsModal.openSettingsModal();
            moveModalToPortal('.et-settings-modal');
        });

        jQuery('#et-overflow-gallery').on('click', (e) => {
            e.stopPropagation();
            closeOverflowMenu();
            closeMenus();
            if (gallery) gallery.openGalleryModal();
            moveModalToPortal('.et-gallery-overlay');
        });

        jQuery('#et-overflow-together').on('click', (e) => {
            e.stopPropagation();
            closeOverflowMenu();
            if (emotionSystem) emotionSystem.toggleTogether();
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
        replyDraft = null;
        bindAttachPanel();

        jQuery('#et-reply-draft').on('click', '[data-et-role="reply-cancel"]', function (e) {
            e.stopPropagation();
            clearReplyDraft();
            jQuery('#et-input').trigger('focus');
        });

        jQuery('#et-share-type').on('click', function (e) {
            e.stopPropagation();
            toggleShareTypeMenu(jQuery(this));
        });

        // A platform's own photo button (Instagram's, in the field) starts a photo, as "+" would
        jQuery('#et-photo-btn').on('click', function (e) {
            e.stopPropagation();
            closeAllDotMenus();
            setComposeMode('photo');
            jQuery('#et-input').trigger('focus');
        });

        // The sticker button raises the sticker panel, or puts it away for the keyboard
        jQuery('#et-sticker-btn').on('click', function (e) {
            e.stopPropagation();
            if (jQuery('#et-attach-panel').attr('data-et-panel') === 'stickers') {
                closeAttachPanel();
                jQuery('#et-input').trigger('focus');
            } else {
                toggleStickerPanel();
            }
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
            } else if (e.key === 'Escape' && replyDraft) {
                e.preventDefault();
                clearReplyDraft();
            }
        }).on('input', function () {
            fitInputHeight(this);
            // Still typing: the character keeps waiting
            noteTyping();
            if (isGenerating) updateSendButton(true);
        }).on('compositionstart compositionupdate', noteTyping);

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
                let lastHeight = window.visualViewport.height;
                const onVVResize = () => {
                    if (!panelOpen) return;
                    closeMenusForKeyboard(lastHeight, window.visualViewport.height);
                    lastHeight = window.visualViewport.height;
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
    // ============================================================
    // SOCIAL ACCOUNT (lib/social.js, docs/platform-plan.md 17)
    // ============================================================

    // The character's social account page, over the panel; made on first use
    let socialView = null;
    let socialArchives = null;

    /** The open character's account theme (social/<id>/theme.js), or null with none loaded. */
    function socialTheme() {
        const themes = window.EchoTextSocialThemes || {};
        const key = getCharacterKey();
        if (!key) return null;
        const account = Social.getAccount(settings, key, { name: getCharacterName() });
        return themes[account.theme] || themes[Social.DEFAULT_THEME] || null;
    }

    function openSocial() {
        // The page is a window over the chat: the chat's menus close
        closeMenus();
        if (!socialView) {
            socialView = Social.createSocialView({
                getSettings: () => settings,
                saveSettings,
                getCharacterKey,
                getCharacterName,
                getAvatarUrl: getCharAvatarUrl,
                getContainer: () => document.getElementById('et-panel'),
                stylesheetUrl: (theme, file) => `${BASE_URL}/social/${theme}/${file}${VERSION_QUERY}`,
                now: () => Date.now(),
                pickImage: pickSocialImage,
                pickPhoto: pickSocialPhoto,
                forgetPhoto: forgetSocialPhoto,
                openArchives: openSocialArchives,
                generatePosts: generateSocialPosts,
                uploadImage: (dataUrl, kind) => uploadUserImage(dataUrl, getCharacterName(), `echogram-social-${kind}`),
                deleteImage: deleteUserImage,
            });
        }
        socialView.open();
    }

    // The account's banner, as X keeps one: 3:1, 1500 px wide at most
    const SOCIAL_BANNER_WIDTH = 1500;

    /** The account's new avatar (square, as Echogram's) or banner (3:1), cropped in SillyTavern's dialog; null if cancelled. */
    async function pickSocialImage(kind) {
        // Before any await: a file dialog must open within the tap
        const file = await pickImageFile();
        if (!file) return null;
        const context = SillyTavern.getContext();
        const banner = kind === 'banner';
        const cropped = await context.callGenericPopup('', context.POPUP_TYPE.CROP, '',
            { cropAspect: banner ? 3 : 1, cropImage: await readFileAsDataUrl(file) });
        if (!cropped) return null;
        return banner ? (await fitImageDataUrl(cropped, SOCIAL_BANNER_WIDTH)).dataUrl : shrinkImageDataUrl(cropped, AVATAR_SIZE);
    }

    /** Deletes an image file unless a post, pinned or the chat's, or a post archive still has it. */
    function forgetSocialPhoto(path) {
        const kept = JSON.stringify([settings.socialPosts, settings.socialAccounts, settings.socialArchives]);
        if (!kept.includes(JSON.stringify(path).slice(1, -1))) deleteUserImage(path);
    }

    /** The chat's posts go with it: pinned ones stay on the character, and images only an old post had are deleted. */
    function forgetChatPosts(key) {
        const posts = Array.isArray(settings.socialPosts?.[key]) ? settings.socialPosts[key] : [];
        delete settings.socialPosts?.[key];
        posts.map(post => post?.photo?.path).filter(Boolean).forEach(forgetSocialPhoto);
    }

    /** The window that saves, loads, exports and imports the posts, on its own: the chat's archives don't hold them. */
    function openSocialArchives() {
        if (!socialArchives) {
            socialArchives = window.EchoTextSaveLoadModal.createSaveLoadModal({
                source: Social.createArchiveSource({
                    getSettings: () => settings,
                    saveSettings,
                    getCharacterKey,
                    getCharacterName,
                    now: () => Date.now(),
                    forgetPhoto: forgetSocialPhoto,
                    readPhoto: async (path) => {
                        const response = await fetch(Social.photoUrl(path));
                        if (!response.ok) throw new Error(`read failed (${response.status})`);
                        return readFileAsDataUrl(await response.blob());
                    },
                    uploadPhoto: dataUrl => uploadUserImage(dataUrl, getCharacterName(), 'echogram-social-photo'),
                    onLoad: () => socialView?.render(),
                }),
            });
        }
        socialArchives.openSaveLoadModal();
        moveModalToPortal('#et-sl-overlay');
    }

    /** An image for a post's photo, saved to the user's images; null if cancelled or it failed (a toast says so). */
    async function pickSocialPhoto() {
        // Before any await: a file dialog must open within the tap
        const file = await pickImageFile();
        if (!file) return null;
        try {
            const image = await fitImageDataUrl(await readFileAsDataUrl(file), PHOTO_SIZE);
            const path = await uploadUserImage(image.dataUrl, getCharacterName(), 'echogram-social-photo');
            return { path, width: image.width, height: image.height };
        } catch (err) {
            error('Could not add the photo:', err);
            toastr.error(`Could not add the photo: ${err.message}`, 'Echogram');
            return null;
        }
    }

    /**
     * New posts on the open character's social account (docs/platform-plan.md 17c): one
     * request with the account's fixed system prompt (lib/social.js), the card and world
     * info as the chat has them, the account and its latest posts. Kept with the chat;
     * resolves with how many. Throws when the model sends back none, or when `signal`
     * stops it (nothing is kept then).
     */
    async function generateSocialPosts({ count, outlines = null, signal = new AbortController().signal } = {}) {
        const char = getCurrentCharacter();
        const key = getCharacterKey();
        if (!char || !key) throw new Error('no character is open');
        const name = char.name || 'Character';
        const posts = Social.getPosts(settings, key);
        const request = Social.buildPostsRequest({
            charName: name,
            userName: getUserName(),
            platform: socialTheme()?.label || 'X',
            card: await buildCharacterReference(char, name),
            account: Social.getAccount(settings, key, { name }),
            posts,
            count,
            outlines,
            now: Date.now(),
        });
        const systemPrompt = withRefusalFrame(request.systemPrompt);
        const raw = await sendCompletionRequest({
            apiMessages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: request.prompt }],
            rawPrompt: request.prompt, systemPrompt, signal,
        });
        // An answer that comes after all (the default connection can't be stopped)
        if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
        const now = Date.now();
        const answer = stripThinkingTags(String(raw ?? ''));
        const added = request.outlines
            ? Social.parseOutlinedPosts(answer, { outlines: request.outlines, now })
            : Social.parsePosts(answer, { now, after: posts[0]?.at || 0, count: request.count });
        if (!added.length) throw new Error('the model sent back no posts');
        Social.addChatPosts(settings, key, added, `p${now}`);
        saveSettings();
        return added.length;
    }

    function closeSocial() {
        if (socialView) socialView.close();
    }

    function openAvatarMenu(anchor) {
        if (!getCharacterKey()) return;
        if (jQuery('.et-avatar-menu').length) {
            closeAllDotMenus();
            return;
        }
        closeMenus();
        const items = [];
        if (getCharAvatarUrl()) items.push(['view', 'fa-expand', 'View Avatar']);
        items.push(['change', 'fa-image', 'Change Avatar']);
        if (getCustomCharAvatarUrl()) items.push(['reset', 'fa-rotate-left', 'Use Card Avatar']);
        // The social account's page; a platform with a "+" panel has it there instead
        const social = socialTheme();
        if (social && !getActivePlatform().composerPanel) items.push(['social', social.icon, social.label]);
        if (getActivePlatform().username) {
            items.push(['username', 'fa-at', 'Set Username']);
            if (getCharacterUsername()) {
                items.push(settings.showUsername ? ['show-mood', 'fa-face-smile', 'Show Mood'] : ['show-username', 'fa-id-badge', 'Show Username']);
            }
        }
        const menu = jQuery(`<div class="et-dots-menu et-avatar-menu">${items.map(([id, icon, label]) =>
            `<button class="et-dots-item" data-avatar="${id}"><i class="${icon.startsWith('fa-brands') ? icon : `fa-solid ${icon}`}"></i><span>${escapeHtml(label)}</span></button>`).join('')}</div>`);
        // A message's avatar: the menu scrolls with the list; the header's stays on the panel
        const inList = anchor.closest('#et-messages');
        jQuery(inList || '#et-panel').append(menu);

        const a = anchor.getBoundingClientRect();
        const p = document.getElementById('et-panel').getBoundingClientRect();
        const area = inList ? listMenuArea() : { x: p.left, y: p.top, top: 8, bottom: p.height - 8, width: p.width };
        const left = Math.max(8, Math.min(a.left - area.x, area.width - menu.outerWidth() - 8));
        const height = menu.outerHeight();
        const below = a.bottom - area.y + 6;
        const fitsBelow = below + height < area.bottom;
        const top = Math.max(area.top, Math.min(fitsBelow ? below : a.top - area.y - 6 - height, area.bottom - height));
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
            else if (choice === 'username') editCharacterUsername();
            else if (choice === 'show-username' || choice === 'show-mood') setShowUsername(choice === 'show-username');
            else if (choice === 'social') openSocial();
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
            setCustomCharAvatar(charKey, await uploadUserImage(image, char.name, 'echotext-avatar'));
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

    // ── Usernames ────────────────────────────────────────────────────────────
    // On a platform that shows one (Instagram), a character's username is set from the
    // avatar menu and kept in settings.usernameByCharacter; one switch for all
    // characters (settings.showUsername) puts it under the header's name in the mood's
    // place. The profile of an empty chat shows it either way.

    /** The current character's username, '' when none is set. */
    function getCharacterUsername() {
        const key = getCharacterKey();
        return (key && settings.usernameByCharacter?.[key]) || '';
    }

    /** A username as Instagram takes one: no @, no spaces, at most 30 characters. */
    function cleanUsername(value) {
        return String(value ?? '').trim().replace(/^@+/, '').replace(/\s+/g, '').slice(0, 30);
    }

    async function editCharacterUsername() {
        const charKey = getCharacterKey();
        if (!charKey) return;
        const context = SillyTavern.getContext();
        const value = await context.callGenericPopup('Username', context.POPUP_TYPE.INPUT, getCharacterUsername());
        // false or null: cancelled
        if (typeof value !== 'string') return;
        const username = cleanUsername(value);
        settings.usernameByCharacter = settings.usernameByCharacter || {};
        if (username) settings.usernameByCharacter[charKey] = username;
        else delete settings.usernameByCharacter[charKey];
        saveSettings();
        if (!panelOpen) return;
        updatePanelStatusRow();
        renderMessages(getChatHistory(), true);
    }

    function setShowUsername(show) {
        settings.showUsername = show;
        saveSettings();
        if (panelOpen) updatePanelStatusRow();
    }

    /** Saves a JPEG data URL to the user's images, in the character's folder; resolves with its path (user/images/Mira/…). */
    async function uploadUserImage(dataUrl, charName, prefix) {
        const response = await fetch('/api/images/upload', {
            method: 'POST',
            headers: SillyTavern.getContext().getRequestHeaders(),
            body: JSON.stringify({
                image: dataUrl.split(',')[1],
                format: 'jpeg',
                ch_name: charName,
                filename: `${prefix}-${Date.now()}`,
            }),
        });
        if (!response.ok) throw new Error(`upload failed (${response.status})`);
        const { path } = await response.json();
        if (!path) throw new Error('no path returned');
        return path;
    }

    function deleteUserImage(path) {
        fetch('/api/images/delete', {
            method: 'POST',
            headers: SillyTavern.getContext().getRequestHeaders(),
            body: JSON.stringify({ path }),
        }).catch(err => warn('Could not delete an image:', err));
    }

    // ── A photo's own image ──────────────────────────────────────────────────
    // Any photo bubble, the character's or the user's, can be given a real image from
    // its ⋯ menu. It's saved to the user's images and kept on the message by bubble,
    // per version as the tapbacks are (msg.photoImages: { [bubble]: { path, width,
    // height } }). The model still gets only the description, which a tap still shows.
    // Apart from a generated image (msg.imageAttachment), which a reply can carry too.

    // A photo's longest side, in px
    const PHOTO_SIZE = 1600;

    function getPhotoImages(msg) {
        return msg?.photoImages && typeof msg.photoImages === 'object' ? msg.photoImages : {};
    }

    /** Sets the message's photo images, on its current version too. */
    function setPhotoImages(msg, store) {
        const swipe = Array.isArray(msg.swipes) ? msg.swipes[msg.swipeIndex ?? 0] : null;
        if (Object.keys(store).length) {
            msg.photoImages = store;
            if (swipe) swipe.photoImages = { ...store };
        } else {
            delete msg.photoImages;
            if (swipe) delete swipe.photoImages;
        }
    }

    /** Every image a message's photos have, in all its versions (to delete with it). */
    function allPhotoImagePaths(msg) {
        const stores = [getPhotoImages(msg), ...(Array.isArray(msg?.swipes) ? msg.swipes.map(getPhotoImages) : [])];
        return [...new Set(stores.flatMap(store => Object.values(store).map(image => image?.path).filter(Boolean)))];
    }

    /** Picks an image for a photo bubble (replacing any it has) and saves it. */
    async function addPhotoImage(msgIndex, partIndex) {
        const charKey = getCharacterKey();
        const msg = getChatHistory()[msgIndex];
        const char = getCurrentCharacter();
        if (!msg || !char) return;
        // Before any await: a file dialog must open within the tap
        const file = await pickImageFile();
        if (!file) return;
        try {
            const image = await fitImageDataUrl(await readFileAsDataUrl(file), PHOTO_SIZE);
            const path = await uploadUserImage(image.dataUrl, char.name, 'echotext-photo');
            const history = getChatHistory();
            // The chat changed meanwhile: the image has nowhere to go
            if (getCharacterKey() !== charKey || history[msgIndex] !== msg) {
                deleteUserImage(path);
                return;
            }
            const previous = getPhotoImages(msg)[partIndex]?.path;
            setPhotoImages(msg, { ...getPhotoImages(msg), [partIndex]: { path, width: image.width, height: image.height } });
            saveChatHistory(history);
            if (previous && previous !== path) deleteUserImage(previous);
            if (panelOpen) renderMessages(history, true);
        } catch (err) {
            error('Could not add the photo:', err);
            toastr.error(`Could not add the photo: ${err.message}`, 'Echogram');
        }
    }

    function removePhotoImage(msgIndex, partIndex) {
        const history = getChatHistory();
        const msg = history[msgIndex];
        const previous = getPhotoImages(msg)[partIndex]?.path;
        if (!previous) return;
        const store = { ...getPhotoImages(msg) };
        delete store[partIndex];
        setPhotoImages(msg, store);
        saveChatHistory(history);
        deleteUserImage(previous);
        if (panelOpen) renderMessages(history, true);
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

    /** An image no larger than `size` px on its longest side, its shape kept, as a JPEG data URL with its size. */
    function fitImageDataUrl(dataUrl, size) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const scale = Math.min(1, size / Math.max(img.naturalWidth, img.naturalHeight));
                const width = Math.max(1, Math.round(img.naturalWidth * scale));
                const height = Math.max(1, Math.round(img.naturalHeight * scale));
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const g = canvas.getContext('2d');
                // A transparent PNG goes on white, not JPEG's black
                g.fillStyle = '#ffffff';
                g.fillRect(0, 0, width, height);
                g.drawImage(img, 0, 0, width, height);
                resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.88), width, height });
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

        // Another chat's reply under way isn't touched: this one's texts wait for it (startCharacterReply)
        if (generatingHere()) {
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
        } else if (mode === 'location') {
            // "place | address"
            mes = `<location>${text.replace(/\s*\n\s*/g, ' ')}</location>`;
        } else if (mode === 'music') {
            // "song | artist", then lines of lyrics (semicolons or line breaks)
            mes = RichMessages.musicTag(text);
        } else if (mode === 'file') {
            // "title | description", as the kind picked on the chip
            mes = RichMessages.shareTag(text, shareType);
        } else if (mode === 'link') {
            // A platform with links but no files (Instagram): "title | address | description"
            mes = RichMessages.shareTag(text, 'link');
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

        // Replying: the quote goes in front, as the <reply> it is
        if (replyDraft) {
            mes = `<reply>${RichMessages.replyContent(replyDraft)}</reply>\n${mes}`;
            clearReplyDraft();
        }

        input.val('');
        fitInputHeight(input[0]);
        // A photo or transfer is one message; voice from the voice button stays on until switched back, as in WeChat
        if (mode && !isVoiceButtonMode()) setComposeMode(null);
        if (isGenerating) updateSendButton(true);

        postUserMessage(createUserMessage(mes));
    }

    /**
     * Sends a sticker from the panel as a text of its own, there and then (a quote
     * waiting goes with it). As a text sent from the box: during a regeneration it waits.
     */
    function sendSticker(name) {
        if (!name || !getCurrentCharacter()) return;
        if (generatingHere()) {
            if (!replyInProgress) {
                toastr.info('Wait for the current reply to finish.');
                return;
            }
            // As handleSend: a reply not yet asked for starts over to cover this one too
            if (activeCompletionRequests === 0 && abortController) abortController.abort();
        }
        let mes = `<sticker>${name}</sticker>`;
        if (replyDraft) {
            mes = `<reply>${RichMessages.replyContent(replyDraft)}</reply>\n${mes}`;
            clearReplyDraft();
        }
        if (isGenerating) updateSendButton(true);
        postUserMessage(createUserMessage(mes));
    }

    /**
     * The quote for one bubble (the last when `partIndex` is null): its sender and
     * its words on one line — a card as its plain-text note — cut to about 80
     * characters, with nothing that could read as a tag.
     */
    function quoteForBubble(msg, partIndex) {
        const parts = getMessageDisplayParts(msg);
        const words = RichMessages.partWords(parts[partIndex ?? parts.length - 1] || { type: 'text', text: '' });
        const chars = Array.from(words.replace(/<[^>]*>/g, '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim());
        const text = chars.length > 80 ? `${chars.slice(0, 80).join('').trimEnd()}…` : chars.join('');
        const name = msg.is_user ? getUserName() : (msg.charName || getCharacterName());
        return { name, text };
    }

    /** Reply (bubble menu): the bubble's quote waits above the input bar for the next message sent. */
    function startReply(msgIndex, partIndex) {
        const msg = getChatHistory()[msgIndex];
        if (!msg) return;
        replyDraft = { charKey: getCharacterKey(), ...quoteForBubble(msg, partIndex) };
        renderReplyDraft();
        jQuery('#et-input').trigger('focus');
    }

    function clearReplyDraft() {
        replyDraft = null;
        renderReplyDraft();
    }

    function renderReplyDraft() {
        const el = jQuery('#et-reply-draft');
        if (!replyDraft) {
            el.attr('hidden', '').empty();
            return;
        }
        const name = replyDraft.name ? `<span class="et-reply-draft-name">${escapeHtml(replyDraft.name)}</span>` : '';
        el.html(`<i class="fa-solid fa-reply"></i>${name}<span class="et-reply-draft-text">${escapeHtml(replyDraft.text)}</span>`
            + '<button type="button" class="et-reply-draft-close" data-et-role="reply-cancel" title="Cancel reply"><i class="fa-solid fa-xmark"></i></button>')
            .removeAttr('hidden');
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
        // You're back: the last catch-up's bar goes (a paused or failed gap is let go)
        dismissCatchUp();
        const newHistory = [...getChatHistory(), userMsg];
        saveChatHistory(newHistory);
        setFabUnreadIndicator(false);
        markProactiveUserActivity(getCharacterKey(), Date.now());
        // You're back
        storyActiveAt = 0;
        // What the replies before it finished is settled now
        keepLifeMemories();
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
        if (generatingHere() && activeCompletionRequests === 0 && abortController) abortController.abort();
        const tag = accept ? 'transfer_accept' : 'transfer_decline';
        postUserMessage(createUserMessage(`<${tag}>${amount}</${tag}>`));
    }

    // ── Reply scheduling ─────────────────────────────────────────────────────
    // The user can send several texts in a row; the character answers once they
    // pause. A reply the model is already writing finishes first, then the
    // character follows up on whatever arrived meanwhile.

    const REPLY_PAUSE_MS = 3000;
    // Text left in the box holds the reply until this long after its last keystroke
    const DRAFT_HOLD_MS = 60000;

    /** Whether there's text in the box, sent or not. */
    function inputHasText() {
        return !!String(jQuery('#et-input').val() || '').trim();
    }

    /**
     * A keystroke in the box: a reply still waiting starts its pause over; one in its read
     * and typing delays, before the model is asked, is dropped and waits for you as a new
     * text would make it. One the model is already writing finishes.
     */
    function noteTyping() {
        lastTypedAt = Date.now();
        if (replyTimer) {
            scheduleCharacterReply();
        } else if (replyInProgress && generatingHere() && activeCompletionRequests === 0 && abortController) {
            abortController.abort();
            scheduleCharacterReply();
        }
    }

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
        // Text in the box: you're still writing. Wait, up to a minute after its last keystroke
        const idle = Date.now() - lastTypedAt;
        if (inputHasText() && idle < DRAFT_HOLD_MS) {
            scheduleCharacterReply(Math.min(REPLY_PAUSE_MS, DRAFT_HOLD_MS - idle));
            return;
        }
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
        // A follow-up round that was waiting on this (a catch-up, say) goes now, not at its next retry
        if (proactiveMessaging) proactiveMessaging.armProactiveTimer();
        // Once things are quiet, the background summary of older messages
        setTimeout(() => { summarizeOldMessages(); }, 2000);
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

    /** The kinds of file the platform can share: a web page only where it has links. */
    function shareTypes() {
        return RichMessages.SHARE_TYPES.filter(type => type.id !== 'link' || platformHas('link'));
    }

    function renderShareTypeChip() {
        const type = shareTypes().find(t => t.id === shareType) || shareTypes()[0];
        shareType = type.id;
        jQuery('#et-share-type').html(`<span>${escapeHtml(shareTypeLabel(type))}</span><i class="fa-solid fa-chevron-down"></i>`);
    }

    /** The kinds of file to share, in a menu over the chip (styled like the attach menu). */
    function toggleShareTypeMenu(chip) {
        if (jQuery('.et-share-type-menu').length) {
            closeAllDotMenus();
            return;
        }
        closeMenus();
        const items = shareTypes().map(type =>
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
        closeMenus();
        // A platform with its own voice or photo button (the mic and the picture in Instagram's field) leaves them out of the menu
        const platform = getActivePlatform();
        const itemsHtml = Object.entries(Features.getComposerModes(getActiveFeatures()))
            .filter(([id]) => !(id === 'voice' && platform.voiceButton) && !(id === 'photo' && platform.photoButton)).map(([id, m]) =>
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
        toggleBottomPanel('attach');
    }

    /** The sticker panel (the sticker button), the same way: a tab per set and its stickers. */
    function toggleStickerPanel() {
        toggleBottomPanel('stickers');
    }

    /** The "+" panel's tiles: the platform's own (WeChat records voice from the input bar instead); '' with none. */
    function attachPanelHtml() {
        const looks = getActivePlatform().composerPanel || {};
        const tiles = Object.entries(Features.getComposerModes(getActiveFeatures())).filter(([id]) => looks[id]).map(([id, mode]) => {
            const look = { ...mode, ...looks[id] };
            return `<button class="et-attach-panel-item" type="button" data-mode="${id}"><span class="et-attach-panel-icon"><i class="fa-solid ${look.icon}"></i></span><span class="et-attach-panel-label">${escapeHtml(look.label)}</span></button>`;
        }).join('');
        // Last, the social account's page
        const social = socialTheme();
        const socialTile = social ? `<button class="et-attach-panel-item" type="button" data-et-social><span class="et-attach-panel-icon"><i class="${social.icon}"></i></span><span class="et-attach-panel-label">${escapeHtml(social.label)}</span></button>` : '';
        return tiles || socialTile ? `<div class="et-attach-panel-list">${tiles}${socialTile}</div>` : '';
    }

    // The sticker set the panel shows, until another tab is picked (not kept across reloads)
    let stickerTab = null;
    // Holding a set's tab down this long opens its menu; the tab held, until its click goes by
    const STICKER_HOLD_MS = 500;
    let stickerHoldTimer = 0;
    let stickerHeld = null;

    /**
     * The sticker panel: along the top the add button (a ZIP, as in Settings → Stickers) and a
     * tab per set (its first sticker; held down, it's turned on or off for the character),
     * then the set's stickers with their names.
     */
    function stickerPanelHtml() {
        const sets = getStickerLibrary().filter(set => set.stickers.length);
        const current = sets.find(set => set.id === stickerTab) || sets[0];
        stickerTab = current?.id || null;
        const add = '<button class="et-sticker-add" type="button" title="Add"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 20 20"/></svg></button><input type="file" class="et-sticker-add-file" accept=".zip,application/zip" hidden>';
        const tabs = sets.map(set =>
            `<button class="et-sticker-tab${set === current ? ' et-sticker-tab-active' : ''}" type="button" data-sticker-set="${escapeHtml(set.id)}" title="${escapeHtml(set.name)}"><img src="${escapeHtml(set.stickers[0].url)}" alt="" draggable="false"></button>`).join('');
        const stickers = (current?.stickers || []).map(sticker =>
            `<button class="et-sticker-item" type="button" data-sticker-name="${escapeHtml(sticker.name)}"><img src="${escapeHtml(sticker.url)}" alt="" loading="lazy" draggable="false"><span>${escapeHtml(sticker.name)}</span></button>`).join('');
        return `<div class="et-sticker-tabs">${add}${tabs}</div><div class="et-sticker-grid">${stickers}</div>`;
    }

    /** A set's tab held down (or right-clicked): a menu turning it on or off for the open character. */
    function openStickerSetMenu(tab) {
        const charKey = getCharacterKey();
        const set = getStickerLibrary().find(s => s.id === tab.dataset.stickerSet);
        if (!charKey || !set) return;
        closeMenus();
        const on = stickerSetsFor(charKey).includes(set.id);
        const menu = jQuery(`<div class="et-dots-menu et-sticker-set-menu"><button class="et-dots-item${on ? ' et-dots-item-current' : ''}" data-sticker-set-for="${on ? 'off' : 'on'}"><i class="fa-solid ${on ? 'fa-check' : 'fa-user-plus'}"></i><span>${escapeHtml(`${set.name} · ${getCharacterName()}`)}</span></button></div>`);
        jQuery('#et-panel').append(menu);
        const tabRect = tab.getBoundingClientRect();
        const panelRect = document.getElementById('et-panel').getBoundingClientRect();
        const left = Math.max(8, Math.min(panelRect.width - menu.outerWidth() - 8, tabRect.left - panelRect.left));
        menu.css({ left: left + 'px', bottom: (panelRect.bottom - tabRect.top + 6) + 'px', top: 'auto', 'transform-origin': 'bottom left' });
        requestAnimationFrame(() => menu.addClass('et-dots-menu-open'));
        // The row of tabs scrolls sideways: the menu goes with its tab
        const strip = tab.closest('.et-sticker-tabs');
        const stripFrom = strip.scrollLeft;
        const followTab = () => {
            if (!menu[0].isConnected) { strip.removeEventListener('scroll', followTab); return; }
            menu.css('left', (left - (strip.scrollLeft - stripFrom)) + 'px');
        };
        strip.addEventListener('scroll', followTab, { passive: true });
        setTimeout(() => {
            jQuery(document).one('click.et-sticker-set-outside', function (e) {
                if (!jQuery(e.target).closest('.et-sticker-set-menu').length) closeAllDotMenus();
            });
        }, 0);
        menu.find('.et-dots-item').on('click', function (e) {
            e.stopPropagation();
            setStickerSetFor(charKey, set.id, this.dataset.stickerSetFor === 'on');
            renderStickerSets();
            closeAllDotMenus();
        });
    }

    /**
     * Opens the panel of a kind ('attach' | 'stickers'), or closes it when it's the one
     * open; the other kind open turns into this one where it stands.
     */
    function toggleBottomPanel(kind) {
        const open = jQuery('#et-attach-panel');
        if (open.length && open.attr('data-et-panel') === kind) {
            closeAttachPanel();
            return;
        }
        // The list moves up: open menus close rather than float where it was
        closeMenus();
        const html = kind === 'stickers' ? stickerPanelHtml() : attachPanelHtml();
        if (!html) return;
        // Where the list stands before the panel changes
        const fromBottom = messagesFromBottom();
        if (open.length) {
            // From its height now to the new content's
            const from = open.outerHeight();
            open.attr('data-et-panel', kind).html(html).css('height', 'auto');
            const to = open.outerHeight();
            open.css('height', from + 'px');
            void open[0].offsetHeight;
            open.css('height', to + 'px');
            followAttachPanel(open, fromBottom);
            syncStickerButton();
            return;
        }
        const panel = jQuery(`<div class="et-attach-panel" id="et-attach-panel" data-et-role="attach-panel" data-et-panel="${kind}">${html}</div>`);
        jQuery('#et-panel [data-et-role~="input-bar"]').after(panel);
        // Grows from nothing (paced by the platform's height transition), so the
        // input bar and the tiles rise together
        const fullHeight = panel.outerHeight();
        panel.css('height', '0px');
        void panel[0].offsetHeight;
        panel.css('height', fullHeight + 'px');
        followAttachPanel(panel, fromBottom);
        syncStickerButton();
    }

    /** The sticker button shows a keyboard while its panel is open, as WeChat's does. */
    function syncStickerButton() {
        const open = jQuery('#et-attach-panel').attr('data-et-panel') === 'stickers';
        jQuery('#et-sticker-btn').toggleClass('et-sticker-btn-active', open).attr('title', open ? 'Keyboard' : 'Stickers');
    }

    /** The sticker panel drawn again where it stands (the library changed). */
    function refreshStickerPanel() {
        const panel = jQuery('#et-attach-panel[data-et-panel="stickers"]');
        if (!panel.length) return;
        const scroll = panel.find('.et-sticker-grid').scrollTop();
        panel.html(stickerPanelHtml()).find('.et-sticker-grid').scrollTop(scroll);
    }

    /**
     * A tile picks its mode; a sticker is sent there and then, the panel staying up;
     * a tab shows its set. Tapping the message list or the input puts the panel away.
     */
    function bindAttachPanel() {
        jQuery('#et-panel').on('click', '#et-attach-panel .et-attach-panel-item', function (e) {
            e.stopPropagation();
            const mode = jQuery(this).data('mode');
            closeAttachPanel();
            if (this.hasAttribute('data-et-social')) {
                openSocial();
                return;
            }
            setComposeMode(mode);
            jQuery('#et-input').trigger('focus');
        }).on('click', '#et-attach-panel .et-sticker-item', function (e) {
            e.stopPropagation();
            sendSticker(this.dataset.stickerName);
        }).on('click', '#et-attach-panel .et-sticker-tab', function (e) {
            e.stopPropagation();
            // The click that ends holding it down only opened the menu
            if (stickerHeld === this) {
                stickerHeld = null;
                return;
            }
            stickerTab = this.dataset.stickerSet;
            const panel = jQuery('#et-attach-panel');
            panel.html(stickerPanelHtml());
        }).on('pointerdown', '#et-attach-panel .et-sticker-tab', function () {
            const tab = this;
            stickerHeld = null;
            clearTimeout(stickerHoldTimer);
            stickerHoldTimer = setTimeout(() => {
                stickerHeld = tab;
                openStickerSetMenu(tab);
            }, STICKER_HOLD_MS);
        }).on('pointerup pointerleave pointercancel', '#et-attach-panel .et-sticker-tab', () => clearTimeout(stickerHoldTimer))
            .on('contextmenu', '#et-attach-panel .et-sticker-tab', function (e) {
                e.preventDefault();
                clearTimeout(stickerHoldTimer);
                if (stickerHeld !== this) openStickerSetMenu(this);
            })
            .on('click', '#et-attach-panel .et-sticker-add', function (e) {
                e.stopPropagation();
                jQuery(this).siblings('.et-sticker-add-file').trigger('click');
            })
            .on('change', '#et-attach-panel .et-sticker-add-file', function () {
                const file = this.files?.[0];
                this.value = '';
                if (file) importStickerZip(file);
            })
            .on('click', '[data-et-role~="messages"]', closeAttachPanel)
            .on('focus', '#et-input', closeAttachPanel);
    }

    function closeAttachPanel() {
        const panel = jQuery('#et-attach-panel');
        if (!panel.length) return;
        // The list moves down (and a sticker set's menu loses its tab): open menus close
        closeMenus();
        // Shrinks away the same way, then goes; a new "+" meanwhile opens a fresh one
        const fromBottom = messagesFromBottom();
        panel.removeAttr('id').css('height', '0px');
        followAttachPanel(panel, fromBottom);
        setTimeout(() => panel.remove(), attachPanelDuration(panel) + 30);
        syncStickerButton();
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
        closeMenus();
        const amount = card.attr('data-amount') || '';
        const menu = jQuery(`
            <div class="et-dots-menu et-transfer-menu">
                <button class="et-dots-item" data-accept="1"><i class="fa-solid fa-circle-check"></i><span>Accept ${escapeHtml(RichMessages.formatAmount(amount))}</span></button>
                <button class="et-dots-item et-dots-item-delete" data-accept="0"><i class="fa-solid fa-arrow-rotate-left"></i><span>Decline</span></button>
            </div>`);
        jQuery('#et-messages').append(menu);

        const cardRect = card[0].getBoundingClientRect();
        const area = listMenuArea();
        const menuW = 160;
        const menuH = menu.outerHeight() || 90;
        const left = Math.max(8, Math.min(area.width - menuW - 8, cardRect.left - area.x));
        let top = cardRect.bottom - area.y + 6;
        if (top + menuH > area.bottom) {
            top = cardRect.top - area.y - menuH - 6;
            menu.css('transform-origin', 'bottom left');
        } else {
            menu.css('transform-origin', 'top left');
        }
        menu.css({ left: left + 'px', top: Math.max(area.top, top) + 'px' });
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

    /** Whether a generation is under way for the chat open now: only there can it be cancelled. */
    function generatingHere() {
        return isGenerating && isViewing(generatingTarget);
    }

    /** The send button as the chat open now has it (renderMessages sets it again for another chat). */
    function syncSendButton() {
        const btn = jQuery('#et-send-btn');
        // While a reply is being written the button cancels it — unless the user
        // has typed another text, which they can send without interrupting
        const hasDraft = !!String(jQuery('#et-input').val() || '').trim();
        if (generatingHere() && !(replyInProgress && hasDraft)) {
            btn.addClass('et-send-stop').attr('title', 'Cancel generation');
            btn.html('<i class="fa-solid fa-stop"></i>');
        } else {
            btn.removeClass('et-send-stop').attr('title', 'Send message');
            btn.html('<i class="fa-solid fa-paper-plane"></i>');
        }
    }

    function updateSendButton(generating) {
        syncSendButton();
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
        if (!panel) return;

        // The header drags the panel, and so does any bar a page over it marks
        // data-et-drag (the social account's top bar), its buttons aside
        const DRAG_AREAS = '#et-panel-drag-handle, [data-et-drag]';
        const NOT_DRAG = '.et-header-btn, button, input, select, textarea, #et-char-name, #et-panel-status-trigger';
        let isDragging = false;
        let startX, startY, origLeft, origTop;

        panel.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            if (!e.target.closest(DRAG_AREAS) || e.target.closest(NOT_DRAG)) return;
            isDragging = true;
            startX = e.clientX; startY = e.clientY;
            const rect = panel.getBoundingClientRect();
            origLeft = rect.left; origTop = rect.top;
            panel.style.transition = 'none';
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
            e.preventDefault();
        });

        panel.addEventListener('touchstart', (e) => {
            if (!e.target.closest(DRAG_AREAS) || e.target.closest(NOT_DRAG)) return;
            const t = e.touches[0];
            isDragging = true;
            startX = t.clientX; startY = t.clientY;
            const rect = panel.getBoundingClientRect();
            origLeft = rect.left; origTop = rect.top;
            panel.style.transition = 'none';
        }, { passive: true });

        panel.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            const t = e.touches[0];
            const dx = t.clientX - startX, dy = t.clientY - startY;
            panel.style.left = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, origLeft + dx)) + 'px';
            panel.style.top = Math.max(0, Math.min(window.innerHeight - 60, origTop + dy)) + 'px';
        }, { passive: true });

        panel.addEventListener('touchend', () => {
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
    /** A character's values (the open one's without `key`) now, or at `at` (ms), or null while emotions are off. */
    function getEmotionState(key, at) {
        return emotionSystem ? emotionSystem.getEmotionState(key ?? undefined, at) : null;
    }

    function clearEmotionState() {
        if (emotionSystem) emotionSystem.clearEmotionState();
    }

    /** The chat's emotion state as an archive saves it. */
    function getEmotionSnapshot() {
        return emotionSystem ? emotionSystem.getEmotionSnapshot() : null;
    }

    /** The chat's Daily Life state (errands, what happened) as an archive saves it, or null when there's none. */
    function getLifeSnapshot() {
        const key = getCharacterKey();
        const state = key ? settings.lifeState[key] : null;
        return state ? JSON.parse(JSON.stringify(state)) : null;
    }

    /** The memories that go with the chat, as an archive saves them, or null when there are none. */
    function getChatMemoriesSnapshot() {
        const key = getCharacterKey();
        const store = key ? settings.chatMemories?.[key] : null;
        return store ? JSON.parse(JSON.stringify(store)) : null;
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
     * A generated reply as it is kept: { mes, mood, life } — the text without its <mood>
     * and <life> lines, in Auto mode the feelings the first reports (stored as msg.mood),
     * and with Daily Life the changes the second reports (msg.life). Cut to `maxTexts`
     * bubbles, or with `oneText` its lines made one (a follow-up).
     */
    function readReply(text, target = chatTarget(), { maxTexts = null, oneText = false } = {}) {
        const cleaned = cleanGeneratedResponse(text);
        const reply = emotionSystem ? emotionSystem.readReply(cleaned) : { mes: cleaned, mood: null };
        // One thing that happened a reply, at most (the rule asks for that too)
        const { text: lifeless, life } = DailyLife.parseLifeTag(reply.mes, new Date(), { maxHappened: DailyLife.REPLY_HAPPENED });
        const mes = oneText ? RichMessages.oneText(lifeless) : maxTexts ? RichMessages.capTexts(lifeless, maxTexts) : lifeless;
        // Whether the chat it's for keeps them, not whichever is open when it answers
        if (target?.group) return { mes, mood: null, life: null };
        return { mes, mood: reply.mood, life: settings.dailyLifeEnabled === true && target ? life : null };
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
    // DAILY LIFE (docs/platform-plan.md 12; the data is lib/daily-life.js)
    // ============================================================

    // ============================================================
    // A CHARACTER'S DATA ACROSS RENAMES (lib/character-data.js)
    // ============================================================

    const CharacterData = window.EchoTextCharacterData;

    /**
     * SillyTavern renamed a character, and with it their card's file: what Echogram keeps
     * for them moves to the new key. Its own chat change then redraws the panel; one
     * picked here (not SillyTavern's) is redrawn once the cards are listed again.
     */
    function onCharacterRenamed(oldAvatar, newAvatar) {
        if (!oldAvatar || !newAvatar || oldAvatar === newAvatar) return;
        CharacterData.moveCharacterData(settings, oldAvatar, newAvatar);
        if (groupManager?.getActiveCharKey?.() === oldAvatar) groupManager.setActiveCharKey(newAvatar);
        const picked = selectedCharacterKey === oldAvatar;
        if (picked) selectedCharacterKey = newAvatar;
        saveSettings();
        if (picked) setTimeout(() => { if (panelOpen) applySelectedCharacterToPanel(); }, 1000);
    }

    /** The key of every card SillyTavern has. */
    function liveCharacterKeys() {
        return (SillyTavern.getContext().characters || []).map(char => char.avatar || char.name).filter(Boolean);
    }

    /** Remembers every card's name under its key, for naming its data if the card goes. */
    function rememberCharacterNames() {
        if (CharacterData.rememberNames(settings, SillyTavern.getContext().characters || [])) saveSettings();
    }

    /**
     * Settings → General, both copies: data no card has any more (renamed before Echogram
     * moved it, or the card deleted), to move onto the open character or delete. Hidden
     * when there's none, in a group, or before SillyTavern has listed its cards.
     */
    function renderRecoverRows() {
        rememberCharacterNames();
        const rows = jQuery('[data-et-recover]');
        if (!rows.length) return;
        const live = liveCharacterKeys();
        const orphans = live.length && getCharacterKey() && !inGroupSession() ? CharacterData.orphanedKeys(settings, live) : [];
        rows.prop('hidden', !orphans.length);
        const options = orphans.map(o =>
            `<option value="${escapeHtml(o.key)}">${escapeHtml(`${o.name} · ${CharacterData.describeOrphan(o)}`)}</option>`).join('');
        // The one picked stays picked while it's there
        rows.find('[data-et-recover-pick]').each(function () {
            const picked = this.value;
            jQuery(this).html(options);
            if (orphans.some(o => o.key === picked)) this.value = picked;
        });
        rows.find('[data-et-recover-move]').removeClass('et-recover-armed').text(`Move to ${getCharacterName()}`);
        rows.find('[data-et-recover-delete]').removeClass('et-recover-armed').text('Delete');
    }

    // Moving data onto a character goes into theirs, deleting it is for good: a second click within a few seconds
    function bindRecoverRows() {
        let disarm = null;
        jQuery(document).off('click.et-recover').on('click.et-recover', '[data-et-recover-move], [data-et-recover-delete]', function () {
            const button = jQuery(this);
            const from = button.closest('[data-et-recover]').find('[data-et-recover-pick]').val();
            const to = getCharacterKey();
            if (!from || !to) return;
            clearTimeout(disarm);
            if (!button.hasClass('et-recover-armed')) {
                renderRecoverRows();
                button.addClass('et-recover-armed').text('Confirm?');
                disarm = setTimeout(renderRecoverRows, 3000);
                return;
            }
            const name = getCharacterName();
            const moving = button.is('[data-et-recover-move]');
            if (moving) CharacterData.moveCharacterData(settings, from, to);
            else CharacterData.deleteCharacterData(settings, from);
            saveSettings();
            if (moving && panelOpen) applySelectedCharacterToPanel();
            renderRecoverRows();
            toastr.success(moving ? `Moved to ${name}` : `Deleted ${CharacterData.nameOf(from)}`, 'Echogram');
        });
    }

    const DailyLife = window.EchoTextDailyLife;
    // How much slower a busy or sleeping character reads and answers
    const BUSY_SLOWDOWN = 2;

    /** Daily Life on or off: both settings' switches and the popup's Schedule tab follow. */
    function setDailyLifeEnabled(on) {
        settings.dailyLifeEnabled = on === true;
        saveSettings();
        jQuery('#et_daily_life').prop('checked', settings.dailyLifeEnabled);
        if (emotionSystem) emotionSystem.refresh();
        refreshProactiveInsights();
    }

    /** Whether Daily Life applies to the open chat: switched on, and not a group chat. */
    function dailyLifeActive() {
        return settings.dailyLifeEnabled === true && !inGroupSession() && !!getCharacterKey();
    }

    /** The current character's week while Daily Life applies, else null. */
    function activeSchedule() {
        if (!dailyLifeActive()) return null;
        const schedule = DailyLife.normalizeSchedule(settings.characterSchedules[getCharacterKey()]);
        return DailyLife.hasSchedule(schedule) ? schedule : null;
    }

    /**
     * The open chat's errands, what happened and today's change as they stand now (the
     * replies' <life> reports replayed), while Daily Life applies, else null.
     */
    function activeLife() {
        if (!dailyLifeActive()) return null;
        const key = getCharacterKey();
        return DailyLife.currentLife(settings.lifeState[key], new Date(), getEmotionHistory(key));
    }

    /** The rule for the hidden <life> line while Daily Life applies (see buildSystemPrompt), else ''. */
    function buildLifeRules(char) {
        if (!dailyLifeActive()) return '';
        return `\n\n${DailyLife.lifeRules({ charName: char.name || 'Character', userName: getUserName(), madeUp: settings.dailyLifeMadeUp === true,
            schedule: DailyLife.hasSchedule(activeSchedule()) })}`;
    }

    /** The day those rules count from, while Daily Life applies, else ''. */
    /** The block of the week the character is in now ({ day, index, block }), or null. */
    function currentScheduleBlock() {
        const schedule = activeSchedule();
        return schedule ? DailyLife.blockAt(schedule, new Date()) : null;
    }

    /** The open character's change of plan by hand (Life tab; settings.phoneOverrides), held or not. */
    function phoneOverride() {
        return settings.phoneOverrides?.[getCharacterKey()] || null;
    }

    /**
     * The open character's phone now while they have a schedule, { phone, endsAt, by }: a
     * change of plan by hand, else free while still texting you, else the schedule
     * (lib/daily-life.js phoneAt). Null without one.
     */
    function phoneNow() {
        const schedule = activeSchedule();
        if (!schedule) return null;
        return DailyLife.phoneAt({ schedule, override: phoneOverride(), date: new Date(), repliedAt: DailyLife.lastReplyAt(getChatHistory()) });
    }

    /** The open character's phone at a time (ms), as phoneNow tells it for now; null without a schedule. */
    function phoneAtTime(at) {
        const schedule = activeSchedule();
        if (!schedule) return null;
        return DailyLife.phoneAt({ schedule, override: phoneOverride(), date: new Date(at), repliedAt: DailyLife.lastReplyAt(getChatHistory()) });
    }

    /** Time you two spent together in a character's chat, as Recent keeps it: its entries with { from, until }. */
    function togetherSpans(key) {
        return DailyLife.normalizeLife(settings.lifeState?.[key]).start.log.filter(entry => entry.until);
    }

    /** Whether the open character was with you at a time (ms), Daily Life on now or not: a catch-up looking back. */
    function withYouAt(at) {
        return togetherSpans(getCharacterKey()).some(span => span.from <= at && at < span.until);
    }

    /** When the open character's phone state now gives way (ms), for what waits on them; 0 if not ahead. */
    function phoneEndsNow() {
        const now = phoneNow();
        if (!now) return 0;
        if (now.by === 'texting') return now.endsAt;
        return DailyLife.phoneEndsAt({ schedule: activeSchedule(), override: phoneOverride(), date: new Date() }) || 0;
    }

    /** Whether the open character is with you in person now (13a). */
    function isWithYou() {
        return phoneNow()?.phone === 'together';
    }

    /** The ⋯ menu's With {name}: needs a schedule, like every change of plan, and shows when it's on. */
    function updateTogetherItem() {
        jQuery('#et-overflow-together').toggle(!!activeSchedule()).toggleClass('et-overflow-item-on', isWithYou())
            .find('span').text(`With ${getCharacterName()}`);
    }

    /**
     * A change of plan was made or undone (`before` is what it replaced): a reply waiting
     * for the character to look comes now if they're free now, or with you; with you, their
     * follow-ups stop; time together that's over is noted.
     */
    function onPhoneOverride(before = null) {
        const key = getCharacterKey();
        const phone = phoneNow()?.phone;
        if (key && settings.pendingReplies?.[key] && (phone === 'free' || phone === 'together')) {
            settings.pendingReplies[key] = Date.now();
            saveSettings();
            resumePendingReply();
        }
        if (before?.phone === 'together' && phone !== 'together') {
            noteTogether(key, { from: before.from, until: Math.min(before.until, Date.now()) }, { explain: true });
        }
        updatePanelStatusRow();
        refreshProactiveInsights();
    }

    // The time together being summed up: its request's controller
    let summingUp = null;

    /** With you ran out while nobody was changing it: what you two did is noted once. */
    function noteTogetherEnded() {
        const key = getCharacterKey();
        const plan = phoneOverride();
        if (!dailyLifeActive() || plan?.phone !== 'together' || Date.now() < plan.until) return;
        delete settings.phoneOverrides[key];
        saveSettings();
        noteTogether(key, plan);
        updatePanelStatusRow();
        refreshProactiveInsights();
    }

    /**
     * Time together is over: it goes in the life's Recent list right away, under the day
     * it began, with its hours, and when Main Chat is on and has anything from that time, the
     * model's sentence about it takes its place and in Auto mode moves the feelings, with a
     * bar up meanwhile; paused, what's there stays. Today's change goes with it: it was most
     * likely written for this. A text may follow once they've parted. An accidental moment
     * leaves nothing. The entry keeps the span, so a catch-up puts no texts in it. With
     * `explain` (you ended it), says so when no sentence is to come.
     */
    async function noteTogether(key, { from, until }, { explain = false } = {}) {
        const char = getCurrentCharacter();
        if (!char || until - from < DailyLife.TOGETHER_MIN_MINUTES * 60000) return;
        const userName = getUserName();
        const entry = { id: `with${from.toString(36)}`, date: DailyLife.dateKey(new Date(from)), text: DailyLife.togetherEntry({ userName, from, until }), from, until };
        writeLife(key, { edit: parts => ({ ...DailyLife.withEntry(parts, -1, entry), today: null }) });
        if (emotionSystem) emotionSystem.refresh();
        if (proactiveMessaging) proactiveMessaging.planParted(key, until);
        const story = getSTStoryContext(char, { from, until, maxMessages: ST_STRETCH_MAX_MESSAGES, maxChars: ST_STRETCH_MAX_CHARS });
        if (!story) {
            if (explain) {
                toastr.info(settings.ctxMainChat === false ? 'Main Chat is off: no summary'
                    : isCharInCurrentSTChat(char) ? 'No main chat messages from this time: no summary' : `Main chat isn't on ${char.name}: no summary`, 'Echogram');
            }
            return;
        }
        const controller = new AbortController();
        summingUp = controller;
        setStatusBar('et-together-bar', 'Summing up…', 'pause-together', soloTarget(key));
        try {
            const request = DailyLife.buildTogetherRequest({ charName: char.name || 'Character', userName, story, moodRule: buildMoodRules(char) });
            const systemPrompt = withRefusalFrame(request.systemPrompt);
            const raw = await sendCompletionRequest({
                apiMessages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: request.prompt }],
                rawPrompt: request.prompt, systemPrompt, signal: controller.signal,
            });
            if (controller.signal.aborted) return;
            const reply = readReply(stripThinkingTags(String(raw ?? '')), soloTarget(key));
            const text = DailyLife.cleanTogetherEntry(reply.mes);
            if (!text || ChatSummaries.looksLikeRefusal(text)) return;
            // Deleted meanwhile, or the chat cleared: left that way
            if (!DailyLife.normalizeLife(settings.lifeState[key]).start.log.some(e => e.id === entry.id)) return;
            const sentence = { ...entry, text: DailyLife.togetherEntry({ userName, from, until, text }) };
            writeLife(key, { edit: parts => DailyLife.withEntry(parts, parts.log.findIndex(e => e.id === entry.id), sentence) });
            if (emotionSystem) {
                emotionSystem.refresh();
                emotionSystem.applyMood(reply.mood, key);
            }
        } catch (err) {
            if (!controller.signal.aborted) warn('Noting the time together failed:', err);
        } finally {
            if (summingUp === controller) {
                summingUp = null;
                setStatusBar('et-together-bar', '');
            }
        }
    }

    /** Pausing that: the request stops, and what's noted stays as it is. */
    function pauseTogetherNote() {
        if (summingUp) summingUp.abort();
    }

    // Life memories kept per character: at most this many marks of what's been kept
    const LIFE_KEPT_MAX = 300;

    /**
     * Keeps what a chat's life has let go of as Life memories (12e): an errand a
     * reply marked done, once you've texted after it (a swipe can take it back till then;
     * `settledBefore` moves that), and what happened once it's older than the week the life
     * keeps, a memory a week, added to as more of that week goes. Each only once
     * (marked with the chat's memories), even when you delete the memory. A catch-up's
     * `changes` are kept as it settles them. Without `key`, the open chat's while Daily
     * Life applies to it; with one (its life being written), whatever is open.
     */
    function keepLifeMemories({ key = null, settledBefore = null, changes = null } = {}) {
        if (settings.dailyLifeEnabled !== true || !memorySystem) return;
        if (!key) {
            if (!dailyLifeActive()) return;
            key = getCharacterKey();
        }
        const history = getEmotionHistory(key);
        const lastUser = [...history].reverse().find(m => m?.is_user);
        const before = settledBefore ?? (lastUser ? Number(lastUser.send_date) || Date.parse(lastUser.send_date) || 0 : 0);
        const { done, expired } = DailyLife.lettingGo(settings.lifeState?.[key], history, new Date(), { settledBefore: before, changes });
        if (!done.length && !expired.length) return;
        const store = memorySystem.getChatStore(key);
        const { kept } = store;
        const name = getCharacterByKey(key)?.name || 'Character';
        let changed = false;
        for (const errand of done) {
            if (kept[`errand:${errand.id}`]) continue;
            kept[`errand:${errand.id}`] = 1;
            changed = true;
            addLifeMemory(key, DailyLife.errandMemory(errand, name));
        }
        const weeks = new Map();
        for (const entry of expired) {
            if (kept[`entry:${entry.id}`]) continue;
            kept[`entry:${entry.id}`] = 1;
            changed = true;
            const monday = DailyLife.weekOf(entry.date);
            weeks.set(monday, [...(weeks.get(monday) || []), { date: entry.date, text: entry.text }]);
        }
        for (const [monday, entries] of weeks) {
            const week = kept[`week:${monday}`];
            if (!week) {
                const memory = addLifeMemory(key, DailyLife.weekMemory(monday, entries, name));
                if (memory) kept[`week:${monday}`] = { memory: memory.id, entries };
            } else if (store.items.some(m => m.id === week.memory)) {
                // Still there (you may have deleted it): the week's memory grows
                week.entries = [...week.entries, ...entries];
                memorySystem.editMemory(week.memory, DailyLife.weekMemory(monday, week.entries, name));
            }
        }
        const marks = Object.keys(kept);
        for (const mark of marks.slice(0, Math.max(0, marks.length - LIFE_KEPT_MAX))) delete kept[mark];
        if (changed) saveSettings();
    }

    /** Adds a Life memory to a chat's memories. */
    function addLifeMemory(key, { label, content }) {
        return memorySystem.addMemory({ category: 'life', label, content, scope: 'chat', charKey: key });
    }

    /**
     * Writes a chat's life, the one way to besides a reply's report (lib/daily-life.js
     * rewriteLife). The reports so far can't be taken back after this, so what they ended
     * is kept as memories first.
     */
    function writeLife(key, { changes = null, edit = null } = {}) {
        keepLifeMemories({ key, settledBefore: Infinity, changes });
        settings.lifeState[key] = DailyLife.rewriteLife(settings.lifeState[key], getEmotionHistory(key), new Date(), { changes, edit });
        saveSettings();
    }

    /** Where the character is in their life, for the system prompt; '' without Daily Life, or with nothing to say. */
    /** The character's usual schedule from `from`'s day (today) to tomorrow (lib/daily-life.js describeSchedule), Daily Life on; '' else. */
    function buildScheduleContext(charName, from = null) {
        if (!dailyLifeActive()) return '';
        const text = DailyLife.describeSchedule({ schedule: activeSchedule(), charName, date: new Date(), from });
        return text ? `\n\n${text}` : '';
    }

    function buildDailyLifeContext(charName) {
        if (!dailyLifeActive()) return '';
        const text = DailyLife.describeNow({ schedule: activeSchedule(), life: activeLife(), date: new Date(), charName, userName: getUserName(), override: phoneOverride() });
        return text ? `\n\n${text}` : '';
    }

    /**
     * The insights row: the block the character is in now (or a change of plan, or still
     * texting), and when they look at texts they haven't seen.
     */
    function scheduleInsight() {
        if (!activeSchedule()) return '—';
        const now = currentScheduleBlock();
        const phoneNowAt = phoneNow();
        const clock = ms => new Date(ms).toTimeString().slice(0, 5);
        const label = id => DailyLife.PLAN_PHONES.find(p => p.id === id).label;
        const pending = settings.pendingReplies?.[getCharacterKey()];
        const unseen = pending ? ` · reads at ${clock(pending)}` : '';
        if (phoneNowAt.by === 'plan') return `${label(phoneNowAt.phone)} until ${clock(phoneNowAt.endsAt)}${unseen}`;
        const texting = phoneNowAt.by === 'texting' ? ' · texting' : '';
        if (!now) return `Free${unseen}`;
        const { block } = now;
        return `${block.from}–${block.to} ${[block.doing, block.place].filter(Boolean).join(' · ')} (${label(block.phone)})${texting}${unseen}`;
    }

    /**
     * Whether a busy or sleeping character leaves `unread` texts unseen for now: if so, when
     * they'll look is kept (settings.pendingReplies, by character) and true is returned. More
     * unread texts make them likelier to notice; another text that gets through clears it.
     * A change of plan by hand counts, and one still texting you sees them.
     */
    function parkUnseenReply(unread) {
        const key = getCharacterKey();
        const schedule = activeSchedule();
        const until = schedule ? DailyLife.unseenUntil({ schedule, override: phoneOverride(), date: new Date(), unread,
            repliedAt: DailyLife.lastReplyAt(getChatHistory()) }) : null;
        if (!until) {
            if (key && settings.pendingReplies?.[key]) { delete settings.pendingReplies[key]; saveSettings(); }
            refreshProactiveInsights();
            return false;
        }
        // A later text never puts off the look already coming
        if (!settings.pendingReplies) settings.pendingReplies = {};
        const earlier = settings.pendingReplies[key];
        settings.pendingReplies[key] = earlier ? Math.min(earlier, until) : until;
        saveSettings();
        refreshProactiveInsights();
        return true;
    }

    /**
     * A parked reply whose time has come: the character looks at the texts and answers.
     * Checked every minute, when the panel opens and when the app comes back to the
     * front. Gone without a word when the texts were answered or the chat cleared meanwhile;
     * with Daily Life off it goes at once.
     */
    function resumePendingReply() {
        const key = getCharacterKey();
        const at = key ? settings.pendingReplies?.[key] : null;
        if (!at || isGenerating || replyTimer || inGroupSession()) return;
        const history = getChatHistory();
        if (!getUnreadUserMessageIndices(history).length) {
            delete settings.pendingReplies[key];
            saveSettings();
            return;
        }
        if (dailyLifeActive() && Date.now() < at) return;
        delete settings.pendingReplies[key];
        saveSettings();
        generateEchoText(history, null, { noticed: true });
    }

    /** A request's system prompt with the same framing the replies get, when it's on. */
    function withRefusalFrame(systemPrompt) {
        const frame = settings.antiRefusal === true
            ? replaceMacros(settings.promptAntiRefusalFrame || window.EchoTextConfig?.defaultSettings?.promptAntiRefusalFrame || '') : '';
        return frame ? `${systemPrompt}\n\n${frame}` : systemPrompt;
    }

    /**
     * Drafts the character's week from their card and the user's persona (one request,
     * without the chat) and keeps it in place of the one they had. Throws when the
     * model sends back no schedule, or when `signal` stops it (nothing is kept then).
     */
    async function generateSchedule({ signal = new AbortController().signal } = {}) {
        const char = getCurrentCharacter();
        const key = getCharacterKey();
        if (!char || !key) return;
        const name = char.name || 'Character';
        const card = [['description', `${name}'s description`], ['personality', `${name}'s personality`], ['scenario', 'Scenario']]
            .flatMap(([field, label]) => {
                const text = String(char[field] || char.data?.[field] || '').trim();
                return text ? [`${label}: ${replaceMacros(text)}`] : [];
            });
        const opening = getEchoTextFirstMessage(char);
        if (opening) card.push(`How the story began: ${opening.length > 3000 ? `${opening.slice(0, 3000)}…` : opening}`);
        let persona = '';
        try { persona = String(SillyTavern.getContext().powerUserSettings?.persona_description || '').trim(); } catch (e) { /* none */ }
        const request = DailyLife.buildScheduleRequest({ charName: name, userName: getUserName(), card, persona: persona ? replaceMacros(persona) : '' });
        const systemPrompt = withRefusalFrame(request.systemPrompt);
        const raw = await sendCompletionRequest({
            apiMessages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: request.prompt }],
            rawPrompt: request.prompt, systemPrompt, signal,
        });
        // An answer that comes after all (the default connection can't be stopped)
        if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
        const schedule = DailyLife.parseSchedule(stripThinkingTags(String(raw ?? '')));
        if (!DailyLife.hasSchedule(schedule)) throw new Error('the model sent back no schedule');
        settings.characterSchedules[key] = schedule;
        saveSettings();
    }


    // ============================================================
    // PLAYING THE MAIN CHAT (docs/platform-plan.md 13b)
    // ============================================================
    // While you're at it, the character doesn't text first: follow-ups, new topics and
    // catch-ups wait until the main chat has been quiet a while, or you text them. Only
    // whether you're playing counts, not what happens in the story.

    const STORY_PAUSE_MS = 15 * 60000;
    let storyActiveAt = 0;
    // A catch-up put off by that
    let catchUpHeld = false;

    /** A message sent or received in the main chat; the greeting of a chat just opened is no sign of you. */
    function noteStoryActivity(_messageId, type) {
        if (type === 'first_message') return;
        storyActiveAt = Date.now();
        keepStorySpan(storyActiveAt);
        refreshProactiveInsights();
    }

    /**
     * When you played the main chat, for a catch-up to hold back over it as live does
     * (settings.storySpans: [{ from, until }], until being when the pause ran out), the
     * last few days only.
     */
    function keepStorySpan(at) {
        const spans = Array.isArray(settings.storySpans) ? settings.storySpans : [];
        const last = spans[spans.length - 1];
        if (last && at <= last.until) last.until = at + STORY_PAUSE_MS;
        else spans.push({ from: at, until: at + STORY_PAUSE_MS });
        settings.storySpans = spans.filter(span => span.until > at - CatchUp.DAYS * 24 * 3600000);
        saveSettings();
    }

    /**
     * When the character may text first again (ms), while you're playing the main chat; 0
     * otherwise. At `at` (ms), for a catch-up looking back: as it was then.
     */
    function storyPauseUntil(at = undefined) {
        if (settings.storyPauseEnabled === false) return 0;
        if (at !== undefined) return (Array.isArray(settings.storySpans) ? settings.storySpans : []).find(span => span.from <= at && at < span.until)?.until || 0;
        if (!storyActiveAt) return 0;
        const until = storyActiveAt + STORY_PAUSE_MS;
        return until > Date.now() ? until : 0;
    }

    /** The minute's check: a catch-up put off comes once you've stopped. */
    function resumeHeldCatchUp() {
        if (catchUpHeld && !storyPauseUntil()) maybeCatchUp();
    }

    // ============================================================
    // CATCH-UP (docs/platform-plan.md 12c, 12d-3; the logic is lib/catch-up.js)
    // ============================================================
    // Proactive texts only ever run for the open character while the page runs. When you
    // open a character's chat after a while nothing ran for them, Catch up fills the gap
    // in one request: how their life moved on (Daily Life) and the texts they sent you
    // meanwhile (Proactive). A bar says so, and it can be paused (the gap is then left as it is).
    //   settings.proactiveSeenAt[k]: when proactive texts last ran for the character

    const CatchUp = window.EchoTextCatchUp;
    // The catch-up under way: { key, controller }
    let catchingUp = null;
    let seenSavedAt = 0;

    /**
     * Marks the open character seen now: proactive texts are running for them. Not over a
     * gap waiting to be caught up (it's caught up first, or skipped), and not in a group.
     * Saved every ten minutes or so.
     */
    function markSeen(force = false) {
        const key = getCharacterKey();
        if (!key || inGroupSession()) return;
        if (!settings.proactiveSeenAt || typeof settings.proactiveSeenAt !== 'object') settings.proactiveSeenAt = {};
        const now = Date.now();
        const seen = settings.proactiveSeenAt[key];
        if (!force && seen && now - seen > CatchUp.AWAY_MS) return;
        settings.proactiveSeenAt[key] = now;
        if (force || now - seenSavedAt > 10 * 60000) { seenSavedAt = now; saveSettings(); }
    }

    // The bars up now, by id: { target, text, pause }
    const statusBars = new Map();

    /**
     * A bar over the messages while something runs in the background for a chat (`target`),
     * with its pause button (none with `pause` null); gone without `text`. Shown only while
     * that chat is open.
     */
    function setStatusBar(id, text, pause = 'pause', target = chatTarget()) {
        if (text) statusBars.set(id, { target, text, pause });
        else statusBars.delete(id);
        drawStatusBars();
    }

    const CATCH_UP_LAST = { done: 'Caught up', paused: 'Catch-up paused', failed: 'Catch-up failed' };
    // Why a catch-up brought no texts (runCatchUp's `quiet`)
    const CATCH_UP_QUIET = { limit: 'daily limit', reply: 'reply pending', off: 'Proactive off', unwritten: 'none written', failed: 'a text failed' };

    /** The last catch-up's bar: done, how many texts came in, or none and why ("Caught up · no texts · daily limit"). */
    function catchUpLastLabel(last) {
        if (last.state !== 'done' || last.count === undefined) return CATCH_UP_LAST[last.state];
        if (last.count) return `Caught up · ${last.count} ${last.count === 1 ? 'text' : 'texts'}`;
        const why = String(last.quiet || 'none');
        const reason = CATCH_UP_QUIET[why];
        return `Caught up · no texts${reason ? ` · ${reason}` : ''}`;
    }

    /** The bars of the chat open now (the list's chat changed, or a bar did), and the last catch-up's, once it's over. */
    function drawStatusBars() {
        jQuery('#et-messages > .et-catchup-bar').remove();
        for (const [id, { target, text, pause }] of statusBars) {
            if (!isViewing(target)) continue;
            jQuery('#et-messages').prepend(`<div id="${id}" class="et-catchup-bar"><i class="fa-solid fa-clock-rotate-left"></i>`
                + `<span>${text}</span>`
                + (pause ? `<button type="button" class="et-catchup-pause" data-et-catchup="${pause}" title="Pause"><i class="fa-solid fa-pause"></i></button>` : '')
                + `</div>`);
        }
        const key = getCharacterKey();
        // A text of hers that failed: her texts wait on its Retry (or ×, or your text)
        const failed = key && !inGroupSession() ? settings.proactiveState?.[key]?.failed : null;
        if (failed && isViewing(soloTarget(key))) {
            jQuery('#et-messages').prepend(`<div id="et-text-failed" class="et-catchup-bar et-catchup-bar-still" data-state="failed"><i class="fa-solid fa-triangle-exclamation"></i>`
                + `<span>Text failed · ${escapeHtml(failed.error)}</span>`
                + `<button type="button" class="et-catchup-pause" data-et-text-failed="again" title="Retry"><i class="fa-solid fa-rotate-right"></i></button>`
                + `<button type="button" class="et-catchup-pause" data-et-text-failed="dismiss" title="Dismiss"><i class="fa-solid fa-xmark"></i></button>`
                + `</div>`);
        }
        const last = key && !inGroupSession() && catchingUp?.key !== key ? settings.catchUpLast?.[key] : null;
        if (!last || !CATCH_UP_LAST[last.state] || !isViewing(soloTarget(key))) return;
        const again = last.state === 'done' ? 'Redo' : 'Retry';
        jQuery('#et-messages').prepend(`<div id="et-catchup-last" class="et-catchup-bar et-catchup-bar-still" data-state="${last.state}"><i class="fa-solid fa-clock-rotate-left"></i>`
            + `<span>${escapeHtml(catchUpLastLabel(last))}</span>`
            + `<button type="button" class="et-catchup-pause" data-et-catchup="again" title="${again}"><i class="fa-solid fa-rotate-right"></i></button>`
            + `<button type="button" class="et-catchup-pause" data-et-catchup="dismiss" title="Dismiss"><i class="fa-solid fa-xmark"></i></button>`
            + `</div>`);
    }

    function setCatchUpBar(on, key) {
        setStatusBar('et-catchup-bar', on ? 'Catching up…' : '', 'pause', soloTarget(key));
    }


    /**
     * The open character's catch-up, with Catch up on, when their chat is on screen and a
     * gap is due: Daily Life settles their life over it; the texts they'd have sent are
     * worked out by the proactive engine's own rules (lib/proactive-messaging.js
     * simulateAway) and the model only writes them. Nothing to do: they're simply marked seen.
     * `retry` (a paused or failed one's bar): its bar stays until another takes its place, and
     * with nothing to write it says so ("Caught up · no texts · daily limit").
     */
    async function maybeCatchUp({ retry = false } = {}) {
        noteTogetherEnded();
        if (catchingUp || isGenerating || !panelOpen || inGroupSession() || !CatchUp) return;
        // Playing the main chat: once it's been quiet a while (the minute's check picks it up)
        catchUpHeld = storyPauseUntil() > 0;
        if (catchUpHeld) { if (retry) toastr.info('Catch-up waits while you play the main chat', 'Echogram'); return; }
        const char = getCurrentCharacter();
        const key = getCharacterKey();
        if (!char || !key) return;
        // Paused or failed: it waits on its bar's Retry (or ×)
        if (!retry && ['paused', 'failed'].includes(settings.catchUpLast?.[key]?.state)) { drawStatusBars(); return; }
        const plan = catchUpPlan(char, key);
        if (!plan) {
            markSeen(true);
            if (retry) { setCatchUpLast(key, { state: 'done', at: Date.now(), count: 0, quiet: 'none' }); saveSettings(); drawStatusBars(); }
            return;
        }
        const { settle, settleFrom, textFrom, sim, events, now } = plan;
        if (!settle && !events.some(e => !e.text)) {
            // Nothing for the model to write: a round's texts written before go in, and the engine moves on
            const added = skipCatchUp(key, plan);
            if (retry) { setCatchUpLast(key, { state: 'done', at: Date.now(), count: added, quiet: added ? null : catchUpQuiet(sim, events, soloTarget(key)) }); saveSettings(); drawStatusBars(); }
            return;
        }
        await runCatchUp({ char, key, settle, events, sim, from: Math.min(settle ? settleFrom : Infinity, events.length ? textFrom : Infinity), now });
    }

    /**
     * What a catch-up for the open character would cover now, or null when there's no
     * gap to look at (never seen, an empty chat, Catch up off): whether Daily Life settles
     * (from `settleFrom`), and the texts the engine works out (`sim`, from `textFrom`).
     */
    function catchUpPlan(char, key) {
        const history = getChatHistory();
        const seen = settings.proactiveSeenAt?.[key];
        const last = history[history.length - 1];
        if (!seen || !last || settings.catchUpEnabled === false) return null;
        const now = Date.now();
        const lastAt = Number(last.send_date) || Date.parse(last.send_date) || 0;
        const settleFrom = Math.max(lastAt, settings.lifeState?.[key]?.settledAt || 0);
        const settle = dailyLifeActive() && now - settleFrom >= CatchUp.SETTLE_GAP_MS;
        // Texts: not while she owes you a reply
        const textFrom = Math.max(seen, lastAt);
        // Texts: whatever was due while it didn't run live
        const sim = settings.proactiveMessagingEnabled === true && proactiveMessaging && !last.is_user && now - textFrom >= CatchUp.AWAY_MS
            ? proactiveMessaging.simulateAway(key, char, { from: textFrom, to: now, days: CatchUp.DAYS, max: CatchUp.MAX_TEXTS }) : null;
        return { settle, settleFrom, textFrom, sim, events: sim ? sim.events : [], now };
    }

    /**
     * Lets a gap go without the model: the texts a round had written already go in, the
     * engine's state moves on, the life counts as settled, and the character is seen now.
     */
    function skipCatchUp(key, { settle, sim, events, now }) {
        let added = 0;
        if (events.some(e => e.text)) {
            const chat = getChatHistory();
            added = insertCatchUpTexts(chat, soloTarget(key), events);
            if (added) { saveChatHistory(chat); renderMessages(chat); }
        }
        if (sim) proactiveMessaging.adoptSimulation(key, sim.state);
        if (settle) settings.lifeState[key] = { ...DailyLife.normalizeLife(settings.lifeState[key]), settledAt: now };
        markSeen(true);
        return added;
    }

    /** Why a catch-up brought no texts (CATCH_UP_QUIET): none to write, Proactive off, a reply owed, or the engine's reason. */
    function catchUpQuiet(sim, events, target) {
        return events.length ? 'unwritten'
            : !sim ? (settings.proactiveMessagingEnabled !== true ? 'off' : getChatHistory(target).at(-1)?.is_user ? 'reply' : 'none')
            : sim.quiet?.why || 'none';
    }

    // ── After a catch-up (settings.catchUpLast[k]) ───────────────────────────
    // Its bar stays: done, it can be redone (its texts and its <life> changes taken back,
    // the engine starting again from where it was); paused or failed, retried. Kept over
    // a reload or another chat until × or your next text (a paused or failed gap is then
    // let go, as × does).
    //   { state: 'done' | 'paused' | 'failed', at, run?, before? }  (done: `run` marks its
    //   texts, `before` is the engine's state, the life and when they were seen, as it began)

    function setCatchUpLast(key, last) {
        if (!settings.catchUpLast || typeof settings.catchUpLast !== 'object') settings.catchUpLast = {};
        if (last) settings.catchUpLast[key] = last;
        else delete settings.catchUpLast[key];
    }

    /** The open character's catch-up again: a paused or failed one tried again, a done one redone. */
    function retryCatchUp() {
        const key = getCharacterKey();
        const last = key && settings.catchUpLast?.[key];
        if (!last || catchingUp || isGenerating) return;
        // Paused or failed: its bar stays until what comes of trying again takes its place
        if (last.state !== 'done') return maybeCatchUp({ retry: true });
        // Done with nothing it began from (one that had nothing to write): looked at again
        if (last.before) {
            const { proactive, life, seenAt } = last.before;
            if (!settings.proactiveState) settings.proactiveState = {};
            if (proactive) settings.proactiveState[key] = proactive;
            else delete settings.proactiveState[key];
            if (life) settings.lifeState[key] = life;
            else delete settings.lifeState[key];
            if (seenAt) settings.proactiveSeenAt[key] = seenAt;
            const chat = getChatHistory().filter(m => m?.meta?.catchUp !== last.run);
            saveChatHistory(chat);
            renderMessages(chat);
        }
        setCatchUpLast(key, null);
        saveSettings();
        // One that had nothing to write says again what comes of looking
        return maybeCatchUp({ retry: !last.before });
    }

    /** The bar's ×, or your next text: done, it just goes; paused or failed, the gap is let go too. */
    function dismissCatchUp(key = getCharacterKey()) {
        const last = key && settings.catchUpLast?.[key];
        if (!last || catchingUp?.key === key) return;
        setCatchUpLast(key, null);
        if (last.state !== 'done') {
            const char = getCurrentCharacter();
            const plan = char && getCharacterKey() === key ? catchUpPlan(char, key) : null;
            if (plan) skipCatchUp(key, plan);
            else markSeen(true);
        }
        saveSettings();
        drawStatusBars();
    }

    /**
     * A catch-up's texts into a chat at the engine's times, in its order: the model's by
     * number (`written`: { n, mes }, n counting from 1 over `events`), or what a round had
     * written already, marked with the catch-up's `run`. One the model left out stays out.
     * How many went in.
     */
    function insertCatchUpTexts(chat, target, events, written = [], run = null) {
        let added = 0;
        events.forEach((e, i) => {
            const mes = written.find(w => w.n === i + 1)?.mes;
            const reply = e.text || (mes ? readReply(mes, target, { maxTexts: window.EchoTextProactiveRounds.TOPIC_MAX_TEXTS }) : null);
            if (!reply?.mes) return;
            chat.push({
                is_user: false, mes: reply.mes, send_date: e.at,
                meta: { proactive: true, proactiveType: e.type,
                    // The catch-up it came in, to take back on Redo
                    ...(run ? { catchUp: run } : {}) },
                ...(reply.mood ? { mood: reply.mood } : {}),
            });
            added++;
        });
        return added;
    }

    async function runCatchUp({ char, key, settle, events, sim, from, now }) {
        const controller = new AbortController();
        catchingUp = { key, controller };
        // Where things were, for Redo
        const clone = v => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)));
        const before = { proactive: clone(settings.proactiveState?.[key]), life: clone(settings.lifeState?.[key]), seenAt: settings.proactiveSeenAt?.[key] || null };
        const run = now;
        // Holds the proactive timers and your next reply until it's done (onGenerationSettled)
        isGenerating = true;
        generatingTarget = soloTarget(key);
        setCatchUpBar(true, key);
        // Its chat, whatever's open when it answers; written while its last message is still there
        const target = soloTarget(key);
        // The texts the model writes: those no round had written already, numbered over all of them
        const asked = events.map((e, i) => ({ n: i + 1, at: e.at, note: e.note, text: e.text })).filter(e => !e.text);
        let notSent = false;
        let inserted = false;
        let failed = false;
        let added = 0;
        try {
            const history = getChatHistory(target);
            const anchor = history[history.length - 1] || null;
            const userName = getUserName();
            // The schedule from the first of the days it tells in detail
            const scheduleFrom = Math.max(from, now - CatchUp.DAYS * 24 * 60 * 60 * 1000);
            const { apiMessages, rawPrompt, systemPrompt } = await buildApiMessagesFromHistoryForChar(history, [], char, { verbosity: false, scheduleFrom });
            // Built from what's open now: another chat by then, it isn't sent and the gap waits
            if (!isViewing(target)) { notSent = true; return; }
            const instruction = CatchUp.buildInstruction({
                charName: char.name || 'Character', userName, from, now, settle, schedule: activeSchedule(),
                errands: activeLife()?.errands || [], madeUp: settings.dailyLifeMadeUp === true, texts: asked,
                // How they're written, when there are any
                guidance: asked.length ? sim?.guidance || null : null,
            });
            apiMessages.push({ role: 'user', content: `[Instruction for this turn — not a message from ${userName}; never quote or answer it: ${instruction}]` });
            if (asked.length) proactiveMessaging.noteCatchUpRequest(key);
            const raw = await requestEchoTextCompletion({ apiMessages, rawPrompt, systemPrompt, signal: controller.signal });
            // Paused: left as it is. The chat cleared or replaced meanwhile: the gap was another chat's
            if (controller.signal.aborted) return;
            const chat = getChatHistory(target);
            if (anchor && !chat.includes(anchor)) { inserted = true; return; }
            const answer = CatchUp.readAnswer(stripThinkingTags(String(raw ?? '')), { now, asked: asked.map(e => e.n) });
            // Texts asked for and none came back: it failed, nothing kept, its bar offers Retry
            if (asked.length && !answer.texts.length) throw new Error('none of the texts came back');
            if (settle) writeLife(key, { changes: answer.life });
            inserted = 'done';
            added = insertCatchUpTexts(chat, target, events, answer.texts, run);
            if (added) {
                saveChatHistory(chat, target);
                if (isViewing(target)) renderMessages(chat);
            }
        } catch (err) {
            if (!controller.signal.aborted) {
                failed = true;
                warn('Catching up failed:', err);
                toastr.error(`Could not catch up: ${err.message}`, 'Echogram');
            }
        } finally {
            // Paused or failed: nothing moves on, and its bar offers Retry (or ×, which lets the gap go)
            const held = !notSent && !inserted && (failed || controller.signal.aborted);
            if (held) setCatchUpLast(key, { state: failed ? 'failed' : 'paused', at: Date.now() });
            // Done (or the chat gone meanwhile): the gap isn't tried again (not sent for another
            // chat: it is). What the engine worked out holds: texts a round had written still go
            // in, and its state moves on so nothing comes twice
            if (!notSent && !held) {
                if (!inserted && events.some(e => e.text)) {
                    const chat = getChatHistory(target);
                    if (insertCatchUpTexts(chat, target, events)) {
                        saveChatHistory(chat, target);
                        if (isViewing(target)) renderMessages(chat);
                    }
                }
                if (sim) proactiveMessaging.adoptSimulation(key, sim.state);
                if (settle) settings.lifeState[key] = { ...DailyLife.normalizeLife(settings.lifeState[key]), settledAt: now };
                if (getCharacterKey() === key) markSeen(true);
                else settings.proactiveSeenAt[key] = Date.now();
                // Done: its bar stays, to redo it, saying how many came in, or why none did
                const quiet = added ? null : catchUpQuiet(sim, events, target);
                setCatchUpLast(key, inserted === 'done' ? { state: 'done', at: Date.now(), run, before, count: added, quiet } : null);
            }
            catchingUp = null;
            isGenerating = false;
            setCatchUpBar(false, key);
            saveSettings();
            if (emotionSystem) emotionSystem.refresh();
            refreshProactiveInsights();
            onGenerationSettled();
        }
    }

    /** Whether a catch-up is due for the open character: their live texts wait for it (lib/proactive-messaging.js). */
    function catchUpPending(key) {
        if (!CatchUp || settings.catchUpEnabled === false || inGroupSession() || !key || key !== getCharacterKey()) return false;
        if (catchingUp?.key === key) return true;
        const seen = settings.proactiveSeenAt?.[key];
        return !!seen && Date.now() - seen > CatchUp.AWAY_MS;
    }

    /** The open character's failed text tried again now (its bar's ↻), as of now. */
    function retryFailedText() {
        const char = getCurrentCharacter();
        const key = getCharacterKey();
        if (!char || !key || !proactiveMessaging) return;
        const going = proactiveMessaging.retryFailedText(char, key);
        drawStatusBars();
        return going;
    }

    /** The open character's failed text let go (its bar's ×): her next one planned from now. */
    function dismissFailedText() {
        const key = getCharacterKey();
        if (!key || !proactiveMessaging) return;
        proactiveMessaging.dismissFailedText(key);
        drawStatusBars();
    }

    /** Pausing a catch-up: its request stops, and the gap is left as it is. */
    function pauseCatchUp() {
        if (catchingUp) catchingUp.controller.abort();
    }

    // ============================================================
    // AI CHARACTER REACTIONS TO USER MESSAGES
    // ============================================================
    // The model reacts by writing <react>name</react> in its reply; the reaction shows
    // on the user's bubble a <reply> right before it quotes, else on the last bubble of
    // the user's latest message before that reply (a part's tapbacks in
    // lib/chat-view-model.js; the platform's message template draws it). Older chats
    // may still carry a stored msg.charReaction from the former keyword-based
    // auto-reaction, which shows on the message's last bubble.

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

        // Plain text, as a messaging app shows it: no Markdown. Every \n is a line of its own
        const html = escapeHtml(raw).split(/\n/).map(line => `<p>${line}</p>`).join('');
        return DOMPurify.sanitize(html, { ALLOWED_TAGS: ['p'], ALLOWED_ATTR: [] });
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
            if (isGenerating) {
                toastr.info('Wait for the current reply to finish.');
                return;
            }
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
        // The tapbacks already on a bubble (its menu is a hold or right-click on the bubble: openBubbleMenu)
        'react': ({ el, msgIndex, partIndex }) => {
            closeAllDotMenus();
            toggleReactOverlay(jQuery(el), msgIndex, partIndex);
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
        // A bubble held down, or right-clicked, opens its menu
        const el = inner[0];
        if (el && !el._etBubbleHoldBound) {
            el._etBubbleHoldBound = true;
            el.addEventListener('pointerdown', onBubblePointerDown);
            el.addEventListener('pointermove', onBubblePointerMove, { passive: true });
            for (const type of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(type, cancelBubbleHold);
            el.addEventListener('contextmenu', onBubbleContextMenu);
            // Capture phase: the click that ends a hold does nothing else (a photo's, a voice message's)
            el.addEventListener('click', swallowHeldClick, true);
        }
    }

    // ── A bubble's menu: held down (touch, or a mouse button) or right-clicked ──
    // The menu (Reply, React, Copy, Edit, Delete…) goes under the bubble; React (a
    // character's bubble, where the platform has tapbacks) opens the tapback row over it.
    // A message's last bubble's menu covers the whole message, the others' their bubble.
    const BUBBLE_HOLD_MS = 500;
    // A finger moving further than this is scrolling, not holding
    const BUBBLE_HOLD_SLOP = 10;
    let bubbleHold = null;
    // The bubble a hold just opened the menu of, until the click that ends it goes by
    let bubbleHeld = null;

    /** The bubble a press on `target` holds, or null (one being edited, its controls, a tapback, an avatar). */
    function bubbleTarget(target) {
        if (!target?.closest) return null;
        if (target.closest('[contenteditable="true"], [data-et-role="edit-save"], [data-et-role="edit-cancel"], [data-et-action="swipe-prev"], [data-et-action="swipe-next"], [data-et-action="react"], [data-et-action="avatar"]')) return null;
        return target.closest('[data-et-role~="bubble"]');
    }

    function onBubblePointerDown(e) {
        bubbleHeld = null;
        cancelBubbleHold();
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const bubble = bubbleTarget(e.target);
        if (!bubble) return;
        const ref = bubbleRef(bubble);
        bubbleHold = {
            x: e.clientX,
            y: e.clientY,
            timer: setTimeout(() => {
                bubbleHold = null;
                // Redrawn meanwhile (a reply or "typing" arriving): its new self, else nothing
                const live = bubble.isConnected ? bubble : findBubble(ref);
                if (!live) return;
                bubbleHeld = live;
                openBubbleMenu(live);
            }, BUBBLE_HOLD_MS),
        };
    }

    /** Where a bubble is: its message's index and its place among the message's bubbles. */
    function bubbleRef(bubble) {
        const msgEl = bubble.closest('[data-et-role~="message"]');
        return { index: msgEl?.dataset.index, at: msgEl ? [...msgEl.querySelectorAll('[data-et-role~="bubble"]')].indexOf(bubble) : -1 };
    }

    /** The bubble at `ref` as the list has it now, or null. */
    function findBubble(ref) {
        const msgEl = findMessageElement(ref.index)[0];
        return (msgEl && ref.at >= 0 && msgEl.querySelectorAll('[data-et-role~="bubble"]')[ref.at]) || null;
    }

    function onBubblePointerMove(e) {
        if (bubbleHold && Math.hypot(e.clientX - bubbleHold.x, e.clientY - bubbleHold.y) > BUBBLE_HOLD_SLOP) cancelBubbleHold();
    }

    function cancelBubbleHold() {
        if (bubbleHold) clearTimeout(bubbleHold.timer);
        bubbleHold = null;
    }

    /** A right-click (or a touch screen's own long-press menu) opens the bubble's menu instead of the browser's. */
    function onBubbleContextMenu(e) {
        const bubble = bubbleTarget(e.target);
        if (!bubble) return;
        e.preventDefault();
        cancelBubbleHold();
        if (bubbleHeld === bubble) return;
        openBubbleMenu(bubble);
    }

    function swallowHeldClick(e) {
        if (!bubbleHeld || !bubbleHeld.contains(e.target)) return;
        e.stopPropagation();
        e.preventDefault();
        bubbleHeld = null;
    }

    /** A bubble's menu (a character's has React, where the platform has tapbacks, for the tapback row). */
    function openBubbleMenu(bubble) {
        // A menu placed by a bubble no longer on the page would land in the corner
        if (!bubble.isConnected) return;
        const msgEl = bubble.closest('[data-et-role~="message"]');
        const msgIndex = parseInt(msgEl?.dataset.index, 10);
        const msg = getChatHistory()[msgIndex];
        if (!msg) return;
        const bubbles = [...msgEl.querySelectorAll('[data-et-role~="bubble"]')];
        const part = bubble.matches('[data-et-role~="main"]') || bubbles.indexOf(bubble) === bubbles.length - 1 ? null : bubbles.indexOf(bubble);
        closeAllReactOverlays();
        toggleDotsMenu(jQuery(bubble), msgIndex, !!msg.is_user, part);
    }

    /**
     * Puts the active platform on the panel: its id in data-platform (its CSS is
     * scoped under it), its stylesheet loaded only while in use, the "+" button
     * only when it has something to attach, and the pickers in settings.
     */
    // ── One gradient across the visible list (Instagram's sent bubbles) ──────
    // A platform naming elements in `sharedFill` gets on each how far its top sits
    // below the top of the visible list (--et-fill-y), and the list's height on the
    // list (--et-fill-h), so its CSS can size one gradient to the list and show each
    // element its own slice, shifting as the list scrolls. A fixed background would
    // do it, but SillyTavern's transform on <html> turns those off.
    let sharedFillFrame = 0;

    function updateSharedFill() {
        sharedFillFrame = 0;
        const list = document.getElementById('et-messages');
        const selector = getActivePlatform().sharedFill;
        if (!list || !selector) return;
        const box = list.getBoundingClientRect();
        list.style.setProperty('--et-fill-h', `${Math.round(box.height)}px`);
        for (const el of list.querySelectorAll(selector)) {
            el.style.setProperty('--et-fill-y', `${Math.round(el.getBoundingClientRect().top - box.top)}px`);
        }
    }

    function queueSharedFill() {
        if (!sharedFillFrame) sharedFillFrame = requestAnimationFrame(updateSharedFill);
    }

    /**
     * Keeps the shared fill current on the list now in the panel: scrolling, messages
     * and bubbles coming and going or opening, the panel resized. (Style changes
     * aren't watched: updating sets them.)
     */
    function watchSharedFill() {
        const list = document.getElementById('et-messages');
        if (!list || list.etSharedFill) return;
        list.etSharedFill = true;
        list.addEventListener('scroll', queueSharedFill, { passive: true });
        list.addEventListener('animationend', queueSharedFill);
        new MutationObserver(queueSharedFill).observe(list, { childList: true, subtree: true, attributes: true,
            attributeFilter: ['class', 'hidden', 'aria-expanded', 'data-et-arrive', 'data-platform'] });
        if (window.ResizeObserver) new ResizeObserver(queueSharedFill).observe(list);
    }

    // ── Bubbles hug their longest line ───────────────────────────────────────
    // A box that wraps its text keeps the whole width it was allowed, so a text whose
    // lines break early (before a long word) leaves a gap between its words and the
    // bubble's right edge; messaging apps fit the bubble to the longest line instead.
    // Every text in the list (data-et-role="text") gets that width whenever messages
    // come, show or change, the list is resized or fonts change. A text being edited
    // keeps the full width. A song's shared lines (data-et-role="lyrics") are fitted to
    // their card in the same pass.
    let fitTextsFrame = 0;

    /** How far a text's longest line ends short of its box, in px (0 when it fills it or shows nothing). */
    function textGap(el) {
        let right = -Infinity;
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const range = document.createRange();
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            range.selectNodeContents(node);
            for (const rect of range.getClientRects()) right = Math.max(right, rect.right);
        }
        // Inline code's padding and border reach past its text
        for (const code of el.querySelectorAll('code')) {
            for (const rect of code.getClientRects()) right = Math.max(right, rect.right);
        }
        if (right === -Infinity) return 0;
        const style = getComputedStyle(el);
        const contentRight = el.getBoundingClientRect().right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
        return Math.max(0, Math.floor(contentRight - right));
    }

    function fitTexts() {
        fitTextsFrame = 0;
        const list = document.getElementById('et-messages');
        if (!list) return;
        const texts = [...list.querySelectorAll('[data-et-role~="text"]')];
        // All cleared first, so a wider list lets them grow back; then measured, then set
        for (const el of texts) el.style.width = '';
        const widths = texts.map(el => {
            if (el.isContentEditable) return null;
            const gap = textGap(el);
            return gap > 1 ? parseFloat(getComputedStyle(el).width) - gap : null;
        });
        texts.forEach((el, i) => {
            if (widths[i] !== null) el.style.width = `${widths[i]}px`;
        });
        for (const el of list.querySelectorAll('[data-et-role~="lyrics"]')) fitLyrics(el);
    }

    /**
     * Fits a song's shared lines to their box, whose height the platform's CSS caps
     * (max-height): the largest font between its --et-lyrics-max and --et-lyrics-min
     * (px) at which they all fit, and when even the smallest is too big, only as many
     * lines from the first as fit. Never a box that scrolls or spills over.
     */
    function fitLyrics(el) {
        const lines = [...el.children];
        for (const line of lines) line.style.display = '';
        el.style.fontSize = '';
        const style = getComputedStyle(el);
        const max = parseFloat(style.getPropertyValue('--et-lyrics-max')) || parseFloat(style.fontSize);
        const min = Math.min(max, parseFloat(style.getPropertyValue('--et-lyrics-min')) || max);
        const overflows = () => el.scrollHeight > el.clientHeight + 1;
        let size = max;
        el.style.fontSize = `${size}px`;
        while (size > min && overflows()) el.style.fontSize = `${--size}px`;
        for (let i = lines.length - 1; i > 0 && overflows(); i--) lines[i].style.display = 'none';
    }

    function queueFitTexts() {
        if (!fitTextsFrame) fitTextsFrame = requestAnimationFrame(fitTexts);
    }

    /** Keeps the texts on the list now in the panel fitted (setting their widths isn't watched). */
    function watchTextFit() {
        const list = document.getElementById('et-messages');
        if (!list || list.etTextFit) return;
        list.etTextFit = true;
        // Typing in a text being edited changes nothing to fit
        const editing = node => !!(node.nodeType === 1 ? node : node.parentElement)?.isContentEditable;
        new MutationObserver(records => {
            if (records.some(r => !editing(r.target))) queueFitTexts();
        }).observe(list, { childList: true, subtree: true, attributes: true,
            attributeFilter: ['hidden', 'aria-expanded', 'data-et-arrive', 'contenteditable', 'data-platform'] });
        let listWidth = 0;
        if (window.ResizeObserver) {
            new ResizeObserver(([entry]) => {
                if (entry.contentRect.width === listWidth) return;
                listWidth = entry.contentRect.width;
                queueFitTexts();
            }).observe(list);
        }
        document.fonts?.addEventListener?.('loadingdone', queueFitTexts);
    }

    function syncPlatformChrome() {
        const platform = getActivePlatform();
        watchSharedFill();
        queueSharedFill();
        watchTextFit();
        queueFitTexts();
        jQuery('#et-panel').attr({
            'data-platform': platform.id,
            'data-et-scheme': getColorScheme(),
            'data-et-typing': typingShown() ? '' : null,
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
        // One that starts a photo from its own button (Instagram's picture in the field) shows it
        jQuery('#et-photo-btn').prop('hidden', !(platform.photoButton && modes.photo));
        // A mode the platform lacks ends; one it has is redrawn (voice moves between "+" and the voice button)
        if (composeMode) setComposeMode(modes[composeMode] ? composeMode : null);
        if (!platform.composerPanel && jQuery('#et-attach-panel').attr('data-et-panel') !== 'stickers') closeAttachPanel();
        // Stickers: the button where the platform has them; their panel goes where it hasn't
        const stickers = platform.features.includes('sticker');
        jQuery('#et-sticker-btn').prop('hidden', !stickers);
        if (!stickers && jQuery('#et-attach-panel').attr('data-et-panel') === 'stickers') closeAttachPanel();
        populatePlatformSelects();
    }

    /** Fills the platform pickers in both settings views: the default, and the current character's. */
    function populatePlatformSelects() {
        const options = PLATFORM_IDS.filter(id => Platforms[id])
            .map(id => `<option value="${id}">${escapeHtml(Platforms[id].name)}</option>`).join('');
        const charKey = getCharacterKey();
        const charChoice = charKey ? settings.platformByCharacter?.[charKey] : null;
        jQuery('#et_platform_default')
            .html(options)
            .val(Platforms[settings.defaultPlatform] ? settings.defaultPlatform : 'echotext');
        jQuery('#et_platform_character')
            .html(`<option value="">Use default</option>${options}`)
            .val(Platforms[charChoice] ? charChoice : '')
            .prop('disabled', !charKey);
        jQuery('#et_platform_character_label')
            .text(charKey ? `Platform for ${getCharacterName()}` : 'Platform for this character');
    }

    function bindPlatformSelects() {
        jQuery(document).off('change.et-platform')
            .on('change.et-platform', '#et_platform_default', function () {
                settings.defaultPlatform = this.value;
                onPlatformChoiceChanged();
            })
            .on('change.et-platform', '#et_platform_character', function () {
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
        closeMenus();
        saveSettings();
        activePlatformMemo = null;
        populatePlatformSelects();
        // The input's own wording on the new platform (not while a photo or voice is being composed)
        const input = jQuery('#et-input');
        if (input.data('et-text-placeholder') !== undefined && input.data('et-compose-placeholder') === undefined) {
            setInputPlaceholder(input.data('et-text-placeholder'));
        }
        if (panelOpen) {
            updatePanelStatusRow();
            renderMessages(getChatHistory(), true);
        }
    }

    // The view of each message on screen, by index, so refreshMessages() replaces only what changed
    let renderedViews = new Map();

    /**
     * What renderedViews keeps of a message as drawn: its view, and which of its
     * bubbles carry a tapback (with its time, to tell it from another message that
     * took its index when one before it was deleted).
     */
    function renderedEntry(m, signature = JSON.stringify(m)) {
        return { signature, timestamp: m.timestamp, tapbacks: tapbackMarks(m) };
    }

    /** Which of a message's bubbles show a tapback (the user's on a character's, the character's on the user's). */
    function tapbackMarks(m) {
        return m.parts.map(p => !!p.tapbacks?.length);
    }

    /** View-model options for the chat on screen. */
    function getChatViewOptions() {
        return {
            charName: getCharacterName(),
            userName: getUserName(),
            reactionIds: getReactionIds(),
            features: getActiveFeatures(),
            combineMode: !!(groupManager && groupManager.isGroupSession() && groupManager.isCombineMode()),
            swipes: !!settings.swipedMessages,
            songArt: (title, artist) => songArt?.cached(title, artist) ?? null,
            findSticker: name => Stickers.findSticker(getStickerLibrary(), name),
        };
    }

    // ── Song covers ──────────────────────────────────────────────────────────
    // The songs on screen without a cover are looked up after each render
    // (lib/music-lookup.js); the messages whose covers came in are drawn again. A slow
    // or blocked network only leaves the placeholders.
    let songArtTimer = 0;

    function requestSongArt(view) {
        if (!songArt) return;
        for (const m of view.messages) {
            for (const p of m.parts) {
                if (p.type === 'music' && !p.cover) songArt.request(p.title, p.artist).then(found => found && queueSongArtRefresh());
            }
        }
    }

    function queueSongArtRefresh() {
        clearTimeout(songArtTimer);
        songArtTimer = setTimeout(() => {
            // A reply still arriving bubble by bubble would show whole when redrawn: wait for it
            if (document.querySelector('#et-messages-inner [data-et-role~="bubble"][style*="display: none"]')) {
                queueSongArtRefresh();
                return;
            }
            if (panelOpen) refreshMessages(getChatHistory());
        }, 300);
    }

    /** What platform templates get besides a message's own view (see platforms/echotext/platform.js). */
    function getMessageRenderContext() {
        const { DOMPurify } = SillyTavern.libs;
        return {
            charName: getCharacterName(),
            username: getActivePlatform().username ? getCharacterUsername() : '',
            // Bubbles whose tapback is new: they make room for it and it pops in (replaceMessageElement)
            arrivingTapbacks: [],
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

    /** What a message's markup doesn't carry: its arrival sequence. */
    function decorateMessage(msgEl, m) {
        if (shouldStaggerReveal(m)) {
            staggerRevealParts(msgEl);
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
        requestSongArt(view);
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
            renderedViews.set(m.index, renderedEntry(m, signature));
        }
    }

    /**
     * Swaps a rendered message for its new view: no entrance animation, open photos
     * stay open. A bubble that just got a tapback makes room for it above, and the
     * list scrolls along so the bubble stays put and what's above slides up.
     */
    function replaceMessageElement(oldEl, m, prev, ctx) {
        const expanded = oldEl.find('[aria-expanded]').map((i, el) => el.getAttribute('aria-expanded')).get();
        const was = prev && prev.timestamp === m.timestamp ? prev.tapbacks || [] : null;
        const arriving = was ? tapbackMarks(m).flatMap((on, j) => (on && !was[j] ? [j] : [])) : [];
        const anchor = arriving.length ? oldEl.find('[data-et-role~="bubble"]')[arriving[0]] : null;
        const anchorTop = anchor ? anchor.getBoundingClientRect().top : null;
        const html = getActivePlatform().templates.message(m, { ...ctx, arrivingTapbacks: arriving });
        const msgEl = jQuery(html.trim()).attr('data-et-refreshed', '');
        msgEl.find('[aria-expanded]').each((i, el) => {
            if (expanded[i]) el.setAttribute('aria-expanded', expanded[i]);
        });
        oldEl.replaceWith(msgEl);
        decorateMessage(msgEl, m);
        if (anchorTop !== null) keepInPlace(msgEl.find('[data-et-role~="bubble"]')[arriving[0]], anchorTop);
        return msgEl;
    }

    /** For a moment, scrolls the list so `el` stays at `top` (on screen) while things above it grow. */
    function keepInPlace(el, top, ms = 360) {
        const list = document.getElementById('et-messages');
        if (!el || !list) return;
        const behavior = list.style.scrollBehavior;
        list.style.scrollBehavior = 'auto';
        const end = performance.now() + ms;
        const step = () => {
            const drift = el.getBoundingClientRect().top - top;
            if (drift) list.scrollTop += drift;
            if (performance.now() < end) requestAnimationFrame(step);
            else list.style.scrollBehavior = behavior;
        };
        step();
    }

    // What the rendered list was drawn with besides each message's view; when it
    // changes (another chat, platform or avatar), renderMessages() starts over
    let renderedFrame = null;

    function getRenderFrame(platform, ctx) {
        return JSON.stringify([platform.id, platform.features, getCharacterKey(), ctx.charName, ctx.groupChat,
            getUserAvatarUrl(), getCharAvatarUrl(), ctx.username]);
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
            /(^|\s)(message|typing|image-generating|chat-head)(\s|$)/.test(el.getAttribute('data-et-role') || ''));
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
                const head = children.filter('[data-et-role~="chat-head"]');
                if (prevEl) prevEl.after(msgEl);
                else if (head.length) head.after(msgEl);
                else inner.prepend(msgEl);
                decorateMessage(msgEl, m);
                rebuilt.add(m.index);
                // Re-scroll when a new message's images load
                msgEl.find('img').on('load', scrollMessagesToEnd);
            }
            renderedViews.set(m.index, renderedEntry(m, signature));
            prevEl = msgEl;
        }
        for (const [index, el] of existing) {
            el.remove();
            renderedViews.delete(Number(index));
        }

        // Indicators as a full render leaves them: the typing indicator last, if on
        children.filter('[data-et-role~="image-generating"]').remove();
        const typing = inner.children('[data-et-role~="typing"]');
        if (!typingShown()) typing.remove();
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
        drawStatusBars();
        syncSendButton();
        if (replyDraft && replyDraft.charKey !== getCharacterKey()) clearReplyDraft();

        if (!history || history.length === 0) {
            inner.empty();
            renderedViews = new Map();
            renderedFrame = null;
            const char = getCurrentCharacter();
            if (!char) { showNoCharacterMessage(); return; }
            inner.html(getActivePlatform().templates.emptyChat(getMessageRenderContext()));
            return;
        }

        const platform = getActivePlatform();
        const view = ChatViewModel.buildChatViewModel(history, getChatViewOptions());
        requestSongArt(view);
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
        if (platform.templates.chatHead) inner.append(platform.templates.chatHead(ctx));
        view.messages.forEach((m) => {
            inner.append(platform.templates.message(m, ctx));
            decorateMessage(inner.children().last(), m);
            renderedViews.set(m.index, renderedEntry(m));
        });

        if (typingShown()) {
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

    /**
     * The panel's menus: the ⋯ menu, a bubble's, the avatar's, the "+" and file-type menus,
     * the tapback row, a transfer's, a sticker set's, and the character list. At most one
     * is open: opening one closes the rest, and so does a window opening (settings,
     * archives, the gallery, the X page) or the panel's content changing (another
     * character or look, the panel closing). The emotion popup isn't one: it stays.
     */
    function closeMenus() {
        closeAllDotMenus();
        closeAllReactOverlays();
        jQuery('#et-overflow-menu').removeClass('et-overflow-menu-open');
        closeCharacterPicker();
    }

    // The visible height dropping by more than this is the on-screen keyboard coming up
    const KEYBOARD_MIN_PX = 120;

    /**
     * The phone's keyboard coming up (the visible height dropping by `KEYBOARD_MIN_PX` or
     * more) moves the panel's content: open menus close rather than stay where it was.
     * Not when it's for a field in a menu (the character list's search). Its going down
     * doesn't: a tap on "+" while typing does that, as its menu opens.
     */
    function closeMenusForKeyboard(before, after) {
        if (before - after < KEYBOARD_MIN_PX) return;
        if (document.activeElement?.closest?.('.et-dots-menu, #et-char-picker')) return;
        closeMenus();
    }

    /**
     * Where a menu opened from a message can go. It's a child of the scrolling list, so it
     * stays beside its message as the list scrolls. `x`/`y` turn a screen position into
     * the list's own coordinates; `top`/`bottom` are the visible part in those, below
     * what covers the list's top (Instagram's header), `width` its width.
     */
    function listMenuArea() {
        const list = document.getElementById('et-messages');
        const box = list.getBoundingClientRect();
        return {
            x: box.left + list.clientLeft,
            y: box.top + list.clientTop - list.scrollTop,
            top: list.scrollTop + Math.max(8, parseFloat(getComputedStyle(list).paddingTop) || 0),
            bottom: list.scrollTop + list.clientHeight - 8,
            width: list.clientWidth,
        };
    }

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
        closeMenus();

        const msg = getChatHistory()[msgIndex];
        const partCount = msg ? getMessageDisplayParts(msg).length : 1;
        const deleteAllLabel = `Delete all (${partCount})`;

        // Build menu items: every bubble's menu replies to, copies, remembers and
        // deletes that bubble; the main (last) bubble's also acts on the whole message
        const items = [{ id: 'copy_part', icon: 'fa-copy', label: 'Copy', cls: '' }];
        // A character's bubble takes a tapback: the row opens from here, so the menu never covers it
        if (!isUser && platformHas('react')) items.unshift({ id: 'react', icon: 'fa-face-smile', label: 'React', cls: '' });
        if (platformHas('reply')) items.unshift({ id: 'reply', icon: 'fa-reply', label: 'Reply', cls: '' });
        if (memorySystem && settings.memoryEnabled) items.push({ id: 'add_memory', icon: 'fa-brain', label: 'Add Memory', cls: '' });
        // A photo bubble takes a real image (the footer menu's is the last bubble's)
        const bubble = partIndex !== null ? partIndex : partCount - 1;
        if (msg && platformHas('photo') && getMessageDisplayParts(msg)[bubble]?.type === 'photo') {
            if (getPhotoImages(msg)[bubble]) {
                items.push({ id: 'photo_add', icon: 'fa-image', label: 'Change Photo', cls: '' });
                items.push({ id: 'photo_remove', icon: 'fa-image', label: 'Remove Photo', cls: '' });
            } else {
                items.push({ id: 'photo_add', icon: 'fa-image', label: 'Add Photo', cls: '' });
            }
        }
        // Texts sent in a row are edited and regenerated together, from the last one, as a reply's bubbles are
        const runEnd = !isUser || !getChatHistory()[msgIndex + 1]?.is_user;
        if (partIndex === null && runEnd) {
            items.push({ id: 'edit', icon: 'fa-pen', label: 'Edit', cls: '' });
            items.push({ id: 'regen', icon: 'fa-rotate-right', label: 'Regenerate', cls: '' });
            items.push({ id: 'delete', icon: 'fa-trash', label: partCount > 1 ? 'Delete this' : 'Delete', cls: 'et-dots-item-delete' });
            if (partCount > 1) items.push({ id: 'delete_all', icon: 'fa-trash-can', label: deleteAllLabel, cls: 'et-dots-item-delete' });
        } else {
            items.push({ id: 'delete', icon: 'fa-trash', label: 'Delete', cls: 'et-dots-item-delete' });
        }
        // The footer menu's "Delete this" removes the main (last) bubble
        const targetPart = partIndex !== null ? partIndex : (partCount > 1 ? partCount - 1 : null);

        const itemsHtml = items.map(item => `<button class="et-dots-item ${item.cls}" data-action="${item.id}">
                <i class="fa-solid ${item.icon}"></i><span>${item.label}</span>
            </button>`).join('');

        const menu = jQuery(`
            <div class="et-dots-menu" data-for="${msgIndex}" data-is-user="${isUser ? 1 : 0}" data-part="${partKey}">
                ${itemsHtml}
            </div>
        `);

        jQuery('#et-messages').append(menu);

        // Under the bubble, lined up with its outer edge (yours on the right, theirs on the
        // left); above it when there's no room below, and within the visible list either way
        const anchor = btn[0].getBoundingClientRect();
        const area = listMenuArea();
        const menuW = menu.outerWidth() || 160;
        const menuH = menu.outerHeight() || 160;
        const side = isUser ? 'right' : 'left';
        let left = (isUser ? anchor.right - menuW : anchor.left) - area.x;
        left = Math.max(8, Math.min(area.width - menuW - 8, left));
        let top = anchor.bottom - area.y + 6;
        let origin = `top ${side}`;
        if (top + menuH > area.bottom) {
            top = anchor.top - area.y - menuH - 6;
            origin = `bottom ${side}`;
        }
        top = Math.max(area.top, Math.min(area.bottom - menuH, top));
        menu.css({ left: left + 'px', top: top + 'px', 'transform-origin': origin });
        requestAnimationFrame(() => menu.addClass('et-dots-menu-open'));

        // Close on outside click (once)
        setTimeout(() => {
            jQuery(document).one('click.et-dots-outside', function (e) {
                if (!jQuery(e.target).closest('.et-dots-menu').length) {
                    closeAllDotMenus();
                    closeAllReactOverlays();
                }
            });
        }, 0);

        // Bind actions
        menu.find('.et-dots-item').on('click', function (e) {
            e.stopPropagation();
            const action = jQuery(this).data('action');
            // React: the menu goes and the tapback row opens over the bubble
            if (action === 'react') {
                closeAllDotMenus();
                toggleReactOverlay(btn, msgIndex, partIndex);
                return;
            }
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
        const parts = getMessageDisplayParts(msg);
        // The user's tapbacks stay on their bubbles: those after this one move up
        const tapbacks = ChatViewModel.getUserTapbacks(msg, parts.length, getReactionIds());
        if (Object.keys(tapbacks).length) {
            setBubbleReactions(msg, Object.fromEntries(Object.entries(tapbacks)
                .filter(([j]) => Number(j) !== partIndex)
                .map(([j, ids]) => [Number(j) > partIndex ? Number(j) - 1 : Number(j), ids])));
        }
        // So do the photos' images; the deleted bubble's goes
        const images = getPhotoImages(msg);
        if (Object.keys(images).length) {
            if (images[partIndex]?.path) deleteUserImage(images[partIndex].path);
            setPhotoImages(msg, Object.fromEntries(Object.entries(images)
                .filter(([j]) => Number(j) !== partIndex)
                .map(([j, image]) => [Number(j) > partIndex ? Number(j) - 1 : Number(j), image])));
        }
        const remaining = parts.filter((part, j) => j !== partIndex
            && part.type !== 'reaction_note' && (part.type !== 'text' || part.text));
        // <react> tags aren't bubbles, so they survive deleting one
        const reactions = RichMessages.parseMessageParts(msg.mes).filter(part => part.type === 'react');
        if (!remaining.length && !reactions.length && !msg.imageAttachment) {
            allPhotoImagePaths(msg).forEach(deleteUserImage);
            history.splice(msgIndex, 1);
            return;
        }
        msg.mes = RichMessages.serializeParts([...remaining, ...reactions]);
        const swipe = Array.isArray(msg.swipes) ? msg.swipes[msg.swipeIndex ?? 0] : null;
        if (swipe) swipe.mes = msg.mes;
    }

    /** The first index of the texts the user sent in a row that end at `msgIndex`. */
    function userRunStart(history, msgIndex) {
        let start = msgIndex;
        while (history[msgIndex]?.is_user && history[start - 1]?.is_user) start--;
        return start;
    }

    /**
     * Edits a message in place as one raw text (tags included): the message is
     * re-rendered as a single text bubble — the platform's own text bubble — and
     * its text becomes editable. Save writes the text back; Cancel restores the
     * message. The user's texts sent in a row are edited as one, a line each, as
     * a reply's bubbles are, and saved as a text per line.
     */
    function startInlineEdit(history, msgIndex) {
        const msg = history[msgIndex];
        const oldEl = findMessageElement(msgIndex);
        if (!msg || !oldEl.length) return;

        // Already editing?
        if (oldEl.find('[contenteditable="true"]').length) return;

        const runStart = userRunStart(history, msgIndex);
        const run = history.slice(runStart, msgIndex + 1);
        const rawText = run.map(m => m.mes).join('\n');
        // The run's other texts make way for the one box while it's open
        const runEls = jQuery(run.slice(0, -1).map((m, i) => findMessageElement(runStart + i).get(0)).filter(Boolean));
        runEls.hide();

        // By history index: hidden messages (e.g. reaction-only replies on WeChat) leave gaps in the list
        const view = ChatViewModel.buildChatViewModel(history, getChatViewOptions()).messages.find(m => m.index === msgIndex);
        if (!view) return;
        const html = getActivePlatform().templates.message({ ...view, parts: [{ type: 'text', text: '' }] },
            { ...getMessageRenderContext(), arrivingTapbacks: [] });
        const msgEl = jQuery(html.trim()).attr('data-et-refreshed', '');
        oldEl.replaceWith(msgEl);
        // Not the message's real view any more, so the next refresh restores it
        renderedViews.delete(msgIndex);

        const bubble = msgEl.find('[data-et-role~="main"]');
        const textEl = bubble.find('[data-et-role~="text"]');

        // Set the content to raw markdown so it's editable and preserved
        textEl.text(rawText);
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
            runEls.show();
        };

        toolbar.find('[data-et-role="edit-save"]').on('click', () => {
            // Extract plain text from contenteditable
            const newText = textEl[0].innerText.trim();
            if (!newText) { finishEdit(); renderMessages(history); return; }
            if (msg.is_user) {
                if (newText === rawText.trim()) { finishEdit(); refreshMessages(history); return; }
                // A text per line, each keeping the place (time, receipt, photo) of the one it replaces
                const parts = RichMessages.parseMessageParts(newText, { splitLines: true });
                const texts = parts.map((part, i) => {
                    if (i < run.length) return { ...run[i], mes: RichMessages.serializeParts([part]) };
                    const { photoImages, bubbleReactions, ...rest } = run[run.length - 1];
                    return { ...rest, mes: RichMessages.serializeParts([part]) };
                });
                history.splice(runStart, run.length, ...texts);
            } else {
                history[msgIndex].mes = newText;
            }
            saveChatHistory(history);
            finishEdit();
            renderMessages(history, true);
        });

        toolbar.find('[data-et-role="edit-cancel"]').on('click', () => {
            finishEdit();
            refreshMessages(history);
        });

        // Also save on Enter (without shift), cancel on Escape. A phone's keyboard has
        // no Shift+Enter, so there Enter makes a new line and only Save saves
        textEl.on('keydown.edit', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && !isMobileDevice()) {
                e.preventDefault();
                toolbar.find('[data-et-role="edit-save"]').trigger('click');
            } else if (e.key === 'Escape') {
                toolbar.find('[data-et-role="edit-cancel"]').trigger('click');
            }
        });
    }

    /** One bubble's words (the last bubble's when `partIndex` is null); a card as its plain-text note. */
    function bubbleText(msg, partIndex) {
        const parts = getMessageDisplayParts(msg);
        const part = parts[partIndex ?? parts.length - 1];
        return !part ? '' : part.type === 'text' || part.type === 'voice' ? part.text : RichMessages.toPlainText(RichMessages.serializeParts([part]));
    }

    /**
     * @param {number|null} partIndex - the bubble a part-level action targets (Copy /
     *   Delete on one bubble of a multi-bubble message); null for the whole message
     */
    function handleDotsAction(action, msgIndex, isUser, btn, partIndex = null) {
        const history = getChatHistory();
        const msg = history[msgIndex];
        if (!msg) return;

        if (action === 'reply') {
            closeAllDotMenus();
            startReply(msgIndex, partIndex);
            return;
        }

        if (action === 'photo_add' || action === 'photo_remove') {
            closeAllDotMenus();
            const bubble = partIndex !== null ? partIndex : 0;
            if (action === 'photo_add') addPhotoImage(msgIndex, bubble);
            else removePhotoImage(msgIndex, bubble);
            return;
        }

        if (action === 'copy_part') {
            try { navigator.clipboard.writeText(bubbleText(msg, partIndex)); } catch (e) { /* noop */ }
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

                if (wholeMessage) {
                    allPhotoImagePaths(msg).forEach(deleteUserImage);
                    history.splice(msgIndex, 1);
                } else deleteMessagePart(history, msgIndex, partIndex);

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

        if (action === 'add_memory') {
            closeAllDotMenus();
            showManualMemorySaveModal(bubbleText(msg, partIndex));
            return;
        }

        if (action === 'regen') {
            closeAllDotMenus();
            // Not over a reply on its way: cutting the chat back now would be undone when it lands
            if (isGenerating) {
                toastr.info('Wait for the current reply to finish.');
                return;
            }

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

    /**
     * The tapback picker for one bubble of a character message (the last when
     * `partIndex` is null), above its button; the tapbacks already on that bubble
     * are marked, and picking one adds or takes it off.
     */
    function toggleReactOverlay(reactBtn, msgIndex, partIndex = null) {
        const msg = getChatHistory()[msgIndex];
        if (!msg) return;
        const partCount = getMessageDisplayParts(msg).length;
        const part = partIndex ?? partCount - 1;
        // If the picker is already open for this bubble, close it
        const existing = jQuery(`.et-react-overlay[data-for="${msgIndex}"][data-part="${part}"]`);
        if (existing.length) {
            closeAllReactOverlays();
            return;
        }

        closeMenus();

        const chosen = ChatViewModel.getUserTapbacks(msg, partCount, getReactionIds())[part] || [];
        const emojiHtml = FA_REACTIONS.map(r =>
            `<button class="et-overlay-emoji${chosen.includes(r.id) ? ' et-overlay-emoji-on' : ''}" data-emoji="${r.id}" data-index="${msgIndex}" title="${r.label}" style="--react-color:${r.color}">
                <i class="${r.icon}"></i>
                <span class="et-overlay-emoji-label">${r.label}</span>
            </button>`
        ).join('');

        const overlay = jQuery(`
            <div class="et-react-overlay" data-for="${msgIndex}" data-part="${part}">
                <div class="et-react-overlay-inner">
                    ${emojiHtml}
                </div>
            </div>
        `);

        // Position overlay above the react button
        jQuery('#et-messages').append(overlay);

        const btnRect = reactBtn[0].getBoundingClientRect();
        const area = listMenuArea();
        // Its own size, as the platform draws it (Instagram's bar is lower than Echogram's)
        const overlayW = overlay.outerWidth() || 340;
        const overlayH = overlay.outerHeight() || 72;

        // Right on the bubble's top edge; under it when there's no room above
        let left = btnRect.left - area.x;
        let top = btnRect.top - area.y - overlayH - 4;

        // Clamp within the list
        left = Math.max(8, Math.min(area.width - overlayW - 8, left));
        if (top < area.top) top = btnRect.bottom - area.y + 4;

        overlay.css({ left: left + 'px', top: top + 'px' });

        // Animate in
        requestAnimationFrame(() => {
            overlay.addClass('et-react-overlay-open');
        });

        // Bind emoji clicks
        overlay.find('.et-overlay-emoji').on('click', function (e) {
            e.stopPropagation();
            const emoji = jQuery(this).data('emoji');
            addReaction(msgIndex, emoji, part);
            closeAllReactOverlays();
            // A menu still open goes too
            closeAllDotMenus();
        });
    }

    // At most this many of the user's tapbacks on one bubble
    const MAX_TAPBACKS = 3;

    /**
     * Adds the user's tapback to one bubble of a character message (the last when
     * `partIndex` is null), or takes it off when it's already there. Kept per
     * bubble in msg.bubbleReactions, and on the current swipe, since another
     * version has other bubbles; the former whole-message ones move onto the last
     * bubble the first time.
     */
    function addReaction(msgIndex, reactionId, partIndex = null) {
        if (!FA_REACTIONS.some(r => r.id === reactionId)) return;

        const history = getChatHistory();
        const msg = Array.isArray(history) ? history[msgIndex] : null;
        if (!msg || msg.is_user) return;

        const partCount = getMessageDisplayParts(msg).length;
        const part = partIndex ?? partCount - 1;
        const store = ChatViewModel.getUserTapbacks(msg, partCount, getReactionIds());
        const ids = store[part] || [];
        if (ids.includes(reactionId)) {
            store[part] = ids.filter(id => id !== reactionId);
        } else if (ids.length >= MAX_TAPBACKS) {
            toastr.info(`You can only have ${MAX_TAPBACKS} reactions per message.`);
            return;
        } else {
            store[part] = [...ids, reactionId];
        }
        if (!store[part].length) delete store[part];
        setBubbleReactions(msg, store);

        saveChatHistory(history);
        refreshMessages(history);
    }

    /** Writes a message's per-bubble tapbacks (and its current swipe's); the former whole-message ones go. */
    function setBubbleReactions(msg, store) {
        delete msg.reactions;
        const swipe = Array.isArray(msg.swipes) ? msg.swipes[msg.swipeIndex ?? 0] : null;
        if (Object.keys(store).length) {
            msg.bubbleReactions = store;
            if (swipe) swipe.bubbleReactions = { ...store };
        } else {
            delete msg.bubbleReactions;
            if (swipe) delete swipe.bubbleReactions;
        }
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

    /** The memories block for the prompt, picked against `history`'s messages as plain text, with its summaries. */
    function buildMemoryContext(history) {
        if (!memorySystem) return '';
        const texts = (history || []).flatMap(msg => {
            const text = resolveHistoryMessageText(msg);
            return text === null ? [] : [RichMessages.toPlainText(text)];
        });
        return memorySystem.buildMemoryContext(texts, summariesOn() ? ChatSummaries.summaries(history || []) : []);
    }

    // ── Summaries of a long chat (docs/platform-plan.md 10b) ─────────────────
    // The model gets the latest messages word for word and summaries of the ones
    // before, written in the background a chunk at a time (lib/chat-summaries.js).
    // Off with the memory system or the setting, and in group chats: everything is
    // sent word for word, as before.

    function summariesOn() {
        return !!settings.memoryEnabled && settings.memorySummaries !== false;
    }

    function keepMessageCount() {
        const n = Math.round(Number(settings.memoryKeepMessages));
        return Number.isFinite(n) && n >= 20 ? Math.min(n, 500) : ChatSummaries.KEEP;
    }

    /** The messages of `history` the model is sent word for word. */
    function historyToSend(history) {
        return summariesOn() ? ChatSummaries.toSend(history, { keep: keepMessageCount() }) : history;
    }

    let summarizing = false;
    // After a failed summary, the chat length to try again at, by character
    const summaryRetryAt = {};

    /**
     * Summarizes the oldest messages no summary covers, once enough wait beyond
     * the latest ones, and keeps the summary on the last of them. One request,
     * without the character card; the chat must be unchanged when it comes back.
     */
    async function summarizeOldMessages() {
        if (summarizing || isGenerating || !summariesOn() || inGroupSession()) return;
        const char = getCurrentCharacter();
        const key = getCharacterKey();
        if (!char || !key) return;
        const history = getChatHistory();
        if (history.length < (summaryRetryAt[key] || 0)) return;
        const chunk = ChatSummaries.nextChunk(history, { keep: keepMessageCount() });
        if (!chunk) return;

        summarizing = true;
        try {
            const messages = history.slice(chunk.start, chunk.end + 1);
            const lines = messages.flatMap(msg => {
                const text = resolveHistoryMessageText(msg);
                if (text === null || !text.trim()) return [];
                return [`${msg.is_user ? getUserName() : (msg.charName || char.name)}: ${RichMessages.toPlainText(text).replace(/\s*\n\s*/g, ' / ')}`];
            });
            const previous = ChatSummaries.summaries(history.slice(0, chunk.start)).pop()?.text || '';
            const request = ChatSummaries.buildRequest({ lines, previous, charName: char.name, userName: getUserName() });
            const { prompt } = request;
            const systemPrompt = withRefusalFrame(request.systemPrompt);
            const raw = await sendCompletionRequest({
                apiMessages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }],
                rawPrompt: prompt, systemPrompt, signal: new AbortController().signal,
            });
            const text = ChatSummaries.cleanSummary(stripThinkingTags(String(raw ?? '')));
            if (!text) throw new Error('the model sent back no summary');
            if (ChatSummaries.looksLikeRefusal(text)) throw new Error(`the model declined: ${text.slice(0, 80)}`);

            // Another chat now, or the last message gone or summarized meanwhile: try later
            if (getCharacterKey() !== key || inGroupSession()) return;
            const now = getChatHistory();
            const at = now.indexOf(messages[messages.length - 1]);
            if (at === -1 || ChatSummaries.covered(now)[at]) return;
            now[at].memo = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), text, count: messages.length, at: Date.now() };
            delete summaryRetryAt[key];
            saveSettings();
            refreshMemoryLists();
        } catch (err) {
            warn('Summarizing older messages failed:', err);
            summaryRetryAt[key] = history.length + 10;
        } finally {
            summarizing = false;
        }
    }

    function refreshMemoryLists() {
        if (!settingsModal || typeof settingsModal.renderMemoryListInto !== 'function') return;
        settingsModal.renderMemoryListInto('#et_memory_list', '#et_memory_empty', '#et_memory_list_label');
    }

    /** The open chat's summaries for the settings list: { id, text, from, to, recalled } (1-based message numbers). */
    function getChatSummariesForList() {
        if (inGroupSession() || !getCharacterKey()) return [];
        const recalled = memorySystem ? memorySystem.getRecalledIds() : new Set();
        return ChatSummaries.summaries(getChatHistory()).map(s => ({ ...s, from: s.from + 1, to: s.to + 1, recalled: recalled.has(`memo:${s.id}`) }));
    }

    /** Edits (text) or deletes (null) one of the open chat's summaries; deleted, its messages are summarized again later. */
    function setChatSummary(id, text) {
        const history = getChatHistory();
        const msg = history.find(m => m.memo && String(m.memo.id) === String(id));
        if (!msg) return;
        const clean = text === null ? '' : String(text).trim();
        if (clean) msg.memo = { ...msg.memo, text: clean };
        else delete msg.memo;
        saveChatHistory(history);
        refreshMemoryLists();
    }

    /** The open chat's memories for the settings list. */
    function getChatMemoriesForList() {
        return memorySystem && !inGroupSession() ? memorySystem.getChatMemories() : [];
    }

    /**
     * Copies one of the chat's summaries to the permanent memories, to stay through a
     * cleared chat. The summary itself stays: the messages it covers are only sent through it.
     */
    function keepChatSummary(id) {
        const history = getChatHistory();
        const msg = history.find(m => m.memo && String(m.memo.id) === String(id));
        if (!msg || msg.memo.kept || !memorySystem) return;
        if (!memorySystem.permanentHasRoom()) { toastr.warning('Permanent memories are full', 'Echogram'); return; }
        memorySystem.addMemory({ category: 'life', label: 'Chat summary', content: msg.memo.text });
        msg.memo = { ...msg.memo, kept: true };
        saveChatHistory(history);
        refreshMemoryLists();
    }

    const _MEM_CATEGORY_LABELS = {
        inside_joke:    'Inside Joke',
        person:         'Important Person',
        hobby:          'Hobby / Interest',
        favorite_thing: 'Favorite Thing',
        shared_moment:  'Shared Moment',
        life:           'Life',
        custom:         'Custom'
    };

    /**
     * Add Memory (bubble menu): the bubble's words, editable, saved with a
     * category, an optional name and keywords, pinned or not.
     * @param {string} messageText - the bubble's text
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
            <input type="text" class="et-input-text et-mem-save-keys" value="" placeholder="Keywords, comma-separated">
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
            const keys        = jQuery('#et-mem-save-modal .et-mem-save-keys').val();
            const pin         = jQuery('#et-mem-save-modal .et-mem-save-pin').is(':checked');
            const chosenScope = jQuery('#et-mem-save-modal .et-mem-scope-seg-active').data('scope') || 'per-character';
            if (memorySystem) {
                memorySystem.addMemory({ category: cat, label: lbl, content: saveContent, keys, pinned: pin, scope: chosenScope });
            }
            if (settingsModal && typeof settingsModal.renderMemoryListInto === 'function') {
                settingsModal.renderMemoryListInto('#et_memory_list',       '#et_memory_empty',       '#et_memory_list_label');
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
        closeMenus();
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
            generateSchedule,
            onPhoneOverride,
            isWithYou,
            // An edit by hand bakes in every report so far: what ended is kept first
            writeLife,
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
            toggleEchoTextMaster,
            updateProviderVisibility,
            updateImageGenerationVisibility,
            getChatHistory,
            renderMessages,
            isPanelOpen,
            setEmotionMode,
            setDailyLifeEnabled,
            refreshProactiveInsights,
            renderRecoverRows,
            renderStickerSets,
            updateProactiveToggleButtons,
            startProactiveScheduler,
            triggerTestProactiveMessage,
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

        songArt = window.EchoTextMusicLookup.createMusicLookup({
            getCache: () => (settings.songArt ||= {}),
            saveCache: saveSettings,
        });

        // Expose character accessor helpers for the settings-modal memory UI
        window._etGetCharacterKey  = getCharacterKey;
        window._etGetCharacterName = getCharacterName;
        // The memories the last prompt carried, marked in the memory list; the chat's summaries
        window._etGetRecalledMemoryIds = () => memorySystem.getRecalledIds();
        window._etGetChatSummaries = getChatSummariesForList;
        window._etSetChatSummary = setChatSummary;
        window._etGetChatMemories = getChatMemoriesForList;
        window._etKeepChatSummary = keepChatSummary;
        window._etKeepChatMemory = id => {
            if (!memorySystem.moveToPermanent(id)) toastr.warning('Permanent memories are full', 'Echogram');
            refreshMemoryLists();
        };

        saveLoadModal = window.EchoTextSaveLoadModal.createSaveLoadModal({
            getSettings: () => settings,
            saveSettings,
            getCharacterKey,
            getCharacterName,
            getChatHistory,
            saveChatHistory,
            renderMessages,
            getEmotionSnapshot,
            getLifeSnapshot,
            getChatMemoriesSnapshot,
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
            getProactivePace: (key, at) => (emotionSystem ? emotionSystem.getProactivePace(key ?? undefined, at) : 1),
            // A text of hers that failed: said, its bar up (Retry, ×), and a tap tries it again now
            textFailed: ({ char, error, retry }) => {
                drawStatusBars();
                toastr.error(`Echogram: ${char?.name || 'Character'}'s text failed: ${error}. Tap to retry.`, '',
                    { timeOut: 15000, onclick: () => { retry(); drawStatusBars(); } });
            },
            // How the character follows up when ignored (Personality tab; lib/proactive-rounds.js)
            getTemperament: key => (emotionSystem ? emotionSystem.getTemperament(key) : 'normal'),
            // Daily Life, the open character with a schedule: where they are in their day and
            // their errands and news, for new topics (lib/proactive-rounds.js lifeTopics); else null.
            // At `at` (ms) when a catch-up looks back
            getDailyLife: (at = undefined) => {
                const schedule = activeSchedule();
                if (!schedule) return null;
                const date = at === undefined ? new Date() : new Date(at);
                const { block, since, prev } = DailyLife.currentStretch(schedule, date);
                // A change of plan or still texting: their phone, and never just got free
                const now = at === undefined ? phoneNow() : phoneAtTime(at);
                const own = now.by === 'schedule';
                const key = getCharacterKey();
                return {
                    phone: now.phone, block, since: since ? since.getTime() : null,
                    prevPhone: own ? (prev ? prev.phone : 'free') : now.phone, prevDoing: prev ? prev.doing : '',
                    life: at === undefined ? activeLife() : DailyLife.currentLife(settings.lifeState[key], date, getEmotionHistory(key)),
                    today: DailyLife.dateKey(date),
                };
            },
            // While you're playing the main chat: when they may text first again (13b)
            getStoryPauseUntil: storyPauseUntil,
            // The open character's memories (their chat's, theirs and the shared ones), Memory on; for new topics
            getMemories: () => (memorySystem && settings.memoryEnabled !== false ? memorySystem.getAllMemoriesForInjection() : []),
            // Daily Life: the open character's phone now (or at `at`, ms) and when that changes ({ phone, endsAt }), or null
            getScheduleNow: (at = undefined) => {
                if (at === undefined) {
                    const now = phoneNow();
                    return now ? { phone: now.phone, endsAt: phoneEndsNow() } : null;
                }
                const then = phoneAtTime(at);
                if (!then) return null;
                return { phone: then.phone, endsAt: then.by === 'texting' ? then.endsAt
                    : (DailyLife.phoneEndsAt({ schedule: activeSchedule(), override: phoneOverride(), date: new Date(at) }) || 0) };
            },
            withYouAt,
            // A catch-up due for them: their live texts wait for it
            catchUpPending,
            readReply,
            chatTarget,
            isViewing,
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

        // Daily Life: replies parked while the character was busy or asleep go once they look;
        // also when the app comes back to the front (a phone suspends the timer meanwhile)
        setInterval(resumePendingReply, 60000);
        setInterval(noteTogetherEnded, 60000);
        setInterval(resumeHeldCatchUp, 60000);
        // The proactive insights keep up on their own while they're on screen ("in 6m", what's due)
        setInterval(refreshVisibleInsights, 30000);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) { resumePendingReply(); maybeCatchUp(); } });
        // Catch-up: proactive texts are running for the open character; a first run of this
        // marks every chat seen now, so old chats aren't caught up on all at once
        if (!settings.proactiveSeenAt || typeof settings.proactiveSeenAt !== 'object') {
            settings.proactiveSeenAt = Object.fromEntries(Object.keys(settings.chatHistory || {}).map(key => [key, Date.now()]));
            saveSettings();
        }
        setInterval(() => markSeen(), 60000);
        setTimeout(() => maybeCatchUp(), 3000);
        jQuery(document).on('click', '[data-et-catchup="pause"]', () => pauseCatchUp());
        jQuery(document).on('click', '[data-et-catchup="again"]', () => retryCatchUp());
        jQuery(document).on('click', '[data-et-catchup="dismiss"]', () => dismissCatchUp());
        jQuery(document).on('click', '[data-et-text-failed="again"]', () => retryFailedText());
        jQuery(document).on('click', '[data-et-text-failed="dismiss"]', () => dismissFailedText());
        jQuery(document).on('click', '[data-et-catchup="pause-together"]', () => pauseTogetherNote());
        // Settings that depend on another
        const Controls = window.EchoTextSettingsModal;
        jQuery(document).on('change.et-controls', '#et_daily_life, #et_memory_enabled, #et_image_generation_enabled, #et_ctx_st_messages',
        () => setTimeout(() => Controls.syncDependentControls(settings), 0));
        jQuery(document).on('click.et-controls', '.et-field-off', function (e) {
            e.preventDefault();
            toastr.info(`Needs ${Controls.controlNeeded(this)}`, 'Echogram');
        });

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
            closeMenus();
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
            renderRecoverRows();
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
        context.eventSource.on(context.event_types.MESSAGE_SENT, noteStoryActivity);
        context.eventSource.on(context.event_types.MESSAGE_RECEIVED, noteStoryActivity);
        // A rename changes the card's file, and so the key Echogram files them under
        if (context.event_types.CHARACTER_RENAMED) context.eventSource.on(context.event_types.CHARACTER_RENAMED, onCharacterRenamed);
        bindRecoverRows();
        bindStickerSets();

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
            context.eventSource.removeListener(context.event_types.MESSAGE_SENT, noteStoryActivity);
            context.eventSource.removeListener(context.event_types.MESSAGE_RECEIVED, noteStoryActivity);
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
