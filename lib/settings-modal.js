(function () {
    'use strict';

    function createSettingsModal(api) {
        const {
            getSettings,
            saveSettings,
            getThemePresets,
            applySettingsToUI,
            applyAppearanceSettings,
            populateConnectionProfiles,
            fetchOllamaModels,
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
            updateProactiveToggleButtons,
            startProactiveScheduler,
            triggerTestProactiveMessage,
            positionFab,
            buildThemeDropdownHtml,
            buildFontDropdownHtml,
            loadGoogleFont,
            updatePanelStatusRow,
            renderStripTagChips,
            renderCustomPatternRows,
            invalidateStripTagsCache,
            openThemeEditor
        } = api;

        function settings() {
            return getSettings();
        }

        function THEME_PRESETS() {
            return getThemePresets();
        }

        // ============================================================
        // MEMORY SYSTEM HTML HELPERS
        // ============================================================

        const MEM_CATEGORIES = {
            inside_joke:    { label: 'Inside Joke',       icon: 'fa-face-laugh-squint' },
            person:         { label: 'Important Person',  icon: 'fa-user-tag'          },
            hobby:          { label: 'Hobby / Interest',  icon: 'fa-gamepad'            },
            favorite_thing: { label: 'Favorite Thing',    icon: 'fa-star'               },
            shared_moment:  { label: 'Shared Moment',     icon: 'fa-heart'              },
            life:           { label: 'Life',              icon: 'fa-list-check'         },
            custom:         { label: 'Custom',             icon: 'fa-tag'                }
        };

        function escHtml(str) {
            return String(str || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }

        function buildMemoryCardHtml(mem, recalled, { inChat = false } = {}) {
            const cat      = MEM_CATEGORIES[mem.category] || MEM_CATEGORIES.custom;
            const pinClass = mem.pinned ? ' et-mem-card-pinned' : '';
            const keys     = Array.isArray(mem.keys) ? mem.keys : [];
            const usedDot  = recalled.has(mem.id)
                ? `<span class="et-mem-recalled-dot" title="In the last reply's prompt"></span>` : '';
            const pinTitle = mem.pinned ? 'Unpin — always injected' : 'Pin — always inject this memory';
            const pinIcon  = mem.pinned ? 'fa-thumbtack' : 'fa-thumbtack';
            const pinActive= mem.pinned ? ' et-mem-btn-pin-active' : '';

            return `<div class="et-mem-card${pinClass}" data-mem-id="${escHtml(mem.id)}" data-mem-category="${escHtml(mem.category)}">
                <div class="et-mem-card-header">
                    <div class="et-mem-card-meta">
                        <span class="et-mem-cat-chip">
                            <i class="fa-solid ${cat.icon}"></i> ${cat.label}
                        </span>
                        ${usedDot}
                    </div>
                    <div class="et-mem-card-actions">
                        ${inChat ? `<button class="et-mem-btn" data-mem-action="keep" title="Move to permanent"><i class="fa-solid fa-box-archive"></i></button>` : ''}
                        <button class="et-mem-btn${pinActive}" data-mem-action="pin" title="${pinTitle}">
                            <i class="fa-solid fa-thumbtack"></i>
                        </button>
                        <button class="et-mem-btn" data-mem-action="edit" title="Edit memory">
                            <i class="fa-solid fa-pen"></i>
                        </button>
                        <button class="et-mem-btn et-mem-btn-delete" data-mem-action="delete" title="Delete memory">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                </div>
                <div class="et-mem-card-label">${escHtml(mem.label)}</div>
                <div class="et-mem-card-content">${escHtml(mem.content)}</div>
                ${keys.length ? `<div class="et-mem-card-keys">${keys.map(k => `<span class="et-mem-key">${escHtml(k)}</span>`).join('')}</div>` : ''}
                <div class="et-mem-card-edit" style="display:none;">
                    <div class="et-mem-form-row" style="margin-top:8px;">
                        <select class="et-select et-mem-edit-category" title="Category">
                            ${Object.entries(MEM_CATEGORIES).map(([k, v]) =>
                                `<option value="${k}"${mem.category === k ? ' selected' : ''}>${v.label}</option>`
                            ).join('')}
                        </select>
                        <input type="text" class="et-input-text et-mem-edit-label" value="${escHtml(mem.label)}" placeholder="Label">
                    </div>
                    <textarea class="et-mem-form-content et-mem-edit-content" rows="3">${escHtml(mem.content)}</textarea>
                    <input type="text" class="et-input-text et-mem-form-keys et-mem-edit-keys" value="${escHtml(keys.join(', '))}" placeholder="Keywords, comma-separated">
                    <div class="et-mem-form-actions">
                        <label class="et-mem-form-pin-row">
                            <input type="checkbox" class="checkbox et-mem-edit-pin"${mem.pinned ? ' checked' : ''}>
                            <span><i class="fa-solid fa-thumbtack"></i> Pin</span>
                        </label>
                        <div style="display:flex;gap:8px;">
                            <button class="et-mem-form-save et-mem-edit-save" type="button">Save</button>
                            <button class="et-mem-form-cancel et-mem-edit-cancel" type="button">Cancel</button>
                        </div>
                    </div>
                </div>
            </div>`;
        }

        /** Every list a memory can be in. */
        function memoryLists() {
            const s = settings();
            return [s.globalMemories, ...Object.values(s.characterMemories || {}), ...Object.values(s.chatMemories || {}).map(c => c.items)];
        }

        /** One of the open chat's summaries (lib/chat-summaries.js): the messages it covers, edit, delete. */
        function buildSummaryCardHtml(memo) {
            const usedDot = memo.recalled ? `<span class="et-mem-recalled-dot" title="In the last reply's prompt"></span>` : '';
            return `<div class="et-mem-card et-memo-card" data-memo-id="${escHtml(memo.id)}">
                <div class="et-mem-card-header">
                    <div class="et-mem-card-meta">
                        <span class="et-mem-cat-chip"><i class="fa-solid fa-scroll"></i> Messages ${memo.from}–${memo.to}</span>
                        ${usedDot}
                    </div>
                    <div class="et-mem-card-actions">
                        ${memo.kept ? '' : `<button class="et-mem-btn" data-memo-action="keep" title="Copy to permanent"><i class="fa-solid fa-box-archive"></i></button>`}
                        <button class="et-mem-btn" data-memo-action="edit" title="Edit summary">
                            <i class="fa-solid fa-pen"></i>
                        </button>
                        <button class="et-mem-btn et-mem-btn-delete" data-memo-action="delete" title="Delete summary">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                </div>
                <div class="et-mem-card-content">${escHtml(memo.text)}</div>
                <div class="et-mem-card-edit" style="display:none;">
                    <textarea class="et-mem-form-content et-memo-edit-text" rows="4">${escHtml(memo.text)}</textarea>
                    <div class="et-mem-form-actions">
                        <span></span>
                        <div style="display:flex;gap:8px;">
                            <button class="et-mem-form-save et-memo-edit-save" type="button">Save</button>
                            <button class="et-mem-form-cancel et-memo-edit-cancel" type="button">Cancel</button>
                        </div>
                    </div>
                </div>
            </div>`;
        }

        /** The open chat's memories and summaries, in the section beside the permanent list. */
        function renderSummariesNear(container) {
            const section = container.parent().find('.et-memo-section');
            if (!section.length) return;
            const memos = typeof window._etGetChatSummaries === 'function' ? window._etGetChatSummaries() : [];
            const memories = typeof window._etGetChatMemories === 'function' ? window._etGetChatMemories() : [];
            const recalled = typeof window._etGetRecalledMemoryIds === 'function' ? window._etGetRecalledMemoryIds() : new Set();
            section.toggle(memos.length + memories.length > 0);
            section.find('.et-memo-list').html(memories.map(mem => buildMemoryCardHtml(mem, recalled, { inChat: true })).join('') + memos.map(buildSummaryCardHtml).join(''));
        }

        function renderMemoryListInto(containerSel, emptyHintSel, labelSel) {
            const s = settings();
            const scope = s.memoryScope || 'per-character';

            let memories = [];
            if (scope === 'global') {
                memories = Array.isArray(s.globalMemories) ? s.globalMemories : [];
            } else {
                // In per-character mode, try to get the current character's memories
                const charKeyFn = window._etGetCharacterKey;
                const charKey = (typeof charKeyFn === 'function') ? charKeyFn() : null;
                if (charKey && s.characterMemories && Array.isArray(s.characterMemories[charKey])) {
                    memories = s.characterMemories[charKey];
                } else {
                    // No character selected — show global as fallback header
                    memories = [];
                }
            }

            const container = jQuery(containerSel);
            const emptyHint = jQuery(emptyHintSel);
            if (!container.length) return;
            renderSummariesNear(container);

            if (memories.length === 0) {
                container.html('');
                emptyHint.show();
            } else {
                emptyHint.hide();
                const recalled = typeof window._etGetRecalledMemoryIds === 'function' ? window._etGetRecalledMemoryIds() : new Set();
                container.html(memories.map(mem => buildMemoryCardHtml(mem, recalled)).join(''));
            }

            // Update label
            if (labelSel) {
                const charKeyFn = window._etGetCharacterKey;
                const charKey   = (typeof charKeyFn === 'function') ? charKeyFn() : null;
                const charName  = window._etGetCharacterName ? window._etGetCharacterName() : null;
                let label = 'Permanent — All characters';
                if (scope === 'per-character') {
                    label = charKey
                        ? `Permanent — ${charName || charKey}`
                        : 'Permanent (no character selected)';
                }
                jQuery(labelSel).text(label);
            }
        }

        function updateMemoryScopePills(scopePillsSel, scope) {
            jQuery(scopePillsSel).find('.et-mem-scope-btn').removeClass('et-mem-scope-btn-active');
            jQuery(`${scopePillsSel} .et-mem-scope-btn[data-scope="${scope}"]`).addClass('et-mem-scope-btn-active');
        }

        // ============================================================
        // PROMPT MANAGER HTML
        // ============================================================

        function buildPromptCard(id, label, hint, defaultVal) {
            const s = settings();
            const val = (s[id] !== undefined && s[id] !== null && s[id] !== '') ? s[id] : defaultVal;
            const escaped = String(val).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            return `<div class="et-pm-card" data-pm-id="${id}">
                <div class="et-pm-card-header">
                    <div class="et-pm-card-meta">
                        <div class="et-pm-label">${label}</div>
                        <div class="et-pm-desc">${hint}</div>
                    </div>
                    <div class="et-pm-toolbar">
                        <button class="et-pm-btn" data-pm-action="copy" title="Copy to clipboard"><i class="fa-solid fa-copy"></i></button>
                        <button class="et-pm-btn" data-pm-action="paste" title="Paste from clipboard"><i class="fa-solid fa-paste"></i></button>
                        <button class="et-pm-btn et-pm-btn-reset" data-pm-action="reset" title="Reset to default"><i class="fa-solid fa-rotate-left"></i></button>
                    </div>
                </div>
                <textarea class="et-pm-textarea" id="et_pm_${id}" spellcheck="false">${escaped}</textarea>
            </div>`;
        }

        function buildPromptGroup(icon, label, hint, cards, collapsed) {
            const collapseClass = collapsed ? ' et-pm-group-collapsed' : '';
            return `<div class="et-pm-group${collapseClass}">
                <div class="et-pm-group-header">
                    <div class="et-pm-group-title">
                        <i class="fa-solid ${icon}"></i>
                        <span class="et-pm-group-name">${label}</span>
                        <span class="et-pm-group-badge">${cards.length}</span>
                    </div>
                    <div class="et-pm-group-right">
                        <span class="et-pm-group-hint">${hint}</span>
                        <i class="fa-solid fa-chevron-down et-pm-group-chevron"></i>
                    </div>
                </div>
                <div class="et-pm-group-body">
                    <div class="et-pm-group-inner">
                        ${cards.join('')}
                    </div>
                </div>
            </div>`;
        }

        function buildPromptManagerSectionHtml() {
            const d = window.EchoTextConfig && window.EchoTextConfig.defaultSettings || {};

            const coreCards = [
                buildPromptCard('promptSystemBase',
                    '<i class="fa-solid fa-id-badge"></i> System Base',
                    'The opening identity line sent in every generation. Always included.',
                    d.promptSystemBase || ''),
                buildPromptCard('promptTextingFormat',
                    '<i class="fa-solid fa-mobile-screen"></i> Texting Format',
                    'Sent near the end of every solo generation. Keeps replies as phone texts — no narration or bracketed actions. (One-bubble-per-line and &lt;photo&gt; rules are added automatically.)',
                    d.promptTextingFormat || ''),
                buildPromptCard('promptAntiRefusalFrame',
                    '<i class="fa-solid fa-shield-halved"></i> Anti-Refusal Frame',
                    'Injected when Anti-Refusal is ON. Sets the roleplay fiction context. Also used in Group Chat Combined Mode.',
                    d.promptAntiRefusalFrame || '')
            ];

            const soloCards = [
                buildPromptCard('promptTetheredReminder',
                    '<i class="fa-solid fa-link"></i> Reminder <span class="et-pm-tag">Anti-Refusal ON</span>',
                    'Persona-lock reminder appended when Anti-Refusal is enabled.',
                    d.promptTetheredReminder || ''),
                buildPromptCard('promptTetheredNoFrame',
                    '<i class="fa-solid fa-comment"></i> Closing <span class="et-pm-tag">Anti-Refusal OFF</span>',
                    'Closing instruction when Anti-Refusal is disabled.',
                    d.promptTetheredNoFrame || '')
            ];

            const groupCards = [
                buildPromptCard('promptGroupSceneFrame',
                    '<i class="fa-solid fa-users"></i> Group Scene Frame',
                    'System-level instruction that opens every Combined Mode request. Supports <code>{{user}}</code> and <code>{{group_members}}</code>.',
                    d.promptGroupSceneFrame || ''),
                buildPromptCard('promptGroupCharacterCue',
                    '<i class="fa-solid fa-person-rays"></i> Group Character Cue',
                    'Appended to the final user turn for each character\'s call in Combined Mode. Supports <code>{{char}}</code>.',
                    d.promptGroupCharacterCue || '')
            ];

            const verbosityCards = [
                buildPromptCard('promptVerbosityShort',
                    '<i class="fa-solid fa-compress-alt"></i> Short <span class="et-pm-tag et-pm-tag-blue">1–2 texts, up to 4</span>',
                    'Injected when the reply length is Short.',
                    d.promptVerbosityShort || ''),
                buildPromptCard('promptVerbosityMedium',
                    '<i class="fa-solid fa-align-center"></i> Medium <span class="et-pm-tag et-pm-tag-green">1–4 texts, up to 6</span>',
                    'Injected when the reply length is Medium.',
                    d.promptVerbosityMedium || ''),
                buildPromptCard('promptVerbosityLong',
                    '<i class="fa-solid fa-expand-alt"></i> Long <span class="et-pm-tag et-pm-tag-purple">1–7 texts, up to 9</span>',
                    'Injected when the reply length is Long.',
                    d.promptVerbosityLong || '')
            ];

            return [
                buildPromptGroup('fa-brain', 'Core Behavior', 'Always Injected', coreCards, false),
                buildPromptGroup('fa-user', 'Solo Chat', 'One-on-One', soloCards, true),
                buildPromptGroup('fa-users', 'Group Chat', 'Combined Mode / Group', groupCards, true),
                buildPromptGroup('fa-ruler', 'Verbosity', 'Reply Length', verbosityCards, true)
            ].join('');
        }

        function buildSettingsModalHtml() {
            return `
        <div id="et-settings-modal" class="et-settings-modal">
            <div class="et-settings-overlay" id="et-settings-overlay"></div>
            <div class="et-settings-dialog">
                <div class="et-settings-header">
                    <div class="et-settings-title">
                        <i class="fa-solid fa-comment-dots"></i> Echogram Settings
                    </div>
                    <div class="et-settings-close" id="et-settings-close" title="Close settings">
                        <i class="fa-solid fa-xmark"></i>
                    </div>
                </div>

                <div class="et-settings-body">
                    <nav class="et-settings-nav">
                        <div class="et-nav-item active" data-section="general">
                            <i class="fa-solid fa-toggle-on"></i> General
                        </div>
                        <div class="et-nav-item" data-section="engine">
                            <i class="fa-solid fa-microchip"></i> Generation Engine
                        </div>
                        <div class="et-nav-item" data-section="context">
                            <i class="fa-solid fa-file-lines"></i> Context
                        </div>
                        <div class="et-nav-item" data-section="appearance">
                            <i class="fa-solid fa-palette"></i> Appearance
                        </div>
                        <div class="et-nav-item" data-section="fab">
                            <i class="fa-solid fa-circle-dot"></i> Action Button
                        </div>
                        <div class="et-nav-item" data-section="proactive-insights">
                            <i class="fa-solid fa-clock"></i> Proactive Messages
                        </div>
                        <div class="et-nav-item" data-section="memory">
                            <i class="fa-solid fa-brain"></i> Memory
                        </div>
                        <div class="et-nav-item" data-section="image-generation">
                            <i class="fa-solid fa-image"></i> Image Generation
                        </div>
                        <div class="et-nav-item" data-section="prompts">
                            <i class="fa-solid fa-scroll"></i> Prompt Manager
                        </div>
                    </nav>

                    <div class="et-settings-content">

                        <!-- GENERAL -->
                        <div class="et-settings-section active" id="et-section-general">
                            <h3><i class="fa-solid fa-toggle-on"></i> General</h3>

                            <div class="et-field">
                                <label class="et-toggle-row" for="et_enabled">
                                    <input type="checkbox" id="et_enabled" class="checkbox">
                                    <span class="et-label-text"><i class="fa-solid fa-power-off"></i> Enable Echogram</span>
                                </label>
                                <div class="et-hint">Show the Echogram floating action button and panel.</div>
                            </div>

                            <div class="et-field">
                                <label class="et-field-label" for="et_emotion_mode"><i class="fa-solid fa-heart-pulse"></i> Emotions</label>
                                <div class="et-select-wrapper">
                                    <select id="et_emotion_mode" class="et-select">
                                        <option value="off">Off</option>
                                        <option value="manual">Manual</option>
                                        <option value="auto">Auto</option>
                                    </select>
                                    <i class="fa-solid fa-chevron-down et-select-arrow"></i>
                                </div>
                                <div class="et-hint">Set them under the character's name.</div>
                            </div>

                            <div class="et-field">
                                <label class="et-toggle-row" for="et_nsfw_enabled">
                                    <input type="checkbox" id="et_nsfw_enabled" class="checkbox">
                                    <span class="et-label-text"><i class="et-icon-adult"></i> NSFW</span>
                                </label>
                                <div class="et-hint">Adds Desire and Morality.</div>
                            </div>

                            <div class="et-field">
                                <label class="et-toggle-row" for="et_swiped_messages">
                                    <input type="checkbox" id="et_swiped_messages" class="checkbox">
                                    <span class="et-label-text"><i class="fa-solid fa-clone"></i> Swiped Messages</span>
                                </label>
                                <div class="et-hint">Save previous AI responses when regenerating. Use arrows (or swipe on mobile) to browse between versions. The right arrow on the latest response triggers a new regeneration.</div>
                            </div>

                            <div class="et-field">
                                <label class="et-toggle-row" for="et_auto_open">
                                    <input type="checkbox" id="et_auto_open" class="checkbox">
                                    <span class="et-label-text"><i class="fa-solid fa-door-open"></i> Auto-Open on Reload</span>
                                </label>
                                <div class="et-hint">Automatically open the Echogram panel when SillyTavern loads.</div>
                            </div>

                            <div class="et-field">
                                <label class="et-toggle-row" for="et_auto_load_last_char">
                                    <input type="checkbox" id="et_auto_load_last_char" class="checkbox">
                                    <span class="et-label-text"><i class="fa-solid fa-rotate-left"></i> Auto-Load Last Character</span>
                                </label>
                                <div class="et-hint">When SillyTavern reloads, automatically select the last character you were chatting with.</div>
                            </div>

                            <div class="et-field" data-et-recover hidden>
                                <label class="et-field-label"><i class="fa-solid fa-box-archive"></i> Lost Character Data</label>
                                <div class="et-recover-row">
                                    <div class="et-select-wrapper">
                                        <select class="et-select" data-et-recover-pick></select>
                                        <i class="fa-solid fa-chevron-down et-select-arrow"></i>
                                    </div>
                                    <button type="button" class="et-mem-add-btn" data-et-recover-move>Move</button>
                                    <button type="button" class="et-mem-add-btn et-recover-delete" data-et-recover-delete>Delete</button>
                                </div>
                                <div class="et-hint">Left by a renamed or deleted card.</div>
                            </div>

                            <div class="et-field">
                                <label class="et-toggle-row" for="et_auto_scroll">
                                    <input type="checkbox" id="et_auto_scroll" class="checkbox">
                                    <span class="et-label-text"><i class="fa-solid fa-arrow-down"></i> Auto-scroll to Latest Message</span>
                                </label>
                                <div class="et-hint">Automatically scroll down when new messages appear in the chat.</div>
                            </div>

                            <div class="et-field">
                                <label class="et-field-label"><i class="fa-solid fa-ruler"></i> Verbosity Default</label>
                                <div class="et-select-wrapper">
                                    <select id="et_verbosity_default" class="et-select">
                                        <option value="short">Short</option>
                                        <option value="medium">Medium</option>
                                        <option value="long">Long</option>
                                    </select>
                                    <i class="fa-solid fa-chevron-down et-select-arrow"></i>
                                </div>
                                <div class="et-hint">Set per character under their name.</div>
                            </div>

                        </div>

                        <!-- GENERATION ENGINE -->
                        <div class="et-settings-section" id="et-section-engine">
                            <h3><i class="fa-solid fa-microchip"></i> Generation Engine</h3>

                            <div class="et-field">
                                <label class="et-field-label"><i class="fa-solid fa-plug"></i> Source</label>
                                <div class="et-select-wrapper">
                                    <select id="et_source" class="et-select">
                                        <option value="default">Default (Main API)</option>
                                        <option value="profile">Connection Profile (Recommended)</option>
                                        <option value="ollama">Ollama (Local)</option>
                                        <option value="openai">OpenAI Compatible</option>
                                    </select>
                                    <i class="fa-solid fa-chevron-down et-select-arrow"></i>
                                </div>
                            </div>

                            <div id="et_profile_settings" class="et-sub-panel" style="display:none;">
                                <div class="et-sub-panel-title"><i class="fa-solid fa-link"></i> Connection Profile</div>
                                <div class="et-select-wrapper">
                                    <select id="et_profile_select" class="et-select"></select>
                                    <i class="fa-solid fa-chevron-down et-select-arrow"></i>
                                </div>
                                <div class="et-hint"><i class="fa-solid fa-shield-halved"></i> Uses your existing SillyTavern credentials securely.</div>
                            </div>

                            <div id="et_ollama_settings" class="et-sub-panel" style="display:none;">
                                <div class="et-sub-panel-title"><i class="fa-solid fa-terminal"></i> Ollama</div>
                                <input id="et_ollama_url" type="text" class="et-input-text" placeholder="http://localhost:11434">
                                <div class="et-select-wrapper">
                                    <select id="et_ollama_model_select" class="et-select"></select>
                                    <i class="fa-solid fa-chevron-down et-select-arrow"></i>
                                </div>
                                <div id="et_ollama_status" class="et-status-note"></div>
                            </div>

                            <div id="et_openai_settings" class="et-sub-panel" style="display:none;">
                                <div class="et-sub-panel-title"><i class="fa-solid fa-cloud"></i> OpenAI Compatible</div>
                                <div class="et-select-wrapper">
                                    <select id="et_openai_preset" class="et-select">
                                        <option value="custom">Custom</option>
                                        <option value="lmstudio">LM Studio (:1234)</option>
                                        <option value="kobold">KoboldCPP (:5001)</option>
                                        <option value="textgen">TextGenWebUI (:5000)</option>
                                        <option value="vllm">vLLM (:8000)</option>
                                    </select>
                                    <i class="fa-solid fa-chevron-down et-select-arrow"></i>
                                </div>
                                <input id="et_openai_url" type="text" class="et-input-text" placeholder="http://localhost:1234/v1">
                                <input id="et_openai_key" type="password" class="et-input-text" placeholder="API Key (Optional)">
                                <input id="et_openai_model" type="text" class="et-input-text" placeholder="Model name">
                            </div>

</div>

                        <!-- CONTEXT -->
                        <div class="et-settings-section" id="et-section-context">
                            <h3><i class="fa-solid fa-file-lines"></i> Context</h3>
                            <div class="et-hint" style="margin-bottom:16px;">Choose what information from SillyTavern to include in the character's context when generating responses.</div>

                            <div class="et-field">
                                <label class="et-toggle-row" for="et_ctx_main_chat">
                                    <input type="checkbox" id="et_ctx_main_chat" class="checkbox">
                                    <span class="et-label-text"><i class="fa-solid fa-book-open"></i> Main Chat</span>
                                </label>
                            </div>

                            <div class="et-field">
                                <label class="et-toggle-row" for="et_ctx_st_messages">
                                    <input type="checkbox" id="et_ctx_st_messages" class="checkbox">
                                    <span class="et-label-text"><i class="fa-solid fa-comments"></i> Echogram Messages</span>
                                </label>
                                <div class="et-hint et-hint-indent">The other way round: your Echogram texts with the chat's character go into SillyTavern's own roleplay prompt, each exchange placed where it happened in the story. Not in group chats.</div>
                                <div class="et-hint et-hint-indent" data-et-reveal="story-day" style="display:none;">Also sends the character's day.</div>
                            </div>

                            <div class="et-field">
                                <label class="et-toggle-row" for="et_ctx_description">
                                    <input type="checkbox" id="et_ctx_description" class="checkbox">
                                    <span class="et-label-text"><i class="fa-solid fa-address-card"></i> Character Description</span>
                                </label>
                                <div class="et-hint et-hint-indent">Include the character's description field in the system prompt.</div>
                            </div>

                            <div class="et-field">
                                <label class="et-toggle-row" for="et_ctx_personality">
                                    <input type="checkbox" id="et_ctx_personality" class="checkbox">
                                    <span class="et-label-text"><i class="fa-solid fa-brain"></i> Personality</span>
                                </label>
                                <div class="et-hint et-hint-indent">Include the character's personality field.</div>
                            </div>

                            <div class="et-field">
                                <label class="et-toggle-row" for="et_ctx_scenario">
                                    <input type="checkbox" id="et_ctx_scenario" class="checkbox">
                                    <span class="et-label-text"><i class="fa-solid fa-map"></i> Scenario</span>
                                </label>
                                <div class="et-hint et-hint-indent">Include the scenario/world context field.</div>
                            </div>

                            <div class="et-field">
                                <label class="et-toggle-row" for="et_ctx_persona">
                                    <input type="checkbox" id="et_ctx_persona" class="checkbox">
                                    <span class="et-label-text"><i class="fa-solid fa-face-smile"></i> Your Persona</span>
                                </label>
                                <div class="et-hint et-hint-indent">Include your active persona description.</div>
                            </div>

                            <div class="et-field">
                                <label class="et-toggle-row" for="et_ctx_authors_note">
                                    <input type="checkbox" id="et_ctx_authors_note" class="checkbox">
                                    <span class="et-label-text"><i class="fa-solid fa-pen-nib"></i> Author's Note</span>
                                </label>
                                <div class="et-hint et-hint-indent">Include the character's Author's Note — special per-character instructions set in SillyTavern.</div>
                            </div>

                            <div class="et-field">
                                <label class="et-toggle-row" for="et_ctx_world_info">
                                    <input type="checkbox" id="et_ctx_world_info" class="checkbox">
                                    <span class="et-label-text"><i class="fa-solid fa-globe"></i> World Info / Lorebook</span>
                                </label>
                                <div class="et-hint et-hint-indent">Configure which World Info / Lorebook entries to include in context.</div>
                            </div>

                            <div class="et-ctx-wi-sub" id="et-ctx-wi-sub" style="display:none;">
                                <div class="et-ctx-wi-mode-grid">
                                    <button class="et-ctx-wi-mode-btn" type="button" data-mode="min_order" title="Include all entries at or above a minimum insertion order value">
                                        <i class="fa-solid fa-chevron-up et-ctx-wi-mode-icon"></i>
                                        <span class="et-ctx-wi-mode-name">Min Order</span>
                                        <span class="et-ctx-wi-mode-sub">&ge; threshold</span>
                                    </button>
                                    <button class="et-ctx-wi-mode-btn" type="button" data-mode="range" title="Include entries whose insertion order falls between a min and max value">
                                        <i class="fa-solid fa-left-right et-ctx-wi-mode-icon"></i>
                                        <span class="et-ctx-wi-mode-name">Order Range</span>
                                        <span class="et-ctx-wi-mode-sub">min &rarr; max</span>
                                    </button>
                                    <button class="et-ctx-wi-mode-btn" type="button" data-mode="targeted" title="Include only entries whose insertion order exactly matches one of your values">
                                        <i class="fa-solid fa-crosshairs et-ctx-wi-mode-icon"></i>
                                        <span class="et-ctx-wi-mode-name">Targeted</span>
                                        <span class="et-ctx-wi-mode-sub">exact values</span>
                                    </button>
                                    <button class="et-ctx-wi-mode-btn" type="button" data-mode="custom" title="Combine range and targeted — entries matching either condition are included">
                                        <i class="fa-solid fa-sliders et-ctx-wi-mode-icon"></i>
                                        <span class="et-ctx-wi-mode-name">Custom</span>
                                        <span class="et-ctx-wi-mode-sub">full control</span>
                                    </button>
                                </div>
                                <div class="et-ctx-wi-inputs">
                                    <div class="et-ctx-wi-field" id="et-ctx-wi-row-min">
                                        <i class="fa-solid fa-chevron-up et-ctx-wi-field-icon"></i>
                                        <span class="et-ctx-wi-field-label">Min Order</span>
                                        <input type="number" class="et-ctx-wi-field-input" id="et_ctx_wi_min" min="0" max="9999" step="1" value="250" placeholder="250">
                                    </div>
                                    <div class="et-ctx-wi-field" id="et-ctx-wi-row-max" style="display:none;">
                                        <i class="fa-solid fa-chevron-down et-ctx-wi-field-icon"></i>
                                        <span class="et-ctx-wi-field-label">Max Order</span>
                                        <input type="number" class="et-ctx-wi-field-input" id="et_ctx_wi_max" min="0" max="9999" step="1" placeholder="no limit">
                                    </div>
                                    <div class="et-ctx-wi-field" id="et-ctx-wi-row-targeted" style="display:none;">
                                        <i class="fa-solid fa-hashtag et-ctx-wi-field-icon"></i>
                                        <span class="et-ctx-wi-field-label">Order Values</span>
                                        <input type="text" class="et-ctx-wi-field-input" id="et_ctx_wi_targeted" placeholder="e.g. 100, 250, 500">
                                    </div>
                                </div>
                            </div>

                            <div class="et-field" style="margin-top:8px;">
                                <label class="et-toggle-row" for="et_strip_thinking_enabled">
                                    <input type="checkbox" id="et_strip_thinking_enabled" class="checkbox">
                                    <span class="et-label-text"><i class="fa-solid fa-filter"></i> Strip Reasoning Tags</span>
                                </label>
                                <div class="et-hint et-hint-indent">Remove AI reasoning/thinking tag blocks from messages before they enter context. Prevents internal model reasoning from inflating the context window.</div>
                            </div>

                            <div class="et-strip-tags-sub" id="et_strip_tags_sub">
                                <div class="et-field">
                                    <div class="et-strip-tags-label-row">
                                        <label class="et-field-label" style="margin-bottom:0;"><i class="fa-solid fa-tags"></i> Tags to Strip</label>
                                        <button id="et_strip_tag_reset" class="et-strip-tag-reset-btn" title="Reset to defaults"><i class="fa-solid fa-rotate-left"></i> Reset</button>
                                    </div>
                                    <div class="et-strip-tags-chips" id="et_strip_tag_chips"></div>
                                    <div class="et-strip-tags-input-row">
                                        <input type="text" id="et_strip_tag_input" class="et-input-text" style="margin-bottom:0;flex:1;" placeholder="Add tag name…">
                                        <button id="et_strip_tag_add" class="et-mem-add-btn" title="Add tag"><i class="fa-solid fa-plus"></i> Add</button>
                                    </div>
                                    <div class="et-hint et-hint-indent" style="margin-top:6px;">Tag names without angle brackets (e.g. <code>thinking</code>). Matching is case-insensitive.</div>
                                </div>
                                <div class="et-field" style="margin-top:10px;">
                                    <div class="et-strip-tags-label-row">
                                        <label class="et-field-label" style="margin-bottom:0;"><i class="fa-solid fa-scissors"></i> Custom Patterns</label>
                                    </div>
                                    <div class="et-custom-patterns-list" id="et_custom_pattern_list"></div>
                                    <div class="et-custom-pattern-add-row">
                                        <input type="text" id="et_custom_pattern_start" class="et-input-text" style="margin-bottom:0;flex:1;min-width:0;" placeholder="Start string…">
                                        <input type="text" id="et_custom_pattern_end" class="et-input-text" style="margin-bottom:0;flex:1;min-width:0;" placeholder="End string…">
                                        <button id="et_custom_pattern_add" class="et-mem-add-btn" title="Add pattern"><i class="fa-solid fa-plus"></i> Add</button>
                                    </div>
                                    <div class="et-hint et-hint-indent" style="margin-top:6px;">Strip text between two literal strings. Useful for models with unique delimiters (case-insensitive).</div>
                                </div>
                            </div>

                        </div>

                        <!-- APPEARANCE -->
                        <div class="et-settings-section" id="et-section-appearance">
                            <h3><i class="fa-solid fa-palette"></i> Appearance</h3>

                            <div class="et-field">
                                <label class="et-field-label"><i class="fa-solid fa-swatchbook"></i> Theme</label>
                                ${buildThemeDropdownHtml(settings().theme)}
                                <button class="et-te-open-btn" id="et-te-open-btn-modal" title="Create and manage custom colour themes">
                                    <i class="fa-solid fa-wand-magic-sparkles"></i> Edit Custom Themes
                                </button>
                                <div class="et-hint">Colors Echogram's own look and its menus and settings. Platform looks keep their own colors.</div>
                            </div>

                            <div class="et-field">
                                <label class="et-field-label" for="et_platform_default"><i class="fa-solid fa-mobile-screen"></i> Chat Platform</label>
                                <div class="et-select-wrapper">
                                    <select id="et_platform_default" class="et-select"></select>
                                    <i class="fa-solid fa-chevron-down et-select-arrow"></i>
                                </div>
                                <div class="et-hint">How chats look and which extra functions they support.</div>
                            </div>

                            <div class="et-field">
                                <label class="et-field-label" for="et_platform_character" id="et_platform_character_label">Platform for this character</label>
                                <div class="et-select-wrapper">
                                    <select id="et_platform_character" class="et-select"></select>
                                    <i class="fa-solid fa-chevron-down et-select-arrow"></i>
                                </div>
                            </div>

                            <div class="et-field">
                                <label class="et-field-label" for="et_font_size">
                                    <i class="fa-solid fa-font"></i> Font Size
                                </label>
                                <div class="et-slider-row">
                                    <input type="range" id="et_font_size" class="slider et-slider" min="10" max="24" step="1" value="15">
                                    <span id="et_font_size_val" class="et-slider-val">15px</span>
                                </div>
                                <div class="et-hint">Applies to every look.</div>
                            </div>

                            <div class="et-field">
                                <label class="et-field-label"><i class="fa-solid fa-text-height"></i> Font Family</label>
                                ${buildFontDropdownHtml(settings().fontFamily)}
                                <div class="et-hint">Applies to every look.</div>
                            </div>

                            <div class="et-field">
                                <label class="et-field-label" for="et_glass_blur">
                                    <i class="fa-solid fa-droplet"></i> Glassmorphism Blur
                                </label>
                                <div class="et-slider-row">
                                    <input type="range" id="et_glass_blur" class="slider et-slider" min="0" max="40" step="2" value="20">
                                    <span id="et_glass_blur_val" class="et-slider-val">20px</span>
                                </div>
                                <div class="et-hint">Controls the background blur intensity behind the panel for the frosted glass effect. Echogram's look only.</div>
                            </div>

                            <div class="et-field">
                                <label class="et-field-label" for="et_glass_opacity">
                                    <i class="fa-solid fa-eye"></i> Panel Opacity
                                </label>
                                <div class="et-slider-row">
                                    <input type="range" id="et_glass_opacity" class="slider et-slider" min="20" max="100" step="5" value="85">
                                    <span id="et_glass_opacity_val" class="et-slider-val">85%</span>
                                </div>
                                <div class="et-hint">Adjusts how transparent the panel background appears. Echogram's look only.</div>
                            </div>

                            <div class="et-field">
                                <label class="et-field-label" for="et_line_spacing">
                                    <i class="fa-solid fa-text-height"></i> Line Spacing
                                </label>
                                <div class="et-slider-row">
                                    <input type="range" id="et_line_spacing" class="slider et-slider" min="1.0" max="2.0" step="0.05" value="1.3">
                                    <span id="et_line_spacing_val" class="et-slider-val">1.30</span>
                                </div>
                                <div class="et-hint">Controls the line height of text within each message bubble. Echogram's look only.</div>
                            </div>

                            <div class="et-field">
                                <label class="et-field-label" for="et_paragraph_spacing">
                                    <i class="fa-solid fa-grip-lines"></i> Message Spacing
                                </label>
                                <div class="et-slider-row">
                                    <input type="range" id="et_paragraph_spacing" class="slider et-slider" min="2" max="24" step="2" value="12">
                                    <span id="et_paragraph_spacing_val" class="et-slider-val">12px</span>
                                </div>
                                <div class="et-hint">Controls the vertical gap between chat bubbles. Echogram's look only.</div>
                            </div>

                        </div>


                        <!-- ACTION BUTTON -->
                        <div class="et-settings-section" id="et-section-fab">
                            <h3><i class="fa-solid fa-circle-dot"></i> Action Button</h3>

                            <div class="et-field">
                                <label class="et-field-label" for="et_fab_size">
                                    <i class="fa-solid fa-expand"></i> Button Size
                                </label>
                                <div class="et-slider-row">
                                    <input type="range" id="et_fab_size" class="slider et-slider" min="22" max="76" step="2" value="56">
                                    <span id="et_fab_size_val" class="et-slider-val">56px</span>
                                </div>
                            </div>

                            <div class="et-field">
                                <label class="et-field-label" for="et_fab_opacity">
                                    <i class="fa-solid fa-eye"></i> Button Opacity
                                </label>
                                <div class="et-slider-row">
                                    <input type="range" id="et_fab_opacity" class="slider et-slider" min="10" max="100" step="10" value="100">
                                    <span id="et_fab_opacity_val" class="et-slider-val">100%</span>
                                </div>
                            </div>

                            <div class="et-field">
                                <label class="et-field-label">
                                    <i class="fa-solid fa-icons"></i> Button Icon
                                </label>
                                <div class="et-icon-grid">
                                    <button class="et-icon-option" data-icon="fa-comment-dots" title="Comment Dots"><i class="fa-solid fa-comment-dots"></i></button>
                                    <button class="et-icon-option" data-icon="fa-message" title="Message"><i class="fa-solid fa-message"></i></button>
                                    <button class="et-icon-option" data-icon="fa-comments" title="Comments"><i class="fa-solid fa-comments"></i></button>
                                    <button class="et-icon-option" data-icon="fa-mobile-screen" title="Mobile"><i class="fa-solid fa-mobile-screen"></i></button>
                                    <button class="et-icon-option" data-icon="fa-robot" title="Robot"><i class="fa-solid fa-robot"></i></button>
                                    <button class="et-icon-option" data-icon="fa-heart" title="Heart"><i class="fa-solid fa-heart"></i></button>
                                    <button class="et-icon-option" data-icon="fa-star" title="Star"><i class="fa-solid fa-star"></i></button>
                                    <button class="et-icon-option" data-icon="fa-bolt" title="Bolt"><i class="fa-solid fa-bolt"></i></button>
                                    <button class="et-icon-option" data-icon="fa-fire" title="Fire"><i class="fa-solid fa-fire"></i></button>
                                    <button class="et-icon-option" data-icon="fa-wand-magic-sparkles" title="Magic"><i class="fa-solid fa-wand-magic-sparkles"></i></button>
                                </div>
                            </div>
                        </div>

                        <!-- PROACTIVE INSIGHTS -->
                        <div class="et-settings-section" id="et-section-proactive-insights">
                            <h3><i class="fa-solid fa-clock"></i> Proactive Messages</h3>
                            <div class="et-hint" style="margin-bottom:16px;">The character texts you first when you don't answer.</div>


                            <div class="et-field">
                                <div class="et-proactive-controls-row">
                                    <button id="et_proactive_toggle" class="et-proactive-btn et-proactive-btn-toggle" type="button" title="Enable or disable proactive trigger checks">
                                        <i class="fa-solid fa-toggle-on"></i>
                                        <span>Proactive: Enabled</span>
                                    </button>
                                    <button id="et_trigger_message" class="et-proactive-btn et-proactive-btn-trigger" type="button" title="Send a random proactive trigger message now">
                                        <i class="fa-solid fa-bolt"></i>
                                        <span>Trigger Message</span>
                                    </button>
                                </div>
                            </div>

                            <div class="et-field" data-et-needs="proactive">
                                <label class="et-label-text" for="et_proactive_daily_limit"><i class="fa-solid fa-gauge"></i> Daily limit</label>
                                <input type="number" class="et-ctx-wi-field-input" id="et_proactive_daily_limit" min="1" step="1" placeholder="20">
                                <div class="et-hint">Texts a day, all characters.</div>
                            </div>

                            <div class="et-field" data-et-needs="proactive">
                                <span class="et-label-text"><i class="fa-solid fa-hourglass-half"></i> When ignored</span>
                                <div class="et-hint">Each unanswered text multiplies the next wait.</div>
                                <table class="et-temperament-table" id="et_temperament_table">
                                    <thead><tr><th></th><th>First wait (min)</th><th>Growth</th><th></th></tr></thead>
                                    <tbody></tbody>
                                </table>
                            </div>

                            <div class="et-field">
                                <label class="et-toggle-row" for="et_daily_life">
                                    <input type="checkbox" id="et_daily_life" class="checkbox">
                                    <span class="et-label-text"><i class="fa-solid fa-calendar-days"></i> Daily Life</span>
                                </label>
                                <div class="et-hint">Adds Schedule under the character's name.</div>
                            </div>

                            <div class="et-field" data-et-needs="daily-life">
                                <label class="et-toggle-row" for="et_daily_life_made_up">
                                    <input type="checkbox" id="et_daily_life_made_up" class="checkbox">
                                    <span class="et-label-text"><i class="fa-solid fa-wand-magic-sparkles"></i> Made-up errands</span>
                                </label>
                                <div class="et-hint">The character adds errands of their own.</div>
                            </div>

                            <div class="et-field" data-et-needs="proactive-or-daily-life">
                                <label class="et-toggle-row" for="et_catch_up">
                                    <input type="checkbox" id="et_catch_up" class="checkbox">
                                    <span class="et-label-text"><i class="fa-solid fa-clock-rotate-left"></i> Catch up</span>
                                </label>
                                <div class="et-hint">Fills in what they did while you were away.</div>
                            </div>

                            <div class="et-field" data-et-needs="proactive-or-daily-life">
                                <label class="et-toggle-row" for="et_story_pause">
                                    <input type="checkbox" id="et_story_pause" class="checkbox">
                                    <span class="et-label-text"><i class="fa-solid fa-book-open-reader"></i> Pause during story</span>
                                </label>
                                <div class="et-hint">Holds their texts while you're playing the main chat.</div>
                            </div>

                            <div class="et-proactive-insights-grid">
                                <div class="et-proactive-insight-item"><span class="et-proactive-insight-label">Character</span><span class="et-proactive-insight-val" id="et_proactive_character">—</span></div>
                                <div class="et-proactive-insight-item"><span class="et-proactive-insight-label">Check cadence</span><span class="et-proactive-insight-val" id="et_proactive_tick">—</span></div>
                                <div class="et-proactive-insight-item"><span class="et-proactive-insight-label">You last messaged</span><span class="et-proactive-insight-val" id="et_proactive_last_user">—</span></div>
                                <div class="et-proactive-insight-item"><span class="et-proactive-insight-label">Character last replied</span><span class="et-proactive-insight-val" id="et_proactive_last_char">—</span></div>
                                <div class="et-proactive-insight-item"><span class="et-proactive-insight-label">Last proactive text</span><span class="et-proactive-insight-val" id="et_proactive_last_auto">—</span></div>
                                <div class="et-proactive-insight-item et-proactive-insight-wide"><span class="et-proactive-insight-label">Current status</span><span class="et-proactive-insight-val" id="et_proactive_next">—</span></div>
                                <div class="et-proactive-insight-item"><span class="et-proactive-insight-label">Last trigger</span><span class="et-proactive-insight-val" id="et_proactive_type">—</span></div>
                                <div class="et-proactive-insight-item et-proactive-insight-wide"><span class="et-proactive-insight-label">Schedule</span><span class="et-proactive-insight-val" id="et_proactive_life">—</span></div>
                            </div>

                            <div class="et-field" style="margin-top:12px;">
                                <details class="et-trigger-details" id="et_trigger_details">
                                    <summary><i class="fa-solid fa-list-check"></i> Trigger Timeline Diagnostics</summary>
                                    <div class="et-trigger-list" id="et_trigger_list"></div>
                                </details>
                            </div>
                        </div>

                        <!-- MEMORY SYSTEM -->
                        <div class="et-settings-section" id="et-section-memory">
                            <h3><i class="fa-solid fa-brain"></i> Memory System</h3>
                            <div class="et-hint" style="margin-bottom:18px;">
                                Pinned memories are always in the prompt; the others when the recent messages mention them or one of their keywords.
                            </div>

                            <div class="et-field">
                                <label class="et-toggle-row" for="et_memory_enabled">
                                    <input type="checkbox" id="et_memory_enabled" class="checkbox">
                                    <span class="et-label-text"><i class="fa-solid fa-brain"></i> Enable Memory System</span>
                                </label>
                                <div class="et-hint">Inject relevant shared memories into the system prompt during generation.</div>
                            </div>

                            <div class="et-field" data-et-needs="memory">
                                <label class="et-toggle-row" for="et_memory_summaries">
                                    <input type="checkbox" id="et_memory_summaries" class="checkbox">
                                    <span class="et-label-text"><i class="fa-solid fa-scroll"></i> Summarize Older Messages</span>
                                </label>
                                <div class="et-hint">The model gets the latest messages in full and short summaries of the ones before.</div>
                                <div class="et-ctx-wi-field" style="margin-top:8px;">
                                    <i class="fa-solid fa-comments et-ctx-wi-field-icon"></i>
                                    <span class="et-ctx-wi-field-label">Messages in Full</span>
                                    <input type="number" class="et-ctx-wi-field-input" id="et_memory_keep" min="20" max="500" step="10" placeholder="60">
                                </div>
                            </div>

                            <div class="et-field">
                                <label class="et-field-label"><i class="fa-solid fa-folder-open"></i> Memory Scope</label>
                                <div class="et-mem-scope-pills" id="et_memory_scope_pills">
                                    <button class="et-mem-scope-btn" data-scope="per-character" type="button">
                                        <i class="fa-solid fa-user"></i> Per Character
                                    </button>
                                    <button class="et-mem-scope-btn" data-scope="global" type="button">
                                        <i class="fa-solid fa-globe"></i> Global
                                    </button>
                                </div>
                                <div class="et-hint" id="et_memory_scope_hint">
                                    Per Character: each character has their own separate memory pool.<br>
                                    Global: one shared pool used across all characters.
                                </div>
                            </div>

                            <div class="et-field" style="margin-top:20px;">
                                <div class="et-mem-list-header">
                                    <span class="et-mem-list-title" id="et_memory_list_label">Memories</span>
                                    <div style="display:flex;gap:8px;align-items:center;">
                                        <button class="et-mem-clear-btn" id="et_memory_clear" type="button" title="Clear all memories for this scope">
                                            <i class="fa-solid fa-trash-can"></i> Clear All
                                        </button>
                                        <button class="et-mem-add-btn" id="et_memory_add_btn" type="button">
                                            <i class="fa-solid fa-plus"></i> Add
                                        </button>
                                    </div>
                                </div>

                                <!-- Inline add form -->
                                <div class="et-mem-add-form" id="et_memory_add_form" style="display:none;">
                                    <div class="et-mem-form-row">
                                        <div class="et-select-wrapper">
                                            <select class="et-select et-mem-form-category" id="et_memory_form_category">
                                                <option value="inside_joke">Inside Joke</option>
                                                <option value="person">Important Person</option>
                                                <option value="hobby">Hobby / Interest</option>
                                                <option value="favorite_thing">Favorite Thing</option>
                                                <option value="shared_moment">Shared Moment</option>
                                                <option value="life">Life</option>
                                                <option value="custom">Custom</option>
                                            </select>
                                            <i class="fa-solid fa-chevron-down et-select-arrow"></i>
                                        </div>
                                        <input type="text" class="et-input-text et-mem-form-label" id="et_memory_form_label" placeholder="Label (e.g. &ldquo;Our song&rdquo;, &ldquo;Her sister&rdquo;)">
                                    </div>
                                    <textarea class="et-mem-form-content" id="et_memory_form_content" rows="3" placeholder="Describe the memory in plain language…"></textarea>
                                    <input type="text" class="et-input-text et-mem-form-keys" id="et_memory_form_keys" placeholder="Keywords, comma-separated">
                                    <div class="et-mem-form-actions">
                                        <label class="et-mem-form-pin-row">
                                            <input type="checkbox" id="et_memory_form_pin" class="checkbox">
                                            <span><i class="fa-solid fa-thumbtack"></i> Pin — always inject this memory</span>
                                        </label>
                                        <div style="display:flex;gap:8px;">
                                            <button class="et-mem-form-save" id="et_memory_form_save" type="button">Save</button>
                                            <button class="et-mem-form-cancel" id="et_memory_form_cancel" type="button">Cancel</button>
                                        </div>
                                    </div>
                                </div>

                                <!-- Memory card list -->
                                <div class="et-mem-list" id="et_memory_list"></div>
                                <div class="et-mem-empty" id="et_memory_empty" style="display:none;">
                                    <i class="fa-solid fa-box-open"></i>
                                    <div>No memories saved yet.</div>
                                    <div style="margin-top:4px;font-size:0.88em;opacity:0.7;">Add one here or from a bubble's menu.</div>
                                </div>
                                <!-- This chat's summaries -->
                                <div class="et-memo-section" style="display:none;">
                                    <div class="et-mem-list-header"><span class="et-mem-list-title">This chat</span></div>
                                    <div class="et-mem-list et-memo-list"></div>
                                </div>
                            </div>
                        </div>

                        <!-- IMAGE GENERATION -->
                        <div class="et-settings-section" id="et-section-image-generation">
                            <h3><i class="fa-solid fa-image"></i> Image Generation</h3>
                            <div class="et-hint" style="margin-bottom:16px;">Use SillyTavern's Image Generation plugin so characters can respond to natural image requests with generated pictures inside Echogram.</div>

                            <div class="et-field">
                                <label class="et-toggle-row" for="et_image_generation_enabled">
                                    <input type="checkbox" id="et_image_generation_enabled" class="checkbox">
                                    <span class="et-label-text"><i class="fa-solid fa-wand-magic-sparkles"></i> Enable Image Generation</span>
                                </label>
                                <div class="et-hint">Lets characters respond to natural image requests with generated pictures. Requires SillyTavern's Image Generation extension.</div>
                            </div>

                            <div id="et_image_generation_plugin_notice" class="et-imagegen-setup-notice" style="display:none;">
                                <div class="et-imagegen-setup-title"><i class="fa-solid fa-circle-exclamation"></i> One-time plugin setup required</div>
                                <ol class="et-imagegen-setup-steps">
                                    <li>Enable the <strong>Image Generation</strong> extension in SillyTavern</li>
                                    <li>Configure it with a working image source <span class="et-imagegen-setup-note">(ComfyUI, Gemini, etc.)</span></li>
                                    </ol>
                            </div>

                            <div class="et-field" data-et-needs="image">
                                <label class="et-toggle-row" for="et_image_generation_include_text_reply">
                                    <input type="checkbox" id="et_image_generation_include_text_reply" class="checkbox">
                                    <span class="et-label-text"><i class="fa-solid fa-comment"></i> Include Text Alongside Image</span>
                                </label>
                                <div class="et-hint">If enabled, the character sends a short in-character text with the generated image.</div>
                            </div>

                            <!-- IMAGE TRIGGER REFERENCE ACCORDION -->
                            <details class="et-trigger-details et-imagetrig-details" id="et_image_trigger_reference">
                                <summary>
                                    <i class="fa-solid fa-circle-info"></i>
                                    <span>What triggers image generation?</span>
                                    <i class="fa-solid fa-chevron-down et-trigger-summary-chevron"></i>
                                </summary>
                                <div class="et-imagetrig-body">

                                    <p class="et-imagetrig-intro">
                                        Echogram listens for natural-language phrases in your messages.
                                        Any message that matches one of the patterns below (or an
                                        affirmative reply after the character offered a photo) will
                                        trigger image generation. When your request contains a contextual
                                        reference &mdash; like <em>&ldquo;that&rdquo;</em> or
                                        <em>&ldquo;what you&rsquo;re wearing&rdquo;</em> &mdash; Echogram
                                        automatically looks back through the recent conversation to
                                        resolve what you meant before building the image prompt.
                                    </p>

                                    <div class="et-imagetrig-group">
                                        <div class="et-imagetrig-group-label">
                                            <i class="fa-solid fa-camera"></i> Selfie &amp; Photo Requests
                                        </div>
                                        <div class="et-imagetrig-pills">
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="Send me a selfie" title="Click to copy">Send me a selfie</span>
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="Send me a photo" title="Click to copy">Send me a photo / pic</span>
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="Show me a photo of you" title="Click to copy">Show me a photo of you</span>
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="Can you send me a pic?" title="Click to copy">Can you send me a pic?</span>
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="Could you send a picture?" title="Click to copy">Could you send a picture?</span>
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="Take a selfie for me" title="Click to copy">Take a selfie for me</span>
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="Snap a photo" title="Click to copy">Snap a photo</span>
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="Got any photos?" title="Click to copy">Got any photos?</span>
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="Any pics of you?" title="Click to copy">Any pics of you?</span>
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="Photo of you" title="Click to copy">Photo / pic / shot of you</span>
                                        </div>
                                    </div>

                                    <div class="et-imagetrig-group">
                                        <div class="et-imagetrig-group-label">
                                            <i class="fa-solid fa-eye"></i> Appearance &amp; Look
                                        </div>
                                        <div class="et-imagetrig-pills">
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="What do you look like?" title="Click to copy">What do you look like?</span>
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="Show me what you look like" title="Click to copy">Show me what you look like</span>
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="Show me how you look" title="Click to copy">Show me how you look</span>
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="Show me you wearing " title="Click to copy">Show me you wearing&hellip;</span>
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="Show me your outfit" title="Click to copy">Show me your outfit</span>
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="I want to see you" title="Click to copy">I want to see you</span>
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="I want to see what you're wearing" title="Click to copy">I want to see what you&rsquo;re wearing</span>
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="I want a photo of you" title="Click to copy">I want a photo of you</span>
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="I'd love to see you" title="Click to copy">I&rsquo;d love to see you</span>
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="I'd love to see a pic" title="Click to copy">I&rsquo;d love to see a pic</span>
                                        </div>
                                    </div>

                                    <div class="et-imagetrig-group">
                                        <div class="et-imagetrig-group-label">
                                            <i class="fa-solid fa-arrows-spin"></i> Context References <span class="et-imagetrig-group-note">(AI resolves from conversation)</span>
                                        </div>
                                        <div class="et-imagetrig-pills">
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="Show me a photo of that" title="Click to copy">Show me a photo of that</span>
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="Send me a pic of that" title="Click to copy">Send me a pic of that</span>
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="Show me what you're wearing" title="Click to copy">Show me what you&rsquo;re wearing</span>
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="Show me your outfit today" title="Click to copy">Show me your outfit today</span>
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="Show me that look" title="Click to copy">Show me that look</span>
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="Send me a photo of how you look right now" title="Click to copy">Send me a photo of how you look right now</span>
                                        </div>
                                    </div>

                                    <div class="et-imagetrig-group">
                                        <div class="et-imagetrig-group-label">
                                            <i class="fa-solid fa-pen-nib"></i> Drawing &amp; Art
                                        </div>
                                        <div class="et-imagetrig-pills">
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="Draw me a picture of " title="Click to copy">Draw me a picture of&hellip;</span>
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="Draw me" title="Click to copy">Draw me</span>
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="Sketch me a portrait" title="Click to copy">Sketch me a portrait</span>
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="Paint a picture of " title="Click to copy">Paint a picture of&hellip;</span>
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="Illustrate yourself" title="Click to copy">Illustrate yourself</span>
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="Draw a comic of " title="Click to copy">Draw a comic of&hellip;</span>
                                        </div>
                                    </div>

                                    <div class="et-imagetrig-group">
                                        <div class="et-imagetrig-group-label">
                                            <i class="fa-solid fa-wand-magic-sparkles"></i> Make / Create / Generate
                                        </div>
                                        <div class="et-imagetrig-pills">
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="Make me a photo of " title="Click to copy">Make me a photo of&hellip;</span>
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="Create a drawing of " title="Click to copy">Create a drawing of&hellip;</span>
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="Generate a selfie" title="Click to copy">Generate a selfie</span>
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="Make me a portrait" title="Click to copy">Make me a portrait</span>
                                        </div>
                                    </div>

                                    <div class="et-imagetrig-group">
                                        <div class="et-imagetrig-group-label">
                                            <i class="fa-solid fa-paintbrush"></i> Artwork, Anime &amp; CGs
                                        </div>
                                        <div class="et-imagetrig-pills">
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="Send me a cg" title="Click to copy">Send me a CG</span>
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="Show me a render" title="Click to copy">Show me a render</span>
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="Show me some hentai" title="Click to copy">Show me some hentai</span>
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="Got any artwork?" title="Click to copy">Got any artwork?</span>
                                            <span class="et-imagetrig-pill et-imagetrig-pill-copyable" data-copy="Generate an illustration" title="Click to copy">Generate an illustration</span>
                                        </div>
                                    </div>

                                    <div class="et-imagetrig-group">
                                        <div class="et-imagetrig-group-label">
                                            <i class="fa-solid fa-reply"></i> Affirmative Reply <span class="et-imagetrig-group-note">(after character offers a photo)</span>
                                        </div>
                                        <div class="et-imagetrig-pills">
                                            <span class="et-imagetrig-pill">Yes / Yeah / Yep / Sure</span>
                                            <span class="et-imagetrig-pill">Definitely / Absolutely</span>
                                            <span class="et-imagetrig-pill">Please do / Go ahead</span>
                                            <span class="et-imagetrig-pill">Of course / Alright</span>
                                            <span class="et-imagetrig-pill">I&rsquo;d love to / Send it</span>
                                            <span class="et-imagetrig-pill">Show me / Let me see</span>
                                        </div>
                                    </div>

                                    <p class="et-imagetrig-tip">
                                        <i class="fa-solid fa-lightbulb"></i>
                                        <strong>Tip:</strong> You can be explicit &mdash;
                                        <em>&ldquo;Send me a selfie in a red dress at the beach&rdquo;</em> &mdash;
                                        or just reference the conversation &mdash;
                                        <em>&ldquo;Show me a photo of that&rdquo;</em> or
                                        <em>&ldquo;Show me what you&rsquo;re wearing&rdquo;</em>.
                                        Echogram uses the AI to resolve contextual references automatically.
                                    </p>

                                    <p class="et-imagetrig-tip" style="margin-top: 10px;">
                                        <i class="fa-solid fa-brain"></i>
                                        <strong>Context Resolution:</strong> When your message contains a vague
                                        reference (&ldquo;that&rdquo;, &ldquo;what you&rsquo;re wearing&rdquo;,
                                        &ldquo;your outfit&rdquo;), Echogram makes a quick AI call to look back
                                        through the last few messages and extract the concrete visual description
                                        before sending it to Stable Diffusion. Simple explicit requests skip this
                                        step entirely for instant generation.
                                    </p>

                                    <p class="et-imagetrig-tip" style="margin-top: 10px;">
                                        <i class="fa-solid fa-fire"></i>
                                        <strong>Style Modifiers:</strong> Words like <em>hentai, nsfw, ecchi, lewd,</em> or <em>manga</em> will automatically force explicit or anime style tags into the underlying Stable Diffusion prompt.
                                    </p>

                                </div>
                            </details>
                        </div>

                        <!-- PROMPT MANAGER -->
                        <div class="et-settings-section" id="et-section-prompts">
                            <h3><i class="fa-solid fa-scroll"></i> Prompt Manager</h3>
                            <div class="et-hint" style="margin-bottom:18px;">Edit the prompts sent to the AI. Changes auto-save as you type. Use <code>{{char}}</code> and <code>{{user}}</code> as placeholders. Click <b>Reset</b> to restore the factory default.</div>

                            <div class="et-field" >
                                <label class="et-toggle-row" for="et_anti_refusal">
                                    <input type="checkbox" id="et_anti_refusal" class="checkbox">
                                    <span class="et-label-text"><i class="fa-solid fa-shield-halved"></i> Anti-Refusal Framing</span>
                                </label>
                                <div class="et-hint">Prepend a roleplay fiction frame and persona-lock reminder to the system prompt, and insert an in-character pre-fill for chat-completion backends (Profile / Ollama / OpenAI) to prevent out-of-character refusals.</div>
                            </div>

                            ${buildPromptManagerSectionHtml()}
                        </div>

                    </div>
                </div>
            </div>
        </div>`;
        }

        
            function updateAntiRefusalPromptsVisibility() {
                const isOn = !!settings().antiRefusal;
                // If it's unchecked, hide the Anti-Refusal ON prompts, and show the OFF prompts.
                jQuery('.et-pm-card[data-pm-id="promptAntiRefusalFrame"]').toggle(isOn);
                jQuery('.et-pm-card[data-pm-id="promptTetheredReminder"]').toggle(isOn);
                jQuery('.et-pm-card[data-pm-id="promptTetheredNoFrame"]').toggle(!isOn);
            }
function openSettingsModal() {
            jQuery('#et-settings-modal').remove();
            jQuery('body').append(buildSettingsModalHtml());

            applySettingsToUI();
            api.renderRecoverRows?.();

            // Apply World Info sub-panel state after settings are applied
            const _wiEn = settings().ctxWorldInfo === true;
            jQuery('#et-ctx-wi-sub').toggle(_wiEn);
            if (_wiEn) {
                const _wiM = settings().ctxWorldInfoMode || 'min_order';
                jQuery('#et-ctx-wi-sub .et-ctx-wi-mode-btn').removeClass('et-ctx-wi-mode-btn-active');
                jQuery('#et-ctx-wi-sub .et-ctx-wi-mode-btn[data-mode="' + _wiM + '"]').addClass('et-ctx-wi-mode-btn-active');
                jQuery('#et_ctx_wi_min').val(typeof settings().ctxWorldInfoMinOrder === 'number' ? settings().ctxWorldInfoMinOrder : 250);
                jQuery('#et_ctx_wi_max').val(typeof settings().ctxWorldInfoMaxOrder === 'number' ? String(settings().ctxWorldInfoMaxOrder) : '');
                jQuery('#et_ctx_wi_targeted').val(Array.isArray(settings().ctxWorldInfoTargetedOrders) ? settings().ctxWorldInfoTargetedOrders.join(', ') : '');
                toggleWIModalRows(_wiM);
            }
            populateConnectionProfiles();
            if (settings().source === 'ollama') fetchOllamaModels();
            updateProviderVisibility();

            // Update font preview
            updateFontPreview(settings().fontFamily);
            updateThemePreviewFull(settings().theme);
            refreshProactiveInsights();

            requestAnimationFrame(() => {
                jQuery('#et-settings-modal').addClass('et-settings-visible');
            });

            // Initialize custom dropdowns
            initCustomDropdowns();
            updateAntiRefusalPromptsVisibility();

            bindSettingsModalEvents();

            // iOS: patch any sliders that were just injected into the modal
            patchIOSSliders(document.getElementById('et-settings-modal'));
        }

        function closeSettingsModal() {
            const modal = jQuery('#et-settings-modal');
            modal.removeClass('et-settings-visible');
            // Remove custom dropdown event listeners
            jQuery(document).off('click.et-dd');
            setTimeout(() => modal.remove(), 250);
        }

        function updateFontPreview(fontFamily) {
            const preview = jQuery('#et_font_preview');
            if (!preview.length) return;
            loadGoogleFont(fontFamily);
            preview.css('font-family', `'${fontFamily}', sans-serif`);
        }

        function updateThemePreviewFull(themeKey) {
            const theme = THEME_PRESETS()[themeKey] || THEME_PRESETS().sillytavern;
            const preview = jQuery('#et_theme_preview');
            const desc = jQuery('#et_theme_desc');
            if (preview.length) {
                preview.html((theme.swatches || []).map(c =>
                    `<span class="et-theme-swatch" style="background:${c};"></span>`
                ).join(''));
            }
            if (desc.length) desc.text(theme.description || '');
        }

        function toggleWIModalRows(mode) {
            jQuery('#et-ctx-wi-row-min').toggle(mode === 'min_order' || mode === 'range' || mode === 'custom');
            jQuery('#et-ctx-wi-row-max').toggle(mode === 'range' || mode === 'custom');
            jQuery('#et-ctx-wi-row-targeted').toggle(mode === 'targeted' || mode === 'custom');
        }

        function bindSettingsModalEvents() {
            jQuery('#et-settings-close, #et-settings-overlay').on('click', closeSettingsModal);

            const onKey = (e) => {
                if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); closeSettingsModal(); }
            };
            document.addEventListener('keydown', onKey);

            // Custom theme editor button (settings modal)
            jQuery('#et-te-open-btn-modal').on('click', function () {
                if (typeof openThemeEditor === 'function') openThemeEditor();
            });

            jQuery('.et-nav-item').on('click', function () {
                const section = jQuery(this).data('section');
                jQuery('.et-nav-item').removeClass('active');
                jQuery(this).addClass('active');
                jQuery('.et-settings-section').removeClass('active');
                jQuery(`#et-section-${section}`).addClass('active');
                // The proactive section: its insights as they are now
                if (section === 'proactive-insights') refreshProactiveInsights();
            });

            // General - Enable toggle
            jQuery('#et_enabled').on('change', function () {
                settings().enabled = jQuery(this).is(':checked');
                saveSettings();
                toggleEchoTextMaster();
                jQuery('#et_enabled_quick').prop('checked', settings().enabled);
            });

            jQuery('#et_auto_scroll').on('change', function () {
                settings().autoScroll = jQuery(this).is(':checked');
                saveSettings();
            });

            jQuery('#et_verbosity_default').on('change', function () {
                settings().verbosityDefault = jQuery(this).val();
                saveSettings();
            });

            jQuery('#et_auto_open').on('change', function () {
                settings().autoOpenOnReload = jQuery(this).is(':checked');
                saveSettings();
            });

            jQuery('#et_auto_load_last_char').on('change', function () {
                settings().autoLoadLastCharacter = jQuery(this).is(':checked');
                saveSettings();
            });

            jQuery('#et_emotion_mode').on('change', function () {
                setEmotionMode(jQuery(this).val());
                saveSettings();
                if (typeof updatePanelStatusRow === 'function') updatePanelStatusRow();
            });

            jQuery('#et_nsfw_enabled').on('change', function () {
                settings().nsfwEnabled = jQuery(this).is(':checked');
                saveSettings();
                if (typeof updatePanelStatusRow === 'function') updatePanelStatusRow();
            });

            jQuery('#et_swiped_messages').on('change', function () {
                settings().swipedMessages = jQuery(this).is(':checked');
                saveSettings();
            });

            // Generation Engine
            jQuery('#et_source').on('change', function () {
                settings().source = jQuery(this).val();
                saveSettings();
                updateProviderVisibility();
                if (settings().source === 'profile') populateConnectionProfiles();
                if (settings().source === 'ollama') fetchOllamaModels();
            });

            jQuery('#et_profile_select').on('change', function () {
                settings().preset = jQuery(this).val();
                saveSettings();
            });

            jQuery('#et_ollama_url').on('change', function () {
                settings().ollama_url = jQuery(this).val();
                saveSettings();
                fetchOllamaModels();
            });

            jQuery('#et_ollama_model_select').on('change', function () {
                settings().ollama_model = jQuery(this).val();
                saveSettings();
            });

            jQuery('#et_openai_preset').on('change', function () {
                settings().openai_preset = jQuery(this).val();
                const presets = { lmstudio: 'http://localhost:1234/v1', kobold: 'http://localhost:5001/v1', textgen: 'http://localhost:5000/v1', vllm: 'http://localhost:8000/v1' };
                if (presets[settings().openai_preset]) {
                    settings().openai_url = presets[settings().openai_preset];
                    jQuery('#et_openai_url').val(settings().openai_url);
                }
                saveSettings();
            });

            jQuery('#et_openai_url').on('change', function () {
                settings().openai_url = jQuery(this).val();
                saveSettings();
            });

            jQuery('#et_openai_key').on('change', function () {
                settings().openai_key = jQuery(this).val();
                saveSettings();
            });

            jQuery('#et_openai_model').on('change', function () {
                settings().openai_model = jQuery(this).val();
                saveSettings();
            });

            jQuery('#et_anti_refusal').on('change', function () {
                settings().antiRefusal = jQuery(this).is(':checked');
                saveSettings();
                if (typeof updateAntiRefusalPromptsVisibility === "function") updateAntiRefusalPromptsVisibility();
            });

            jQuery('#et_image_generation_enabled').on('change', function () {
                settings().imageGenerationEnabled = jQuery(this).is(':checked');
                saveSettings();
                jQuery('#et_image_generation_plugin_notice').toggle(settings().imageGenerationEnabled === true);
                if (typeof updateImageGenerationVisibility === 'function') updateImageGenerationVisibility();
            });

            jQuery('#et_image_generation_include_text_reply').on('change', function () {
                settings().imageGenerationIncludeTextReply = jQuery(this).is(':checked');
                saveSettings();
            });

            // Trigger pill click-to-copy (modal)
            jQuery('#et-section-image-generation').on('click', '.et-imagetrig-pill-copyable', function () {
                const pill = jQuery(this);
                const text = pill.data('copy');
                if (!text) return;
                navigator.clipboard.writeText(text).then(() => {
                    pill.addClass('et-imagetrig-pill-copied');
                    setTimeout(() => pill.removeClass('et-imagetrig-pill-copied'), 1400);
                }).catch(() => {});
            });

            // Context settings
            jQuery('#et_ctx_description').on('change', function () {
                settings().ctxDescription = jQuery(this).is(':checked');
                saveSettings();
            });

            jQuery('#et_ctx_personality').on('change', function () {
                settings().ctxPersonality = jQuery(this).is(':checked');
                saveSettings();
            });

            jQuery('#et_ctx_scenario').on('change', function () {
                settings().ctxScenario = jQuery(this).is(':checked');
                saveSettings();
            });

            jQuery('#et_ctx_persona').on('change', function () {
                settings().ctxPersona = jQuery(this).is(':checked');
                saveSettings();
            });

            jQuery('#et_ctx_authors_note').on('change', function () {
                settings().ctxAuthorsNote = jQuery(this).is(':checked');
                saveSettings();
            });

            jQuery('#et_ctx_world_info').on('change', function () {
                settings().ctxWorldInfo = jQuery(this).is(':checked');
                saveSettings();
                // Toggle sub-panel
                jQuery('#et-ctx-wi-sub').toggle(settings().ctxWorldInfo);
                if (settings().ctxWorldInfo) {
                    const _m = settings().ctxWorldInfoMode || 'min_order';
                    jQuery('#et-ctx-wi-sub .et-ctx-wi-mode-btn').removeClass('et-ctx-wi-mode-btn-active');
                    jQuery('#et-ctx-wi-sub .et-ctx-wi-mode-btn[data-mode="' + _m + '"]').addClass('et-ctx-wi-mode-btn-active');
                    toggleWIModalRows(_m);
                }
            });

            // World Info mode buttons (modal)
            jQuery('#et-ctx-wi-sub').off('click.wi-modal').on('click.wi-modal', '.et-ctx-wi-mode-btn', function () {
                const mode = jQuery(this).data('mode');
                settings().ctxWorldInfoMode = mode;
                saveSettings();
                jQuery('#et-ctx-wi-sub .et-ctx-wi-mode-btn').removeClass('et-ctx-wi-mode-btn-active');
                jQuery(this).addClass('et-ctx-wi-mode-btn-active');
                toggleWIModalRows(mode);
            });

            // World Info input fields (modal)
            jQuery('#et_ctx_wi_min').off('input.wi-modal').on('input.wi-modal', function () {
                const val = parseInt(jQuery(this).val(), 10);
                settings().ctxWorldInfoMinOrder = isNaN(val) ? 250 : val;
                saveSettings();
            });
            jQuery('#et_ctx_wi_max').off('input.wi-modal').on('input.wi-modal', function () {
                const raw = jQuery(this).val().trim();
                const val = parseInt(raw, 10);
                settings().ctxWorldInfoMaxOrder = (raw === '' || isNaN(val)) ? null : val;
                saveSettings();
            });
            jQuery('#et_ctx_wi_targeted').off('input.wi-modal').on('input.wi-modal', function () {
                const raw = jQuery(this).val().trim();
                settings().ctxWorldInfoTargetedOrders = !raw ? [] : raw.split(',').map(function (v) { return parseInt(v.trim(), 10); }).filter(function (n) { return !isNaN(n); });
                saveSettings();
            });

            jQuery('#et_ctx_main_chat').on('change', function () {
                settings().ctxMainChat = jQuery(this).is(':checked');
                saveSettings();
            });

            jQuery('#et_ctx_st_messages').on('change', function () {
                settings().ctxSTMessages = jQuery(this).is(':checked');
                saveSettings();
            });

            jQuery('#et_strip_thinking_enabled').on('change', function () {
                settings().stripThinkingTagsEnabled = jQuery(this).is(':checked');
                saveSettings();
                jQuery('#et_strip_tags_sub').toggle(settings().stripThinkingTagsEnabled !== false);
            });

            jQuery('#et_strip_tag_chips').on('click', '.et-strip-tag-remove', function () {
                const idx = parseInt(jQuery(this).data('index'));
                if (!Array.isArray(settings().stripThinkingTagList)) return;
                settings().stripThinkingTagList.splice(idx, 1);
                invalidateStripTagsCache();
                saveSettings();
                renderStripTagChips('et_strip_tag_chips');
            });

            jQuery('#et_strip_tag_add').on('click', function () {
                const input = jQuery('#et_strip_tag_input');
                const val = input.val().trim().toLowerCase().replace(/[<>/\s]/g, '');
                if (!val) return;
                if (!Array.isArray(settings().stripThinkingTagList)) settings().stripThinkingTagList = [];
                if (!settings().stripThinkingTagList.includes(val)) {
                    settings().stripThinkingTagList.push(val);
                    invalidateStripTagsCache();
                    saveSettings();
                    renderStripTagChips('et_strip_tag_chips');
                }
                input.val('');
            });

            jQuery('#et_strip_tag_input').on('keydown', function (e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    jQuery('#et_strip_tag_add').trigger('click');
                }
            });

            jQuery('#et_strip_tag_reset').on('click', function () {
                const defaults = ['thinking', 'think', 'thought', 'reasoning', 'reason', 'gemma4'];
                settings().stripThinkingTagList = [...defaults];
                invalidateStripTagsCache();
                saveSettings();
                renderStripTagChips('et_strip_tag_chips');
            });

            jQuery('#et_custom_pattern_list').on('click', '.et-custom-pattern-remove', function () {
                const idx = parseInt(jQuery(this).data('index'));
                if (!Array.isArray(settings().stripCustomPatterns)) return;
                settings().stripCustomPatterns.splice(idx, 1);
                invalidateStripTagsCache();
                saveSettings();
                renderCustomPatternRows('et_custom_pattern_list');
            });

            jQuery('#et_custom_pattern_add').on('click', function () {
                const start = (jQuery('#et_custom_pattern_start').val() || '').trim();
                const end = (jQuery('#et_custom_pattern_end').val() || '').trim();
                if (!start || !end) return;
                if (!Array.isArray(settings().stripCustomPatterns)) settings().stripCustomPatterns = [];
                settings().stripCustomPatterns.push({ start, end });
                invalidateStripTagsCache();
                saveSettings();
                renderCustomPatternRows('et_custom_pattern_list');
                jQuery('#et_custom_pattern_start').val('');
                jQuery('#et_custom_pattern_end').val('');
            });

            // Appearance
            jQuery('#et_font_size').on('input', function () {
                settings().fontSize = parseInt(jQuery(this).val());
                jQuery('#et_font_size_val').text(settings().fontSize + 'px');
                applyAppearanceSettings();
                saveSettings();
            });

            jQuery('#et_glass_blur').on('input', function () {
                settings().glassBlur = parseInt(jQuery(this).val());
                jQuery('#et_glass_blur_val').text(settings().glassBlur + 'px');
                applyAppearanceSettings();
                saveSettings();
            });

            jQuery('#et_glass_opacity').on('input', function () {
                settings().glassOpacity = parseInt(jQuery(this).val());
                jQuery('#et_glass_opacity_val').text(settings().glassOpacity + '%');
                applyAppearanceSettings();
                saveSettings();
            });

            jQuery('#et_line_spacing').on('input', function () {
                settings().lineSpacing = parseFloat(jQuery(this).val());
                jQuery('#et_line_spacing_val').text(settings().lineSpacing.toFixed(2));
                applyAppearanceSettings();
                saveSettings();
            });

            jQuery('#et_paragraph_spacing').on('input', function () {
                settings().paragraphSpacing = parseInt(jQuery(this).val());
                jQuery('#et_paragraph_spacing_val').text(settings().paragraphSpacing + 'px');
                applyAppearanceSettings();
                saveSettings();
            });


            // Action Button
            jQuery('#et_fab_size').on('input', function () {
                settings().fabSize = parseInt(jQuery(this).val());
                jQuery('#et_fab_size_val').text(settings().fabSize + 'px');
                applyAppearanceSettings();
                positionFab();
                saveSettings();
            });

            jQuery('#et_fab_opacity').on('input', function () {
                settings().fabOpacity = parseInt(jQuery(this).val());
                jQuery('#et_fab_opacity_val').text(settings().fabOpacity + '%');
                applyAppearanceSettings();
                positionFab();
                saveSettings();
            });

            jQuery('.et-icon-option').on('click', function () {
                jQuery('.et-icon-option').removeClass('selected');
                jQuery(this).addClass('selected');
                settings().fabIcon = jQuery(this).data('icon');
                applyAppearanceSettings();
                saveSettings();
            });

            jQuery('#et_proactive_toggle').on('click', function () {
                settings().proactiveMessagingEnabled = settings().proactiveMessagingEnabled === false;
                saveSettings();
                updateProactiveToggleButtons();
                startProactiveScheduler();
                refreshProactiveInsights();
                syncDependentControls(settings());
            });

            jQuery('#et_trigger_message').on('click', function () {
                triggerTestProactiveMessage();
            });

            jQuery('#et_daily_life').on('change', function () {
                setDailyLifeEnabled(jQuery(this).is(':checked'));
            });

            jQuery('#et_daily_life_made_up').on('change', function () {
                settings().dailyLifeMadeUp = jQuery(this).is(':checked');
                saveSettings();
            });

            jQuery('#et_catch_up').on('change', function () {
                settings().catchUpEnabled = jQuery(this).is(':checked');
                saveSettings();
            });

            // ---- When ignored: the daily limit and the temperaments' two numbers ----
            renderTemperamentControls();
            jQuery('#et_proactive_daily_limit').on('change', function () {
                const n = Math.round(Number(this.value));
                settings().proactiveDailyLimit = Number.isFinite(n) && this.value !== '' ? Math.max(1, n) : 20;
                saveSettings();
                renderTemperamentControls();
                refreshProactiveInsights();
            });
            jQuery('#et_temperament_table').on('change', 'input', function () {
                const row = jQuery(this).closest('tr');
                const id = row.data('temperament');
                const Rounds = window.EchoTextProactiveRounds;
                const fallback = Rounds.TEMPERAMENTS.find(t => t.id === id);
                const params = Rounds.cleanParams({ baseMinutes: [row.find('[data-field="lo"]').val(), row.find('[data-field="hi"]').val()], growth: row.find('[data-field="growth"]').val() }, fallback);
                const own = { ...(settings().proactiveTemperamentParams || {}) };
                // The defaults again: nothing kept
                const same = params.growth === fallback.growth && params.baseMinutes.every((v, i) => v === fallback.baseMinutes[i]);
                if (same) delete own[id];
                else own[id] = params;
                settings().proactiveTemperamentParams = own;
                saveSettings();
                renderTemperamentControls();
                refreshProactiveInsights();
            });
            jQuery('#et_temperament_table').on('click', '[data-temperament-reset]', function () {
                const own = { ...(settings().proactiveTemperamentParams || {}) };
                delete own[this.dataset.temperamentReset];
                settings().proactiveTemperamentParams = own;
                saveSettings();
                renderTemperamentControls();
                refreshProactiveInsights();
            });

            jQuery('#et_story_pause').on('change', function () {
                settings().storyPauseEnabled = jQuery(this).is(':checked');
                saveSettings();
                refreshProactiveInsights();
            });

            // ---- Memory System (modal-specific) ----

            // Apply initial scope state for modal
            (function initMemoryModalUI() {
                const s = settings();
                const scope = s.memoryScope || 'per-character';
                jQuery('#et_memory_enabled').prop('checked', s.memoryEnabled !== false);
                jQuery('#et_memory_summaries').prop('checked', s.memorySummaries !== false);
                jQuery('#et_memory_keep').val(s.memoryKeepMessages || 60);
                updateMemoryScopePills('#et_memory_scope_pills', scope);
                renderMemoryListInto('#et_memory_list', '#et_memory_empty', '#et_memory_list_label');
            })();

            jQuery('#et_memory_enabled').on('change', function () {
                settings().memoryEnabled = jQuery(this).is(':checked');
                saveSettings();
            });

            jQuery('#et_memory_summaries').on('change', function () { setSummaries(jQuery(this).is(':checked')); });
            jQuery('#et_memory_keep').on('change', function () { setKeepMessages(this.value); });

            jQuery('#et_memory_scope_pills').on('click', '.et-mem-scope-btn', function () {
                const scope = jQuery(this).data('scope');
                settings().memoryScope = scope;
                saveSettings();
                updateMemoryScopePills('#et_memory_scope_pills', scope);
                const hint = scope === 'global'
                    ? 'One shared memory pool used across all characters.'
                    : 'Each character keeps their own separate memory pool.';
                jQuery('#et_memory_scope_hint').html(hint);
                renderMemoryListInto('#et_memory_list', '#et_memory_empty', '#et_memory_list_label');
            });

            jQuery('#et_memory_add_btn').on('click', function () {
                jQuery('#et_memory_add_form').slideToggle(180);
                jQuery('#et_memory_form_content').focus();
            });

            jQuery('#et_memory_form_cancel').on('click', function () {
                jQuery('#et_memory_add_form').slideUp(180);
                jQuery('#et_memory_form_label, #et_memory_form_content, #et_memory_form_keys').val('');
                jQuery('#et_memory_form_pin').prop('checked', false);
            });

            jQuery('#et_memory_form_save').on('click', function () {
                const category = jQuery('#et_memory_form_category').val();
                const label    = jQuery('#et_memory_form_label').val().trim();
                const content  = jQuery('#et_memory_form_content').val().trim();
                const keys     = window.EchoTextMemoryRecall.parseKeys(jQuery('#et_memory_form_keys').val());
                const pinned   = jQuery('#et_memory_form_pin').is(':checked');
                if (!content) {
                    jQuery('#et_memory_form_content').focus();
                    return;
                }
                const s = settings();
                const scope = s.memoryScope || 'per-character';
                const newMem = {
                    id:            Date.now().toString(36) + Math.random().toString(36).substring(2, 7),
                    category,
                    label:         label || (MEM_CATEGORIES[category] ? MEM_CATEGORIES[category].label : 'Memory'),
                    content,
                    keys,
                    createdAt:     Date.now(),
                    pinned
                };
                if (scope === 'global') {
                    if (!Array.isArray(s.globalMemories)) s.globalMemories = [];
                    s.globalMemories.unshift(newMem);
                } else {
                    const charKeyFn = window._etGetCharacterKey;
                    const charKey   = typeof charKeyFn === 'function' ? charKeyFn() : null;
                    if (charKey) {
                        if (!s.characterMemories) s.characterMemories = {};
                        if (!Array.isArray(s.characterMemories[charKey])) s.characterMemories[charKey] = [];
                        s.characterMemories[charKey].unshift(newMem);
                    } else {
                        // No character — fall back to global
                        if (!Array.isArray(s.globalMemories)) s.globalMemories = [];
                        s.globalMemories.unshift(newMem);
                    }
                }
                saveSettings();
                jQuery('#et_memory_add_form').slideUp(180);
                jQuery('#et_memory_form_label, #et_memory_form_content, #et_memory_form_keys').val('');
                jQuery('#et_memory_form_pin').prop('checked', false);
                renderMemoryListInto('#et_memory_list', '#et_memory_empty', '#et_memory_list_label');
            });

            jQuery('#et_memory_clear').on('click', function () {
                const btn = jQuery(this);
                if (!btn.hasClass('et-mem-confirm-pending')) {
                    btn.addClass('et-mem-confirm-pending');
                    btn.data('orig-html', btn.html());
                    btn.html('<i class="fa-solid fa-triangle-exclamation"></i> Click again to confirm');
                    clearTimeout(btn.data('confirm-timer'));
                    btn.data('confirm-timer', setTimeout(() => {
                        btn.removeClass('et-mem-confirm-pending');
                        btn.html(btn.data('orig-html'));
                    }, 3000));
                    return;
                }
                clearTimeout(btn.data('confirm-timer'));
                btn.removeClass('et-mem-confirm-pending');
                btn.html(btn.data('orig-html'));
                const s = settings();
                const scope = s.memoryScope || 'per-character';
                if (scope === 'global') {
                    s.globalMemories = [];
                } else {
                    const charKeyFn = window._etGetCharacterKey;
                    const charKey   = typeof charKeyFn === 'function' ? charKeyFn() : null;
                    if (charKey && s.characterMemories) delete s.characterMemories[charKey];
                }
                saveSettings();
                renderMemoryListInto('#et_memory_list', '#et_memory_empty', '#et_memory_list_label');
            });

        }

        // ============================================================
        // MEMORY SYSTEM EVENTS (Global Delegation)
        // ============================================================
        // Mounted once: the modal is built again each time it opens.

        // Summaries and how many messages go in full
        function setSummaries(on) {
            settings().memorySummaries = on;
            saveSettings();
            jQuery('#et_memory_summaries').prop('checked', on);
        }
        /** The daily limit and the temperaments' two numbers as set (their defaults where unchanged, a reset on the changed ones). */
        function renderTemperamentControls() {
            const Rounds = window.EchoTextProactiveRounds;
            if (!Rounds) return;
            const s = settings();
            jQuery('#et_proactive_daily_limit').val(Math.max(1, Math.round(Number(s.proactiveDailyLimit)) || 20));
            const rows = Rounds.TEMPERAMENTS.map(base => {
                const t = Rounds.temperamentOf(base.id, s.proactiveTemperamentParams);
                const changed = !!s.proactiveTemperamentParams?.[base.id];
                const field = (name, value, min, step) => `<input type="number" class="et-ctx-wi-field-input" data-field="${name}" min="${min}" step="${step}" value="${value}">`;
                return `<tr data-temperament="${base.id}"><td>${base.label}</td>`
                    + `<td class="et-temperament-range">${field('lo', t.baseMinutes[0], 0.1, 'any')}<span>–</span>${field('hi', t.baseMinutes[1], 0.1, 'any')}</td>`
                    + `<td>${field('growth', t.growth, 1, 0.1)}</td>`
                    + `<td>${changed ? `<button type="button" class="et-temperament-reset" data-temperament-reset="${base.id}" title="Reset"><i class="fa-solid fa-rotate-left"></i></button>` : ''}</td></tr>`;
            });
            jQuery('#et_temperament_table tbody').html(rows.join(''));
            syncDependentControls(s);
        }

        function setKeepMessages(value) {
            const n = Math.round(Number(value));
            settings().memoryKeepMessages = Number.isFinite(n) ? Math.min(500, Math.max(20, n)) : 60;
            saveSettings();
            jQuery('#et_memory_keep').val(settings().memoryKeepMessages);
        }
        // Memory card action buttons (pin, edit, delete)
        jQuery(document).on('click.et-mem', '.et-mem-btn[data-mem-action]', function (e) {
            e.stopPropagation();
            const btn    = jQuery(this);
            const action = btn.data('mem-action');
            const card   = btn.closest('.et-mem-card');
            const memId  = card.data('mem-id');
            if (!memId) return;

            if (action === 'delete') {
                if (!btn.hasClass('et-mem-confirm-pending')) {
                    btn.addClass('et-mem-confirm-pending');
                    btn.data('orig-html', btn.html());
                    btn.html('<i class="fa-solid fa-triangle-exclamation"></i> Sure?');
                    clearTimeout(btn.data('confirm-timer'));
                    btn.data('confirm-timer', setTimeout(() => {
                        btn.removeClass('et-mem-confirm-pending');
                        btn.html(btn.data('orig-html'));
                    }, 3000));
                    return;
                }
                clearTimeout(btn.data('confirm-timer'));
                btn.removeClass('et-mem-confirm-pending');
                btn.html(btn.data('orig-html'));
                const removeFrom = (list) => {
                    if (!Array.isArray(list)) return false;
                    const idx = list.findIndex(m => m.id === memId);
                    if (idx !== -1) { list.splice(idx, 1); return true; }
                    return false;
                };
                if (memoryLists().some(removeFrom)) saveSettings();
                renderMemoryListInto('#et_memory_list', '#et_memory_empty', '#et_memory_list_label');
                return;
            }

            if (action === 'keep') {
                window._etKeepChatMemory?.(memId);
                return;
            }

            if (action === 'pin') {
                const togglePin = (list) => {
                    if (!Array.isArray(list)) return false;
                    const idx = list.findIndex(m => m.id === memId);
                    if (idx === -1) return false;
                    list[idx].pinned = !list[idx].pinned;
                    return true;
                };
                if (memoryLists().some(togglePin)) saveSettings();
                renderMemoryListInto('#et_memory_list', '#et_memory_empty', '#et_memory_list_label');
                return;
            }

            if (action === 'edit') {
                const editPanel = card.find('.et-mem-card-edit');
                const isOpen    = editPanel.is(':visible');
                editPanel.slideToggle(160);
                card.find('.et-mem-card-content, .et-mem-card-label, .et-mem-card-keys').toggle(isOpen);
                return;
            }
        });

        // Save inline edit
        jQuery(document).on('click.et-mem', '.et-mem-edit-save', function () {
            const card   = jQuery(this).closest('.et-mem-card');
            const memId  = card.data('mem-id');
            if (!memId) return;
            const category = card.find('.et-mem-edit-category').val();
            const label    = card.find('.et-mem-edit-label').val().trim();
            const content  = card.find('.et-mem-edit-content').val().trim();
            const keys     = window.EchoTextMemoryRecall.parseKeys(card.find('.et-mem-edit-keys').val());
            const pinned   = card.find('.et-mem-edit-pin').is(':checked');

            const applyEdit = (list) => {
                if (!Array.isArray(list)) return false;
                const idx = list.findIndex(m => m.id === memId);
                if (idx === -1) return false;
                list[idx].category = category;
                list[idx].label    = label || list[idx].label;
                list[idx].content  = content;
                list[idx].keys     = keys;
                list[idx].pinned   = pinned;
                return true;
            };
            if (memoryLists().some(applyEdit)) saveSettings();
            renderMemoryListInto('#et_memory_list', '#et_memory_empty', '#et_memory_list_label');
        });

        // Summary cards: edit opens the text, delete asks once more (its messages are summarized again later)
        jQuery(document).on('click.et-mem', '.et-mem-btn[data-memo-action]', function (e) {
            e.stopPropagation();
            const btn  = jQuery(this);
            const card = btn.closest('.et-memo-card');
            const id   = card.attr('data-memo-id');
            if (btn.data('memo-action') === 'edit') {
                const editPanel = card.find('.et-mem-card-edit');
                const isOpen    = editPanel.is(':visible');
                editPanel.slideToggle(160);
                card.find('.et-mem-card-content').toggle(isOpen);
                return;
            }
            if (btn.data('memo-action') === 'keep') {
                window._etKeepChatSummary?.(id);
                return;
            }
            if (!btn.hasClass('et-mem-confirm-pending')) {
                btn.addClass('et-mem-confirm-pending');
                btn.data('orig-html', btn.html());
                btn.html('<i class="fa-solid fa-triangle-exclamation"></i> Sure?');
                clearTimeout(btn.data('confirm-timer'));
                btn.data('confirm-timer', setTimeout(() => {
                    btn.removeClass('et-mem-confirm-pending');
                    btn.html(btn.data('orig-html'));
                }, 3000));
                return;
            }
            clearTimeout(btn.data('confirm-timer'));
            if (typeof window._etSetChatSummary === 'function') window._etSetChatSummary(id, null);
        });

        jQuery(document).on('click.et-mem', '.et-memo-edit-save', function () {
            const card = jQuery(this).closest('.et-memo-card');
            const text = card.find('.et-memo-edit-text').val().trim();
            if (!text) { card.find('.et-memo-edit-text').focus(); return; }
            if (typeof window._etSetChatSummary === 'function') window._etSetChatSummary(card.attr('data-memo-id'), text);
        });

        jQuery(document).on('click.et-mem', '.et-memo-edit-cancel', function () {
            const card = jQuery(this).closest('.et-memo-card');
            card.find('.et-mem-card-edit').slideUp(160);
            card.find('.et-mem-card-content').show();
        });

        // Cancel inline edit
        jQuery(document).on('click.et-mem', '.et-mem-edit-cancel', function () {
            const card      = jQuery(this).closest('.et-mem-card');
            const editPanel = card.find('.et-mem-card-edit');
            editPanel.slideUp(160);
            card.find('.et-mem-card-content, .et-mem-card-label, .et-mem-card-keys').show();
        });

        // ============================================================
        // PROMPT MANAGER EVENTS (Global Delegation)
        // ============================================================
        // Mounted once: the modal is built again each time it opens.

        // Prompt Manager — group collapse / expand
        jQuery(document).on('click.et-pm', '.et-pm-group-header', function () {
            const group = jQuery(this).closest('.et-pm-group');
            group.toggleClass('et-pm-group-collapsed');
        });

        // Prompt Manager — auto-save on input (debounced)
        const pmTimers = {};
        jQuery(document).on('input.et-pm', '.et-pm-textarea', function () {
            const card = jQuery(this).closest('.et-pm-card');
            const id = card.data('pm-id');
            if (!id) return;
            const val = jQuery(this).val();
            clearTimeout(pmTimers[id]);
            pmTimers[id] = setTimeout(() => {
                settings()[id] = val;
                saveSettings();
                // Brief save flash
                jQuery(this).addClass('et-pm-saved');
                setTimeout(() => jQuery(this).removeClass('et-pm-saved'), 600);
            }, 400);
        });

        // Prompt Manager — Copy / Paste / Reset buttons
        jQuery(document).on('click.et-pm', '.et-pm-btn', function () {
            const btn = jQuery(this);
            const action = btn.data('pm-action');
            const card = btn.closest('.et-pm-card');
            const id = card.data('pm-id');
            const textarea = card.find('.et-pm-textarea');

            if (action === 'copy') {
                navigator.clipboard.writeText(textarea.val()).then(() => {
                    btn.html('<i class="fa-solid fa-check"></i>');
                    setTimeout(() => btn.html('<i class="fa-solid fa-copy"></i>'), 1200);
                }).catch(() => { });

            } else if (action === 'paste') {
                navigator.clipboard.readText().then(text => {
                    textarea.val(text);
                    settings()[id] = text;
                    saveSettings();
                    textarea.addClass('et-pm-saved');
                    setTimeout(() => textarea.removeClass('et-pm-saved'), 600);
                }).catch(() => { });

            } else if (action === 'reset') {
                const defaults = window.EchoTextConfig && window.EchoTextConfig.defaultSettings || {};
                const defaultVal = defaults[id] || '';
                textarea.val(defaultVal);
                settings()[id] = defaultVal;
                saveSettings();
                btn.html('<i class="fa-solid fa-check"></i>');
                setTimeout(() => btn.html('<i class="fa-solid fa-rotate-left"></i>'), 1200);
            }
        });

        return {
            buildSettingsModalHtml,
            openSettingsModal,
            closeSettingsModal,
            updateFontPreview,
            updateThemePreviewFull,
            bindSettingsModalEvents,
            buildPromptManagerSectionHtml,
            renderMemoryListInto
        };
    }

    // ─────────────────────────────────────────────────────────────
    // iOS Slider Patch
    //
    // On iOS/Safari, <input type="range"> inside a scrollable
    // container has its touchmove events captured by the scroll
    // system before the browser's own range handler can act.
    // The result: tapping or dragging the slider does nothing.
    //
    // Fix: attach our own touchstart + touchmove listeners with
    // passive:false so we can call preventDefault (preventing the
    // scroll from stealing the gesture), then manually compute and
    // set the value from the raw touch coordinates.
    //
    // Called each time the settings modal opens, on the sliders it injects.
    // ─────────────────────────────────────────────────────────────
    function patchIOSSliders(root) {
        var scope = (root instanceof Element || root instanceof Document) ? root : document;
        scope.querySelectorAll('input[type="range"].et-slider').forEach(function (slider) {
            // Guard: don't attach twice
            if (slider._etIosPatch) return;
            slider._etIosPatch = true;

            function valueFromTouch(touch) {
                var rect  = slider.getBoundingClientRect();
                var min   = parseFloat(slider.min)  || 0;
                var max   = parseFloat(slider.max)  || 100;
                var step  = parseFloat(slider.step) || 1;
                var ratio = (touch.clientX - rect.left) / rect.width;
                ratio = Math.max(0, Math.min(1, ratio));
                var val = min + ratio * (max - min);
                // Snap to the nearest step
                val = Math.round(val / step) * step;
                // Fix floating-point drift (e.g. 0.1 + 0.2 ≠ 0.3)
                var decimals = (step.toString().split('.')[1] || '').length;
                val = parseFloat(val.toFixed(decimals));
                return Math.max(min, Math.min(max, val));
            }

            // touchstart: claim the gesture immediately so iOS doesn't
            // treat it as a potential scroll. Also update on tap.
            slider.addEventListener('touchstart', function (e) {
                e.preventDefault();   // stop scroll-intent detection
                e.stopPropagation();
                slider.value = valueFromTouch(e.touches[0]);
                slider.dispatchEvent(new Event('input',  { bubbles: true }));
            }, { passive: false });

            // touchmove: keep updating while the finger drags
            slider.addEventListener('touchmove', function (e) {
                e.preventDefault();   // prevent scroll from taking over
                e.stopPropagation();
                slider.value = valueFromTouch(e.touches[0]);
                slider.dispatchEvent(new Event('input',  { bubbles: true }));
            }, { passive: false });

            // touchend: fire a final change event (mirrors mouse behaviour)
            slider.addEventListener('touchend', function (e) {
                e.stopPropagation();
                slider.dispatchEvent(new Event('change', { bubbles: true }));
            }, { passive: true });
        });
    }

    // A setting that does nothing without another says so with data-et-needs on its field:
    // greyed out and not to be changed while the one above it is off (what it's set to stays).
    const CONTROLS_ABOVE = {
        'daily-life': { label: 'Daily Life', on: s => s.dailyLifeEnabled === true },
        'proactive-or-daily-life': { label: 'Proactive or Daily Life', on: s => s.proactiveMessagingEnabled !== false || s.dailyLifeEnabled === true },
        proactive:    { label: 'Proactive', on: s => s.proactiveMessagingEnabled !== false },
        memory:       { label: 'Memory System', on: s => s.memoryEnabled !== false },
        image:        { label: 'Image Generation', on: s => s.imageGenerationEnabled === true },
    };

    /** Brings every setting that depends on another in line with it, and lines shown only with two settings on. */
    function syncDependentControls(s) {
        document.querySelectorAll('[data-et-needs]').forEach(field => {
            const off = !CONTROLS_ABOVE[field.dataset.etNeeds].on(s);
            field.classList.toggle('et-field-off', off);
            field.querySelectorAll('input, button').forEach(input => { input.disabled = off; });
        });
        const storyDay = s.ctxSTMessages === true && s.dailyLifeEnabled === true;
        document.querySelectorAll('[data-et-reveal="story-day"]').forEach(line => { line.style.display = storyDay ? '' : 'none'; });
    }

    /** What's needed before a greyed-out setting can be changed. */
    function controlNeeded(field) {
        return CONTROLS_ABOVE[field.dataset.etNeeds].label;
    }

    window.EchoTextSettingsModal = { syncDependentControls, controlNeeded, createSettingsModal, patchIOSSliders };
})();

