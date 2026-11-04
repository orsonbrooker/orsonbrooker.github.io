"""Adds a ?v=<hash> to every script and stylesheet address so browsers fetch new versions.

GitHub Pages lets browsers keep scripts for 4 hours, so without this a visitor can keep running
old code after an update. Runs automatically before each commit (see .githooks/pre-commit).

Usage: python3 tools/stamp_versions.py
"""
import hashlib, os, re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def read(name):
    with open(os.path.join(ROOT, name), encoding='utf-8') as f:
        return f.read()


def write(name, text):
    with open(os.path.join(ROOT, name), 'w', encoding='utf-8') as f:
        f.write(text)


def version(text):
    # Includes any stamps inside the file, so a new module version also gives game.js a new one.
    return hashlib.sha1(text.encode()).hexdigest()[:8]


def stamp(text, name, v):
    return re.sub(rf'(["\'](?:\./)?{re.escape(name)})(\?v=[0-9a-f]+)?(["\'])', rf'\g<1>?v={v}\3', text)


def main():
    # game.js imports the other modules, so stamp it first, then the page that loads it.
    game = read('game.js')
    for module in ('audio.js', 'phrases.js'):
        game = stamp(game, module, version(read(module)))
    write('game.js', game)

    page = read('index.html')
    page = stamp(page, 'game.js', version(game))
    page = stamp(page, 'styles.css', version(read('styles.css')))
    write('index.html', page)


if __name__ == '__main__':
    main()
