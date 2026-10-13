(function () {
    'use strict';

    /**
     * EchoText Rich Messages
     *
     * Rich content lives inline in a message's `mes` as XML-style tags, so the
     * model sees its own past usage verbatim in the chat history:
     *
     *     <photo>what the photo shows</photo>
     *     <voice>the words said</voice>               a voice message
     *     <file>name.ext | what's in it</file>         a shared file (summary optional)
     *     <link>title | address | one line</link>     a shared web page
     *     <transfer>52.00</transfer>                  send money
     *     <transfer_accept>52.00</transfer_accept>    accept a transfer
     *     <transfer_decline>52.00</transfer_decline>  decline a transfer
     *     <react>heart</react>                        tapback on the user's latest message
     *     <reply>Name: the quoted words</reply>       quotes a message for the bubble after it
     *
     * Character replies are also split into one bubble per line, the way people
     * send several short texts in a row. Everything here is pure string work —
     * rendering and transfer status live in index.js.
     *
     * Models drift from the canonical format, so parsing is deliberately lenient:
     * alias tag names, attributes, self-closing tags, unclosed tags, stray closers,
     * and contents broken across lines are all repaired by normalizeMessageTags().
     */

    // Used when neither a transfer nor any earlier transfer in the chat names a currency
    const DEFAULT_CURRENCY = '¥';

    // Currency words and symbols → display symbol. Ordered so longer words win
    // ("美元" before "元"); Latin codes must not touch other letters.
    const latin = word => `(?<![a-z])(?:${word})(?![a-z])`;
    const CURRENCY_PATTERNS = [
        [new RegExp(`美元|美金|刀|\\$|${latin('usd|us|dollars?')}`, 'i'), '$'],
        [new RegExp(`欧元|€|${latin('eur|euros?')}`, 'i'), '€'],
        [new RegExp(`英镑|£|${latin('gbp|pounds?')}`, 'i'), '£'],
        [new RegExp(`韩元|₩|원|${latin('krw|won')}`, 'i'), '₩'],
        [new RegExp(`日元|日圆|円|${latin('jpy|yen')}`, 'i'), '¥'],
        [new RegExp(`人民币|元|块|¥|￥|${latin('rmb|cny|yuan')}`, 'i'), '¥'],
    ];

    // Canonical tag name → names models commonly use for it
    const TAG_ALIASES = {
        photo: ['photo', 'image', 'picture', 'pic', 'img', '照片', '图片'],
        voice: ['voice', 'voice_message', 'voicemessage', 'voice_note', 'audio', '语音', '语音消息'],
        file: ['file', 'document', 'attachment', '文件'],
        link: ['link', 'url', 'webpage', 'web_page', 'article', '链接', '网页'],
        transfer: ['transfer', 'money_transfer', '转账'],
        transfer_accept: ['transfer_accept', 'accept_transfer', 'transfer_accepted', 'receive_transfer', 'transfer_received', '收款', '接收转账', '已收款'],
        transfer_decline: ['transfer_decline', 'decline_transfer', 'transfer_declined', 'reject_transfer', 'refuse_transfer', 'return_transfer', 'transfer_returned', '拒绝转账', '退还转账', '已退还'],
        react: ['react', 'reaction', 'tapback', '表情回应'],
        reply: ['reply', 'quote', 'reply_to', 'replying_to', 'in_reply_to', '引用', '回复'],
    };

    // Tapback names, emoji and words → reaction ids. The ids must match
    // FA_REACTIONS in emotion-system.js, which supplies their icons and colours.
    const REACTION_ALIASES = {
        heart: ['heart', 'love', '❤️', '❤', '♥️', '♥', '💕', '💖', '💗', '😍', '🥰', '爱心', '心'],
        haha: ['haha', 'lol', 'laugh', 'funny', '😂', '🤣', '😆', '😄', '哈哈', '笑'],
        wow: ['wow', 'surprised', 'omg', '😮', '😲', '😯', '😱', '哇', '惊讶'],
        sad: ['sad', 'cry', '😢', '😭', '🥺', '😞', '难过', '哭'],
        fire: ['fire', 'hot', '🔥', '火'],
        like: ['like', 'thumbs up', 'thumbsup', '👍', '赞', '点赞'],
        star: ['star', '⭐', '🌟', '✨', '星星'],
        bolt: ['bolt', 'zap', 'lightning', '⚡', '闪电'],
    };
    const REACTION_IDS = Object.keys(REACTION_ALIASES);
    const TAG_TYPES = Object.keys(TAG_ALIASES);
    const AMOUNT_TYPES = new Set(['transfer', 'transfer_accept', 'transfer_decline']);

    const ALIAS_TO_TYPE = new Map();
    for (const [type, aliases] of Object.entries(TAG_ALIASES)) {
        for (const alias of aliases) ALIAS_TO_TYPE.set(alias.toLowerCase(), type);
    }

    const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Longest first so alternation can't stop at a shorter alias; a name must be
    // followed by whitespace, '/' or '>' (\b doesn't work for CJK names)
    const ALIAS_GROUP = [...ALIAS_TO_TYPE.keys()].sort((a, b) => b.length - a.length).map(escapeRe).join('|');
    const ANY_ALIAS_RE = new RegExp(`<\\s*\\/?\\s*(?:${ALIAS_GROUP})(?=[\\s/>])`, 'i');
    const OPEN_TAG_RE = new RegExp(`<\\s*(${ALIAS_GROUP})(?=[\\s/>])([^>]*)>`, 'gi');
    const CLOSE_TAG_RE = new RegExp(`<\\s*\\/\\s*(${ALIAS_GROUP})\\s*>`, 'gi');
    const ATTR_VALUE_RE = /\b(?:desc|description|summary|alt|caption|content|text|transcript|amount|value)\s*=\s*(["'])([\s\S]*?)\1/i;
    const ATTR_NAME_RE = /\b(?:name|filename|title)\s*=\s*(["'])([\s\S]*?)\1/i;
    const ATTR_URL_RE = /\b(?:url|href|link)\s*=\s*(["'])([\s\S]*?)\1/i;
    // A file's or link's fields are separated by |; the field that is only an address is the link's
    const FIELD_SPLIT_RE = /\s*[|｜]\s*/;
    const ADDRESS_RE = /^(?:https?:\/\/|www\.)\S+$/i;

    const TYPE_GROUP = TAG_TYPES.join('|');
    const ANY_OPEN = `<(?:${TYPE_GROUP})>`;
    const TOKEN_RE = new RegExp(`<(\\/?)(${TYPE_GROUP})>`, 'g');
    const CLOSED_TAG_RE = new RegExp(`<(${TYPE_GROUP})>((?:(?!${ANY_OPEN})[\\s\\S])*?)<\\/\\1>`, 'g');
    const PART_RE = new RegExp(`<(${TYPE_GROUP})>([\\s\\S]*?)<\\/\\1>`, 'g');
    const FENCE_RE = /^\s*```/;

    /** The display symbol for the first currency named in `text`, or ''. */
    function detectCurrency(text) {
        const found = CURRENCY_PATTERNS.find(([re]) => re.test(String(text ?? '')));
        return found ? found[1] : '';
    }

    /**
     * Formats a transfer amount as "52.00", keeping a named currency as its symbol
     * ("$52.00"); unparseable contents are kept as-is and an empty amount stays
     * empty (a response can omit it).
     */
    function normalizeAmount(content) {
        const text = String(content ?? '').trim();
        const match = text.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
        if (!match) return text;
        const value = Number(match[0]);
        return Number.isFinite(value) ? `${detectCurrency(text)}${value.toFixed(2)}` : text;
    }

    /** The reaction id for a tapback name, emoji or word ("❤️" → "heart"), or ''. */
    function parseReaction(content) {
        const text = String(content ?? '').trim().toLowerCase();
        if (!text) return '';
        for (const [id, aliases] of Object.entries(REACTION_ALIASES)) {
            if (aliases.some(alias => alias.toLowerCase() === text)) return id;
        }
        // An emoji with extra characters around it ("❤️❤️", "🔥!")
        for (const [id, aliases] of Object.entries(REACTION_ALIASES)) {
            if (aliases.some(alias => /\p{Extended_Pictographic}/u.test(alias) && text.includes(alias))) return id;
        }
        return '';
    }

    /** "$52.00" → { symbol: '$', value: '52.00' }; symbol is '' when none is named, value null when unparseable. */
    function splitAmount(amount) {
        const match = String(amount ?? '').match(/^(\D*?)(\d+\.\d{2})$/);
        return match ? { symbol: match[1], value: match[2] } : { symbol: '', value: null };
    }

    /**
     * Strict parse of an amount the user typed — a currency word or symbol plus a
     * positive number with at most two decimals ("20", "$20", "20 USD", "13.14元").
     * @returns {{symbol: string, value: string}|null}
     */
    function parseAmount(text) {
        const raw = String(text ?? '').trim();
        let rest = raw;
        for (const [re] of CURRENCY_PATTERNS) rest = rest.replace(new RegExp(re.source, 'gi'), '');
        rest = rest.replace(/[,，\s]/g, '');
        if (!/^\d+(\.\d{1,2})?$/.test(rest)) return null;
        const value = Number(rest);
        return value > 0 ? { symbol: detectCurrency(raw), value: value.toFixed(2) } : null;
    }

    /**
     * Rewrites every rich-content tag in `text` into its canonical single-line
     * `<type>content</type>` form. Text without such tags is returned as-is.
     */
    function normalizeMessageTags(text) {
        let out = String(text ?? '');
        if (!ANY_ALIAS_RE.test(out)) return out;

        // 1. Unify tag names; a self-closing tag carries its content in an attribute
        out = out.replace(OPEN_TAG_RE, (match, alias, attrs) => {
            const type = ALIAS_TO_TYPE.get(alias.toLowerCase());
            if (!/\/\s*$/.test(attrs)) return `<${type}>`;
            // <file name="a.pdf" desc="…"/>, <link title="…" url="…"/>: the fields in order
            const content = [ATTR_NAME_RE, ATTR_URL_RE, ATTR_VALUE_RE]
                .map(re => (attrs.match(re) || [])[2]).filter(Boolean).join(' | ');
            return `<${type}>${content}</${type}>`;
        });
        out = out.replace(CLOSE_TAG_RE, (match, alias) => `</${ALIAS_TO_TYPE.get(alias.toLowerCase())}>`);

        // 2. Closed contents that wrap across lines are joined back into one line
        out = out.replace(CLOSED_TAG_RE, (match, type, content) =>
            `<${type}>${content.replace(/\s*\n\s*/g, ' ')}</${type}>`);

        // 3. Per line: an unclosed tag runs to the next tag or the end of the line,
        //    and closers without an opener are dropped
        out = out.split('\n').map(normalizeLine).join('\n');

        // 4. Models sometimes wrap a tag in inline-code backticks
        out = out.replace(new RegExp(`\`+(<(${TYPE_GROUP})>[^\\n]*?<\\/\\2>)\`+`, 'g'), '$1');

        // 5. Transfer amounts are plain numbers with two decimals; reactions use their id
        return out.replace(PART_RE, (match, type, content) => {
            if (AMOUNT_TYPES.has(type)) return `<${type}>${normalizeAmount(content)}</${type}>`;
            if (type === 'react') return `<react>${parseReaction(content) || content.trim()}</react>`;
            if (type === 'reply') return `<reply>${replyContent(replyFields(content))}</reply>`;
            return match;
        });
    }

    function normalizeLine(line) {
        let result = '';
        let open = null; // { type, start }
        let i = 0;
        const closeOpen = (end) => {
            const content = line.slice(open.start, end).replace(TOKEN_RE, '').trim();
            result += `<${open.type}>${content}</${open.type}>`;
        };
        for (const token of line.matchAll(TOKEN_RE)) {
            const isClose = token[1] === '/';
            const type = token[2];
            const end = token.index + token[0].length;
            if (open) {
                if (isClose && type === open.type) {
                    closeOpen(token.index);
                    open = null;
                    i = end;
                } else if (!isClose) {
                    // A new tag ends the unclosed one
                    closeOpen(token.index);
                    open = { type, start: end };
                    i = end;
                }
                // A closer of another type inside the content is stripped by closeOpen
            } else if (isClose) {
                result += line.slice(i, token.index);
                i = end;
            } else {
                result += line.slice(i, token.index);
                open = { type, start: end };
                i = end;
            }
        }
        if (open) closeOpen(line.length);
        else result += line.slice(i);
        return result;
    }

    /**
     * Splits a text segment into one text per non-empty line. Fenced code blocks
     * stay together in a single text.
     */
    function splitIntoTexts(segment) {
        const texts = [];
        let fence = null;
        for (const line of segment.split('\n')) {
            if (fence !== null) {
                fence += '\n' + line;
                if (FENCE_RE.test(line)) {
                    texts.push(fence);
                    fence = null;
                }
                continue;
            }
            // A fence that also closes on its own line is ordinary text
            if (FENCE_RE.test(line) && !/```.*```/.test(line)) {
                fence = line;
                continue;
            }
            if (line.trim()) texts.push(line.trim());
        }
        if (fence !== null) texts.push(fence);
        return texts;
    }

    /**
     * Parses a message into display parts, in order:
     *   { type: 'text', text }
     *   { type: 'photo', desc }
     *   { type: 'voice', text }
     *   { type: 'file', name, summary } | { type: 'link', title, url, summary }
     *   { type: 'transfer' | 'transfer_accept' | 'transfer_decline', amount }
     *   { type: 'react', reaction }
     * `amount` is "52.00", or '' when a response omits it; `reaction` is a reaction
     * id, or '' when the tag names none we know. A <reply> isn't a part of its own:
     * the part right after it (or, when nothing follows, the one before it) gets
     * `replyTo: { name, text }`.
     * @param {string} text - the stored message text
     * @param {object} [options]
     * @param {boolean} [options.splitLines=false] - one text part per line (character
     *   replies); otherwise each run of text between tags stays a single part
     * @returns {Array<object>} parts; empty when the message has no visible content
     */
    function parseMessageParts(text, { splitLines = false } = {}) {
        const normalized = normalizeMessageTags(text);
        const parts = [];

        const pushText = (segment) => {
            if (splitLines) {
                for (const chunk of splitIntoTexts(segment)) parts.push({ type: 'text', text: chunk });
                return;
            }
            const trimmed = segment.trim();
            if (trimmed) parts.push({ type: 'text', text: trimmed });
        };

        let last = 0;
        for (const match of normalized.matchAll(PART_RE)) {
            pushText(normalized.slice(last, match.index));
            const [, type, content] = match;
            if (type === 'photo') parts.push({ type, desc: content.trim() });
            else if (type === 'voice') parts.push({ type, text: content.trim() });
            else if (type === 'file' || type === 'link') parts.push({ type, ...shareFields(type, content) });
            else if (type === 'react') parts.push({ type, reaction: parseReaction(content) });
            else if (type === 'reply') parts.push({ type, ...replyFields(content) });
            else parts.push({ type, amount: content.trim() });
            last = match.index + match[0].length;
        }
        pushText(normalized.slice(last));
        return attachReplies(parts);
    }

    /** Hands each <reply> part's quote to the bubble it answers (see parseMessageParts). */
    function attachReplies(parts) {
        if (!parts.some(part => part.type === 'reply')) return parts;
        const out = [];
        let quote = null;
        for (const part of parts) {
            if (part.type === 'reply') quote = { name: part.name, text: part.text };
            else if (quote && part.type !== 'react') {
                out.push({ ...part, replyTo: quote });
                quote = null;
            } else out.push(part);
        }
        const before = quote && out.findLastIndex(part => part.type !== 'react' && !part.replyTo);
        if (quote && before >= 0) out[before] = { ...out[before], replyTo: quote };
        return out;
    }

    /**
     * A quote's name and words from a <reply>'s content: "Name: words", leniently
     * ("replying to Name: words", a full-width colon). No name: everything is the words.
     */
    function replyFields(content) {
        const text = String(content ?? '').trim().replace(/^(?:in\s+)?(?:replying|reply)\s+to\s+|^(?:回复|引用)\s*/i, '');
        const match = text.match(/^([^:：\n]{1,40}?)\s*[:：]\s*([\s\S]*)$/);
        return match ? { name: match[1].trim(), text: match[2].trim() } : { name: '', text: text.trim() };
    }

    /** A <reply>'s canonical content: "Name: words". */
    function replyContent({ name, text }) {
        return name ? `${name}: ${text}` : text;
    }

    /**
     * The inverse of parseMessageParts: canonical message text for a list of parts,
     * one per line (used to drop a single bubble from a message).
     */
    function serializeParts(parts) {
        return parts.map(part => {
            const quote = part.replyTo ? `<reply>${replyContent(part.replyTo)}</reply>\n` : '';
            if (part.type === 'reply') return `<reply>${replyContent(part)}</reply>`;
            if (part.type === 'text') return quote + part.text;
            const content = part.type === 'photo' ? part.desc
                : part.type === 'voice' ? part.text
                : part.type === 'file' ? [part.name, part.summary].filter(Boolean).join(' | ')
                : part.type === 'link' ? [part.title, part.url, part.summary].filter(Boolean).join(' | ')
                : part.type === 'react' ? part.reaction : part.amount;
            return `${quote}<${part.type}>${content ?? ''}</${part.type}>`;
        }).join('\n');
    }

    /** Whether the message contains any rich-content tag. */
    function hasRichContent(text) {
        return ANY_ALIAS_RE.test(String(text ?? ''));
    }

    /**
     * "$52.00" for display: the amount's own currency, else `fallbackSymbol`; the
     * raw content when it isn't a number.
     */
    function formatAmount(amount, fallbackSymbol = DEFAULT_CURRENCY) {
        const { symbol, value } = splitAmount(amount);
        return value ? `${symbol || fallbackSymbol}${value}` : amount;
    }

    /**
     * Plain-text rendering for previews, exports and analysis, e.g.
     * "[Photo: …]", "[Transfer: ¥52.00]", "[Accepted transfer: ¥52.00]",
     * "[Replying to Name: …]".
     */
    function toPlainText(text) {
        const labels = { photo: 'Photo', voice: 'Voice', file: 'File', link: 'Link', react: 'Reaction', transfer: 'Transfer', transfer_accept: 'Accepted transfer', transfer_decline: 'Declined transfer' };
        return normalizeMessageTags(text).replace(PART_RE, (match, type, content) => {
            if (type === 'reply') return `[Replying to ${content.trim()}]`;
            const value = AMOUNT_TYPES.has(type) ? formatAmount(content.trim()) : content.trim();
            const label = labels[type];
            return value ? `[${label}: ${value}]` : `[${label}]`;
        });
    }

    // Characters read one by one (Chinese, Japanese, Korean); anything else is counted in words
    const SYLLABIC_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

    /**
     * How long a voice message runs, in whole seconds, from its words: about 4
     * Chinese / Japanese / Korean characters or 2.5 other words a second, 1–60.
     */
    function voiceDuration(text) {
        const s = String(text ?? '');
        const syllables = (s.match(SYLLABIC_RE) || []).length;
        const words = (s.replace(SYLLABIC_RE, ' ').match(/[\p{L}\p{N}]+/gu) || []).length;
        return Math.min(60, Math.max(1, Math.ceil(syllables / 4 + words / 2.5)));
    }

    /** A file's name and summary, or a link's title, address and summary, from a tag's content. */
    function shareFields(type, content) {
        const fields = String(content ?? '').split(FIELD_SPLIT_RE).map(f => f.trim()).filter(Boolean);
        if (type === 'file') return { name: fields[0] || '', summary: fields.slice(1).join(' | ') };
        // Page titles often hold a | themselves: everything before the address is the title
        const at = fields.findIndex(f => ADDRESS_RE.test(f));
        if (at < 0) return { title: fields[0] || '', url: '', summary: fields.slice(1).join(' | ') };
        return { title: fields.slice(0, at).join(' | '), url: fields[at], summary: fields.slice(at + 1).join(' | ') };
    }

    /** A file's look by its extension: 'word', 'pdf', 'excel', 'ppt' or 'other'. */
    function fileKind(name) {
        const ext = (String(name ?? '').match(/\.([a-z0-9]{1,8})$/i) || [])[1]?.toLowerCase() || '';
        if (['doc', 'docx', 'rtf', 'pages'].includes(ext)) return 'word';
        if (ext === 'pdf') return 'pdf';
        if (['xls', 'xlsx', 'csv', 'numbers'].includes(ext)) return 'excel';
        if (['ppt', 'pptx', 'key'].includes(ext)) return 'ppt';
        return 'other';
    }

    /** The extension of a file name, upper-cased ("PDF"), or ''. */
    function fileExtension(name) {
        return ((String(name ?? '').match(/\.([a-z0-9]{1,8})$/i) || [])[1] || '').toUpperCase();
    }

    // Sizes a made-up file of each kind falls between, in KB
    const FILE_SIZE_KB = { word: [10, 300], pdf: [30, 3000], excel: [8, 600], ppt: [300, 8000], other: [8, 3000] };

    /**
     * A made-up size in bytes for a shared file (there is no real one), the same every
     * time for the same name, in a range that suits its kind (a Word form is small, a
     * deck large).
     */
    function fileSize(name) {
        let h = 2166136261;
        for (const c of String(name ?? '')) h = Math.imul(h ^ c.codePointAt(0), 16777619);
        const [min, max] = FILE_SIZE_KB[fileKind(name)];
        return Math.round(1024 * min * Math.pow(max / min, ((h >>> 0) % 1000) / 1000));
    }

    /** "www.news.cn" from "https://www.news.cn/sports/…", or ''. */
    function linkHost(url) {
        return String(url ?? '').replace(/^https?:\/\//i, '').split(/[/?#]/)[0];
    }

    // What the user can share from the composer, picked before typing "title | description"
    const SHARE_TYPES = [
        { id: 'pdf', label: 'PDF', ext: 'pdf', icon: 'fa-file-pdf' },
        { id: 'word', label: 'Word', ext: 'docx', icon: 'fa-file-word' },
        { id: 'excel', label: 'Excel', ext: 'xlsx', icon: 'fa-file-excel' },
        { id: 'ppt', label: 'PPT', ext: 'pptx', icon: 'fa-file-powerpoint' },
        { id: 'link', label: 'Web page', icon: 'fa-link' },
        { id: 'other', label: 'Other', icon: 'fa-file-lines' },
    ];

    /**
     * The tag for something the user shares from the composer, as "title | description".
     * A PDF / Word / Excel / PPT gets its extension added unless the title already has
     * one of that kind; a web page needs no address; "other" keeps the name as typed
     * (and is a web page when it holds an address). Null when there is nothing.
     */
    function shareTag(text, typeId = 'other') {
        const content = String(text ?? '').replace(/\s*\n\s*/g, ' ').trim();
        if (!content) return null;
        if (typeId === 'link') return `<link>${content}</link>`;
        const type = SHARE_TYPES.find(t => t.id === typeId && t.ext);
        if (!type) {
            const isLink = content.split(FIELD_SPLIT_RE).some(f => ADDRESS_RE.test(f.trim()));
            return isLink ? `<link>${content}</link>` : `<file>${content}</file>`;
        }
        const [title, ...rest] = content.split(FIELD_SPLIT_RE);
        const name = fileKind(title) === type.id ? title : `${title}.${type.ext}`;
        return `<file>${[name, ...rest].join(' | ')}</file>`;
    }

    window.EchoTextRichMessages = {
        DEFAULT_CURRENCY,
        normalizeMessageTags,
        parseMessageParts,
        serializeParts,
        hasRichContent,
        REACTION_IDS,
        parseReaction,
        detectCurrency,
        splitAmount,
        parseAmount,
        formatAmount,
        toPlainText,
        voiceDuration,
        fileKind,
        fileExtension,
        fileSize,
        linkHost,
        SHARE_TYPES,
        shareTag,
        replyContent,
    };
})();
