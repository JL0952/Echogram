(function () {
    'use strict';

    /**
     * EchoText Music Lookup
     *
     * Finds a shared song's cover with the iTunes Search API, straight from the page:
     * it's free, needs no key and answers any origin (Access-Control-Allow-Origin: *),
     * so there's no backend to run (TauriTavern has none for extensions). Hong Kong's
     * store first — the mainland one is empty, Hong Kong's has Chinese, English,
     * Japanese and Korean songs — then the US one when it has no match. iTunes
     * answers loosely (a made-up song still gets some song back), so a result counts
     * only when its title matches, or failing that its artist (matchingSong).
     *
     * The search leaves out whole artists the stores sell (BONES, Lil Mariko), so when
     * neither store's search has the song, the artists named are looked up instead, one
     * after another (each one's id, from an artist search), and the song picked by title
     * among that artist's songs — the 200 a lookup lists, in each store, which for an
     * artist with more may leave it out ("Tonic" is among Lyson's, not BONES').
     *
     * What it finds is kept in the extension settings, by song: the cover (300 px),
     * colours drawn from it (coverColors) and the 30-second preview. A song neither
     * store has is kept as missing and tried again after a week, or at once when the
     * search has changed since (SEARCH_VERSION).
     *
     * The network may be slow or blocked (behind the Great Firewall, say), so every
     * request and every cover image gives up after a few seconds, and a failure isn't
     * kept: that song waits before its next try, longer each time, and after a few
     * failures in a row every song waits. Requests go one at a time, a few seconds
     * apart, to stay inside iTunes' limit of about 20 a minute. Nothing is shown when
     * it fails; the cards keep their placeholders.
     *
     *     const lookup = createMusicLookup({ getCache, saveCache });
     *     lookup.cached(title, artist)   → { cover, color, shade, ink, preview } | null
     *     lookup.request(title, artist)  → Promise<boolean>, whether the song has a cover now
     */

    const SEARCH_URL = 'https://itunes.apple.com/search';
    const LOOKUP_URL = 'https://itunes.apple.com/lookup';
    const STORES = ['hk', 'us'];
    const MISSING_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
    // Raised whenever the search finds more: songs missing by an older one are tried again
    // (2: the artists' own songs)
    const SEARCH_VERSION = 2;
    const FAIL_WAIT_MS = 60 * 1000;
    const FAIL_WAIT_MAX_MS = 30 * 60 * 1000;
    // Failures in a row before every song waits
    const NETWORK_DOWN_AFTER = 3;
    const MAX_SONGS = 200;
    // Artists of one song looked up in turn
    const MAX_ARTISTS = 3;

    const COVER_RE = /^https:\/\/[^\s"'<>]+$/;
    const HEX_RE = /^#[0-9a-f]{6}$/i;

    /**
     * A name as compared: case, width, punctuation and spacing aside, and without the
     * parts stores add ("(Live)", "(feat. …)", "【…】", " - Remastered 2011").
     */
    function simplify(name) {
        return String(name ?? '').normalize('NFKC').toLowerCase()
            .replace(/[(（[【〔][^)）\]】〕]*[)）\]】〕]/g, ' ')
            .replace(/\s[-–—]\s.*$/, '')
            .replace(/[^\p{L}\p{N}]+/gu, '');
    }

    /**
     * Whether two names are the same: equal, one holding the other with little to
     * spare, or — Chinese written in the other script ("起风了" / "起風了") — sharing
     * at least half their characters.
     */
    function sameName(wanted, found) {
        const a = simplify(wanted), b = simplify(found);
        if (!a || !b) return false;
        if (a === b) return true;
        const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
        if (longer.includes(shorter) && shorter.length >= longer.length * 0.6) return true;
        if (!/\p{Script=Han}/u.test(a)) return false;
        const chars = [...a];
        const common = chars.filter(c => b.includes(c)).length;
        return common >= Math.ceil(Math.max(chars.length, [...b].length) / 2);
    }

    /** Among a store's results, the first with the song's title, else the first with its artist; null when none. */
    function matchingSong(results, title, artist) {
        const songs = (Array.isArray(results) ? results : []).filter(r => r?.artworkUrl100);
        return songs.find(r => sameName(title, r.trackName))
            || (artist ? songs.find(r => sameName(artist, r.artistName)) : null)
            || null;
    }

    /** The artists named, at most MAX_ARTISTS ("BONES & Lyson" → BONES, Lyson; "Lil Mariko feat. Zheani" → Lil Mariko, Zheani). */
    function namedArtists(artist) {
        const names = String(artist ?? '').split(/\s*(?:[,，、&＆×]|\s(?:and|x|feat\.?|ft\.?|with)\s)\s*/i)
            .map(name => name.trim()).filter(Boolean);
        return [...new Set(names)].slice(0, MAX_ARTISTS);
    }

    /** The cache key for a song: its title and artist, case and spacing aside. */
    function songKey(title, artist) {
        const clean = s => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
        return `${clean(title)}|${clean(artist)}`;
    }

    const hex = ({ r, g, b }) => '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

    /** WCAG relative luminance of an { r, g, b } colour (0–255 channels), 0–1. */
    function luminance({ r, g, b }) {
        const lin = v => {
            const c = v / 255;
            return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.04045) / 1.055, 2.4);
        };
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    }

    /**
     * The colours a card takes from its cover's colour: `color` itself (a Spotify
     * lyrics card), `ink`, whichever of near-black or white reads better on it, and
     * `shade`, the colour darkened until white text reads on it (a WeChat music card,
     * which keeps mid tones such as #968a7e as they are). Empty when there's no colour.
     */
    function coverColors(rgb) {
        if (!rgb) return {};
        let shade = rgb;
        for (let f = 1; luminance(shade) > 0.28 && f > 0.3; f -= 0.05) {
            shade = { r: rgb.r * f, g: rgb.g * f, b: rgb.b * f };
        }
        // Black text out-contrasts white once luminance passes about 0.18
        return { color: hex(rgb), shade: hex(shade), ink: luminance(rgb) > 0.18 ? '#121212' : '#ffffff' };
    }

    /**
     * A cover's colour, from a small copy of the image: the average with its more
     * colourful pixels counting more, so a muddy average doesn't win. Null when the
     * image doesn't load in time or can't be read.
     */
    function measureCover(url, timeoutMs) {
        return new Promise(resolve => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            const done = value => {
                clearTimeout(timer);
                img.onload = img.onerror = null;
                resolve(value);
            };
            const timer = setTimeout(() => done(null), timeoutMs);
            img.onerror = () => done(null);
            img.onload = () => {
                try {
                    const size = 24;
                    const canvas = document.createElement('canvas');
                    canvas.width = canvas.height = size;
                    const context = canvas.getContext('2d', { willReadFrequently: true });
                    context.drawImage(img, 0, 0, size, size);
                    const { data } = context.getImageData(0, 0, size, size);
                    let r = 0, g = 0, b = 0, total = 0;
                    for (let i = 0; i < data.length; i += 4) {
                        const weight = 0.1 + (Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2])) / 255;
                        r += data[i] * weight;
                        g += data[i + 1] * weight;
                        b += data[i + 2] * weight;
                        total += weight;
                    }
                    done(total ? { r: r / total, g: g / total, b: b / total } : null);
                } catch (e) {
                    // A cover served without CORS taints the canvas
                    done(null);
                }
            };
            img.src = url;
        });
    }

    /**
     * @param {object} api
     * @param {() => object} api.getCache - the stored songs, by songKey (kept in settings)
     * @param {() => void} api.saveCache
     * @param {Function} [api.fetch] - window.fetch
     * @param {(url: string, timeoutMs: number) => Promise<object|null>} [api.measureCover]
     * @param {() => number} [api.now]
     * @param {(ms: number) => Promise<void>} [api.sleep]
     * @param {number} [api.timeoutMs] - a request or cover image gives up after this
     * @param {number} [api.gapMs] - between the starts of two requests
     */
    function createMusicLookup(api) {
        const fetchJson = api.fetch || ((...args) => window.fetch(...args));
        const measure = api.measureCover || measureCover;
        const now = api.now || Date.now;
        const sleep = api.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
        const timeoutMs = api.timeoutMs ?? 8000;
        const gapMs = api.gapMs ?? 3000;

        const pending = new Map();      // songKey → its lookup
        const waits = new Map();        // songKey → { count, until } after failures
        let failuresInARow = 0;
        let networkDownUntil = 0;

        // One request at a time, gapMs apart. The network's failures are counted here,
        // before the next request starts, so songs still queued when it's found down
        // are skipped (SKIPPED) rather than each waiting out a timeout
        const SKIPPED = new Error('network down');
        let queue = Promise.resolve();
        let lastStart = -Infinity;
        function inTurn(task) {
            const run = queue.then(async () => {
                const wait = lastStart + gapMs - now();
                if (wait > 0) await sleep(wait);
                if (now() < networkDownUntil) throw SKIPPED;
                lastStart = now();
                try {
                    const result = await task();
                    failuresInARow = 0;
                    networkDownUntil = 0;
                    return result;
                } catch (e) {
                    failuresInARow++;
                    if (failuresInARow >= NETWORK_DOWN_AFTER) {
                        networkDownUntil = now() + Math.min(FAIL_WAIT_MAX_MS, FAIL_WAIT_MS * 2 ** (failuresInARow - NETWORK_DOWN_AFTER));
                    }
                    throw e;
                }
            });
            queue = run.catch(() => {});
            return run;
        }

        async function getJson(url) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await fetchJson(url, { signal: controller.signal });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return await response.json();
            } finally {
                clearTimeout(timer);
            }
        }

        /** The first store's matching song, or null when no store has one; throws when the network fails. */
        async function search(title, artist) {
            const term = encodeURIComponent([title, artist].filter(Boolean).join(' '));
            for (const country of STORES) {
                const data = await inTurn(() => getJson(`${SEARCH_URL}?term=${term}&entity=song&limit=5&country=${country}`));
                const hit = matchingSong(data?.results, title, artist);
                if (hit) return hit;
            }
            for (const name of namedArtists(artist)) {
                const found = await searchArtist(title, name, artist);
                if (found) return found;
            }
            return null;
        }

        /** The song with this title among the songs of `name` (one of the artists named), or null; throws when the network fails. */
        async function searchArtist(title, name, artist) {
            const term = encodeURIComponent(name);
            let artistId = null;
            for (const country of STORES) {
                const data = await inTurn(() => getJson(`${SEARCH_URL}?term=${term}&entity=musicArtist&limit=5&country=${country}`));
                // The whole name too: "Tyler, The Creator" isn't two artists
                artistId = (data?.results || []).find(r => r?.artistId && (sameName(name, r.artistName) || sameName(artist, r.artistName)))?.artistId;
                if (artistId) break;
            }
            if (!/^\d+$/.test(String(artistId ?? ''))) return null;
            for (const country of STORES) {
                const data = await inTurn(() => getJson(`${LOOKUP_URL}?id=${artistId}&entity=song&limit=200&country=${country}`));
                const hit = matchingSong(data?.results, title, null);
                if (hit) return hit;
            }
            return null;
        }

        function cache() {
            return api.getCache() || {};
        }

        function keep(key, entry) {
            const songs = cache();
            songs[key] = entry;
            const keys = Object.keys(songs);
            if (keys.length > MAX_SONGS) {
                keys.sort((a, b) => (songs[a]?.at || 0) - (songs[b]?.at || 0))
                    .slice(0, keys.length - MAX_SONGS)
                    .forEach(old => delete songs[old]);
            }
            api.saveCache();
        }

        /** A song whose lookup failed waits before its next try, longer each time; one skipped waits with the rest. */
        function failed(key, error) {
            const count = waits.get(key)?.count || 0;
            if (error === SKIPPED) {
                waits.set(key, { count, until: networkDownUntil });
                return;
            }
            waits.set(key, { count: count + 1, until: now() + Math.min(FAIL_WAIT_MAX_MS, FAIL_WAIT_MS * 2 ** count) });
        }

        async function find(title, artist, key) {
            let hit;
            try {
                hit = await search(title, artist);
            } catch (e) {
                failed(key, e);
                return false;
            }
            waits.delete(key);
            const entry = { at: now(), v: SEARCH_VERSION };
            const cover = String(hit?.artworkUrl100 || '').replace(/\/\d+x\d+bb\./, '/300x300bb.');
            if (COVER_RE.test(cover)) {
                entry.cover = cover;
                if (COVER_RE.test(hit.previewUrl || '')) entry.preview = hit.previewUrl;
                Object.assign(entry, coverColors(await measure(cover, timeoutMs).catch(() => null)));
            }
            keep(key, entry);
            return !!entry.cover;
        }

        /** What's known of a song with a cover, checked before it reaches a template; null otherwise. */
        function cached(title, artist) {
            const entry = cache()[songKey(title, artist)];
            if (!entry || !COVER_RE.test(entry.cover || '')) return null;
            const art = { cover: entry.cover };
            for (const name of ['color', 'shade', 'ink']) {
                if (HEX_RE.test(entry[name] || '')) art[name] = entry[name];
            }
            if (COVER_RE.test(entry.preview || '')) art.preview = entry.preview;
            return art;
        }

        /**
         * Looks a song up unless it's known, already on its way, or waiting after a
         * failure. Never rejects.
         */
        function request(title, artist) {
            const key = songKey(title, artist);
            if (!String(title ?? '').trim()) return Promise.resolve(false);
            const entry = cache()[key];
            if (entry?.cover) return Promise.resolve(true);
            if (entry && entry.v === SEARCH_VERSION && now() - (entry.at || 0) < MISSING_RETRY_MS) return Promise.resolve(false);
            if (pending.has(key)) return pending.get(key);
            if (now() < (waits.get(key)?.until || 0) || now() < networkDownUntil) return Promise.resolve(false);
            const lookup = find(title, artist, key).finally(() => pending.delete(key));
            pending.set(key, lookup);
            return lookup;
        }

        return { cached, request };
    }

    window.EchoTextMusicLookup = {
        createMusicLookup,
        songKey,
        coverColors,
        matchingSong,
        namedArtists,
    };
})();
