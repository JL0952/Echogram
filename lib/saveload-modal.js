(function () {
    'use strict';

    /**
     * EchoText Save/Load Chat Modal
     * Provides save, load, rename, and delete for solo, Group, and Combined chat sessions.
     * Exposes: window.EchoTextSaveLoadModal.createSaveLoadModal(api)
     *
     * API object must provide:
     *   getSettings, saveSettings, getCharacterKey, getCharacterName,
     *   getChatHistory, saveChatHistory, renderMessages,
     *   getEmotionSnapshot, isPanelOpen,
     *   isGroupSession()          — true when in a group chat
     *   isCombineMode()           — true when in combined-response mode
     *   getCurrentGroupId()       — the current group's ID string, or null
     *   captureGroupSnapshot()    — snapshot of all members' emotional state
     *   restoreGroupSnapshot(snap)— restore snapshot
     */
    function createSaveLoadModal(api) {

        function settings() { return api.getSettings(); }
        function genId() { return 'sl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7); }

        function formatDate(ts) {
            if (!ts) return '';
            const d = new Date(ts);
            return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' +
                d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        }

        // ── Emotions saved with a chat (lib/emotion-model.js) ───────────────────────
        const EmotionModel = window.EchoTextEmotionModel;
        const { iconHtml } = window.EchoTextEmotionIcons;

        /** A saved chat's feelings above 0, strongest first; none for a pre-2026-10-12 save. */
        function savedFeelings(snapshot) {
            const start = snapshot && typeof snapshot.start === 'object' ? snapshot.start : null;
            if (!start) return [];
            return EmotionModel.activeDimensions({ nsfw: settings().nsfwEnabled === true })
                .map(dim => ({ dim, value: Math.round(start[dim.id] || 0) }))
                .filter(f => f.value !== 0)
                .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
        }

        // ============================================================
        // STATE HELPERS
        // ============================================================

        /**
         * Returns (and initialises if needed) the full savedChats store.
         * Three namespaces: tethered (solo chats; named after the removed second mode) | group | group_combine
         */
        function getStore() {
            const s = settings();
            if (!s.savedChats) s.savedChats = {};
            if (!s.savedChats.tethered) s.savedChats.tethered = {};
            if (!s.savedChats.group) s.savedChats.group = {};
            if (!s.savedChats.group_combine) s.savedChats.group_combine = {};
            return s.savedChats;
        }

        /**
         * Returns the storage namespace for the current context.
         *   group_combine — active group + combine mode
         *   group         — active group, individual-per-character view
         *   tethered      — solo chat
         */
        function getModeKey() {
            const inGroup = api.isGroupSession && api.isGroupSession();
            if (inGroup) {
                return (api.isCombineMode && api.isCombineMode()) ? 'group_combine' : 'group';
            }
            return 'tethered';
        }

        /**
         * Returns the sorted list of saves relevant to the current context.
         * Group saves are filtered by groupId; solo saves by charKey.
         */
        function getSavesForCurrentMode() {
            const store = getStore();
            const modeKey = getModeKey();

            if (modeKey === 'group' || modeKey === 'group_combine') {
                const groupId = api.getCurrentGroupId ? api.getCurrentGroupId() : null;
                if (!groupId) return [];
                return Object.values(store[modeKey])
                    .filter(s => String(s.groupId) === String(groupId))
                    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
            }

            const charKey = api.getCharacterKey();
            if (!charKey) return [];
            return Object.values(store[modeKey])
                .filter(s => s.charKey === charKey)
                .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
        }

        /**
         * Builds a save entry for the current session state.
         */
        function buildSaveEntry(name) {
            const mode = getModeKey();
            const isGroupMode = (mode === 'group' || mode === 'group_combine');
            const charKey = api.getCharacterKey();
            const charName = api.getCharacterName();
            const history = api.getChatHistory();
            const groupId = isGroupMode && api.getCurrentGroupId ? api.getCurrentGroupId() : null;

            // Auto-generate save name
            const datePart = formatDate(Date.now());
            let defaultName;
            if (mode === 'group_combine') {
                defaultName = `Combined \u2014 ${datePart}`;
            } else if (mode === 'group') {
                defaultName = `${charName} (Group) \u2014 ${datePart}`;
            } else {
                defaultName = `${charName} \u2014 ${datePart}`;
            }

            const entry = {
                id: genId(),
                name: name || defaultName,
                mode,
                savedAt: Date.now(),
                history: JSON.parse(JSON.stringify(history))
            };

            if (isGroupMode) {
                entry.groupId = groupId;
                if (mode === 'group') {
                    entry.charKey = charKey;
                    entry.charName = charName;
                }
            } else {
                entry.charKey = charKey;
                entry.charName = charName;
            }

            // ── State snapshots (solo modes only) ──────────────────────────────────
            if (!isGroupMode) {
                entry.emotionSnapshot = api.getEmotionSnapshot ? api.getEmotionSnapshot() : null;
            }

            // Group emotion snapshot for all members
            if (api.isGroupSession && api.isGroupSession() && api.captureGroupSnapshot) {
                entry.groupSnapshot = api.captureGroupSnapshot();
            }

            return entry;
        }

        // ============================================================
        // CRUD
        // ============================================================

        function saveCurrentChat(name) {
            const modeKey = getModeKey();
            const isGroupMode = (modeKey === 'group' || modeKey === 'group_combine');

            if (!isGroupMode && !api.getCharacterKey()) return null;
            if (isGroupMode && !(api.getCurrentGroupId && api.getCurrentGroupId())) return null;

            const entry = buildSaveEntry(name);
            const store = getStore();
            store[modeKey][entry.id] = entry;
            api.saveSettings();
            return entry;
        }

        function loadSave(saveId) {
            const store = getStore();
            const modeKey = getModeKey();
            const entry = store[modeKey][saveId];
            if (!entry) return;

            api.saveChatHistory(entry.history || []);

            const s = settings();

            if (entry.mode === 'tethered' && entry.emotionSnapshot && entry.charKey) {
                if (!s.emotionState) s.emotionState = {};
                s.emotionState[entry.charKey] = JSON.parse(JSON.stringify(entry.emotionSnapshot));
                api.saveSettings();
            }

            // Restore group snapshot for all members if present
            if (entry.groupSnapshot && api.restoreGroupSnapshot) {
                api.restoreGroupSnapshot(entry.groupSnapshot);
                api.saveSettings();
            }

            api.renderMessages(entry.history || []);
            closeSaveLoadModal();
        }

        function renameSave(saveId, newName) {
            const store = getStore();
            const modeKey = getModeKey();
            if (store[modeKey][saveId]) {
                store[modeKey][saveId].name = newName;
                api.saveSettings();
            }
        }

        function deleteSave(saveId) {
            const store = getStore();
            const modeKey = getModeKey();
            delete store[modeKey][saveId];
            api.saveSettings();
        }

        function exportSave(saveId) {
            const store = getStore();
            const modeKey = getModeKey();
            const save = store[modeKey][saveId];
            if (!save) return;

            const name = save.name || 'Chat';
            let markdown = `# ${name}\n\n`;
            
            // Resolve live persona name (same logic as buildPreviewHtml).
            const _ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : {};
            const subUser = _ctx.name1
                || (typeof window.substituteParams === 'function' ? window.substituteParams('{{user}}') : null)
                || window.name1
                || 'User';
            const subChar = typeof window.substituteParams === 'function' ? window.substituteParams('{{char}}') : (window.name2 || 'Char');

            (save.history || []).forEach(m => {
                // For user messages: use the live persona name so {{user}} macros resolve correctly.
                // m.name is stale (baked at save time) and may be the literal "User" default.
                const sender = m.is_user
                    ? (subUser || m.name || 'User')
                    : (m.name || m.charName || save.charName || save.name || subChar);
                markdown += `**${sender}:**\n${plainText(m.mes)}\n\n`;
            });

            const blob = new Blob([markdown], { type: 'text/markdown' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.md`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        // ============================================================
        // HTML HELPERS
        // ============================================================

        function escapeHtml(str) {
            if (!str) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        /** Message text with rich-content tags (photos) spelled out as plain text. */
        function plainText(str) {
            const rich = window.EchoTextRichMessages;
            return rich ? rich.toPlainText(str || '') : (str || '');
        }

        function miniMarkdown(str) {
            if (!str) return '';
            let s = escapeHtml(str);
            s = s.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            s = s.replace(/\*(.*?)\*/g, '<em>$1</em>');
            s = s.replace(/(?<![\p{L}\p{N}_])__(?!\s)(.+?)(?<!\s)__(?![\p{L}\p{N}_])/gu, '<u>$1</u>');
            s = s.replace(/(?<![\p{L}\p{N}_])_(?!\s)(.+?)(?<!\s)_(?![\p{L}\p{N}_])/gu, '<em>$1</em>');
            s = s.replace(/~~(.*?)~~/g, '<del>$1</del>');
            s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
            return s;
        }

        /**
         * Builds a small DOM-inline chip showing the strongest saved feeling's icon.
         * Used in the left-pane save list items.
         */
        function buildDominantEmoChip(snapshot) {
            const top = savedFeelings(snapshot)[0];
            if (!top) return '';
            const { dim, value } = top;
            return `<span class="et-sl-item-chip et-sl-item-chip-emo" style="color:${dim.color};border-color:${dim.color}33;background:${dim.color}14" title="${dim.label} \u2014 ${value}">${iconHtml(dim)}</span>`;
        }

        // ============================================================
        // HTML BUILDERS — LEFT PANE (SAVE LIST)
        // ============================================================

        function buildSaveListHtml(saves, selectedId) {
            if (!saves || saves.length === 0) {
                return `<div class="et-sl-empty"><i class="fa-solid fa-box-open"></i><p>No saved chats yet.<br>Save the current chat to get started.</p></div>`;
            }
            return saves.map(s => {
                const msgCount = (s.history || []).length;
                const msgChip = `<span class="et-sl-item-chip" title="${msgCount} messages"><i class="fa-solid fa-message"></i> ${msgCount}</span>`;

                let modeChip = '';
                if (s.mode === 'tethered' && s.emotionSnapshot) {
                    modeChip = buildDominantEmoChip(s.emotionSnapshot);
                } else if ((s.mode === 'group' || s.mode === 'group_combine') && s.groupSnapshot) {
                    const count = Object.keys(s.groupSnapshot).length;
                    modeChip = `<span class="et-sl-item-chip" title="${count} group members"><i class="fa-solid fa-users"></i> ${count}</span>`;
                }

                return `
            <div class="et-sl-item${s.id === selectedId ? ' et-sl-item-selected' : ''}" data-save-id="${s.id}">
                <div class="et-sl-item-main">
                    <div class="et-sl-item-name" data-save-id="${s.id}" title="Click to rename">${escapeHtml(s.name)}</div>
                    <div class="et-sl-item-meta-row">
                        <div class="et-sl-item-time">${formatDate(s.savedAt)}</div>
                        <div class="et-sl-item-chips">${msgChip}${modeChip}</div>
                    </div>
                </div>
                <div class="et-sl-item-actions">
                    <button class="et-sl-del-btn" data-save-id="${s.id}" title="Delete this save"><i class="fa-solid fa-trash-can"></i></button>
                </div>
            </div>`;
            }).join('');
        }

        // ============================================================
        // HTML BUILDERS — RIGHT PANE (PREVIEW)
        // ============================================================


        function buildPreviewContent(save) {
// ── Messages ───────────────────────────────────────────────────────────
            const msgs = (save.history || []).slice(-5);
            // Resolve the live persona name from context (most reliable source).
            // SillyTavern stores the active persona display name in context.name1,
            // which respects the {{user}} macro. We fall back through substituteParams
            // and window.name1 for compatibility.
            const _ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : {};
            const subUser = _ctx.name1
                || (typeof window.substituteParams === 'function' ? window.substituteParams('{{user}}') : null)
                || window.name1
                || 'User';
            const subChar = typeof window.substituteParams === 'function' ? window.substituteParams('{{char}}') : (window.name2 || 'Char');

            const msgHtml = msgs.length === 0
                ? '<p class="et-sl-prev-nomsg">No messages</p>'
                : msgs.map(m => `
                <div class="et-sl-prev-msg${m.is_user ? ' et-sl-prev-user' : ' et-sl-prev-char'}">
                    <span class="et-sl-prev-sender">${escapeHtml(m.is_user ? (subUser || m.name || 'User') : (m.name || m.charName || save.charName || save.name || subChar))}</span>
                    <span class="et-sl-prev-text">${miniMarkdown(plainText(m.mes))}</span>
                </div>`).join('');

            // ── Metadata block ────────────────────────────────────────────────────
            let metaHtml = '';

            if (save.mode === 'tethered' && savedFeelings(save.emotionSnapshot).length) {
                // The feelings away from 0, strongest first
                const emoRows = savedFeelings(save.emotionSnapshot).map(({ dim, value }, i) => `
                    <div class="et-sl-emo-row${i === 0 ? ' et-sl-emo-dominant' : ''}">
                        <span style="color:${dim.color}">${iconHtml(dim)}</span>
                        <span class="et-sl-emo-label">${dim.label}</span>
                        <div class="et-sl-emo-track"><div class="et-sl-emo-fill" style="width:${Math.abs(value)}%;background:${dim.color}"></div></div>
                        <span class="et-sl-emo-pct">${value}</span>
                    </div>`).join('');

                metaHtml = `
                <div class="et-sl-meta">
                    <div class="et-sl-meta-title"><i class="fa-solid fa-heart-pulse"></i> Emotional State at Save</div>
                    <div class="et-sl-emo-bars">${emoRows}</div>
                </div>`;

            } else if ((save.mode === 'group' || save.mode === 'group_combine') && save.groupSnapshot) {
                const memberCount = Object.keys(save.groupSnapshot).length;

                const memberChips = Object.entries(save.groupSnapshot).map(([, data]) => {
                    const name = data.charName || 'Unknown';
                    const initial = name.charAt(0).toUpperCase();
                    let emoHtml = '';
                    const top = savedFeelings(data.emotionSnapshot)[0];
                    if (top) {
                        emoHtml = `<span class="et-sl-member-emo-chip" style="color:${top.dim.color}" title="${top.dim.label} \u2014 ${top.value}">${iconHtml(top.dim)} ${top.dim.label}</span>`;
                    }
                    return `
                    <div class="et-sl-member-chip">
                        <div class="et-sl-member-avatar">${initial}</div>
                        <span class="et-sl-member-name">${escapeHtml(name)}</span>
                        ${emoHtml}
                    </div>`;
                }).join('');

                metaHtml = `
                <div class="et-sl-meta">
                    <div class="et-sl-meta-title">
                        <i class="fa-solid ${save.mode === 'group_combine' ? 'fa-layer-group' : 'fa-users'}"></i>
                        ${save.mode === 'group_combine' ? 'Combined Group Session' : 'Group Session'} &mdash; ${memberCount} member${memberCount !== 1 ? 's' : ''}
                    </div>
                    <div class="et-sl-member-chips">${memberChips}</div>
                </div>`;
            }
            return `
                <div class="et-sl-prev-msgs">${msgHtml}</div>
                ${metaHtml}
            `;
        }


        function buildMobileCarouselHtml(saves) {
            if (!saves || saves.length === 0) {
                return `<div class="et-sl-empty" style="width:100%"><i class="fa-solid fa-box-open"></i><p>No saved chats yet.<br>Save the current chat to get started.</p></div>`;
            }
            return saves.map(save => `
                <div class="et-sl-mobile-card" data-save-id="${save.id}">
                    <div class="et-sl-mobile-card-header">
                        <div class="et-sl-mobile-card-title-row">
                            <div class="et-sl-item-name et-sl-mobile-card-name" data-save-id="${save.id}" title="Click to rename">${escapeHtml(save.name)}</div>
                            <button class="et-sl-del-btn" data-save-id="${save.id}"><i class="fa-solid fa-trash-can"></i></button>
                        </div>
                        <div class="et-sl-preview-msgcount" style="margin-top: 4px;">${formatDate(save.savedAt)} &bull; ${(save.history || []).length} msg${(save.history || []).length !== 1 ? 's' : ''}</div>
                    </div>
                    <div class="et-sl-mobile-card-body">
                        ${buildPreviewContent(save)}
                    </div>
                    <div class="et-sl-mobile-card-footer">
                        <button class="et-sl-preview-load-btn" data-save-id="${save.id}">
                            <i class="fa-solid fa-upload"></i> Load Chat
                        </button>
                        <button class="et-sl-preview-export-btn" data-save-id="${save.id}">
                            <i class="fa-solid fa-download"></i> Export
                        </button>
                    </div>
                </div>
            `).join('');
        }

        function buildPreviewHtml(save) {
            if (!save) {
                return `<div class="et-sl-preview-empty"><i class="fa-solid fa-arrow-left"></i><p>Select a save to preview</p></div>`;
            }

            
            return `
            <div class="et-sl-preview">
                <div class="et-sl-preview-header">
                    <span class="et-sl-preview-name">${escapeHtml(save.name)}</span>
                    <span class="et-sl-preview-msgcount">${(save.history || []).length} msg${(save.history || []).length !== 1 ? 's' : ''}</span>
                </div>
                ${buildPreviewContent(save)}
                <div class="et-sl-preview-load-wrap">
                    <button class="et-sl-preview-load-btn" data-save-id="${save.id}">
                        <i class="fa-solid fa-upload"></i> Load This Chat
                    </button>
                    <button class="et-sl-preview-export-btn" data-save-id="${save.id}">
                        <i class="fa-solid fa-download"></i> Export Chat
                    </button>
                </div>
            </div>`;
        }

        function buildModalHtml() {
            const inGroup = api.isGroupSession && api.isGroupSession();
            const inCombine = inGroup && api.isCombineMode && api.isCombineMode();
            let modeIcon, modeLabel, modeCssKey;

            if (inCombine) {
                modeIcon = 'fa-layer-group'; modeLabel = 'Group Combined'; modeCssKey = 'group_combine';
            } else if (inGroup) {
                modeIcon = 'fa-users'; modeLabel = 'Group Chat'; modeCssKey = 'group';
            } else {
                modeIcon = 'fa-user'; modeLabel = 'Solo Chat'; modeCssKey = 'tethered';
            }

            const charName = inCombine ? 'Group' : (api.getCharacterName() || 'Chat');
            const datePart = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            const defaultSaveName = inCombine ? `Combined \u2014 ${datePart}` : `${charName} \u2014 ${datePart}`;
            const saves = getSavesForCurrentMode();

            return `
            <div id="et-sl-overlay" class="et-sl-overlay">
                <div class="et-sl-modal" id="et-sl-modal">
                    <div class="et-sl-header">
                        <div class="et-sl-header-title">
                            <i class="fa-solid fa-floppy-disk" style="color:var(--et-theme-color)"></i>
                            Chat Archives
                            <span class="et-sl-mode-badge et-sl-mode-${modeCssKey}">
                                <i class="fa-solid ${modeIcon}"></i> ${modeLabel}
                            </span>
                        </div>
                        <button class="et-sl-close-btn" id="et-sl-close-btn" title="Close"><i class="fa-solid fa-xmark"></i></button>
                    </div>

                    <div class="et-sl-save-bar">
                        <input class="et-sl-name-input" id="et-sl-name-input" type="text" placeholder="Save name\u2026" value="${escapeHtml(defaultSaveName)}" maxlength="80" />
                        <button class="et-sl-save-cta" id="et-sl-save-cta" title="Save current chat">
                            <i class="fa-solid fa-floppy-disk"></i> Save Current Chat
                        </button>
                    </div>

                    <div class="et-sl-body">
                        <div class="et-sl-list" id="et-sl-list">
                            ${buildSaveListHtml(saves, null)}
                        </div>
                        <div class="et-sl-right" id="et-sl-right">
                            ${buildPreviewHtml(null)}
                        </div>
                        <div class="et-sl-mobile-carousel" id="et-sl-mobile-carousel">
                            ${buildMobileCarouselHtml(saves)}
                        </div>
                    </div>
                </div>
            </div>`;
        }

        // ============================================================
        // OPEN / CLOSE
        // ============================================================

        function openSaveLoadModal() {
            jQuery('#et-sl-overlay').remove();
            jQuery('body').append(buildModalHtml());
            requestAnimationFrame(() => jQuery('#et-sl-overlay').addClass('et-sl-overlay-open'));
            bindModalEvents();
        }

        function closeSaveLoadModal() {
            const overlay = jQuery('#et-sl-overlay');
            overlay.removeClass('et-sl-overlay-open').addClass('et-sl-overlay-closing');
            setTimeout(() => overlay.remove(), 220);
        }

        // ============================================================
        // EVENTS
        // ============================================================

        function refreshList(selectedId) {
            const saves = getSavesForCurrentMode();
            jQuery('#et-sl-list').html(buildSaveListHtml(saves, selectedId));
            jQuery('#et-sl-mobile-carousel').html(buildMobileCarouselHtml(saves));
            rebindListEvents(selectedId);
        }

        function showPreviewFor(saveId) {
            const store = getStore();
            const modeKey = getModeKey();
            const save = store[modeKey][saveId] || null;
            jQuery('#et-sl-right').html(buildPreviewHtml(save));
            if (save) {
                jQuery('#et-sl-right').off('click', '.et-sl-preview-load-btn').on('click', '.et-sl-preview-load-btn', function () {
                    loadSave(jQuery(this).data('save-id'));
                });
                jQuery('#et-sl-right').off('click', '.et-sl-preview-export-btn').on('click', '.et-sl-preview-export-btn', function () {
                    exportSave(jQuery(this).data('save-id'));
                });
                jQuery('#et-sl-right').off('click', '.et-sl-prev-msg').on('click', '.et-sl-prev-msg', function () {
                    jQuery(this).toggleClass('et-sl-expanded');
                });
                
                // Detect overflows and add indicator class
                setTimeout(() => {
                    jQuery('#et-sl-right').find('.et-sl-prev-text').each(function() {
                        if (this.scrollHeight > this.clientHeight) {
                            jQuery(this).closest('.et-sl-prev-msg').addClass('et-sl-is-overflowing');
                        }
                    });
                }, 15);
            }
        }

        function rebindListEvents(selectedId) {
            // Prevent duplicate bindings on refresh
            jQuery('#et-sl-list, #et-sl-mobile-carousel').off('click');

            // Delete button (two-click confirm)
            jQuery('#et-sl-list, #et-sl-mobile-carousel').on('click', '.et-sl-del-btn', function (e) {
                e.stopPropagation();
                const id = jQuery(this).data('save-id');
                if (!id) return;
                const btn = jQuery(this);
                if (btn.hasClass('et-sl-del-confirm')) {
                    deleteSave(id);
                    if (selectedId === id) jQuery('#et-sl-right').html(buildPreviewHtml(null));
                    refreshList(selectedId === id ? null : selectedId);
                    return;
                }
                
                // Clear any other active confirms
                jQuery('.et-sl-del-confirm').removeClass('et-sl-del-confirm').html('<i class="fa-solid fa-trash-can"></i>');
                
                // Morph to confirm state
                btn.addClass('et-sl-del-confirm');
                btn.html(`<span>Delete?</span><div class="et-sl-del-progress"></div>`);
                
                const reset = () => {
                    if (btn.hasClass('et-sl-del-confirm')) {
                        btn.removeClass('et-sl-del-confirm').html('<i class="fa-solid fa-trash-can"></i>');
                    }
                };
                
                const timer = setTimeout(reset, 3000);
                
                // Clicking anywhere else clears the confirm
                jQuery(document).one('click.et-sl-del', function(ev) {
                    if (!jQuery(ev.target).closest(btn).length) {
                        clearTimeout(timer);
                        reset();
                    }
                });
            });

            // Click item to select and preview
            jQuery('#et-sl-list').on('click', '.et-sl-item', function (e) {
                if (jQuery(e.target).is('button, button *')) return;
                const id = jQuery(this).data('save-id');
                if (!id) return;
                jQuery('.et-sl-item').removeClass('et-sl-item-selected');
                jQuery(this).addClass('et-sl-item-selected');
                showPreviewFor(id);
            });

            // Inline rename: click name
            jQuery('#et-sl-list, #et-sl-mobile-carousel').on('click', '.et-sl-item-name', function (e) {
                e.stopPropagation();
                const id = jQuery(this).data('save-id');
                if (!id) return;
                const nameEl = jQuery(this);
                const currentName = nameEl.text();
                const parent = nameEl.parent();
                const extraClass = nameEl.hasClass('et-sl-mobile-card-name') ? ' et-sl-mobile-card-name' : '';
                nameEl.replaceWith(`<input class="et-sl-rename-input" value="${escapeHtml(currentName)}" maxlength="80" />`);
                const input = parent.find('.et-sl-rename-input');
                input.focus().select();
                const commit = () => {
                    const newName = input.val().trim() || currentName;
                    renameSave(id, newName);
                    input.replaceWith(`<div class="et-sl-item-name${extraClass}" data-save-id="${id}" title="Click to rename">${escapeHtml(newName)}</div>`);
                };
                input.on('blur', commit);
                input.on('keydown', (ev) => {
                    if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
                    if (ev.key === 'Escape') { input.replaceWith(`<div class="et-sl-item-name${extraClass}" data-save-id="${id}" title="Click to rename">${escapeHtml(currentName)}</div>`); }
                });
            });

            // Carousel specific actions
            jQuery('#et-sl-mobile-carousel').on('click', '.et-sl-preview-load-btn', function () {
                loadSave(jQuery(this).data('save-id'));
            });
            jQuery('#et-sl-mobile-carousel').on('click', '.et-sl-preview-export-btn', function () {
                exportSave(jQuery(this).data('save-id'));
            });
            jQuery('#et-sl-mobile-carousel').on('click', '.et-sl-prev-msg', function () {
                jQuery(this).toggleClass('et-sl-expanded');
            });
            setTimeout(() => {
                jQuery('#et-sl-mobile-carousel').find('.et-sl-prev-text').each(function() {
                    if (this.scrollHeight > this.clientHeight) {
                        jQuery(this).closest('.et-sl-prev-msg').addClass('et-sl-is-overflowing');
                    }
                });
            }, 15);
        }

        function bindModalEvents() {
            jQuery('#et-sl-close-btn').on('click', closeSaveLoadModal);

            jQuery('#et-sl-overlay').on('click', function (e) {
                if (e.target === this) closeSaveLoadModal();
            });

            const onKey = (e) => {
                if (e.key === 'Escape') {
                    document.removeEventListener('keydown', onKey);
                    closeSaveLoadModal();
                }
            };
            document.addEventListener('keydown', onKey);

            jQuery('#et-sl-save-cta').on('click', function () {
                const name = jQuery('#et-sl-name-input').val().trim();
                const saved = saveCurrentChat(name);
                if (!saved) return;
                jQuery(this).html('<i class="fa-solid fa-check"></i> Saved!').addClass('et-sl-saved-flash');
                setTimeout(() => jQuery('#et-sl-save-cta').html('<i class="fa-solid fa-floppy-disk"></i> Save Current Chat').removeClass('et-sl-saved-flash'), 1800);
                refreshList(saved.id);
                showPreviewFor(saved.id);
            });

            rebindListEvents(null);
        }

        // ============================================================
        // PUBLIC API
        // ============================================================

        return { openSaveLoadModal };
    }

    window.EchoTextSaveLoadModal = { createSaveLoadModal };
})();
