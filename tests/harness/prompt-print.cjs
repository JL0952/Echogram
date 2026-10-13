(async () => {
// Prints the system prompt the working tree's index.js builds for one of your real
// characters: its card, your EchoText settings, persona, latest SillyTavern chat,
// lorebook and memories, read from SillyTavern's data folder (nothing is written).
// The emotion popup's values can be tried out without touching the settings.
// usage: node tests/harness/prompt-print.cjs <character name or avatar file>
//          [--values=rapport=-40,romance=80]  set these feelings (the rest stay as saved)
//          [--big5=A=low,E=high]             set these traits
//          [--morality=low|mid|high]         set Morality (shown with NSFW on)
//          [--mode=off|manual|auto] [--nsfw=on|off] [--platform=echotext|wechat|instagram] [--verbosity=short|medium|long]
//          [--tail]                          print only what comes after the story and memories
const fs = require('fs');
const path = require('path');
const REPO = path.resolve(__dirname, '../..');
const ST_ROOT = process.env.ST_ROOT || path.resolve(REPO, '../../../..');
const DATA = process.env.ST_DATA || path.join(ST_ROOT, 'data/default-user');
const acorn = require(path.join(ST_ROOT, 'node_modules/acorn'));

const args = process.argv.slice(2);
const opt = name => { const a = args.find(x => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
const pairs = s => Object.fromEntries((s || '').split(',').filter(Boolean).map(p => p.split('=')));
const who = args.find(a => !a.startsWith('--'));
if (!who) { console.error('usage: node tests/harness/prompt-print.cjs <character> [--values=…] [--big5=…] [--morality=…] [--mode=…] [--nsfw=on|off] [--platform=…] [--verbosity=…] [--tail]'); process.exit(2); }

global.window = {};
for (const f of ['lib/config.js', 'lib/rich-messages.js', 'lib/features.js', 'lib/chat-view-model.js', 'platforms/echotext/platform.js', 'platforms/wechat/platform.js', 'platforms/instagram/platform.js',
    'lib/emotion-model.js', 'lib/emotion-icons.js', 'lib/texting-behavior.js', 'lib/emotion-system.js', 'lib/memory-recall.js', 'lib/memory-system.js', 'lib/chat-summaries.js']) new Function(fs.readFileSync(`${REPO}/${f}`, 'utf8'))();

// ── SillyTavern's data ──────────────────────────────────────────────────────

function readCard(file) {
    const d = fs.readFileSync(file);
    for (let i = 8; i < d.length;) {
        const n = d.readUInt32BE(i), type = d.toString('latin1', i + 4, i + 8);
        if (type === 'tEXt') {
            const body = d.subarray(i + 8, i + 8 + n), zero = body.indexOf(0);
            if (body.toString('latin1', 0, zero) === 'chara') return JSON.parse(Buffer.from(body.toString('latin1', zero + 1), 'base64').toString('utf8'));
        }
        i += 12 + n;
    }
    return null;
}

const avatar = fs.readdirSync(`${DATA}/characters`).filter(f => f.endsWith('.png')).find(f => {
    if (f === who || f === `${who}.png`) return true;
    const card = readCard(`${DATA}/characters/${f}`);
    return (card?.data?.name || card?.name) === who;
});
if (!avatar) { console.error(`No character "${who}" in ${DATA}/characters`); process.exit(1); }
const card = readCard(`${DATA}/characters/${avatar}`);
const char = { ...(card.data || card), avatar, data: card.data || card };

const st = JSON.parse(fs.readFileSync(`${DATA}/settings.json`, 'utf8'));
const settings = JSON.parse(JSON.stringify({ ...window.EchoTextConfig.defaultSettings, ...st.extension_settings.EchoText }));
const userName = st.power_user?.personas?.[st.user_avatar] || 'User';
const personaDescription = st.power_user?.persona_descriptions?.[st.user_avatar]?.description || st.power_user?.persona_description || '';

const chatDir = `${DATA}/chats/${avatar.replace(/\.png$/, '')}`;
const chatFile = fs.existsSync(chatDir) && fs.readdirSync(chatDir).filter(f => f.endsWith('.jsonl'))
    .sort((a, b) => fs.statSync(`${chatDir}/${b}`).mtimeMs - fs.statSync(`${chatDir}/${a}`).mtimeMs)[0];
const stChat = chatFile ? fs.readFileSync(`${chatDir}/${chatFile}`, 'utf8').split('\n').filter(Boolean).slice(1).map(l => JSON.parse(l)) : [];

// Lorebook requests read the world file instead
global.fetch = async (url, init) => {
    const name = JSON.parse(init.body).name;
    const file = `${DATA}/worlds/${name}.json`;
    return fs.existsSync(file) ? { ok: true, json: async () => JSON.parse(fs.readFileSync(file, 'utf8')) } : { ok: false };
};

// ── What to try ─────────────────────────────────────────────────────────────

const Model = window.EchoTextEmotionModel;
if (opt('mode')) settings.emotionMode = opt('mode');
if (opt('nsfw')) settings.nsfwEnabled = opt('nsfw') === 'on';
if (opt('platform')) settings.platformByCharacter = { ...settings.platformByCharacter, [avatar]: opt('platform') };
if (opt('verbosity')) settings.verbosityByCharacter = { ...settings.verbosityByCharacter, [avatar]: opt('verbosity') };
if (opt('values')) {
    const state = Model.normalizeChatState(settings.emotionState?.[avatar], Date.now());
    for (const [id, v] of Object.entries(pairs(opt('values')))) state.start[id] = Model.clampValue(v, id);
    // As if just set in the popup: Auto mode replays only later reports and fades from now
    state.startAt = Date.now();
    settings.emotionState = { ...settings.emotionState, [avatar]: state };
}
if (opt('big5') || opt('morality')) {
    const profile = Model.normalizeProfile(settings.characterProfiles?.[avatar]);
    Object.assign(profile.bigFive, pairs(opt('big5')));
    if (opt('morality')) profile.morality = opt('morality');
    settings.characterProfiles = { ...settings.characterProfiles, [avatar]: profile };
}

// ── index.js's prompt builder ───────────────────────────────────────────────

const NAMES = ['buildSystemPrompt', 'getVerbosityPrompt', 'getEchoTextFirstMessage', 'getSTStoryContext', 'findSTOpeningIndex',
    'isCharInCurrentSTChat', 'cleanSTMessageText', 'ST_STORY_MAX_MESSAGES', 'ST_STORY_MAX_CHARS', 'replaceMacros', 'buildMessageFormatPrompt',
    'RichMessages', 'Features', 'Platforms', 'activePlatformMemo', 'getActivePlatform', 'getActiveFeatures', 'platformHas', 'getReactionIds',
    'getActiveWorldInfoEntries', 'buildMemoryContext', 'summariesOn', 'ChatSummaries', 'resolveHistoryMessageText', 'getContextMessageText', 'buildTextingStyleContext', 'buildBehaviorContext', 'buildMoodRules', 'inGroupSession',
    'stripThinkingTags', 'getStripTagsRegex', 'STRIP_TAGS_DEFAULTS', 'SPECIAL_PATTERNS', '_stripTagsRegex', '_stripTagsListHash'];
const STUBS = `
    const FA_REACTIONS = window.EchoTextFeatures.REACTIONS; const settings = env.settings; const SillyTavern = env.SillyTavern; const emotionSystem = env.emotionSystem; const memorySystem = env.memorySystem;
    const getCurrentCharacter = () => env.char; const getCharacterKey = () => env.char.avatar;
    const getCharacterName = () => env.char.name; const getUserName = () => env.userName;
    const isCombinedGroupMode = () => false; const groupManager = null;
    const expandTimeDateMacros = t => t; const getChatHistory = () => settings.chatHistory?.[env.char.avatar] || [];`;
const code = fs.readFileSync(`${REPO}/index.js`, 'utf8');
const body = acorn.parse(code, { ecmaVersion: 'latest' }).body.find(n => n.type === 'ExpressionStatement').expression.callee.body.body;
const parts = body.filter(node => {
    const names = node.type === 'FunctionDeclaration' ? [node.id.name] : node.type === 'VariableDeclaration' ? node.declarations.map(d => d.id.name) : [];
    return names.some(n => NAMES.includes(n));
}).map(node => code.slice(node.start, node.end));
const api = new Function('env', `${STUBS}\n${parts.join('\n')}\nreturn { buildSystemPrompt };`);

const common = { getSettings: () => settings, saveSettings: () => {}, getCharacterKey: () => avatar, getCharacterName: () => char.name };
const env = {
    settings, char, userName,
    SillyTavern: { getContext: () => ({ chat: stChat, characters: [char], characterId: 0, groupId: null,
        powerUserSettings: { persona_description: personaDescription }, extensionSettings: st.extension_settings }) },
    emotionSystem: window.EchoTextEmotionSystem.createEmotionSystem({ ...common, isPanelOpen: () => false, getChatHistory: key => settings.chatHistory?.[key] || [] }),
    memorySystem: window.EchoTextMemorySystem.createMemorySystem(common),
};
const prompt = await api(env).buildSystemPrompt();

const values = env.emotionSystem.getEmotionState();
console.error(`${char.name} (${avatar}) · user ${userName} · chat ${chatFile || 'none'} · emotions ${settings.emotionMode}`
    + (values ? ` ${JSON.stringify(Object.fromEntries(Object.entries(values).filter(([, v]) => v)))}` : '')
    + ` · Big Five ${JSON.stringify(Model.normalizeProfile(settings.characterProfiles?.[avatar]).bigFive)} · Morality ${Model.normalizeProfile(settings.characterProfiles?.[avatar]).morality} · NSFW ${settings.nsfwEnabled ? 'on' : 'off'}`
    + ` · ${prompt.length} chars\n`);
// --tail: what comes after the memories and summaries, or else after the story
const after = tag => { const at = prompt.lastIndexOf(tag); return at < 0 ? -1 : at + tag.length; };
const tailAt = Math.max(after('</shared_memories>'), after('</earlier_in_this_chat>'));
console.log(args.includes('--tail') ? prompt.slice(Math.max(0, tailAt >= 0 ? tailAt : after('</story_so_far>'))).trim() : prompt);
})();
