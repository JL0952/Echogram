/**
 * EchoText — where the message list is scrolled, kept in one place.
 *
 * Whatever changes the list's height (the keyboard, the sticker or "+" panel, a reply
 * waiting above the input, the input growing, the selection bar) or its content (a
 * message coming, deleted, an image loading), the list is put back where the reader
 * had it, the way a messaging app does:
 *   - at its end: it stays at its end (a message coming in glides there);
 *   - scrolled up, the list's height changing: the same distance from the end, so
 *     what's just above the input bar moves up and down with it;
 *   - scrolled up, the content changing: the scroll position stays.
 * One ResizeObserver on the list and its content does it, after layout and before
 * paint, so a bar animating its height is followed frame by frame and nothing flashes.
 *
 * Where the reader is comes only from their own scrolling and the calls below: the
 * list's own corrections never move it. Nothing else writes the list's scrollTop.
 * @module EchoTextChatScroll
 */
(function () {
    'use strict';

    // Within this of the end counts as at the end
    const AT_END_PX = 4;
    // A glide no scroll event says has ended is taken as over after this
    const GLIDE_MAX_MS = 900;
    const MOVE_MS = 280;

    /**
     * Takes over `list`'s scrolling (once per list element).
     * @param {HTMLElement} list the scrolling element
     * @param {HTMLElement} content its content (the element that grows with messages)
     * @param {{ followGrowth?: () => boolean }} [options] whether content growing at the
     *   end takes the list along (off: the list stays where it is)
     */
    function attach(list, content, options = {}) {
        if (list._etChatScroll) return list._etChatScroll;
        const followGrowth = options.followGrowth || (() => true);

        let atEnd = true;
        let fromEnd = 0;
        let height = list.clientHeight;
        let scrollHeight = list.scrollHeight;
        // The scrollTop last put: its scroll event isn't the reader's
        let put = null;
        // A smooth scroll of ours under way: { top, timer }
        let glide = null;
        // An element kept where it is on screen for a moment: { el, top, until }
        let pin = null;

        const maxTop = () => Math.max(0, list.scrollHeight - list.clientHeight);
        const distance = () => Math.max(0, list.scrollHeight - list.clientHeight - list.scrollTop);

        function read() {
            const d = distance();
            atEnd = d <= AT_END_PX;
            fromEnd = atEnd ? 0 : d;
        }

        function stopGlide() {
            if (!glide) return;
            clearTimeout(glide.timer);
            glide = null;
        }

        function jump(top) {
            stopGlide();
            const target = Math.round(Math.max(0, Math.min(maxTop(), top)));
            if (Math.abs(list.scrollTop - target) >= 1) list.scrollTop = target;
            put = list.scrollTop;
        }

        function glideTo(top) {
            const target = Math.round(Math.max(0, Math.min(maxTop(), top)));
            if (Math.abs(list.scrollTop - target) < 1) { jump(target); return; }
            stopGlide();
            put = null;
            glide = { top: target, timer: setTimeout(endGlide, GLIDE_MAX_MS) };
            list.scrollTo({ top: target, behavior: 'smooth' });
        }

        function endGlide() {
            if (!glide) return;
            stopGlide();
            put = list.scrollTop;
            read();
        }

        // After every layout that changed the list's or its content's size (`instant`: no glide)
        function sync(instant = false) {
            const h = list.clientHeight;
            const sh = list.scrollHeight;
            const resized = Math.abs(h - height) >= 1;
            const grew = sh - scrollHeight >= 1;
            height = h;
            scrollHeight = sh;

            if (pin && performance.now() < pin.until && pin.el.isConnected) {
                const drift = pin.el.getBoundingClientRect().top - pin.top;
                if (Math.abs(drift) >= 0.5) jump(list.scrollTop + drift);
                if (!glide) read();
                return;
            }
            pin = null;

            if (atEnd) {
                // A bar moving or the content shrinking: at once; a message coming: a glide
                if (resized || !(grew || glide)) jump(maxTop());
                else if (glide || followGrowth()) {
                    if (instant) jump(maxTop());
                    else glideTo(maxTop());
                }
            } else if (resized) {
                jump(sh - h - fromEnd);
            }
            if (!glide) read();
        }

        function onScroll() {
            if (glide) {
                if (Math.abs(list.scrollTop - Math.min(glide.top, maxTop())) < 1) endGlide();
                return;
            }
            if (put !== null && Math.abs(list.scrollTop - put) < 1) return;
            put = null;
            read();
        }

        // The reader taking over a glide of ours
        function onInput() {
            if (!glide) return;
            stopGlide();
            put = null;
        }

        const observer = new ResizeObserver(sync);
        observer.observe(list);
        observer.observe(content);
        list.addEventListener('scroll', onScroll, { passive: true });
        list.addEventListener('scrollend', endGlide);
        for (const type of ['wheel', 'touchstart', 'keydown']) list.addEventListener(type, onInput, { passive: true });
        read();

        const api = {
            /** Whether the list is at its end. */
            get atEnd() { return atEnd; },
            /** To the end (and following it from there); `smooth` glides there. */
            toEnd({ smooth = false } = {}) {
                atEnd = true;
                fromEnd = 0;
                if (smooth) glideTo(maxTop());
                else jump(maxTop());
            },
            /** By `dy` px (down is positive); `smooth` glides there. */
            by(dy, { smooth = false } = {}) {
                if (!dy) return;
                const top = (glide ? glide.top : list.scrollTop) + dy;
                if (smooth) glideTo(top);
                else { jump(top); read(); }
            },
            /** To `top` px from the top, at once. */
            to(top) {
                jump(top);
                read();
            },
            /**
             * For `ms`, keeps `el` at `top` (its top on screen, px) while what's above it
             * changes, instead of the usual rules.
             */
            keep(el, top, ms = 360) {
                if (!el) return;
                pin = { el, top, until: performance.now() + ms };
                sync();
            },
            /**
             * Runs `change()` (a redraw taking `gone`, elements of the content's, away), puts
             * the list where it belongs at once, then slides everything that stayed from where
             * it was on screen to where it is now: at the end, what's above comes down; scrolled
             * up, what's below comes up. Nothing jumps, and nothing moves twice.
             */
            move(gone, change, ms = MOVE_MS) {
                const goneSet = new Set(gone);
                // Where an element is laid out on screen, relative to the list (transforms aside)
                const top = (el) => {
                    let y = 0;
                    for (let node = el; node && node !== list; node = node.offsetParent) y += node.offsetTop;
                    return y - list.scrollTop;
                };
                const before = [...content.children].filter(el => !goneSet.has(el)).map(el => [top(el), el.offsetHeight]);
                change();
                sync(true);
                const after = [...content.children];
                const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
                // Something else came or went as well: no telling what was where
                if (reduce || after.length !== before.length) return;
                const view = list.clientHeight;
                const shown = (y, h) => y + h > -view && y < 2 * view;
                after.forEach((el, i) => {
                    const [was, wasHeight] = before[i];
                    const now = top(el);
                    const dy = was - now;
                    if (Math.abs(dy) < 1 || !(shown(was, wasHeight) || shown(now, el.offsetHeight))) return;
                    el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }],
                        { duration: ms, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', composite: 'add' });
                });
            },
            detach() {
                observer.disconnect();
                stopGlide();
                list.removeEventListener('scroll', onScroll);
                list.removeEventListener('scrollend', endGlide);
                for (const type of ['wheel', 'touchstart', 'keydown']) list.removeEventListener(type, onInput);
                delete list._etChatScroll;
            },
        };
        list._etChatScroll = api;
        return api;
    }

    window.EchoTextChatScroll = { attach };
})();
