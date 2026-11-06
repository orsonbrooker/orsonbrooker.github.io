"""Adds a ?v=<hash> to every script and stylesheet address so browsers fetch new versions.

GitHub Pages lets browsers keep scripts for 4 hours, so without this a visitor can keep running
old code after an update. Runs automatically before each commit (see .githooks/pre-commit).
When you add a page, add it to PAGES; when a page loads a new script or stylesheet, add it to ASSETS.

Usage: python3 tools/stamp_versions.py
"""
import hashlib, os, re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

# Modules imported by other scripts: (importing file, imported files). Stamped first.
IMPORTS = [
    ('ui/form.js', ['ui/icons.js']),  # before the files that import it
    ('ui/confirm.js', ['ui/icons.js']),  # before game.js, which imports it
    ('leaderboard.js', ['ui/icons.js', 'ui/form.js', 'shared/rules.js']),  # before game.js, which imports it
    # The game (game.js and its folders): each file after the ones it imports.
    ('engine/physics.js', ['engine/court.js']),
    ('content/looks.js', ['shared/rules.js']),
    ('engine/draw.js', ['content/looks.js', 'engine/court.js', 'shared/rules.js']),
    ('play/state.js', ['engine/court.js', 'engine/storage.js', 'rng.js', 'shared/rules.js']),
    ('play/react.js', ['audio.js', 'content/looks.js', 'daily.js', 'engine/court.js', 'fx.js', 'phrases.js', 'shared/rules.js', 'play/state.js']),
    ('play/players.js', ['engine/court.js', 'engine/draw.js', 'engine/storage.js', 'play/state.js', 'players/recolor.js']),
    ('screens/base.js', ['audio.js', 'engine/storage.js', 'play/state.js', 'ui/icons.js']),
    ('play/scene.js', ['content/looks.js', 'engine/court.js', 'engine/draw.js', 'play/players.js', 'play/react.js', 'play/state.js', 'screens/base.js', 'shared/rules.js']),
    ('modes/points.js', ['audio.js', 'content/calls.js', 'content/looks.js', 'engine/court.js', 'play/react.js', 'play/scene.js', 'play/state.js', 'shared/rules.js']),
    ('modes/timed.js', ['audio.js', 'modes/points.js', 'play/react.js', 'play/scene.js', 'play/state.js', 'shared/rules.js']),
    ('modes/survival.js', ['audio.js', 'content/calls.js', 'engine/court.js', 'modes/points.js', 'play/react.js', 'play/state.js']),
    ('modes/around.js', ['audio.js', 'content/around.js', 'content/looks.js', 'engine/court.js', 'play/react.js', 'play/scene.js', 'play/state.js', 'shared/rules.js']),
    ('modes/index.js', ['modes/around.js', 'modes/survival.js', 'modes/timed.js', 'play/state.js']),
    ('screens/over.js', ['daily.js', 'engine/storage.js', 'leaderboard.js', 'play/players.js', 'play/react.js', 'play/state.js', 'screens/base.js']),
    ('play/round.js', ['audio.js', 'content/looks.js', 'engine/court.js', 'engine/physics.js', 'engine/storage.js', 'leaderboard.js', 'play/players.js', 'play/react.js', 'play/scene.js', 'play/state.js', 'screens/base.js', 'screens/over.js', 'shared/rules.js']),
    ('screens/menus.js', ['engine/storage.js', 'play/players.js', 'play/round.js', 'play/scene.js', 'play/state.js', 'players/recolor.js', 'screens/base.js', 'screens/over.js', 'shared/rules.js', 'ui/confirm.js', 'ui/icons.js']),
    ('screens/panels.js', ['leaderboard.js', 'play/players.js', 'play/state.js', 'screens/base.js']),
    ('game.js', ['audio.js', 'engine/court.js', 'engine/draw.js', 'engine/input.js', 'engine/loop.js', 'engine/storage.js', 'modes/index.js', 'play/players.js', 'play/react.js', 'play/round.js', 'play/scene.js', 'play/state.js', 'screens/base.js', 'screens/menus.js', 'screens/over.js', 'screens/panels.js', 'ui/icons.js']),  # last: its version covers all of the above
    ('players/builder.js', ['players/recolor.js', 'ui/form.js']),
    ('feedback/widget.js', ['ui/icons.js', 'ui/form.js']),
    ('ui/nav.js', ['ui/icons.js']),
]
# Scripts and stylesheets that pages load.
ASSETS = ['game.js', 'styles.css', 'feedback/widget.js', 'feedback/widget.css', 'players/builder.js', 'players/builder.css', 'ui/nav.js', 'home/home.js']
PAGES = ['404.html', 'index.html', 'games/shootaround/index.html', 'ideas/index.html', 'players/index.html']


def read(name):
    with open(os.path.join(ROOT, name), encoding='utf-8') as f:
        return f.read()


def write(name, text):
    with open(os.path.join(ROOT, name), 'w', encoding='utf-8') as f:
        f.write(text)


def version(name):
    # Includes any stamps inside the file, so a new module version also gives its importer a new one.
    return hashlib.sha1(read(name).encode()).hexdigest()[:8]


def stamp(text, name, v):
    # Matches the asset however a page refers to it: "game.js", "./game.js", "../game.js" or "/game.js".
    return re.sub(rf'(["\'](?:\.{{0,2}}/)*{re.escape(name)})(\?v=[0-9a-f]+)?(["\'])', rf'\g<1>?v={v}\3', text)


def main():
    for importer, modules in IMPORTS:
        text = read(importer)
        for module in modules:
            text = stamp(text, module, version(module))
        write(importer, text)

    versions = {asset: version(asset) for asset in ASSETS}
    for page in PAGES:
        text = read(page)
        for asset, v in versions.items():
            text = stamp(text, asset, v)
        write(page, text)


if __name__ == '__main__':
    main()
