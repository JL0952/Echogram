(async () => {
// Builds the system prompt with index.js at REF (default HEAD) and with the
// working index.js, for a few mock characters and settings, and reports any
// difference. Memories, emotions and world info are stubbed with fixed text,
// so only how the prompt is put together is compared.
// usage: node tests/harness/prompt-compare.cjs [REF] [--print=<case>]
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const REPO = path.resolve(__dirname, '../..');
const ST_ROOT = process.env.ST_ROOT || path.resolve(REPO, '../../../..');
const acorn = require(path.join(ST_ROOT, 'node_modules/acorn'));
const args = process.argv.slice(2);
const REF = args.find(a => !a.startsWith('--')) || 'HEAD';
const PRINT = (args.find(a => a.startsWith('--print=')) || '').slice('--print='.length);

global.window = {};
for (const f of ['lib/config.js', 'lib/rich-messages.js', 'lib/features.js', 'lib/chat-view-model.js', 'platforms/echotext/platform.js', 'platforms/wechat/platform.js']) new Function(fs.readFileSync(`${REPO}/${f}`, 'utf8'))();
new Function(fs.readFileSync(`${__dirname}/scenarios.js`, 'utf8'))();

// Real index.js code: the prompt builder and the helpers it uses
const NAMES = ['buildSystemPrompt', 'getVerbosityPrompt', 'getEchoTextFirstMessage', 'getSTStoryContext', 'findSTOpeningIndex',
    'isCharInCurrentSTChat', 'cleanSTMessageText', 'ST_STORY_MAX_MESSAGES', 'ST_STORY_MAX_CHARS', 'replaceMacros', 'buildMessageFormatPrompt',
    'RichMessages', 'Features', 'Platforms', 'activePlatformMemo', 'getActivePlatform', 'getActiveFeatures', 'platformHas', 'getReactionIds', 'isTetheredMode'];
// Stubbed: SillyTavern state and the parts with their own data
const STUBS = `
    const FA_REACTIONS = env.FA_REACTIONS; const settings = env.settings; const SillyTavern = env.SillyTavern;
    const getCurrentCharacter = () => env.char; const getCharacterKey = () => env.char?.avatar || null;
    const getCharacterName = () => env.char?.name || 'Character'; const getUserName = () => 'Qi';
    const isCombinedGroupMode = () => false; const groupManager = null; const stripThinkingTags = t => t;
    const expandTimeDateMacros = t => t; const getActiveWorldInfoEntries = async () => 'WORLD INFO STUB';
    const buildInsideJokesContext = () => '\\n\\n<memories>MEMORY STUB</memories>';
    const buildEmotionContext = () => '\\n\\n<emotional_state>EMOTION STUB</emotional_state>';`;

function load(code) {
    const ast = acorn.parse(code, { ecmaVersion: 'latest' });
    const body = ast.body.find(n => n.type === 'ExpressionStatement').expression.callee.body.body;
    const parts = [];
    for (const node of body) {
        const names = node.type === 'FunctionDeclaration' ? [node.id.name] : node.type === 'VariableDeclaration' ? node.declarations.map(d => d.id.name) : [];
        if (names.some(n => NAMES.includes(n))) parts.push(code.slice(node.start, node.end));
    }
    return new Function('env', `${STUBS}\n${parts.join('\n')}\nreturn { buildSystemPrompt };`);
}

const defaults = window.EchoTextConfig.defaultSettings;
const card = {
    name: 'Mira', avatar: 'mira.png',
    description: '{{char}} is a field agent who never says what she means.',
    personality: 'Guarded, dry, secretly attached to {{user}}.',
    scenario: 'A safehouse in Lisbon, after the job went wrong.',
    first_mes: '*Mira tosses the keys onto the table.* "You\'re late, {{user}}."',
};
const stChat = [
    { name: 'Mira', is_user: false, original_avatar: 'mira.png', mes: '*Mira tosses the keys onto the table.* "Alternate greeting, {{user}}."' },
    { name: 'Qi', is_user: true, mes: 'Sorry. Traffic.' },
    { name: 'Mira', is_user: false, original_avatar: 'mira.png', mes: '<think>hm</think>"Sure it was." *She doesn\'t look up.*' },
    { name: 'Qi', is_user: true, is_system: true, mes: 'hidden note' },
    { name: 'Qi', is_user: true, mes: 'I brought coffee.' },
];
const context = (chat, extra = {}) => ({
    chat, characters: [card], characterId: 0, groupId: null,
    powerUserSettings: { persona_description: '{{user}} is Mira\'s handler.' },
    extensionSettings: { note: { chara: [{ name: 'mira', prompt: 'Mira hates being called sweet.' }] } },
    ...extra,
});
const CASES = {
    full: { settings: { ctxPersona: true, ctxWorldInfo: true, ctxAuthorsNote: true, verbosityByCharacter: { 'mira.png': 'long' }, platformByCharacter: { 'mira.png': 'wechat' } }, chat: stChat },
    antiRefusal: { settings: { antiRefusal: true, ctxScenario: false }, chat: stChat },
    noStoryOpen: { settings: { ctxDescription: false, verbosityByCharacter: { 'mira.png': 'short' } }, chat: [], extra: { characterId: undefined } },
    customPrompts: { settings: { promptSystemBase: 'Custom base for {{char}}.', promptTetheredNoFrame: 'Custom closing.', promptTextingFormat: 'Custom format.' }, chat: stChat },
    noCharacter: { settings: {}, chat: [], char: null },
};

async function run(api) {
    const out = {};
    for (const [id, c] of Object.entries(CASES)) {
        const env = {
            FA_REACTIONS: window.EchoTextScenarioReactions,
            settings: { ...defaults, defaultPlatform: 'echotext', platformByCharacter: {}, ...c.settings },
            SillyTavern: { getContext: () => context(c.chat, c.extra) },
            char: c.char === null ? null : card,
        };
        out[id] = await api(env).buildSystemPrompt();
    }
    return out;
}

const a = await run(load(execSync(`git show ${REF}:index.js`, { cwd: REPO }).toString()));
const b = await run(load(fs.readFileSync(`${REPO}/index.js`, 'utf8')));
let diffs = 0;
for (const id of Object.keys(CASES)) {
    if (a[id] === b[id]) { console.log(`${id}: same (${b[id].length} chars)`); continue; }
    diffs++;
    const at = [...a[id]].findIndex((ch, i) => ch !== b[id][i]);
    console.log(`${id}: DIFFERENT at ${at}\n  ${REF}: ${JSON.stringify(a[id].slice(Math.max(0, at - 60), at + 120))}\n  work: ${JSON.stringify(b[id].slice(Math.max(0, at - 60), at + 120))}`);
}
console.log(`\n${Object.keys(CASES).length} cases, ${diffs} different`);
if (PRINT) console.log(`\n--- ${PRINT} (working tree) ---\n${b[PRINT]}`);
process.exitCode = diffs ? 1 : 0;
})();
