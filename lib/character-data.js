(function () {
    'use strict';

    /**
     * EchoText Character Data
     *
     * What Echogram keeps for a character is filed under their key: the card's avatar
     * file name (index.js getCharacterKey). SillyTavern renames that file when a
     * character is renamed, so their data moves to the new key then (CHARACTER_RENAMED);
     * data left under a key no card has any more (renamed before this, or the card
     * deleted) can be moved onto a character, or deleted, by hand (Settings → General).
     * The name each key's card had is remembered (settings.characterNames), for telling
     * them apart once the card is gone.
     * Pure: the settings object in, changed in place.
     */

    // Filed by character key: chats are merged by time, lists joined, anything else replaced
    const CHATS = ['chatHistory'];
    const LISTS = ['characterMemories', 'characterGalleries', 'socialPosts', 'socialArchives'];
    const VALUES = ['emotionState', 'characterProfiles', 'characterSchedules', 'lifeState', 'pendingReplies', 'phoneOverrides',
        'chatMemories', 'proactiveTemperament', 'proactiveSeenAt', 'proactiveCharacterConfig', 'proactiveState', 'verbosityByCharacter',
        'platformByCharacter', 'stickerSetsByCharacter', 'avatarByCharacter', 'usernameByCharacter', 'catchUpLast', 'socialAccounts'];

    const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
    const timeOf = msg => {
        const t = typeof msg?.send_date === 'number' ? msg.send_date : Date.parse(msg?.send_date);
        return Number.isFinite(t) ? t : 0;
    };

    /** Two chats as one, in time order (each kept in its own order where times tie). */
    function mergeChats(a, b) {
        if (!a.length) return b;
        if (!b.length) return a;
        return [...a, ...b].map((msg, i) => [msg, i]).sort(([x, i], [y, j]) => timeOf(x) - timeOf(y) || i - j).map(([msg]) => msg);
    }

    /** A message's or save's key moved, in place. */
    const rekey = (item, from, to) => { if (isObject(item) && item.charKey === from) item.charKey = to; };

    /**
     * Moves everything filed under `from` to `to`: chats merged by time, memories and
     * gallery joined, the rest from `from` replacing `to`'s; and the key in group chats,
     * saved chats, favourites and the last character. Whether anything was there to move.
     */
    function moveCharacterData(s, from, to) {
        if (!isObject(s) || !from || !to || from === to) return false;
        let moved = false;
        for (const name of CHATS) {
            const map = s[name];
            if (!isObject(map) || !Array.isArray(map[from])) continue;
            map[to] = mergeChats(map[from], Array.isArray(map[to]) ? map[to] : []);
            delete map[from];
            moved = true;
        }
        for (const name of LISTS) {
            const map = s[name];
            if (!isObject(map) || !Array.isArray(map[from])) continue;
            const have = Array.isArray(map[to]) ? map[to] : [];
            const ids = new Set(have.map(item => item?.id).filter(Boolean));
            map[to] = [...have, ...map[from].filter(item => !item?.id || !ids.has(item.id))];
            delete map[from];
            moved = true;
        }
        for (const name of VALUES) {
            const map = s[name];
            if (!isObject(map) || !Object.hasOwn(map, from)) continue;
            map[to] = map[from];
            delete map[from];
            moved = true;
        }
        // Group chats: a member's own history, and who said what in a combined one
        for (const group of Object.values(isObject(s.groupChatHistory) ? s.groupChatHistory : {})) {
            if (!isObject(group) || !Array.isArray(group[from])) continue;
            group[to] = mergeChats(group[from], Array.isArray(group[to]) ? group[to] : []);
            delete group[from];
            moved = true;
        }
        for (const history of Object.values(isObject(s.groupCombineHistory) ? s.groupCombineHistory : {})) {
            if (Array.isArray(history)) history.forEach(msg => rekey(msg, from, to));
        }
        // Saved chats: whose they are, and who said what in a combined one
        for (const saves of Object.values(isObject(s.savedChats) ? s.savedChats : {})) {
            for (const save of Object.values(isObject(saves) ? saves : {})) {
                if (save?.charKey === from) moved = true;
                rekey(save, from, to);
                if (Array.isArray(save?.history)) save.history.forEach(msg => rekey(msg, from, to));
            }
        }
        if (Array.isArray(s.pickerFavorites) && s.pickerFavorites.includes(from)) {
            s.pickerFavorites = [...new Set(s.pickerFavorites.map(key => (key === from ? to : key)))];
        }
        if (s.lastCharacterKey === from) s.lastCharacterKey = to;
        // The name was the old card's: the new one has its own
        if (isObject(s.characterNames)) delete s.characterNames[from];
        return moved;
    }

    /**
     * Deletes everything filed under `key`: its chats, memories, gallery and the rest, its
     * history in group chats, its saved chats, and it as a favourite or the last character.
     * Combined group chats keep what it said. Whether anything was there.
     */
    function deleteCharacterData(s, key) {
        if (!isObject(s) || !key) return false;
        let deleted = false;
        for (const name of [...CHATS, ...LISTS, ...VALUES]) {
            if (!isObject(s[name]) || !Object.hasOwn(s[name], key)) continue;
            delete s[name][key];
            deleted = true;
        }
        for (const group of Object.values(isObject(s.groupChatHistory) ? s.groupChatHistory : {})) {
            if (isObject(group) && Object.hasOwn(group, key)) { delete group[key]; deleted = true; }
        }
        for (const saves of Object.values(isObject(s.savedChats) ? s.savedChats : {})) {
            if (!isObject(saves)) continue;
            for (const [id, save] of Object.entries(saves)) {
                if (save?.charKey === key) { delete saves[id]; deleted = true; }
            }
        }
        if (Array.isArray(s.pickerFavorites)) s.pickerFavorites = s.pickerFavorites.filter(k => k !== key);
        if (s.lastCharacterKey === key) s.lastCharacterKey = '';
        if (isObject(s.characterNames)) delete s.characterNames[key];
        return deleted;
    }

    /** A key as a name: the file name without its extension. */
    const nameOf = key => String(key).replace(/\.(png|webp|jpe?g|gif|json)$/i, '');

    /** Remembers the name of each card in `cards` ({ avatar, name }); whether any was new or changed. */
    function rememberNames(s, cards) {
        if (!isObject(s)) return false;
        if (!isObject(s.characterNames)) s.characterNames = {};
        let changed = false;
        for (const card of cards || []) {
            const key = card?.avatar || card?.name;
            const name = String(card?.name || '').trim();
            if (!key || !name || s.characterNames[key] === name) continue;
            s.characterNames[key] = name;
            changed = true;
        }
        return changed;
    }

    /**
     * The keys with data worth keeping that no card in `liveKeys` has: { key, name (the
     * card's, remembered, else the file's), messages, memories, schedule, life }, the most
     * messages first.
     */
    function orphanedKeys(s, liveKeys) {
        if (!isObject(s)) return [];
        const live = new Set(liveKeys || []);
        const keys = new Set();
        for (const name of [...CHATS, ...LISTS, ...VALUES]) {
            if (isObject(s[name])) Object.keys(s[name]).forEach(key => keys.add(key));
        }
        const count = (name, key) => (Array.isArray(s[name]?.[key]) ? s[name][key].length : 0);
        const schedule = key => Object.values(isObject(s.characterSchedules?.[key]) ? s.characterSchedules[key] : {})
            .some(day => Array.isArray(day) && day.length > 0);
        const life = key => isObject(s.lifeState?.[key]?.start)
            && ['errands', 'log'].some(part => (s.lifeState[key].start[part] || []).length > 0);
        return [...keys].filter(key => !live.has(key)).map(key => ({
            key, name: s.characterNames?.[key] || nameOf(key), messages: count('chatHistory', key), memories: count('characterMemories', key),
            schedule: schedule(key), life: life(key),
        })).filter(o => o.messages || o.memories || o.schedule || o.life || count('characterGalleries', o.key))
            .sort((a, b) => b.messages - a.messages || a.name.localeCompare(b.name));
    }

    /** What an orphan holds, in a few words: "120 messages, schedule, 8 memories". */
    function describeOrphan(o) {
        const parts = [];
        if (o.messages) parts.push(`${o.messages} message${o.messages === 1 ? '' : 's'}`);
        if (o.schedule) parts.push('schedule');
        if (o.life) parts.push('life');
        if (o.memories) parts.push(`${o.memories} memor${o.memories === 1 ? 'y' : 'ies'}`);
        return parts.join(', ');
    }

    // ── A character's setup, from one install to another ─────────────────────
    // Export / Import in the chat's ⋯ menu: what the user set up for the character and
    // what they keep (personality, schedule, temperament, platform, stickers, avatar,
    // the X account, memories), not what happened in a chat (messages, posts, Life,
    // mood). The file is JSON; its images go in it as data URLs (index.js).

    const SETUP_FORMAT = 'echogram-character-setup';
    const SETUP = ['characterProfiles', 'characterSchedules', 'proactiveTemperament', 'proactiveCharacterConfig',
        'verbosityByCharacter', 'platformByCharacter', 'stickerSetsByCharacter', 'usernameByCharacter', 'avatarByCharacter'];
    // The X account, without its kept posts (those are posts, which stay)
    const ACCOUNT_POSTS = ['posts', 'pinnedId'];
    // Where a setup holds an image: [setting, field], no field when the value is the image
    const SETUP_IMAGES = [['avatarByCharacter'], ['socialAccounts', 'banner'], ['socialAccounts', 'avatar']];

    const copy = v => JSON.parse(JSON.stringify(v));
    const without = (o, fields) => Object.fromEntries(Object.entries(o).filter(([f]) => !fields.includes(f)));

    /** The setup filed under `key`: { [setting]: value }, only what's there. */
    function setupOf(s, key) {
        const setup = {};
        for (const name of SETUP) {
            if (isObject(s?.[name]) && Object.hasOwn(s[name], key)) setup[name] = copy(s[name][key]);
        }
        const account = s?.socialAccounts?.[key];
        if (isObject(account)) {
            const rest = without(account, ACCOUNT_POSTS);
            if (Object.keys(rest).length) setup.socialAccounts = copy(rest);
        }
        return setup;
    }

    /** The character's setup as a file's contents (images still their paths). */
    function exportSetup(s, key, name) {
        const memories = Array.isArray(s?.characterMemories?.[key]) ? copy(s.characterMemories[key]) : [];
        return { format: SETUP_FORMAT, version: 1, name: String(name || nameOf(key)), setup: setupOf(s, key), memories };
    }

    /** A file's text as a setup, or throws when it isn't one. */
    function readSetup(text) {
        let file;
        try { file = JSON.parse(text); } catch { file = null; }
        if (!isObject(file) || file.format !== SETUP_FORMAT || !isObject(file.setup)) throw new Error('not an Echogram setup file');
        const setup = {};
        for (const name of [...SETUP, 'socialAccounts']) if (Object.hasOwn(file.setup, name)) setup[name] = file.setup[name];
        if (isObject(setup.socialAccounts)) setup.socialAccounts = without(setup.socialAccounts, ACCOUNT_POSTS);
        else delete setup.socialAccounts;
        const memories = Array.isArray(file.memories) ? file.memories.filter(isObject) : [];
        return { format: SETUP_FORMAT, version: 1, name: String(file.name || ''), setup, memories };
    }

    /** The images a setup holds, as their values (paths, or data URLs in a file). */
    function setupImages(setup) {
        return SETUP_IMAGES.map(([name, field]) => (field ? setup?.[name]?.[field] : setup?.[name]))
            .filter(v => typeof v === 'string' && v);
    }

    /**
     * A copy of `setup` with each image's value put through `fn(value)` (async); one it
     * turns into '' or null is left out.
     */
    async function mapSetupImages(setup, fn) {
        const next = copy(setup);
        for (const [name, field] of SETUP_IMAGES) {
            const holder = field ? next[name] : next;
            const slot = field || name;
            if (!isObject(holder) || typeof holder[slot] !== 'string' || !holder[slot]) continue;
            const value = await fn(holder[slot]);
            if (value) holder[slot] = value;
            else delete holder[slot];
        }
        return next;
    }

    /**
     * Puts a file's setup on the character under `key`: each setting the file has replaces
     * theirs, one it hasn't is cleared; the X account keeps its posts; memories are joined.
     * The images it no longer uses, to delete.
     */
    function importSetup(s, key, file) {
        const before = setupImages(setupOf(s, key));
        for (const name of SETUP) {
            if (Object.hasOwn(file.setup, name)) {
                if (!isObject(s[name])) s[name] = {};
                s[name][key] = copy(file.setup[name]);
            } else if (isObject(s[name])) {
                delete s[name][key];
            }
        }
        const stored = isObject(s.socialAccounts?.[key]) ? s.socialAccounts[key] : {};
        const posts = Object.fromEntries(ACCOUNT_POSTS.filter(f => Object.hasOwn(stored, f)).map(f => [f, stored[f]]));
        const account = { ...(isObject(file.setup.socialAccounts) ? copy(file.setup.socialAccounts) : {}), ...posts };
        if (!isObject(s.socialAccounts)) s.socialAccounts = {};
        if (Object.keys(account).length) s.socialAccounts[key] = account;
        else delete s.socialAccounts[key];
        if (file.memories.length) {
            if (!isObject(s.characterMemories)) s.characterMemories = {};
            const have = Array.isArray(s.characterMemories[key]) ? s.characterMemories[key] : [];
            const ids = new Set(have.map(m => m?.id).filter(Boolean));
            s.characterMemories[key] = [...have, ...copy(file.memories).filter(m => !m.id || !ids.has(m.id))];
        }
        const after = new Set(setupImages(setupOf(s, key)));
        return before.filter(path => !after.has(path));
    }

    window.EchoTextCharacterData = {
        moveCharacterData, deleteCharacterData, rememberNames, orphanedKeys, describeOrphan, nameOf,
        exportSetup, readSetup, setupImages, mapSetupImages, importSetup,
    };
})();
