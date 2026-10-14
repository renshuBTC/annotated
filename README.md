<img src="icons/icon.svg" width="88" alt="Annotated.com logo: a lowercase a on a yellow square">

# Annotated.com

**Website: https://renshubtc.github.io/annotated/** · [Demo video](https://youtu.be/UYfQ-rJFxgE)

**Annotate anything. Ask AI. Global chat.**

A Chrome extension for snipping or recording any part of a web page. Highlight the words that matter, type your take right on the screen, and it lands under your snip with the source link. Save it as a PNG or MP4 ready for X, or share it in a chat that everyone with Annotated.com sees, in Chrome's side panel.

## Made for the Annotated.com bounty

Annotated.com was made for the competition: Jason Calacanis's $5K Chrome extension bounty for Annotated.com, from [This Week in Startups](https://www.youtube.com/watch?v=lsGRHWAp6fw). It will abide by all the terms and conditions set out by the competition.

## Install

1. Download `Annotated.com.zip` from the [website](https://renshubtc.github.io/annotated/) and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the unzipped folder (the one with `manifest.json` in it).
4. Pin the icon so it's one click away.

## How it works

Click the icon (or press **Alt+Shift+S**). The bar appears at the top of the page and the chat opens beside it.

1. Press 📷 for a picture or 🎥 for a video, then drag a box (▭) or click a post, image or video on the page (▤).
2. Drag across the words that matter to highlight them.
3. Type your take and press **Enter**. It drops in under your snip, with the source link.
4. Save it, copy it, or send it to the chat.

## The bar

| Button | What it does |
| --- | --- |
| 📷 Screenshot | Make a picture. |
| 🎥 Screen recording | Make a video. |
| ▭ Select an area | Drag a box around what you want. |
| ▤ Select a post, image or video | Click the thing you want, and the box fits it. |
| ● Record | Start recording your area, after a 2-second countdown. A recording stops by itself at 90 seconds. |
| ❚❚ Pause | Pause the recording. Press again to carry on. |
| ■ Stop | Stop the recording (**Esc** does too). |
| 0:00 | How long the recording is. |
| 🖍 Highlighter | Choose the highlighter's colour. |
| ↶ Undo | Remove your last highlight. |
| ⤓ Save | Save it as a PNG or MP4, ready to post on X. |
| ⧉ Copy | Copy it, to paste into a post or the chat. |
| **a** Send to the chat | Post it in the chat straight away. It flies off the page into the chat. |
| ✕ Close | Close the bar and the chat (**Esc** does too). With a video you haven't saved yet, press it twice. |

## The chat

One chat for everyone with Annotated.com, in Chrome's side panel. Annotations (pictures and videos made with Annotated.com, with their source link) go to everyone, and everything else is a reply to one.

- Click an annotation to reply to it. Clicking its picture also opens it full size, so you can read it while you write; click it again to close it.
- Right-click a post to **Reply** or **Like** it, **Go to source link**, or **Download** or **Copy** it.
- **Ask AI** fact-checks an annotation with Chrome's built-in AI, on your computer.
- **File a claim** if a post uses your work beyond fair use. It goes privately to the people who run the chat.
- You get a random name. Click **Posting as …** under the chat box to change it.

## Privacy

Snipping and saving happen on your computer. Only what you post in the chat is uploaded, and posts in the chat are public. The extension only works on a tab after you click its icon there, and asks for no access to your browsing history.

The chat runs on [Supabase](https://supabase.com). To run it on your own project, run `supabase/setup.sql` in its SQL Editor, turn on anonymous sign-ins, and put the project's URL and publishable key in `chat-config.js`.

## License

[MIT](LICENSE). The Newsreader font in `fonts/` is under the SIL Open Font License (`fonts/OFL.txt`), and the files in `vendor/` keep their own licenses (next to each file).
