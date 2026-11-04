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
    ('leaderboard.js', ['ui/icons.js', 'ui/form.js']),  # before game.js, which imports it
    ('game.js', ['leaderboard.js', 'fx.js', 'audio.js', 'phrases.js', 'players/recolor.js', 'ui/icons.js', 'ui/confirm.js']),
    ('players/builder.js', ['players/recolor.js', 'ui/form.js']),
    ('feedback/widget.js', ['ui/icons.js', 'ui/form.js']),
    ('ui/nav.js', ['ui/icons.js']),
]
# Scripts and stylesheets that pages load.
ASSETS = ['game.js', 'styles.css', 'feedback/widget.js', 'feedback/widget.css', 'players/builder.js', 'players/builder.css', 'ui/nav.js', 'home/home.js']
PAGES = ['index.html', 'games/shootaround/index.html', 'ideas/index.html', 'players/index.html']


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
