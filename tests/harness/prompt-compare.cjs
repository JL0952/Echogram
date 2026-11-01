(async () => {
// Builds the system prompt with index.js at REF (default HEAD) and with the
// working index.js, for a few mock characters and settings, and reports any
// difference. Memories (buildInsideJokesContext before 10a, buildMemoryContext
// after), emotions and world info are stubbed with fixed text,
// so only how the prompt is put together is compared. Stubs a ref doesn't call
// (buildTextingStyleContext before step E2, buildBehaviorContext before E3,
// buildMoodRules before E4) just go unused. Every case is in Manual mode, where
// Auto mode's <mood> rule adds nothing.
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
for (const f of ['lib/config.js', 'lib/rich-messages.js', 'lib/features.js', 'lib/chat-view-model.js', 'lib/daily-life.js', 'platforms/echotext/platform.js', 'platforms/wechat/platform.js', 'platforms/instagram/platform.js']) new Function(fs.readFileSync(`${REPO}/${f}`, 'utf8'))();
new Function(fs.readFileSync(`${__dirname}/scenarios.js`, 'utf8'))();

// Real index.js code: the prompt builder and the helpers it uses
const NAMES = ['buildSystemPrompt', 'buildPromptParts', 'buildLifeDate', 'buildApiMessagesFromHistory', 'buildApiMessagesFromHistoryForChar', 'placeLiveContext', 'splitsLiveContext', 'getVerbosityPrompt', 'getCharacterVerbosity', 'getEchoTextFirstMessage', 'getSTStoryContext', 'findSTOpeningIndex',
    'isCharInCurrentSTChat', 'cleanSTMessageText', 'ST_STORY_MAX_MESSAGES', 'ST_STORY_MAX_CHARS', 'replaceMacros', 'buildMessageFormatPrompt',
    'RichMessages', 'Features', 'Platforms', 'activePlatformMemo', 'getActivePlatform', 'getActiveFeatures', 'platformHas', 'getReactionIds', 'isTetheredMode',
    'DailyLife', 'dailyLifeActive', 'activeSchedule', 'activeLife', 'buildDailyLifeContext', 'phoneOverride', 'buildLifeRules', 'getEmotionHistory'];
// Stubbed: SillyTavern state and the parts with their own data
const STUBS = `
    const FA_REACTIONS = env.FA_REACTIONS; const settings = env.settings; const SillyTavern = env.SillyTavern;
    const getCurrentCharacter = () => env.char; const getCharacterKey = () => env.char?.avatar || null;
    const getCharacterName = () => env.char?.name || 'Character'; const getUserName = () => 'Qi';
    const isCombinedGroupMode = () => false; const inGroupSession = () => false; const groupManager = null; const stripThinkingTags = t => t;
    const expandTimeDateMacros = t => t; const getActiveWorldInfoEntries = async () => 'WORLD INFO STUB';
    const buildInsideJokesContext = () => \`\\n\\n<memories>\${env.memory || 'MEMORY STUB'}</memories>\`;
    const historyToSend = h => h; const resolveHistoryMessageText = m => m.mes; const buildUserReactionText = () => '';
    const buildMemoryContext = buildInsideJokesContext; const getChatHistory = () => [];
    const buildEmotionContext = () => '\\n\\n<emotional_state>EMOTION STUB</emotional_state>';
    const buildTextingStyleContext = () => '\\n\\n<texting_style>STYLE STUB</texting_style>';
    const buildBehaviorContext = (char, verbosity) => ({ nsfw: '\\n\\nNSFW STUB', text: '\\n\\n<texting_behavior>' + (env.feeling || '') + 'BEHAVIOR STUB</texting_behavior>', verbosity });
    const buildMoodRules = () => '';`;

function load(code) {
    const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
    const body = ast.body.find(n => n.type === 'ExpressionStatement').expression.callee.body.body;
    const parts = [];
    for (const node of body) {
        const names = node.type === 'FunctionDeclaration' ? [node.id.name] : node.type === 'VariableDeclaration' ? node.declarations.map(d => d.id.name) : [];
        if (names.some(n => NAMES.includes(n))) parts.push(code.slice(node.start, node.end));
    }
    return new Function('env', `${STUBS}\n${parts.join('\n')}\nreturn { buildSystemPrompt, buildApiMessagesFromHistory };`);
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
const dayFromToday = n => window.EchoTextDailyLife.dateKey(new Date(Date.now() + n * 86400000));
const CASES = {
    full: { settings: { ctxPersona: true, ctxWorldInfo: true, ctxAuthorsNote: true, verbosityByCharacter: { 'mira.png': 'long' }, platformByCharacter: { 'mira.png': 'wechat' } }, chat: stChat },
    antiRefusal: { settings: { antiRefusal: true, ctxScenario: false }, chat: stChat },
    noStoryOpen: { settings: { ctxDescription: false, verbosityByCharacter: { 'mira.png': 'short' } }, chat: [], extra: { characterId: undefined } },
    customPrompts: { settings: { promptSystemBase: 'Custom base for {{char}}.', promptTetheredNoFrame: 'Custom closing.', promptTextingFormat: 'Custom format.' }, chat: stChat },
    noCharacter: { settings: {}, chat: [], char: null },
    // No length of the character's own: the default in the settings (refs before the Personality tab's
    // reply length ignored it and wrote medium)
    verbosityDefault: { settings: { verbosityDefault: 'short' }, chat: stChat },
    // Daily Life on, a week whose blocks cover every hour (differs from refs before step 12a-2, and by the time it runs)
    dailyLife: { settings: { dailyLifeEnabled: true, characterSchedules: { 'mira.png': Object.fromEntries(['weekday', 'saturday', 'sunday'].map(day => [day, [
        { from: '07:00', to: '19:00', place: 'the safehouse', doing: 'watching the street', phone: 'busy' },
        { from: '19:00', to: '07:00', place: 'the safehouse', doing: 'off watch', phone: 'free' }]])) } }, chat: stChat },
    // And the chat's errands, what happened and today's change (12b), dated from today
    dailyLifeErrands: { settings: { dailyLifeEnabled: true, characterSchedules: {}, lifeState: { 'mira.png': { startAt: 0, start: {
        errands: [{ text: 'Find the leak', progress: 'two names left', due: dayFromToday(3), feeling: 'tired of waiting' }],
        log: [{ date: dayFromToday(-1), text: 'Burned the old passports' }],
        today: { date: dayFromToday(0), text: 'meeting the contact at the docks tonight' },
    } } } }, chat: stChat },
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

// The working tree's order of the request: what changes goes after the chat with a
// connection profile, so everything before it is the same next time (a prompt cache)
const assert = require('assert');
const api = load(fs.readFileSync(`${REPO}/index.js`, 'utf8'));
if (api) {
    const turn = (is_user, mes) => ({ is_user, mes });
    const env = {
        FA_REACTIONS: window.EchoTextScenarioReactions,
        settings: { ...defaults, defaultPlatform: 'echotext', platformByCharacter: {}, source: 'profile' },
        SillyTavern: { getContext: () => context(stChat) }, char: card,
    };
    const send = async (history, extra = []) => (await api(env).buildApiMessagesFromHistory(history, extra));
    const history = [turn(true, 'hi'), turn(false, 'hey'), turn(true, 'you there?')];
    const first = await send(history);
    assert.deepEqual(first.apiMessages.map(m => m.role), ['system', 'user', 'assistant', 'system', 'user'], 'before your latest text');
    assert.ok(!first.apiMessages[0].content.includes('MEMORY STUB') && !first.apiMessages[0].content.includes('BEHAVIOR'), 'nothing that changes up front');
    assert.ok(first.apiMessages[0].content.includes('<story_so_far>'), 'the story stays far from the end');
    assert.ok(first.apiMessages[3].content.includes('MEMORY STUB') && first.apiMessages[3].content.includes('BEHAVIOR'));
    assert.ok(first.apiMessages[3].content.startsWith('<context_for_this_reply>\nNot written by Qi: never quote or answer it.\n\n'), 'says it is not from you');
    assert.ok(first.apiMessages[3].content.endsWith('</context_for_this_reply>'));
    // The next reply: other memories and feelings, and the chat moved on. Same up to where it was
    env.memory = 'ANOTHER MEMORY';
    env.feeling = 'ANGRY ';
    const next = await send([...history, turn(false, 'yes'), turn(true, 'good')]);
    assert.deepEqual(next.apiMessages.slice(0, 3), first.apiMessages.slice(0, 3), 'the same up to the last reply');
    assert.deepEqual(next.apiMessages.map(m => m.role), ['system', 'user', 'assistant', 'user', 'assistant', 'system', 'user']);
    assert.ok(next.apiMessages[5].content.includes('ANOTHER MEMORY') && next.apiMessages[5].content.includes('ANGRY'));
    // Two texts in a row wait after it; a reply owed nothing goes last; a proactive text's notes go with it
    assert.deepEqual((await send([...history, turn(true, 'hello?')])).apiMessages.map(m => m.role), ['system', 'user', 'assistant', 'system', 'user', 'user']);
    assert.equal((await send(history.slice(0, 2))).apiMessages.at(-1).role, 'system');
    const proactive = await send(history.slice(0, 2), ['PROACTIVE NOTE']);
    assert.ok(proactive.apiMessages.at(-1).content.includes('PROACTIVE NOTE') && proactive.apiMessages.at(-1).content.includes('MEMORY'), 'one message, its notes with it');
    assert.equal(proactive.apiMessages[1].role, 'user');
    // The prefill stays last
    env.settings.antiRefusal = true;
    assert.deepEqual((await send(history)).apiMessages.map(m => m.role), ['system', 'user', 'assistant', 'system', 'user', 'assistant']);
    env.settings.antiRefusal = false;
    // The default connection takes the system prompt: all of it. So do the others, in one system message
    for (const source of ['default', 'ollama', 'openai']) {
        env.settings.source = source;
        const whole = await send(history, ['NOTE']);
        assert.deepEqual(whole.apiMessages.map(m => m.role), ['system', 'system', 'user', 'assistant', 'user'], source);
        assert.equal(whole.apiMessages[0].content, whole.systemPrompt);
        assert.ok(whole.systemPrompt.includes('ANOTHER MEMORY') && whole.systemPrompt.includes('ANGRY'));
    }
    console.log('order: ok');
}
if (PRINT) console.log(`\n--- ${PRINT} (working tree) ---\n${b[PRINT]}`);
process.exitCode = diffs ? 1 : 0;
})();
