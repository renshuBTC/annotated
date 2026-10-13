<img src="icons/icon.svg" width="88" alt="Annotated.com logo: a lowercase a on a yellow square">

# Annotated.com

A Chrome extension for snipping or recording any part of a web page, with one big addition: you type your annotation right on the screen, and it lands under your snip with the source link and the Annotated.com logo. You can also highlight the words that matter in your snip, like with a highlighter pen. Saves a PNG or MP4 that is ready to post on X, and has a global chat in Chrome's side panel where everyone with Annotated.com shares their annotations.

Snipping and saving happen on your computer. Only what you post in the chat is uploaded.

## Install

1. Right-click `Annotated.com.zip`, choose **Extract All**, and keep the suggested folder name (for example `Desktop\Annotated.com`). The files sit directly in that folder, next to `manifest.json`. To update, extract a new zip into the same folder, replace the files, and press the reload arrow on Annotated.com in `chrome://extensions`.
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the unzipped folder (the one that has `manifest.json` in it).
4. Pin the icon (puzzle piece → pin) so it's one click away.

The extension has a fixed identity (the `key` in `manifest.json`), so renaming or moving its folder keeps your chat name and sign-in. If you publish it to the Chrome Web Store, you can swap in the key the store's dashboard shows (Package → View public key) so your local copy and the store's match ([Chrome docs](https://developer.chrome.com/docs/extensions/reference/manifest/key)).

## Snip a picture

1. Click the icon (or press **Alt+Shift+S**, the icon's shortcut). The bar comes up at the top of the page and the chat opens in Chrome's side panel. Press **📷 Screenshot**: the page freezes and the screen goes dark. To close the bar and the chat, click the icon again, press ✕, or press **Esc**.
2. Pick the area:
   - **Drag a box** around anything (▭ Select an area).
   - **Click** a post, image or video to grab just that (▤ Select a post, image or video).
   - **Whole screen:** drag from corner to corner, or pull the edges of your area out to the screen's edges (within a few pixels of an edge, it goes all the way).
   - Your area can go anywhere, even under the bar or the typing line (they stay in front). **Pull its edges or corners** to change it, or drag on the dark area to pick again.
3. Type your annotation. It appears in **big white text at the bottom of the screen** (the line says "Annotate anything…" until you type).
4. Press **Enter**. Your text drops into the box under the snip, with the **source link** on the left (just the link, no "Source:") and the **Annotated.com logo and name** on the right of the row under your text. Nothing is copied until you ask (step 6).
   - **Shift+Enter** starts a new line. Click your text in the box to change it.
5. **Highlight** what matters (if you like): in the box, press at the start of some text and drag, like selecting it. It turns highlighter yellow, line by line. It only marks text: a drag that doesn't start on a letter marks nothing. Click a highlight to take it away, or press ↶ (right of the marker) or **Ctrl+Z** for the last one. For another colour, press the marker in the bar (see [Highlighting](#highlighting)); it works once you've pressed 📷, 🎥, ▭ or ▤.
6. Press **Enter** again (or ⤓ Save) to save it, or press the **Annotated.com logo** (right of ⧉) to post it in the chat straight away. To copy it, press ⧉ Copy or **Ctrl+C**, then paste it into a post or the chat with **Ctrl+V**. Right-clicking the box gives you all three: **Save image**, **Copy image** and **Send to the chat** (↑ ↓ and Enter work there too). **Ctrl+Enter** drops your text and saves in one go. Once it's saved, copied or sent, the dark screen goes, the bar stays on the page with the chat open beside it, and you can scroll on down the page to the next part.

### The bar on the page

- The icon opens **just the bar**, on the page as it is, with the chat beside it: nothing is chosen and the page works as usual (only the bar takes clicks). **📷 or 🎥** (or ▭, ▤) takes a picture of the page and brings the dark screen. **Press the chosen one again** and the dark screen goes away; the bar and the chat stay.
- **Drag the bar anywhere:** press and hold anywhere on it, even on a button, and move. It stays there until you close it; double-click its empty space to put it back at the top.
- On the page as it is, the bar is frosted white instead of clear glass, since there's no frozen picture behind it to bend.
- **Scrollbars:** while Annotated.com is open, the page's scrollbar is thin and out of sight. It shows while you scroll (or point at it) and fades a second later. The chat's scrollbars do the same. Closing Annotated.com gives the page its own scrollbar back.

### The font

Everything is in **Newsreader**, an open-source serif (SIL Open Font License, `fonts/OFL.txt`): the bar's labels, the typing line, the caption in the box and in the saved pictures and videos, the chat, and the logo's "a" (Newsreader SemiBold, its display cut). It comes with the extension, so it looks the same on every computer. Its optical sizes follow the text size: small labels get the sturdier small-size design, big captions the finer display one.

### The caption

Always **under your snip**, **white with black text**, with a **thin black line** between your snip and the caption, so a white snip and the caption still read as two parts. The source link is black too. The credit is the **Annotated.com logo** (its "a" on the highlighter-yellow square) followed by "Annotated.com" on the same line, with no "By". The logo's base sits exactly on the name's baseline, one straight line under both, and it's sized so its "a" is as tall as the "a"s in the name. Any margins added to fit X's shapes are white.

### Highlighting

Drag across text in your snip to highlight it (step 5 above). Only text is marked, just the letters' lines, never the space around them: a drag has to start on a letter, and it finds the letters even under a see-through layer some sites lay over their text (anything that isn't text, like a picture or a blank space, marks nothing). The marker in the bar (between the recording time and ⤓) picks the colour, once you've pressed 📷, 🎥, ▭ or ▤ (with just the bar on the page it's dimmed). It opens **nine colours as one block of small squares, 3 × 3**, touching, with no shadow and nothing else. Click one, or use the arrow keys and Enter; a click anywhere else only closes it. The line under the marker shows the colour in use.

- The nine, in three rows around the colour wheel: orange, **yellow** (the default, #FFE24D, in the middle of the top row), red; pink, purple, blue; turquoise, green, grey. All are light enough that black text on them stays easy to read.
- The colour you pick is kept for next time. It draws your next highlights; ones already there keep their colour, so a snip can have several.
- Highlights are inked in like a real highlighter (multiplied), so white paper turns exactly that colour and black letters stay black and crisp. On a dark picture (a dark-mode post, say), where ink wouldn't show, a brighter version of the colour is laid over, see-through.
- All your highlights are one layer of colour: highlighting the same words twice (or overlapping ones) doesn't make them darker. Where two colours overlap, the later one shows.
- They go into everything you save, copy or send. On a video, a highlight stays in place for the whole clip.

### X's 280-character limit

Your text is limited like a normal post on X: **280 characters, counted the way X counts them**. Links count as 23, emoji as 2, and Chinese, Japanese and Korean characters as 2. A ring just left of your text fills up as you type, shows how many are left from 20, and past 280 shows how many to cut, with the extra characters highlighted. Enter, Save and Copy wait until you trim it. Links are found with the same patterns as X's own `twitter-text` library.

## Record a video

1. Press 🎥 Screen recording in the bar (or start with **Alt+Shift+V**, which goes straight to the dark screen without opening the chat). With 📷 chosen you always get a picture, even of a playing video.
2. Pick the area (pull its edges or corners to change it), then press ● Start recording. After a 2-second countdown (2, 1) a solid white frame shows what is being recorded, and ● stays pressed (black) while it records.
3. Type while it records. Press **Enter** to drop your text under the video.
   - **Pause** with ❚❚ (between ● and ■) or the **Space bar**: nothing is recorded until you press it again, so you can scroll or move on to the next part in between. The time stands still, ❚❚ stays pressed and the white frame goes dashed while it's paused. The video simply carries on from where it stopped; the pause isn't in it and doesn't count towards its length. (While you're writing your text, Space types a space; press Enter first, or use ❚❚.)
4. Press ■ Stop recording (or Alt+Shift+V). The clip plays back in the box, and you can keep typing or editing your text after it has stopped. You can highlight in it too: drag across text in the box, as with a picture (a highlight stays in place for the whole clip).
5. Press **Enter** (or ⤓ Save) to save. ⤓ fills up as a ring while the MP4 is made. To post it in the chat, press the **Annotated.com logo**: the MP4 is made (sized to fit the chat's 50 MB) and posted. Or copy it (⧉, **Ctrl+C**, or right-click the box → **Copy video**; the same menu has **Save video** and **Send to the chat**) and paste it into the chat with **Ctrl+V**; a copied video only pastes into the chat, because the clipboard has no standard place for a video. For X, save it. To record a new take of the same area, press ● twice.

Your area can reach under the bar or the typing line: they stay in front, so whatever is in front of the area (the bar, your text as you type it) is in the video too. Pull the edge in if you don't want it there. While recording, the page stays live: you can click play, pause or scroll inside the frame, and your typing still goes to your text afterwards (so keys like `k` or `f` don't trigger the page's own shortcuts). Chrome mutes a tab while it is captured, so Annotated.com plays the tab's sound back to you (from a hidden extension page, so it isn't recorded twice).

## The chat (side panel)

One room for everyone with Annotated.com, in Chrome's side panel, laid out as **threads**, one post below another: each annotation, followed by the replies to it (no indents or lines: the order says what answers what). Everyone with the chat open sees new posts and replies right away. The newest posts are at the bottom, by the box; scroll up for older ones. The box and the row under it (+, 🔍, your name, who's online) stay at the bottom.

**Nobody messages everyone.** What goes to everyone is an annotation: a picture or video made with Annotated.com, with its source link. Everything else is a reply to an annotation: right-click it → **Reply**, and the box opens for your reply, which goes right under it. Only annotations can be replied to (a reply can't be). Until you pick one, the box is closed and says "Right-click an annotation to reply". The database holds everyone to the same rules.

- **Post what you made:** press the **Annotated.com logo** on the bar (right of ⧉). Your picture or video goes into the chat straight away, as you, with its source link; the logo turns while it uploads. Anything you're writing in the chat's box stays as it is.
- **Annotations take the whole post:** a picture or video made with Annotated.com fills the post edge to edge. Who posted it, when, and how many have seen it sit on a small white label at the picture's top left: their face, then their name ("you" on yours) over the date, time and views. Any words they added go under it.
- **Date, time and views:** every post's name line ends with when it was posted and how many people have seen it, for example "Oct 13, 2026 · 5:04 AM · **212** Views". A post counts as seen once it has been on screen in someone's chat; each person counts once (the poster too), and the number goes up live. Every post has its own name line, so each one shows its own.
- **Or paste it:** copy it (⧉, Ctrl+C or right-click the box copies a picture or a video), click into the chat and paste it with **Ctrl+V**. Add some words if you like, then press **Enter** (or the ↑ button). **Shift+Enter** starts a new line. A thin bar shows the upload. A picture or video from anywhere else (without a source link) can go in a reply, not to everyone.
- **Up to 280 characters**, counted the way X counts them, the same as the typing line on the page (a link counts as 23, an emoji or a Chinese, Japanese or Korean character as 2). The last 20 count down at the right of the row under the box; past 280 it shows in red how many to cut, and ↑ waits.
- **Post a file:** drag a PNG or MP4 onto the chat, or press **+** under the box and pick it. Pictures (PNG, JPEG, WebP, GIF) and videos (MP4, WebM) up to 50 MB. A snip saved with Annotated.com carries its source link, so it goes to everyone as an annotation; any other file goes with a reply.
- **Click anywhere** in the chat (not on a link, a button or a picture) while you're replying, and the cursor is in the box, ready to type. Typing while you look at the chat goes there too. Clicking a picture opens it full size.
- **Right-click a post**:
  1. **Reply** (on annotations only). Above the box: just the caption of the annotation you're answering (cut from its picture or video); the annotation is outlined in light blue (**Esc** or the ✕ cancels). Your reply goes right under it. No quotes or thumbnails in the thread: where a reply sits says what it answers. A reply whose annotation isn't on screen (deleted, or further back than what's loaded) stands on its own with a small "Reply to …" line; click it to go to that post.
  2. **Delete.** Your own posts only: press it, then press again. Nobody can delete or edit anyone else's posts.
  3. **Like** (or **Unlike**). A 👍 shows under the post with who liked it: one rounded pill with 👍 and up to three round faces (then a number), all centred on one line. Others' likes are light blue; yours is solid blue. Clicking the 👍 likes or unlikes it too.
  4. **Download.** On a picture or video: saves it as it was posted, named like a saved snip ("Annotated.com꞉ " with the first words of the post, or who posted it, and when).
  5. **Copy image**, **Copy video** or **Copy text.** A picture goes on the clipboard ready to paste anywhere; a video (MP4) the way ⧉ copies one, for pasting into the chat; a post with neither, its words. A copied annotation keeps its source link when you paste it back into the chat.
  6. **Go to source link.** Opens where it's from in a new tab. Only on pictures and videos made with Annotated.com: a copied one carries its source along, and a saved picture has it written into the file. Pictures from anywhere else don't have it.
  7. **File a claim.** On someone else's post, for whoever's work it uses beyond fair use: a short form asks what's theirs, why it isn't fair use, and how to reach them. The claim goes privately to the people who run this chat (the `claims` table in its Supabase project, Table Editor → claims), not to the poster, with a copy of the post in case it's deleted. One claim per person per post.

  When it was posted is on the post itself. From the keyboard, press the menu key or **Shift+F10** on a post, then the arrow keys. For Chrome's own menu (to copy text, say), select the text first or hold **Shift** while you right-click.
- **Search:** 🔍, under the box right of **+**, turns the box into a search box for the whole chat (🔍 is yellow while it's on): the text of posts, names, @handles and source links. What matches fills the chat as you type, with your words marked; click one to go to it in the chat. **Esc** (or 🔍 again) brings the chat and your message back.
- **Your name:** you get a random one (like "Swift Heron"). Click **Posting as …** under the box to change it. On the right of that row: how many people have the chat open.

Behind it is a [Supabase](https://supabase.com) project (open source): Postgres tables for the posts, the likes and who has seen which post, a public storage bucket for the pictures and videos, and live updates. Each Chrome profile signs in anonymously the first time the chat opens; that sign-in is kept in the extension's storage. The rules (`supabase/setup.sql`) let anyone read; let you post, reply and like only as yourself (one like per post) and upload only into your own folder; let you delete only your own posts, likes and files; and allow at most 10 posts and 60 likes a minute (deleting doesn't give you more) and 40 uploads an hour. Who a reply answers is filled in by the database, not by the app, so nobody can put words in someone else's mouth. Views are counted by the database too: the chat only says which posts you've had on screen, you count once on each, and nobody can read who saw what or set a count. Posts and files are public: anyone with the extension can see them.

**The chat and the bar come and go together:**

- The icon (or **Alt+Shift+S**) opens both; again, it closes both.
- Chrome's own side panel button (◫) and the chat's **×** do the same: opening the chat brings the bar to the page, closing it takes the bar away.
- The bar's **✕** closes both, and so does **Esc**, on the bar or in the chat (in the chat, Esc first cancels a reply, a search or the right-click menu if one is open). There's no "press again": it closes at once. With just the bar on the page, the page has the keyboard (its arrows and shortcuts work); Esc there closes both unless the page uses it itself.
- Closing the chat while a video is recording or being made leaves the bar, so nothing is lost; close it yourself when it's done.
- Right-click the "a" icon and choose **Open the chat**, or press **Alt+Shift+L** (Chrome keeps Alt+Shift+A for itself): both come up too.

Chrome only lets Annotated.com onto a page once you've pressed its icon there. If the chat opens by itself (with Chrome's side panel button) on a page where you haven't, the chat says to press the icon to bring the bar.

The look is light and quiet: a near-white page, hairline borders and warm greys, 14 px text and 12 px labels, in Newsreader like everything else. The box you write in is one 48 px line (at 100% display scaling) with ↑ inside it on the right, growing as you write. **+**, 🔍, your name and who's online sit under it. There's no title inside the panel, since Chrome's own panel header already says Annotated.com.

### Your own Supabase project

To run the chat on your own project: create a free project at supabase.com, turn on **Allow anonymous sign-ins** (Authentication → Sign In / Providers), run `supabase/setup.sql` in the SQL Editor (run it again after updating Annotated.com: it's safe to run again and adds what's new, like the views), and put the project URL and publishable key (Settings → API Keys) in `chat-config.js`. The publishable key is meant to be public; the rules in `setup.sql` are what protect the data. Never put the secret key in the extension.

## The bar

One bar of light glass sits at the top centre (drag it anywhere), with close on the right. It is the same from start to finish, and **every button does one thing, always in the same place**. Buttons you can't use yet are dimmed. Hover any button to see its name and shortcut.

**📷 🎥 · ▭ ▤ | ● ❚❚ ■ 0:00 | 🖍 ↶ | ⤓ ⧉ a | ✕**

The Annotated.com logo (**a**) sits with ⤓ and ⧉ because the three do the same kind of job: take what you made somewhere (your computer, the clipboard, the chat). It's last of the three, next to ✕, on the side of the bar nearest the chat. The marker (🖍) has a place of its own just before them: marking up your snip comes after making it and before sending it off.

| | Button | Does |
| --- | --- | --- |
| 📷 | Screenshot | Make a picture. After picking an area: a picture of that area instead of a video. |
| 🎥 | Screen recording | Make a video. After picking an area: a video of that area instead of a picture. |
| ▭ | Select an area | Drag a box. After picking: drag a new box (your text stays). |
| ▤ | Select a post, image or video | Click the thing you want. After picking: pick another one. |
| | | The bar opens with nothing chosen and no dark screen: pressing any of 📷, 🎥, ▭ or ▤ brings the dark screen. On the dark screen, pressing the chosen one again takes it away (the bar and the chat stay). |
| ● | Start recording | Records the chosen area after a 2-second countdown, and stays pressed while it records. After a take, press it twice to record a new one. |
| ❚❚ | Pause recording | While recording: pauses it (stays pressed); press again, or Space, to go on. The pause isn't in the video. |
| ■ | Stop recording | Stops the recording (or the countdown before it). |
| 0:00 | Time | How long the recording is. |
| 🖍 | Highlighter colour | Opens the highlighter's nine colours, one block of small squares 3 × 3. The line under the marker shows the colour in use (yellow until you pick another; your pick is kept). Works once you've pressed 📷, 🎥, ▭ or ▤; dimmed with just the bar on the page, and while recording. |
| ↶ | Undo highlight | Takes away your last highlight, in case you marked the wrong thing (Ctrl+Z does the same). Dimmed when there's none. |
| ⤓ | Save | Saves the PNG or MP4. While a video is being made it fills up as a ring, then shows a check mark. |
| ⧉ | Copy | Copies the picture with your text, ready to paste into a post or the chat (so do Ctrl+C and right-clicking the box; nothing is copied by itself). For a video, makes the MP4 and copies it for the chat. |
| a | Send to the chat | Posts the picture or the video in the chat straight away, as you (the chat opens if it's closed). Turns while it uploads; then the dark screen goes and the bar stays. |
| ✕ | Close | Closes the bar and the chat, at once (Esc does the same). |

- **Black and white only, plus glass.** The bar is white glass with black symbols. (The only colours are the highlighter's, under the marker and in its squares, and the logo's yellow.) **Pressed or chosen is always the same bubble of black glass with a white symbol**: the choices you've made (📷 or 🎥, and how you pick), a button while you press it, ● while it records, ❚❚ while it's paused, the marker while its colours are open, ⤓ while it saves, and the logo while it sends. The selection and recording frames, the typing line and the character ring are white.
- **Hover** makes a button spring up and grow a little.
- **Size.** The bar is **48 pixels tall at 100% display scaling**, with 32 px buttons. It's measured in screen pixels, so zooming a page in or out doesn't change it. It only gets smaller if the window is too narrow to fit it.

Everything else is direct: drag a box to pick an area, or click a post, image or video to pick just that. Drag on the dark area to pick again. Type to caption, and click your caption to change it.

### The glass

- **Used sparingly.** Only the bar, the little bubbles, the right-click menus (on the box and in the chat) and the chat's "New posts" button are glass. The snip, the caption and the posts are not.
- **Icons, not words,** on the bar. Every icon has a name for screen readers and a tooltip.
- **Clear and light.** The page stays visible through the bar, only lightly softened (0.8 px) and lifted towards white along a curve (0.55 + 0.45 × √brightness): black text behind shows as mid grey, the dimmed page as light grey with its detail kept, so the dark symbols read over anything. A thin milky veil sits behind the symbols; the menus are frostier, so their words read over anything.
- **Refraction at the rim.** The rim is a convex curve (height = ⁴√(1 − (1 − x)⁴)) traced with Snell's law (index 1.5), so what's behind bends hard right at the edge and not at all in the flat middle, with a rim light that's strongest where the edge faces the top left. Glass appears by ramping up the bending, not just by fading in.
- **Your accessibility settings count:** Reduce Transparency makes the glass frostier, Increase Contrast makes it solid white with a black border, and Reduce Motion turns off the springs and bounces.

## The source link

- On X, a snip of a post in your timeline links to that post (`x.com/user/status/…`), not to the timeline.
- On YouTube, the link includes the time (`&t=…s`): where the still was taken, or where the recording started.
- Elsewhere it's the page address, with tracking tags (`utm_…`, `fbclid`, `gclid`, …) removed. Since the link ends up in a public picture and the chat, anything that could be a secret goes too: logins, any parameter named like a token, key, code, password or session, values that look like keys, and whatever follows `#` (except a link to a spot on the page or a highlighted quote). A file on your computer has no source link.

## Quality: the best X will show

- **Pictures** are taken at your screen's full resolution, then enlarged 2× with whole-pixel scaling whenever that still fits X's 4096 px, so text stays sharp and survives X's own JPEG colour halving. Your text is drawn as text at full resolution, never as a screenshot of text.
- **PNG or JPEG is chosen for you**, by X's rules: X keeps a PNG as it is only if it fits in 900×900 or is smaller than X's own JPEG of it; otherwise X turns it into an 85% JPEG with half the colour detail. So a snip is saved as a lossless **PNG** when X will keep it (sharp text and flat colours usually), and otherwise as a **97% JPEG**, which X for web keeps exactly as uploaded (4096×4096 or smaller, 5 MB or less, no rotation, at least 1 pixel per byte). ([X Developers: changes to PNG image support](https://devcommunity.x.com/t/upcoming-changes-to-png-image-support/118695), last updated by X in January 2020; X may have changed its pipeline since.)
- **Copy (⧉, Ctrl+C or right-click the box)** puts the sharpest PNG within X's 5 MB on the clipboard (the clipboard can only hold PNG), ready to paste into a post. A saved picture has its source link written into the file (a PNG text chunk or a JPEG comment), so the chat can offer "Go to source link" on it.
- **Videos** are cropped to your area before they are compressed, so all the quality goes to what you picked, then saved as large as X takes (up to 1920×1200, or 1200×1900 upright, enlarging up to 3×), so X's own 720p copy (1080p with Premium) is made from as much detail as possible. H.264 High profile, 30 fps, 8 to 24 Mbps, AAC sound at 192 kbps. X recommends at least 5 Mbps and plays 720p for non-Premium accounts, 1080p for Premium ([X API docs](https://docs.x.com/x-api/media/quickstart/best-practices)).

## Made for X

Files are made to fit X's limits:

| | Annotated.com saves | X's limit |
| --- | --- | --- |
| Text | Up to 280 characters, counted like X | 280 for a standard post ([X API docs: counting characters](https://docs.x.com/resources/fundamentals/counting-characters)) |
| Picture | PNG when X keeps it lossless, otherwise a 97% JPEG X keeps as uploaded; always 5 MB or less and 4096 px or less | 5 MB per image ([X API docs](https://docs.x.com/x-api/media/quickstart/best-practices)); 4096×4096 ([X Developers](https://devcommunity.x.com/t/upcoming-changes-to-png-image-support/118695)) |
| Picture shape | White margins keep it between 2:1 and 3:4 | X shows single images between 2:1 and 3:4 in full ([2021 announcement](https://www.socialmediatoday.com/news/twitter-rolls-out-larger-image-display-in-timelines-to-all-users-on-android/599664/)) |
| Video length | Stops at 2:20 | 140 s for non-Premium accounts ([X Help](https://help.x.com/en/using-x/x-videos)) |
| Video size | As large as X takes: up to 1920×1200 (or 1200×1900), enlarging up to 3× | 32×32 to 1920×1200 (and 1200×1900) |
| Video shape | White margins keep it between 1:2.39 and 2.39:1 | 1:2.39 to 2.39:1 |
| Frame rate / bitrate | 30 fps, 8 to 24 Mbps | Up to 60 fps; at least 5 Mbps recommended ([X API docs](https://docs.x.com/x-api/media/quickstart/best-practices)) |
| Format | MP4, H.264 High + AAC-LC, YUV 4:2:0, closed GOPs, "fast start" | H.264 High + AAC-LC recommended ([X API docs](https://docs.x.com/x-api/media/quickstart/best-practices)) |

File names start with **Annotated.com꞉** and the first few words of your text: `Annotated.com꞉ what do you mean by that.png`, `Annotated.com꞉ Watch the flash and listen for.mp4`. (Windows doesn't allow ":" in file names, so the colon is the look-alike "꞉".) With no text: `Annotated.com꞉ Screenshot 2026-10-12 183015.png`.

## Keys

| Key | Does |
| --- | --- |
| Alt+Shift+S | The icon: the bar and the chat; again, close both |
| Alt+Shift+V | Start a recording, straight to choosing the area (again while recording: stop) |
| Alt+Shift+L | Open the chat (side panel), and the bar with it |
| Enter | Drop your text into the box; press again to save |
| Shift+Enter | New line in your text |
| Ctrl+Enter | Drop your text and save |
| Ctrl+C | Copy the picture or the video (when no text is selected) |
| Ctrl+Z | Take away the last highlight |
| Space | Pause or go on, while recording (except while you're writing your text) |
| Arrows, Enter | Move between the highlighter's colours and pick one (when they're open) |
| Esc | Close the bar and the chat, like ✕ (an open right-click menu or the highlighter's colours close first) |

Change the shortcuts at `chrome://extensions/shortcuts`.

## Permissions

- **activeTab**: works only on the tab where you click the icon or press the shortcut, and only then.
- **scripting**: draws the dark overlay on that tab.
- **tabCapture**: records the tab you chose (Chrome shows its usual "recording" indicator).
- **offscreen**: a hidden page that plays the tab's sound back to you while it records.
- **sidePanel**: the chat, in Chrome's side panel.
- **storage**, **unlimitedStorage**: your chat name and sign-in, on this computer.
- **contextMenus**: "Open the chat" when you right-click the icon.

No access to your browsing history and no website permissions in advance. The only network requests are the chat's, to its Supabase project.

## Limits

- Chrome doesn't let extensions run on its own pages (New Tab, Settings, `chrome://…`) or on the Chrome Web Store. The icon explains this instead of doing nothing.
- Protected video (Netflix and other DRM players) records as black. That's Chrome, not the extension.
- A recording shows whatever is in front of your area, including the bar and the typing line if your area reaches under them.
- Sound is saved as AAC, which Chrome can make on Windows and macOS. Where it can't (Linux), the video is saved without sound and you're told so.
- Resizing the window or going full screen stops a recording (the area would no longer line up).
- Right after the icon opens the chat, Chrome gives the chat the keyboard, so you can type there at once (and Esc there closes both). Click the page, or start dragging an area, and keys go to the bar again.
- Chrome's side panel button and the chat's × take the bar along in current Chrome versions (Chrome tells extensions when their panel opens or closes since version 141/142). In older ones they only open and close the chat.
- The glass effect uses an SVG filter as a backdrop filter, which Chrome supports. If a setting turns it off, the bar falls back to frosted glass.

## Files

| File | What it is |
| --- | --- |
| `manifest.json` | Chrome extension manifest (Manifest V3) |
| `sw.js` | The icon and shortcuts: opens (or closes) the bar and the chat together, freezes the page, explains blocked pages |
| `content.js` | Small page helper: hosts the overlay, finds posts/videos under the pointer, works out the source link |
| `ui.html`, `ui.css`, `ui.js` | The overlay: dark screen, selection, the bar, typing line, the box |
| `glass.js` | The light glass filter for the bar, the right-click menus and "New posts" (rim refraction, rim light, clear lift) |
| `caption.js` | Lays out and draws your text, the source and the credit (the logo and the name; same code for the screen and the saved file) |
| `xcount.js` | Counts your text the way X does (280 limit) |
| `recorder.js` | Crops and encodes the recording as it happens |
| `exporter.js` | Builds the PNG and MP4 for X, with your highlights (the highlighter's nine colours are here) |
| `player.html`, `player.js` | Plays the tab's sound back while it's recorded |
| `blocked.html`, `blocked.js` | The "can't snip this page" note |
| `sidepanel.html`, `sidepanel.css`, `sidepanel.js` | The chat, in Chrome's side panel |
| `chat-config.js` | The chat's Supabase project URL and publishable key |
| `supabase/setup.sql` | Sets up the chat's Supabase project: the posts and likes tables, their rules, replies' quotes and thumbnails, X handles and photos, views, live updates, the file bucket |
| `icons/` | The logo (Newsreader's lowercase "a", SemiBold, its outline taken from the font, on a highlighter-yellow square), and the extension icons |
| `fonts/` | The Newsreader font (SIL Open Font License: `fonts/OFL.txt`) |
| `vendor/mp4-muxer.mjs` | MP4 writer (MIT licence: `vendor/mp4-muxer.LICENSE.txt`) |
| `vendor/twitter-text-urls.mjs` | Link patterns from twitter-text 3.1.0 (Apache 2.0 licence: `vendor/twitter-text.LICENSE.txt`) |
| `vendor/supabase.js` | Supabase JavaScript client 2.117.3, bundled (MIT licence: `vendor/supabase.LICENSE.txt`) |
