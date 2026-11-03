# orsonbrooker.github.io

Orson's website. The home page is a 60 second basketball game (`game.js`).

Run it locally with `python3 -m http.server`, then open http://localhost:8000.

## Rebuilding the game art

`assets/` is generated from the court image and the two Orson videos:

```
python3 -m pip install pillow numpy   # also needs ffmpeg and cwebp (brew install ffmpeg webp)
python3 tools/build_assets.py <folder-with-court-and-videos> <scratch-folder>
```
