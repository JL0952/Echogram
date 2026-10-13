(function () {
    'use strict';

    /**
     * Summaries of a long chat's early messages (docs/platform-plan.md 10b). Pure.
     *
     * A summary sits on the last message it covers: msg.memo = { id, text, count, at }.
     * It covers that message and the count − 1 before it, back to the previous
     * summary. The model is sent the latest `keep` messages and every message no
     * summary covers word for word, and the summaries for the rest; so nothing is
     * dropped before it's summarized. Deleting the message a summary sits on puts
     * its messages back, and they're summarized again later.
     *
     * Exposes: window.EchoTextChatSummaries
     */

    const KEEP = 60;    // the latest messages, always sent word for word
    const CHUNK = 30;   // summarized at a time, once that many wait beyond the latest KEEP
    const MAX_CHARS = 1000;

    function memoOf(msg) {
        const memo = msg && msg.memo;
        return memo && typeof memo.text === 'string' && memo.text.trim() ? memo : null;
    }

    /** Each summary with the messages it covers (indices, inclusive), oldest first. */
    function spans(history) {
        const out = [];
        let prev = -1;
        (history || []).forEach((msg, i) => {
            const memo = memoOf(msg);
            if (!memo) return;
            const count = Math.max(1, Math.floor(Number(memo.count) || 1));
            out.push({ memo, from: Math.max(prev + 1, i - count + 1), to: i });
            prev = i;
        });
        return out;
    }

    /** Per message, whether a summary covers it. */
    function covered(history) {
        const out = (history || []).map(() => false);
        for (const { from, to } of spans(history)) for (let i = from; i <= to; i++) out[i] = true;
        return out;
    }

    /** The chat's summaries, oldest first: { id, text, from, to }. */
    function summaries(history) {
        return spans(history).map(({ memo, from, to }) => ({ id: String(memo.id ?? to), text: memo.text.trim(), from, to }));
    }

    /** The messages the model is sent word for word: the latest `keep`, and any no summary covers. */
    function toSend(history, { keep = KEEP } = {}) {
        const list = history || [];
        const cov = covered(list);
        const from = list.length - keep;
        return list.filter((msg, i) => i >= from || !cov[i]);
    }

    /**
     * The next messages to summarize, { start, end } (inclusive), once `size` of them
     * wait before the latest `keep`: the oldest ones no summary covers, in one run.
     * null while fewer wait.
     */
    function nextChunk(history, { keep = KEEP, size = CHUNK } = {}) {
        const list = history || [];
        const cov = covered(list);
        const limit = list.length - keep;
        let waiting = 0;
        let start = -1;
        for (let i = 0; i < limit; i++) {
            if (cov[i]) continue;
            if (start === -1) start = i;
            waiting++;
        }
        if (waiting < size) return null;
        let end = start;
        while (end + 1 < limit && !cov[end + 1] && end + 1 - start < size) end++;
        return { start, end };
    }

    /**
     * The request that summarizes some messages ("Name: text" lines). The notes before
     * them keep names and what's going on consistent.
     * @returns {{ systemPrompt: string, prompt: string }}
     */
    function buildRequest({ lines, previous = '', charName = 'Character', userName = 'User' }) {
        const systemPrompt = `You keep notes on a text chat between ${charName} and ${userName}. `
            + 'Summarize the messages you are given in at most five short lines, in the language they are written in: '
            + 'what happened, what was decided or promised, new facts about either of them, and how things between them changed. '
            + 'Plain statements with names, not pronouns. Write only the notes.';
        const prompt = (previous ? `Notes so far (for context, don't repeat them):\n${previous}\n\n` : '')
            + `Messages:\n${lines.join('\n')}`;
        return { systemPrompt, prompt };
    }

    // A refusal in place of notes: kept, it would ride along in every prompt
    const REFUSAL_RE = /^(i('m| am)? (sorry|unable)|i (can(no|')t|won't|will not)|as an ai|sorry,? (but )?i|抱歉|对不起|我(无法|不能))/i;

    function looksLikeRefusal(text) {
        return REFUSAL_RE.test(String(text ?? '').trim());
    }

    /** The model's notes as kept: no code fence or "Summary:" heading, no blank lines, at most 1000 characters. */
    function cleanSummary(text) {
        let s = String(text ?? '').replace(/```[a-z]*\n?/gi, '').trim();
        s = s.replace(/^(summary|notes)\s*[:：]\s*/i, '');
        s = s.split('\n').map(line => line.trim()).filter(Boolean).join('\n');
        return s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS).trimEnd()}…` : s;
    }

    window.EchoTextChatSummaries = { KEEP, CHUNK, covered, summaries, toSend, nextChunk, buildRequest, cleanSummary, looksLikeRefusal };
})();
