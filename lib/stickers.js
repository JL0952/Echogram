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
     *   set     = { id, name, builtIn?, stickers: [{ name, url, path? }] }
     *   library = the sets in tab order: the built-in ones first, then the imported ones
     *             in the order they came in
     *
     * An imported set is kept in the settings as { id, name, stickers: [{ name, path }] }:
     * its images are uploaded to the user's images (path as the upload returned it), and
     * its stickers are named after their files.
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

    /** `name`, or with the first number from 2 that makes it new to `taken` ("害羞2"). */
    function uniqueName(taken, name) {
        if (!taken.has(name)) return name;
        let n = 2;
        while (taken.has(`${name}${n}`)) n++;
        return `${name}${n}`;
    }

    const HAN_RE = /\p{Script=Han}/u;
    // Chinese text in GBK: Han, full-width punctuation and plain ASCII only
    const GBK_TEXT_RE = /^[\p{Script=Han}　-〿＀-￯\x20-\x7e]*$/u;

    /**
     * A ZIP entry's name from its bytes, for an archive that doesn't mark its names as
     * UTF-8 (JSZip's decodeFileName): UTF-8 when the bytes are, else GBK, as Chinese
     * Windows writes them. Short GBK can pass as UTF-8 (小猫 reads as "Сè"), so UTF-8
     * with no Chinese in it gives way to GBK that is all Chinese.
     */
    function decodeZipName(bytes) {
        const data = typeof bytes === 'string' ? Uint8Array.from(bytes, c => c.charCodeAt(0) & 0xff) : new Uint8Array(bytes);
        const gbk = () => new TextDecoder('gbk').decode(data);
        let utf8;
        try {
            utf8 = new TextDecoder('utf-8', { fatal: true }).decode(data);
        } catch {
            return gbk();
        }
        if (HAN_RE.test(utf8) || /^[\x20-\x7e]*$/.test(utf8)) return utf8;
        const other = gbk();
        return HAN_RE.test(other) && GBK_TEXT_RE.test(other) ? other : utf8;
    }

    const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp)$/i;
    // Folders, macOS's resource forks and hidden files aren't the user's files
    const JUNK_RE = /(^|\/)(__MACOSX\/|\.)/;

    /**
     * The stickers an archive holds, from its entries' paths in order: each image
     * file's name without folders or extension, made unique against `taken` (and each
     * other), and its format for the upload. `skipped`: the other files.
     * @returns {{ files: Array<{ path: string, name: string, format: string }>, skipped: number }}
     */
    function zipStickerFiles(paths, taken = new Set()) {
        const names = new Set(taken);
        const files = [];
        let skipped = 0;
        for (const path of paths) {
            if (path.endsWith('/') || JUNK_RE.test(path)) continue;
            const match = path.match(IMAGE_EXT_RE);
            const base = path.split('/').pop().replace(IMAGE_EXT_RE, '').trim();
            if (!match || !base) {
                skipped++;
                continue;
            }
            const name = uniqueName(names, base);
            names.add(name);
            files.push({ path, name, format: match[1].toLowerCase() });
        }
        return { files, skipped };
    }

    /**
     * Imported sets as the library has them: each sticker's image where the upload put it
     * (user/images/…, served from the site's root).
     */
    function importedSets(stored) {
        return (Array.isArray(stored) ? stored : []).map(set => ({
            id: set.id,
            name: set.name,
            stickers: (set.stickers || []).map(sticker => ({
                name: sticker.name,
                path: sticker.path,
                url: /^(\/|[a-z][a-z0-9+.-]*:)/i.test(sticker.path) ? sticker.path : `/${sticker.path}`,
            })),
        }));
    }

    window.EchoTextStickers = {
        presetSets,
        importedSets,
        characterNames,
        findSticker,
        canonicalNames,
        uniqueName,
        decodeZipName,
        zipStickerFiles,
    };
})();
