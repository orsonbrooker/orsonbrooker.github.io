# orsonbrooker.github.io

Orson's website. The home page is a 60 second basketball game (`game.js`).

Run it locally with `python3 -m http.server`, then open http://localhost:8000.

## Rebuilding the game art

`assets/` is generated from the court image and the two Orson videos:

```
python3 -m pip install pillow numpy   # also needs ffmpeg and cwebp (brew install ffmpeg webp)
python3 tools/build_assets.py <folder-with-court-and-videos> <scratch-folder>
```

The favicon, app icons and `og-image.jpg` come from Orson's portrait and the court picture:

```
python3 tools/build_icons.py <orson.jpg> <court-with-orson.jpg> <PressStart2P-Regular.ttf>
```

## Adding a new game or app

Give it its own folder (e.g. `spelling/index.html`), copy the `<head>` tags from `index.html` and update the title, description, canonical and `og:url`, then add the page to `sitemap.xml`.

## Announcer voice

The announcer's lines are made from `phrases.js` with [Chatterbox](https://github.com/resemble-ai/chatterbox), a free voice generator that runs on the Mac, and packed into one small file in `assets/voice/`. After adding phrases, run:

```
~/.venvs/announcer/bin/python tools/build_voice.py
```

Setup steps are at the top of `tools/build_voice.py`. Phrases without a clip use the device's voice.

## Before committing

Run `python3 tools/stamp_versions.py`. It adds a version tag to the script and stylesheet addresses so visitors get the new code straight away instead of a copy cached for up to 4 hours.
