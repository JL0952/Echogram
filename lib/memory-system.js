(function () {
    'use strict';

    /**
     * EchoText Memory System
     *
     * Memories you write or save from a bubble — the story so far, people, inside
     * jokes, things that happened — kept per character or in one global pool.
     * Which ones go into the prompt is picked by lib/memory-recall.js: pinned ones
     * always, the others when the recent messages bring them up
     * (docs/platform-plan.md 10a).
     *
     * Exposes: window.EchoTextMemorySystem.createMemorySystem(api)
     *          window.EchoTextMemorySystem.MEMORY_CATEGORIES
     */

    const MEMORY_CATEGORIES = {
        inside_joke:    { label: 'Inside Joke',       icon: 'fa-face-laugh-squint' },
        person:         { label: 'Important Person',  icon: 'fa-user-tag'          },
        hobby:          { label: 'Hobby / Interest',  icon: 'fa-gamepad'            },
        favorite_thing: { label: 'Favorite Thing',    icon: 'fa-star'               },
        shared_moment:  { label: 'Shared Moment',     icon: 'fa-heart'              },
        custom:         { label: 'Custom',             icon: 'fa-tag'                }
    };

    const MAX_MEMORIES_PER_SCOPE  = 50;

    function createMemorySystem(api) {
        function settings() { return api.getSettings(); }
        // The memories the last prompt carried (marked in the memory list)
        let recalledIds = new Set();

        function generateId() {
            return Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
        }

        function getScope() {
            return settings().memoryScope || 'per-character';
        }

        function getCharKey() {
            return api.getCharacterKey ? api.getCharacterKey() : null;
        }

        function getActiveMemoryList() {
            const s = settings();
            if (getScope() === 'global') {
                if (!Array.isArray(s.globalMemories)) s.globalMemories = [];
                return s.globalMemories;
            }
            const charKey = getCharKey();
            if (!charKey) return [];
            if (!s.characterMemories || typeof s.characterMemories !== 'object') s.characterMemories = {};
            if (!Array.isArray(s.characterMemories[charKey])) s.characterMemories[charKey] = [];
            return s.characterMemories[charKey];
        }

        function getAllMemoriesForInjection() {
            const s = settings();
            const global = Array.isArray(s.globalMemories) ? s.globalMemories : [];
            if (getScope() === 'global') return global;
            const charKey = getCharKey();
            const perChar = charKey && s.characterMemories && Array.isArray(s.characterMemories[charKey])
                ? s.characterMemories[charKey] : [];
            return [...perChar, ...global];
        }

        // ── CRUD ──────────────────────────────────────────────────────────────

        function addMemory({ category, label, content, keys, pinned, scope: explicitScope } = {}) {
            const s = settings();
            category = category || 'custom';
            const effectiveScope = explicitScope || getScope();
            const memory = {
                id:            generateId(),
                category,
                label:         (label || '').trim() || (MEMORY_CATEGORIES[category] ? MEMORY_CATEGORIES[category].label : 'Memory'),
                content:       (content || '').trim(),
                keys:          window.EchoTextMemoryRecall.parseKeys(keys),
                createdAt:     Date.now(),
                pinned:        !!pinned
            };

            if (effectiveScope === 'global') {
                if (!Array.isArray(s.globalMemories)) s.globalMemories = [];
                s.globalMemories.unshift(memory);
                if (s.globalMemories.length > MAX_MEMORIES_PER_SCOPE) s.globalMemories.splice(MAX_MEMORIES_PER_SCOPE);
            } else {
                const charKey = getCharKey();
                if (!charKey) return null;
                if (!s.characterMemories) s.characterMemories = {};
                if (!Array.isArray(s.characterMemories[charKey])) s.characterMemories[charKey] = [];
                s.characterMemories[charKey].unshift(memory);
                if (s.characterMemories[charKey].length > MAX_MEMORIES_PER_SCOPE) s.characterMemories[charKey].splice(MAX_MEMORIES_PER_SCOPE);
            }
            api.saveSettings();
            return memory;
        }

        function editMemory(id, updates) {
            const s = settings();
            let found = false;
            const applyTo = (list) => {
                if (!Array.isArray(list)) return false;
                const idx = list.findIndex(m => m.id === id);
                if (idx === -1) return false;
                for (const key of ['label', 'content', 'category', 'pinned']) {
                    if (Object.hasOwn(updates, key)) list[idx][key] = updates[key];
                }
                if (Object.hasOwn(updates, 'keys')) list[idx].keys = window.EchoTextMemoryRecall.parseKeys(updates.keys);
                return true;
            };
            if (applyTo(s.globalMemories)) {
                found = true;
            } else if (s.characterMemories) {
                for (const key of Object.keys(s.characterMemories)) {
                    if (applyTo(s.characterMemories[key])) { found = true; break; }
                }
            }
            if (found) api.saveSettings();
            return found;
        }

        function deleteMemory(id) {
            const s = settings();
            let found = false;
            const removeFrom = (list) => {
                if (!Array.isArray(list)) return false;
                const idx = list.findIndex(m => m.id === id);
                if (idx !== -1) { list.splice(idx, 1); return true; }
                return false;
            };
            if (removeFrom(s.globalMemories)) {
                found = true;
            } else if (s.characterMemories) {
                for (const key of Object.keys(s.characterMemories)) {
                    if (removeFrom(s.characterMemories[key])) { found = true; break; }
                }
            }
            if (found) api.saveSettings();
            return found;
        }

        function clearMemoriesForScope(charKey) {
            const s = settings();
            if (getScope() === 'global') {
                s.globalMemories = [];
            } else {
                const key = charKey || getCharKey();
                if (key && s.characterMemories) delete s.characterMemories[key];
            }
            api.saveSettings();
        }

        function getMemories() {
            return getActiveMemoryList();
        }

        // ── INJECTION ─────────────────────────────────────────────────────────

        /**
         * The memories and the chat's summaries for this turn's prompt, picked
         * against the chat (plain texts, oldest first). The latest summary always
         * goes in, the earlier ones like memories, sharing their budget
         * (docs/platform-plan.md 10b). An empty chat (the server plugin's prompt
         * snapshot) leaves the last reply's marks alone.
         * @param {string[]} texts
         * @param {Array<{ id, text }>} [summaries] - the chat's, oldest first (lib/chat-summaries.js)
         */
        function buildMemoryContext(texts, summaries = []) {
            if (!settings().memoryEnabled) {
                recalledIds = new Set();
                return '';
            }
            const notes = summaries.map((s, i) => ({ id: `memo:${s.id}`, content: s.text, pinned: i === summaries.length - 1, order: i }));
            const picked = window.EchoTextMemoryRecall.recall({ memories: [...getAllMemoriesForInjection(), ...notes], texts: texts || [] });
            if (texts && texts.length) recalledIds = new Set(picked.map(p => p.memory.id));

            const lines = list => list.map(p => `- ${p.memory.content.trim().replace(/\s*\n\s*/g, '\n  ')}`).join('\n');
            const earlier = picked.filter(p => notes.includes(p.memory)).sort((a, b) => a.memory.order - b.memory.order);
            const memories = picked.filter(p => !notes.includes(p.memory));
            let out = '';
            if (earlier.length) {
                out += `\n\n<earlier_in_this_chat>\nThe chat's earlier messages, no longer shown, in summary, oldest first:\n${lines(earlier)}\n</earlier_in_this_chat>`;
            }
            if (memories.length) {
                out += `\n\n<shared_memories>\nThings that already happened or were settled between you. Treat them as true; bring one up only when it fits, never force it.\n${lines(memories)}\n</shared_memories>`;
            }
            return out;
        }

        function getRecalledIds() { return recalledIds; }

        return {
            buildMemoryContext,
            getRecalledIds,
            addMemory,
            editMemory,
            deleteMemory,
            clearMemoriesForScope,
            getMemories,
            getScope,
            MEMORY_CATEGORIES
        };
    }

    window.EchoTextMemorySystem = { createMemorySystem, MEMORY_CATEGORIES };
})();
