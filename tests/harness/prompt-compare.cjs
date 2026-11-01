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
for (const f of ['lib/config.js', 'lib/rich-messages.js', 'lib/features.js', 'lib/chat-view-model.js', 'lib/daily-life.js', 'lib/story-texts.js', 'platforms/echotext/platform.js', 'platforms/wechat/platform.js', 'platforms/instagram/platform.js']) new Function(fs.readFileSync(`${REPO}/${f}`, 'utf8'))();
new Function(fs.readFileSync(`${__dirname}/scenarios.js`, 'utf8'))();

// Real index.js code: the prompt builder and the helpers it uses
const NAMES = ['buildSystemPrompt', 'buildPromptParts', 'buildLifeDate', 'buildApiMessagesFromHistory', 'buildApiMessagesFromHistoryForChar', 'placeLiveContext', 'splitsLiveContext', 'buildChatTurns', 'buildChatMessages', 'getSTStoryMessages', 'stMessageTime', 'StoryTexts', 'ST_STORY_CHUNK_MESSAGES', 'ST_STORY_CHUNK_CHARS', 'getVerbosityPrompt', 'getCharacterVerbosity', 'getEchoTextFirstMessage', 'getSTStoryContext', 'findSTOpeningIndex',
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
    const T0 = new Date(2026, 9, 31, 15, 0).getTime();
    const at = min => T0 + min * 60000;
    const turn = (is_user, mes, min = 0) => ({ is_user, mes, send_date: at(min) });
    const stMessage = (is_user, name, mes, min) => ({ is_user, name, mes, send_date: new Date(at(min)).toISOString() });
    let story = [];
    const env = {
        FA_REACTIONS: window.EchoTextScenarioReactions,
        settings: { ...defaults, defaultPlatform: 'echotext', platformByCharacter: {}, source: 'profile' },
        SillyTavern: { getContext: () => context(story, { name1: 'Qi' }) }, char: card,
    };
    const send = async (history, extra = []) => (await api(env).buildApiMessagesFromHistory(history, extra));
    const roles = r => r.apiMessages.map(m => m.role);
    const history = [turn(true, 'hi'), turn(false, 'hey', 1), turn(true, 'you there?', 2)];

    // With no story: what changes after the chat, the same up to there next time
    const first = await send(history);
    assert.deepEqual(roles(first), ['system', 'user', 'assistant', 'system', 'user'], 'before your latest text');
    assert.ok(!first.apiMessages[0].content.includes('MEMORY STUB') && !first.apiMessages[0].content.includes('BEHAVIOR'), 'nothing that changes up front');
    assert.ok(!first.apiMessages[0].content.includes('story_events') && !first.apiMessages[3].content.includes('texting Qi by phone'), 'no story, no word of it');
    assert.ok(first.apiMessages[3].content.includes('MEMORY STUB') && first.apiMessages[3].content.includes('BEHAVIOR'));
    assert.ok(first.apiMessages[3].content.startsWith('<context_for_this_reply>\nNot written by Qi: never quote or answer it.\n\n'), 'says it is not from you');
    assert.ok(first.apiMessages[3].content.endsWith('</context_for_this_reply>'));
    env.memory = 'ANOTHER MEMORY';
    env.feeling = 'ANGRY ';
    const next = await send([...history, turn(false, 'yes', 3), turn(true, 'good', 4)]);
    assert.deepEqual(next.apiMessages.slice(0, 3), first.apiMessages.slice(0, 3), 'the same up to the last reply');
    assert.deepEqual(roles(next), ['system', 'user', 'assistant', 'user', 'assistant', 'system', 'user']);
    assert.ok(next.apiMessages[5].content.includes('ANOTHER MEMORY') && next.apiMessages[5].content.includes('ANGRY'));
    assert.deepEqual(roles(await send([...history, turn(true, 'hello?', 3)])), ['system', 'user', 'assistant', 'system', 'user', 'user']);
    assert.equal((await send(history.slice(0, 2))).apiMessages.at(-1).role, 'system');
    const proactive = await send(history.slice(0, 2), ['PROACTIVE NOTE']);
    assert.ok(proactive.apiMessages.at(-1).content.includes('PROACTIVE NOTE') && proactive.apiMessages.at(-1).content.includes('MEMORY'), 'one message, its notes with it');
    assert.equal(proactive.apiMessages[1].role, 'user');
    env.settings.antiRefusal = true;
    assert.deepEqual(roles(await send(history)), ['system', 'user', 'assistant', 'system', 'user', 'assistant'], 'the prefill stays last');
    env.settings.antiRefusal = false;

    // The cola: asked for by text at 15:06, handed over in the story at 15:09, texts after. The order it happened in
    story = [stMessage(true, 'Qi', 'Going out for a bit.', -10), stMessage(false, 'Mira', 'She shuts the door behind her.', -9),
        stMessage(true, 'Qi', '"I\'m back."', 9), stMessage(false, 'Mira', 'He takes the cola and drinks.', 10)];
    const thread = [turn(true, 'getting the parcel, want anything?', 6), turn(false, 'a cola, cold', 6.5), turn(true, 'back soon', 7), turn(false, 'ok', 7.5), turn(true, 'hey', 12)];
    const woven = await send(thread);
    const shown = woven.apiMessages.slice(1).map(m => (m.role === 'system' ? m.content.split('\n')[0] : m.content));
    assert.deepEqual(shown, ['<story_events>', thread[0].mes, thread[1].mes, thread[2].mes, thread[3].mes, '<story_events>', '<context_for_this_reply>', 'hey']);
    assert.ok(!woven.apiMessages[0].content.includes('<story_so_far>') && !woven.apiMessages[0].content.includes('He takes the cola'), 'none of the story up front');
    assert.ok(woven.apiMessages[0].content.includes('in <story_events>, where they happened between the texts'));
    assert.ok(woven.apiMessages[6].content.includes('\n[2026-10-31 Sat 15:09]\nQi: "I\'m back."\nMira: He takes the cola and drinks.\n</story_events>'), 'the run with its time');
    assert.ok(woven.apiMessages[7].content.includes("Mira is texting Qi by phone: reply only with the texts Mira sends"), 'the reminder is with what changes');
    // The story moves on and the chat goes on: everything before stays exactly as it was
    story = [...story, stMessage(true, 'Qi', 'She washes the melon.', 13), stMessage(false, 'Mira', 'He drinks again.', 14)];
    const later = await send([...thread, turn(false, 'hey what', 12.5), turn(true, 'nice cola?', 15)]);
    assert.deepEqual(later.apiMessages.slice(0, 7), woven.apiMessages.slice(0, 7), 'the story moving on changes nothing before it');
    assert.deepEqual(later.apiMessages.slice(7).map(m => m.role), ['user', 'assistant', 'system', 'system', 'user']);
    assert.ok(later.apiMessages[9].content.includes('He drinks again.'));
    // Story after your last text comes last; the context follows it
    const storyLast = await send(thread.slice(0, 4));
    assert.deepEqual(storyLast.apiMessages.slice(-2).map(m => m.content.split('\n')[0]), ['<story_events>', '<context_for_this_reply>']);
    // A chat this character isn't in: nothing woven
    const elsewhere = await (async () => { const char = env.char; env.char = { ...card, avatar: 'other.png', name: 'Other' }; const r = await send(thread); env.char = char; return r; })();
    assert.ok(!elsewhere.apiMessages.some(m => m.content.includes('story_events')));

    // The default connection takes the system prompt: all of it. So do the others, in one system message
    for (const source of ['default', 'ollama', 'openai']) {
        env.settings.source = source;
        const whole = await send(thread, ['NOTE']);
        assert.deepEqual(roles(whole), ['system', 'system', 'user', 'assistant', 'user', 'assistant', 'user'], source);
        assert.equal(whole.apiMessages[0].content, whole.systemPrompt);
        assert.ok(whole.systemPrompt.includes('ANOTHER MEMORY') && whole.systemPrompt.includes('ANGRY'));
        assert.ok(whole.systemPrompt.includes('<story_so_far>') && whole.systemPrompt.includes('He drinks again.') && !whole.systemPrompt.includes('story_events'), 'the story up front, as ever');
    }
    console.log('order: ok');
}
if (PRINT) console.log(`\n--- ${PRINT} (working tree) ---\n${b[PRINT]}`);
process.exitCode = diffs ? 1 : 0;
})();
