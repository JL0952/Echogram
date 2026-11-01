(function () {
    'use strict';

    /**
     * EchoText Memory System
     *
     * Two kinds of memory. Permanent ones you write, save from a bubble or move out of a
     * chat — the story so far, people, inside jokes, things that happened — kept per
     * character or in one global pool. Chat ones go with the chat: settings.chatMemories[k]
     * = { items: [memory], kept: { mark } }, cleared with it and saved in its archives
     * (the Life memories; a chat's summaries sit on its messages, lib/chat-summaries.js).
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
        // What the character's own life let go of (Daily Life, docs/platform-plan.md 12e)
        // and the chat's summaries moved out of it
        life:           { label: 'Life',              icon: 'fa-list-check'         },
        custom:         { label: 'Custom',             icon: 'fa-tag'                }
    };

    const MAX_MEMORIES_PER_SCOPE  = 50;

    /**
     * Life memories used to be filed with the character's own: they move to the chat, once
     * (one moved to permanent since is a Life memory that stays there).
     */
    function moveLifeMemories(s) {
        if (!s.lifeKept) return;
        if (!s.chatMemories) s.chatMemories = {};
        for (const key of new Set([...Object.keys(s.characterMemories || {}), ...Object.keys(s.lifeKept)])) {
            const list = s.characterMemories?.[key] || [];
            const life = list.filter(m => m.category === 'life');
            if (!life.length && !s.lifeKept[key]) continue;
            const store = s.chatMemories[key] || (s.chatMemories[key] = { items: [], kept: {} });
            store.items.push(...life);
            Object.assign(store.kept, s.lifeKept[key]);
            if (life.length) s.characterMemories[key] = list.filter(m => m.category !== 'life');
        }
        delete s.lifeKept;
    }

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

        /** The open chat's memories and marks: { items, kept }. */
        function getChatStore(charKey = getCharKey()) {
            const s = settings();
            if (!charKey) return { items: [], kept: {} };
            if (!s.chatMemories || typeof s.chatMemories !== 'object') s.chatMemories = {};
            if (!s.chatMemories[charKey]) s.chatMemories[charKey] = { items: [], kept: {} };
            return s.chatMemories[charKey];
        }

        /** The open chat's memories, to read. */
        function getChatMemories() {
            return settings().chatMemories?.[getCharKey()]?.items || [];
        }

        function getAllMemoriesForInjection() {
            const s = settings();
            const global = Array.isArray(s.globalMemories) ? s.globalMemories : [];
            const chat = getChatMemories();
            if (getScope() === 'global') return [...chat, ...global];
            const charKey = getCharKey();
            const perChar = charKey && s.characterMemories && Array.isArray(s.characterMemories[charKey])
                ? s.characterMemories[charKey] : [];
            return [...chat, ...perChar, ...global];
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

            if (effectiveScope === 'chat') {
                const { items } = getChatStore();
                items.unshift(memory);
                if (items.length > MAX_MEMORIES_PER_SCOPE) items.splice(MAX_MEMORIES_PER_SCOPE);
            } else if (effectiveScope === 'global') {
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
            const found = allLists().some(applyTo);
            if (found) api.saveSettings();
            return found;
        }

        function deleteMemory(id) {
            const removeFrom = (list) => {
                if (!Array.isArray(list)) return false;
                const idx = list.findIndex(m => m.id === id);
                if (idx !== -1) { list.splice(idx, 1); return true; }
                return false;
            };
            const found = allLists().some(removeFrom);
            if (found) api.saveSettings();
            return found;
        }

        /** Whether the permanent list has room. */
        function permanentHasRoom() {
            return getActiveMemoryList().length < MAX_MEMORIES_PER_SCOPE;
        }

        /**
         * A chat memory kept for good: it leaves the chat for the permanent list (the scope
         * you're in), and stays there through a cleared chat. False when that's full: it
         * wouldn't push out a memory of yours. Its marks go, so a week that keeps going
         * starts a chat memory of its own.
         */
        function moveToPermanent(id) {
            const store = getChatStore();
            const index = store.items.findIndex(m => m.id === id);
            if (index === -1 || !permanentHasRoom()) return false;
            getActiveMemoryList().unshift(store.items.splice(index, 1)[0]);
            for (const [mark, value] of Object.entries(store.kept)) if (value?.memory === id) delete store.kept[mark];
            api.saveSettings();
            return true;
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

        /** Every list a memory can be in. */
        function allLists() {
            const s = settings();
            return [s.globalMemories, ...Object.values(s.characterMemories || {}), ...Object.values(s.chatMemories || {}).map(c => c.items)];
        }

        // ── INJECTION ─────────────────────────────────────────────────────────

        /**
         * The memories and the chat's summaries for this turn's prompt, picked
         * against the chat (plain texts, oldest first). The latest summary always
         * goes in, the earlier ones like memories, sharing their budget
         * (docs/platform-plan.md 10b). An empty chat leaves the last reply's marks
         * alone.
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
            moveToPermanent,
            permanentHasRoom,
            getChatStore,
            getChatMemories,
            getMemories,
            getScope,
            MEMORY_CATEGORIES,
            MAX_MEMORIES_PER_SCOPE
        };
    }

    window.EchoTextMemorySystem = { createMemorySystem, MEMORY_CATEGORIES, moveLifeMemories };
})();
