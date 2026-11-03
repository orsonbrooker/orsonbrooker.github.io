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
