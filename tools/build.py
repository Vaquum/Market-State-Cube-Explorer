#!/usr/bin/env python3
"""Build the standalone explorer from editable source and the recorded snapshot."""

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def build() -> str:
    view = (ROOT / 'src/view.html').read_text(encoding='utf-8')
    style = (ROOT / 'src/explorer.css').read_text(encoding='utf-8')
    runtime = (ROOT / 'src/state.js').read_text(encoding='utf-8')
    app = (ROOT / 'src/explorer.js').read_text(encoding='utf-8')
    snapshot = json.loads((ROOT / 'data/snapshot.json').read_text(encoding='utf-8'))
    data = json.dumps(snapshot, separators=(',', ':'), ensure_ascii=True).replace('<', '\\u003c')
    template = (ROOT / 'src/document.html').read_text(encoding='utf-8')
    for marker, value in {
        '__EXPLORER_STYLE__': style,
        '__EXPLORER_VIEW__': view,
        '__EXPLORER_DATA__': data,
        '__EXPLORER_STATE__': runtime,
        '__EXPLORER_SCRIPT__': app,
    }.items():
        if template.count(marker) != 1:
            raise ValueError(f'Expected exactly one {marker} placeholder')
        template = template.replace(marker, value)
    return template


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Fail if index.html needs rebuilding')
    args = parser.parse_args()
    output = ROOT / 'index.html'
    rendered = build()
    if args.check:
        if not output.exists() or output.read_text(encoding='utf-8') != rendered:
            raise SystemExit('index.html is stale; run python3 tools/build.py')
        print('index.html matches the source and snapshot.')
    else:
        output.write_text(rendered, encoding='utf-8')
        print(f'Built index.html ({len(rendered.encode("utf-8")):,} bytes).')


if __name__ == '__main__':
    main()
