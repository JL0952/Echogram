(function () {
    'use strict';

    /**
     * Which memories go into the prompt this turn, picked by code with no model
     * call (docs/platform-plan.md 10a). Pure: the memories and the chat's plain
     * texts in, the picked memories out.
     *
     *   1. Pinned ones, always, outside the budget.
     *   2. Ones with a keyword in the recent messages.
     *   3. Ones sharing a rare word with the recent messages. Chinese, Japanese and
     *      Korean are split into overlapping pairs of characters (齐宁怕黑 → 齐宁,
     *      宁怕, 怕黑), anything else into words; a word is rare when few of the
     *      earlier messages have it, so what the whole chat keeps saying never
     *      counts while a topic that's hot right now still does.
     * 2 and 3 share a budget in characters and a cap on how many, best first.
     * The recent messages span about three exchanges, so a memory stays in for a
     * while after it last came up.
     *
     * Exposes: window.EchoTextMemoryRecall
     */

    const WINDOW = 6;           // the recent messages memories are matched against
    const RECENCY = [1, 1, 0.8, 0.8, 0.6, 0.6];   // a match in each of them, newest first
    const BACKGROUND = 400;     // the earlier messages that tell how common a word is
    const MIN_BACKGROUND = 40;  // a new chat counts as this many earlier messages, none with the word
    const RARE = 0.05;          // rare: in at most this share of the earlier messages
    const BUDGET = 1000;        // characters of recalled (not pinned) memories
    const MAX_RECALLED = 6;

    const CJK_RUN_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;
    const HIRAGANA_RE = /^\p{Script=Hiragana}+$/u;
    const WORD_RE = /[\p{L}\p{N}]+/gu;

    // A pair with one of these is grammar, not a topic (我们, 好的, 走了吗, 一个人, 京都に)
    const PARTICLES = new Set(Array.from('我你她它们的了吗呢啊呀哦嗯嘛么啥呵嘿喔哇噢唉诶欸啦咯呗哎个はがをにでとものへやかねよ'));
    // A pair of two of these is too (就是, 没有, 一个, 怎么)
    const FUNCTION_CHARS = new Set(Array.from('我你他她它们的了吗呢啊呀哦嗯嘛么啥吧是在有和就也都还又这那个不没很太好要会能想说去来到给让被把对跟着过得地什怎哪一些点下上里多少几再才只'));
    // Pairs everyone says that name no topic
    const COMMON_PAIRS = new Set(`可以 知道 现在 时候 还是 但是 因为 所以 已经 自己 真的 觉得 这样 那样 一起 今天 明天 昨天
        晚上 早上 今晚 刚才 刚刚 有点 不要 可能 应该 如果 然后 而且 或者 东西 事情 问题 感觉 喜欢 怎样 一直 一样 起来 出来
        回来 过来 下来 看看 好像 其实 只是 不过 没事 谢谢 晚安 早安 哈哈 嘿嘿 嘻嘻 好的 可是 时间 等等 为什 为了 很多
        非常 特别 比较 最近 后来 以后 之前 以前 之后 意思 地方 别人 大家 告诉 需要 开始 继续 记得 发现 打算 准备 当然
        确实 一定 还没 怎么 什么 为啥 突然 终于 毕竟 好吧 行吧 算了 对了 记住 回复 消息 照片 语音`.split(/\s+/));
    const STOPWORDS = new Set(`a an the and or but if so of to in on at by for with from up out about into over after before
        than then as is am are was were be been being do does did done have has had having will would shall should can could
        may might must i me my mine we us our you your yours he him his she her hers it its they them their this that these
        those there here what which who whom whose when where why how all any both each few more most other some such no not
        only own same too very just also still even back well now again ever never always really much many lot lots
        oh ok okay yeah yes yep nope hey hi hello hmm haha lol lmao omg like got get gets getting go goes going gone went
        gonna wanna gotta know think want need make made say said tell told see look come came take give let thing things
        love feel every little bit kinda pretty actually probably already though because cause wait please thank thanks sorry
        something anything nothing everything one ones good great nice fine sure maybe right today tonight tomorrow
        yesterday time day night morning im ive id ill youre dont didnt cant wont isnt thats whats
        photo voice file link reaction transfer replying accepted declined
        memory inside joke important person hobby interest favorite shared moment custom`.split(/\s+/));

    function normalize(text) {
        return String(text ?? '').normalize('NFKC').toLowerCase();
    }

    function isTopicPair(pair) {
        const [a, b] = Array.from(pair);
        if (PARTICLES.has(a) || PARTICLES.has(b)) return false;
        if (FUNCTION_CHARS.has(a) && FUNCTION_CHARS.has(b)) return false;
        return !COMMON_PAIRS.has(pair) && !HIRAGANA_RE.test(pair);
    }

    /** A text's topic words: pairs of characters for Chinese, Japanese and Korean, words otherwise. */
    function words(text) {
        const out = new Set();
        const s = normalize(text);
        for (const [run] of s.matchAll(CJK_RUN_RE)) {
            const chars = Array.from(run);
            for (let i = 0; i < chars.length - 1; i++) {
                const pair = chars[i] + chars[i + 1];
                if (isTopicPair(pair)) out.add(pair);
            }
        }
        for (const [word] of s.replace(CJK_RUN_RE, ' ').matchAll(WORD_RE)) {
            // Plurals count as the word (cats → cat), not "ss" (boss)
            const stem = word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
            if (word.length > 1 && !STOPWORDS.has(word) && !STOPWORDS.has(stem)) out.add(stem);
        }
        return out;
    }

    /** Keywords as typed: split on commas (either width), 、, semicolons or new lines. */
    function parseKeys(value) {
        const list = Array.isArray(value) ? value : String(value ?? '').split(/[,，、;；\n]/);
        return [...new Set(list.map(k => String(k ?? '').trim()).filter(Boolean))];
    }

    /** Whether a keyword appears: a whole word for Latin ones (cat ≠ category), anywhere for the rest. */
    function hasKey(text, key) {
        const k = normalize(key).trim();
        if (!k) return false;
        if (/^[\p{Script=Latin}\p{N}\s'-]+$/u.test(k)) {
            const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u').test(text);
        }
        return text.includes(k);
    }

    /**
     * @param {object}   args
     * @param {Array}    args.memories - { content, label?, keys?, pinned? }
     * @param {string[]} args.texts    - the chat's messages as plain text, oldest first
     * @returns {Array<{ memory, why: 'pinned'|'keyword'|'match', score: number }>}
     *   pinned first, then the recalled ones best first
     */
    function recall({ memories, texts, budget = BUDGET, max = MAX_RECALLED } = {}) {
        const list = (memories || []).filter(m => m && String(m.content ?? '').trim());
        const all = (texts || []).map(t => String(t ?? ''));
        const recent = all.slice(-WINDOW);
        const earlier = all.slice(0, Math.max(0, all.length - WINDOW)).slice(-BACKGROUND);

        const recentWords = recent.map(words).reverse();
        const recentText = normalize(recent.join('\n'));
        const seenIn = new Map();
        for (const text of earlier) for (const w of words(text)) seenIn.set(w, (seenIn.get(w) || 0) + 1);
        const n = Math.max(earlier.length, MIN_BACKGROUND);
        const weight = w => Math.log((n + 1) / ((seenIn.get(w) || 0) + 1));
        const isRare = w => (seenIn.get(w) || 0) <= n * RARE;

        // The shared words' weights, the newest match of each counting most, over the
        // memory's size so a long one doesn't win on length alone; null: no rare word shared
        function match(memory) {
            const own = words(`${memory.label || ''}\n${memory.content}`);
            let sum = 0;
            let rare = false;
            for (const w of own) {
                const at = recentWords.findIndex(set => set.has(w));
                if (at === -1) continue;
                sum += weight(w) * RECENCY[at];
                if (isRare(w)) rare = true;
            }
            return rare ? sum / Math.sqrt(own.size) : null;
        }

        const candidates = [];
        for (const memory of list) {
            if (memory.pinned) continue;
            const keyword = parseKeys(memory.keys).some(k => hasKey(recentText, k));
            const score = match(memory);
            if (keyword) candidates.push({ memory, why: 'keyword', score: score ?? 0 });
            else if (score !== null) candidates.push({ memory, why: 'match', score });
        }
        candidates.sort((a, b) => (b.why === 'keyword') - (a.why === 'keyword') || b.score - a.score);

        // The best one always goes in; the rest while they fit
        const picked = [];
        let used = 0;
        for (const c of candidates) {
            if (picked.length >= max) break;
            const size = String(c.memory.content).trim().length;
            if (picked.length && used + size > budget) continue;
            picked.push(c);
            used += size;
        }

        return [...list.filter(m => m.pinned).map(memory => ({ memory, why: 'pinned', score: 0 })), ...picked];
    }

    window.EchoTextMemoryRecall = { recall, words, parseKeys, hasKey, WINDOW, BUDGET, MAX_RECALLED };
})();
