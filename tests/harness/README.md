# Harness

Browser pages that run EchoText's real message-list code (extracted from
`index.js` by `gen.cjs`) on mock chats (`scenarios.js`), with SillyTavern
stubbed out. They compare the working tree against a git ref (HEAD by default)
and exercise what the Node tests in `tests/*.test.mjs` can't: rendering, clicks,
in-place updates, scrolling and the platform chrome.

## Run

```sh
sh tests/harness/build.sh          # or: sh tests/harness/build.sh <ref>
python3 tests/harness/serve.py     # serves the repo on http://127.0.0.1:8765, caching off
```

Rebuild after changing `index.js` (pages load the repo's own `lib/`, `platforms/`
and `style.css` directly). `build/` is generated and git-ignored; jQuery,
DOMPurify and Font Awesome are copied from SillyTavern.

| Page | What it checks | Result |
|---|---|---|
| `index.html` | Every scenario rendered by the ref and the working tree: same HTML and, per element, the same click → call (or, when the markup changed on purpose, the same set of calls). Then `refreshMessages`, in-place `renderMessages`, touch swipe, voice messages, inline edit, the platform picker, for EchoText and WeChat. `?preview` shows only WeChat, light and dark; `?report` posts the summary to the server (for a phone or simulator), with what differs in each differing scenario (HTML or click actions; `&full` lists every differing action). | On the page; `window.__results` (scenarios), `window.__refresh` (tests), `window.__done` |
| `chrome.html` | The panel header and input bar in each state (empty, draft, typing, generating, composing, menu open). `?platform=`, `?schemes=light,dark`, `?only=<state>` | Screenshots |
| `panel.html` | The "+" panel: `runPanelTest()` (opens, closes on "+" / tile / list / input, platform switch, "+" and 发送 never both shown) and `runAnchorTest()` (the list follows the panel, with and without the height transition). `runRevealTest()`: on touch screens a bubble's "⋯" shows only after the bubble is tapped (run with the Browser pane's mobile preset). `runAvatarTest()`: the character avatar menu, changing (crop, 512 px, upload) and going back to the card's (stubbed crop dialog and image endpoints). `runShareTypeTest()`: the file-type chip in file mode and its menu. `?report=runPanelTest,runAnchorTest` runs those on load and posts their results to the server | Returned objects |
| `emotion.html` | The emotion popup and status chip (`lib/emotion-system.js`) on the real panel: `runEmotionTest()` (old emotion data replaced, sliders, Rapport below 0, buttons that redraw it don't close it, locks kept through a cleared chat, unlocking, Reset, the Desire row, Morality, Off, Big Five levels, texting style and its prompt, opens centred on the panel, beside it on a computer so the header drags it out of the panel but not off the window, only its × closes it). `runAutoTest()`: Auto mode through `index.js`'s real `generateEchoText` / `generateEchoTextSwipe` with the model stubbed (the `<mood>` line neither shown nor kept, values, status chip and chips under the header update, the popup shows what changed beside the values for a few seconds (when a reply arrives and when it opens) and keeps Manual's layout, the next report capped, no `<mood>` in what the model is sent, a swipe or a deleted reply takes its report back, a slider starts over from there, locks, back to Manual). `?tab=emotions\|personality` shows it filled in for a screenshot (`&auto`: Auto mode, the last reply's changes beside the values for a few seconds; `?auto` alone: a reply arriving with the popup closed, the chips under the header); `?platform=`, `?scheme=`, `?width=`, `?desire` (shows Desire and Morality); `?report` runs both tests and posts their results | Returned object |
| `scroll.html` | `runScroll('echotext' \| 'wechat')`: sending, a reply and a full render never scroll the list up | Returned string |
| `mobile.html` | The panel as a phone shows it (in `#et-portal` on `<html>`, `mobile-style.css`, a pinned body), for the iOS Simulator or a phone. "⋯" edits the message straight away; sending adds a message and a three-bubble reply, the input keeping focus. `?demo=share` ends the chat with files and links from both sides. `?old` runs the committed `index.js` instead (`bundle-chrome-old.js`, built from the ref), `?keepfocus` keeps the keyboard up through a "+" tap, `?platform=` / `?scheme=` as elsewhere. | Posted to the server, which prints them: every click (where it landed against the element it hit), viewport changes, and per frame of each "+" panel open / close, the gap between the last message and the input bar |

On the iOS Simulator (Xcode): the on-screen keyboard needs `defaults write com.apple.iphonesimulator ConnectHardwareKeyboard -bool false` before booting (`defaults delete …` puts it back); open the page with `xcrun simctl openurl booted http://127.0.0.1:8765/tests/harness/mobile.html`. What JS measures is the page's own layout; to see what is actually drawn, record the screen (`xcrun simctl io booted recordVideo`) and look at its frames.

Animation-frame tests need the page visible (a hidden tab doesn't run frames).
Focus events don't fire in a window without focus, so "input focus closes the
panel" shows as failing there; dispatch a `focus` event to check it.

## Node scripts

```sh
node --test tests/*.test.mjs                 # view model, features, story texts, proactive prompts, emotion model, texting behavior
node tests/harness/undeclared.cjs [ref]      # names index.js uses but never declares, vs ref
node tests/harness/context-compare.cjs [ref] # what the model is sent, vs ref; then on WeChat
node tests/harness/prompt-compare.cjs [ref] [--print=<case>]  # the system prompt for mock cards and settings, vs ref
node tests/harness/prompt-print.cjs <character> [--values=romance=80,…] [--big5=A=low,…] [--tail]  # the system prompt for one of your real characters, with your settings (read only)
```
