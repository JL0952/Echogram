(function () {
    'use strict';

    /**
     * EchoText Stickers
     *
     * The sticker library (docs/platform-plan.md 16). A sticker is sent as
     * <sticker>name</sticker>, by the user and the character alike, and the model never
     * sees the image: its name is all there is to go on, so a name says what the sticker
     * shows. Names are unique across the library.
     *
     *   set     = { id, name, builtIn?, stickers: [{ name, url }] }
     *   library = the sets in tab order: the built-in ones first
     *
     * The user can send any set's stickers; the character only those of the sets not
     * turned off for them (a list of set ids). Pure: no settings or DOM.
     */

    // The built-in sets. Their files are named after the stickers, in the extension's folder.
    const PRESETS = [
        {
            id: 'yuexinmiao',
            name: '月薪喵',
            folder: 'assets/stickers/yuexinmiao',
            ext: 'gif',
            names: ['安慰', '不想干', '叼花跑来', '敲键盘', '泪目', '害羞', '发射爱心', '惊吓', '被迫上班', '鬼脸', '刚睡醒', '对',
                '错', '在不在', '咬你', '角落画圈圈', '自信', '完了', '听歌', '额', '着迷', '喜欢', '心动'],
        },
    ];

    /** The built-in sets, their images under `baseUrl` (the extension's folder). */
    function presetSets(baseUrl) {
        return PRESETS.map(({ id, name, folder, ext, names }) => ({
            id,
            name,
            builtIn: true,
            stickers: names.map(sticker => ({ name: sticker, url: `${baseUrl}/${folder}/${encodeURIComponent(sticker)}.${ext}` })),
        }));
    }

    /** The names the character may use: those of the sets not in `offIds`, in tab order. */
    function characterNames(library, offIds = []) {
        return library.filter(set => !offIds.includes(set.id)).flatMap(set => set.stickers.map(sticker => sticker.name));
    }

    // What names are compared by: no file extension, spaces, punctuation or symbols, lower case
    const key = name => String(name ?? '').trim()
        .replace(/\.(?:gif|png|jpe?g|webp)$/i, '')
        .replace(/[\s\p{P}\p{S}]+/gu, '')
        .toLowerCase();
    const length = text => [...text].length;

    /**
     * The sticker a written name stands for: the one of that name; else the one that is the
     * same without extension, spaces and punctuation; else the closest in length of those
     * whose name is inside it or holds it ("安慰你" → 安慰). A name of one character only
     * matches whole, so 对 isn't 对不起. null when none is close.
     */
    function findSticker(library, written) {
        const stickers = library.flatMap(set => set.stickers);
        const text = String(written ?? '').trim();
        const exact = stickers.find(sticker => sticker.name === text);
        if (exact) return exact;
        const wanted = key(text);
        if (!wanted) return null;
        const same = stickers.find(sticker => key(sticker.name) === wanted);
        if (same) return same;
        if (length(wanted) < 2) return null;
        let best = null;
        let bestGap = Infinity;
        for (const sticker of stickers) {
            const name = key(sticker.name);
            if (length(name) < 2 || !(wanted.includes(name) || name.includes(wanted))) continue;
            const gap = Math.abs(length(name) - length(wanted));
            if (gap < bestGap) {
                best = sticker;
                bestGap = gap;
            }
        }
        return best;
    }

    /**
     * Canonical text's stickers by the names they were found under ("发射爱心.gif" →
     * 发射爱心), so the model sees the names as it's to write them; one with nothing
     * close stays as written.
     */
    function canonicalNames(library, text) {
        const source = String(text ?? '');
        if (!source.includes('<sticker>')) return source;
        return source.replace(/<sticker>([^<\n]*)<\/sticker>/g, (match, written) => {
            const found = findSticker(library, written);
            return found ? `<sticker>${found.name}</sticker>` : match;
        });
    }

    window.EchoTextStickers = {
        presetSets,
        characterNames,
        findSticker,
        canonicalNames,
    };
})();
