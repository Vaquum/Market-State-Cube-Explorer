#!/usr/bin/env python3
"""Build the standalone explorer from editable source and the recorded snapshot."""

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def check_names(label: str, script: str) -> None:
    """Fail when two functions share a name in the script's own scope, where the
    later one silently replaces the other for every caller."""
    names = re.findall(r'^  (?:async )?function (\w+)\(', script, re.M)
    repeated = sorted({name for name in names if names.count(name) > 1})
    if repeated:
        raise SystemExit(f"{label} declares {', '.join(repeated)} more than once; the last replaces the others.")


def check_inline(label: str, script: str) -> None:
    """Fail on text that would end or corrupt an inline <script> element: a closing
    tag ends it wherever it sits (comments and strings included), and an HTML comment
    opener changes how the parser reads the rest of the block."""
    if re.search(r'</script|<!--', script, re.I):
        raise SystemExit(f"{label} contains </script or <!--, which cannot be inlined in the page.")


def read_source(relative: str) -> str:
    path = ROOT / relative
    if not path.is_file():
        raise SystemExit(f"{relative} is missing; the page cannot be built without it.")
    return path.read_text(encoding='utf-8')


def build() -> str:
    view = read_source('src/view.html')
    style = read_source('src/explorer.css')
    runtime = read_source('src/state.js')
    encoding = read_source('src/encoding.js')
    evidence = read_source('src/evidence.js')
    comparison = read_source('src/comparison.js')
    comparison_ui = read_source('src/comparison-ui.js')
    reference = read_source('src/reference.js')
    app = read_source('src/explorer.js')
    # The scripts are inlined verbatim, so each is checked for what would break the
    # page before it is checked for what would break the script.
    for label, script in (('src/state.js', runtime), ('src/encoding.js', encoding), ('src/evidence.js', evidence), ('src/comparison.js', comparison), ('src/comparison-ui.js', comparison_ui), ('src/reference.js', reference), ('src/explorer.js', app)):
        check_inline(label, script)
        check_names(label, script)
    snapshot = json.loads(read_source('data/snapshot.json'))
    data = json.dumps(snapshot, separators=(',', ':'), ensure_ascii=True).replace('<', '\\u003c')
    template = read_source('src/document.html')
    # State, encoding, comparison and app stay in this order: the app reads window.explorerEncoding and
    # window.explorerState when it starts.
    values = {
        '__EXPLORER_STYLE__': style,
        '__EXPLORER_VIEW__': view,
        '__EXPLORER_DATA__': data,
        '__EXPLORER_STATE__': runtime,
        '__EXPLORER_ENCODING__': encoding,
        '__EXPLORER_EVIDENCE__': evidence,
        '__EXPLORER_COMPARISON__': comparison,
        '__EXPLORER_COMPARISONUI__': comparison_ui,
        '__EXPLORER_REFERENCE__': reference,
        '__EXPLORER_SCRIPT__': app,
    }
    for marker in values:
        if template.count(marker) != 1:
            raise ValueError(f'Expected exactly one {marker} placeholder')
    unknown = sorted(set(re.findall(r'__EXPLORER_[A-Z]+__', template)) - set(values))
    if unknown:
        raise ValueError(f'src/document.html names {", ".join(unknown)}, which the build does not fill')
    # One pass, so a substituted source is never scanned for markers: a marker that appears
    # inside one of them (a comment naming __EXPLORER_SCRIPT__, say) would otherwise be
    # replaced by whatever comes after it, or be left in the page. Refuse it instead.
    for source, value in (('src/explorer.css', style), ('src/view.html', view), ('data/snapshot.json', data),
                          ('src/state.js', runtime), ('src/encoding.js', encoding), ('src/evidence.js', evidence), ('src/comparison.js', comparison), ('src/comparison-ui.js', comparison_ui), ('src/reference.js', reference), ('src/explorer.js', app)):
        found = sorted({marker for marker in values if marker in value})
        if found:
            raise SystemExit(f"{source} contains {', '.join(found)}, which the build reserves for src/document.html.")
    return re.sub(r'__EXPLORER_[A-Z]+__', lambda match: values[match.group(0)], template)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Fail if the built page (index.html, or --out) needs rebuilding')
    parser.add_argument('--out', metavar='PATH',
                        help='Write the page here instead of index.html; missing parent directories are created')
    args = parser.parse_args()
    output = Path(args.out) if args.out else ROOT / 'index.html'
    rendered = build()
    if args.check:
        if not output.exists() or output.read_text(encoding='utf-8') != rendered:
            raise SystemExit(f'{output.name} is stale; run python3 tools/build.py' + (f' --out {args.out}' if args.out else ''))
        print(f'{output.name} matches the source and snapshot.')
    else:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(rendered, encoding='utf-8')
        print(f'Built {output.name} ({len(rendered.encode("utf-8")):,} bytes).')


if __name__ == '__main__':
    main()
