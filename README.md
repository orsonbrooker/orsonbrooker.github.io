# orsonbrooker.github.io

Orson's website. The home page is a 60 second basketball game (`game.js`).

Run it locally with `python3 -m http.server`, then open http://localhost:8000.

## Rebuilding the game art

`assets/` is generated from the court image and the two Orson videos:

```
python3 -m pip install pillow numpy   # also needs ffmpeg and cwebp (brew install ffmpeg webp)
python3 tools/build_assets.py <folder-with-court-and-videos> <scratch-folder>
```

Favicons and home screen icons (Orson's pixel head for the site, the hoop for Shootaround), the pictures shown when a page is shared (`assets/share/`), and the home page's game cards:

```
uv run --with pillow --with numpy python3 tools/build_favicons.py
uv run --with pillow --with numpy python3 tools/build_share_images.py
uv run --with pillow python3 tools/build_game_cards.py
```

## Adding a new game or app

Give it its own folder (e.g. `spelling/index.html`), copy the `<head>` tags from `index.html` and update the title, description, canonical, `og:url` and share image (add one to `tools/build_share_images.py`), then add the page to `sitemap.xml` and to `PAGES` in `tools/stamp_versions.py`.

To let players send ideas about it, add the widget and register the game:

```html
<link rel="stylesheet" href="/feedback/widget.css" />
<script type="module" src="/feedback/widget.js"></script>
<div data-feedback="spelling"></div>
```

```
cf d1 raw 67713a08-4e9f-46b0-874f-bbf9ccf05c4c --sql "INSERT INTO apps (slug, name) VALUES ('spelling', 'Spelling Bee')"
```

## Ideas board

Visitors send ideas with the "Got an idea?" button. Nothing goes public until it's approved at [orsonbrooker.com/admin](https://orsonbrooker.com/admin) (sign in with an allowed email; Cloudflare emails a one-time code). There you can put an idea on the board, merge it into an existing one, or reject it, and move ideas between Idea, Planned, Building and Done. Approved ideas show at [/ideas/](https://orsonbrooker.com/ideas/), where people can upvote them (one vote per idea per device).

The API is a Cloudflare Worker in `worker/` with a D1 database. Run it locally with `npm --prefix worker run dev` (the admin page works without signing in locally), and deploy with `cd worker && cf deploy --secrets-file .secrets.json` (that file holds the production secrets; it lives only on the computer that set things up and is never committed). Every Monday morning it sends a phone notification through [ntfy](https://ntfy.sh) if ideas are waiting.

## Announcer voice

The announcer's lines are made from `phrases.js` with [Chatterbox](https://github.com/resemble-ai/chatterbox), a free voice generator that runs on the Mac, and packed into one small file in `assets/voice/`. After adding phrases, run:

```
~/.venvs/announcer/bin/python tools/build_voice.py
```

Setup steps are at the top of `tools/build_voice.py`. Phrases without a clip use the device's voice.

## Pixel effects

The fire trails, flaming shoes while you're on fire, rim sparks, the swish sparkle and the buzzer-beater fireworks come from [pixelfx](https://github.com/patch-gg/pixelfx) (MIT, commit a841596), copied into `vendor/pixelfx/` with only the effects in use; the ball trail and shoe flames in `effects/` are built from its fire pieces. `fx.js` draws them on a chunky low-res layer over the court. To add one, copy its file (and any `_lib.js` it imports) from the pixelfx repo into the same folder under `vendor/pixelfx/src/fx/`, then add a method to `fx.js`.

To compare versions of an effect, add them to `/lab/` (a page that plays each one on a loop over the court) and open http://localhost:8000/lab/.

## Version tags

`tools/stamp_versions.py` adds a version tag to the script and stylesheet addresses so visitors get new code straight away instead of a copy cached for up to 4 hours. A git hook runs it on every commit; turn the hook on once per computer with:

```
git config core.hooksPath .githooks
```

## Players

Orson and Jethro are hand-made players: a 14-pose sheet drawn from `art/character-template.png` (16:9), turned into sprites with:

```
python3 tools/build_character.py art/characters/jethro.jpg jethro "Jethro"
```

Everyone else is made at [/players/](https://orsonbrooker.com/players/): pick a body, skin, hair, jersey and team colours, and a nickname. New players wait in the Players tab at `/admin` until approved, then show up in the game's player picker.

To add a body to the builder, make a sheet with the bases prompt (plain white jersey, royal blue trim and shorts, no letters), save it in `art/characters/bases/`, then:

```
python3 tools/build_character.py art/characters/bases/braids.jpg braids "Braids" --base
python3 tools/build_regions.py braids --preview /tmp/braids.png
```

The preview shows which pixels became skin, hair, jersey and team colour. The name shown in the builder can be changed in `assets/characters/bases/index.json`.
