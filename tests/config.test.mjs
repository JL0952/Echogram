// Run: node --test tests/*.test.mjs
// The default prompts in lib/config.js and what an earlier default becomes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = {};
new Function(readFileSync(new URL('../lib/config.js', import.meta.url), 'utf8'))();
const { defaultSettings, LEGACY_PROMPT_DEFAULTS } = window.EchoTextConfig;

test('reply length: from one text up, a usual top and a bit more when there\'s a lot to say', () => {
    // The top past the usual is the most a reply keeps (index.js MAX_TEXTS: 4, 6, 9)
    for (const [key, top, most] of [['promptVerbosityShort', 2, 4], ['promptVerbosityMedium', 4, 6], ['promptVerbosityLong', 7, 9]]) {
        assert.equal(defaultSettings[key], `VERBOSITY: A reply can be from 1 up to ${top} texts, up to about ${most} when there's a lot to say. `
            + 'How many follows the moment: a quick message gets a quick answer.', key);
    }
    // The ones that set how many to send become the new ones
    assert.ok(LEGACY_PROMPT_DEFAULTS.promptVerbosityShort.includes('VERBOSITY: Reply with 1–2 short texts. Brief and direct.'));
    assert.ok(LEGACY_PROMPT_DEFAULTS.promptVerbosityMedium.includes('VERBOSITY: Reply with 2–4 texts, each a sentence or two — a natural texting pace.'));
    assert.ok(LEGACY_PROMPT_DEFAULTS.promptVerbosityLong.includes('VERBOSITY: Reply with 4–7 texts, with more detail, expressiveness, and depth — like someone on a texting spree.'));
});
