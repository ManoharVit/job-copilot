"""Validate the actual served HTML and all local JS/CSS build references."""
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit


class DashboardInvalid(ValueError):
    pass


class IndexParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.has_root = False
        self.assets = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "div" and attrs.get("id") == "root":
            self.has_root = True
        if tag == "script" and attrs.get("src"):
            self.assets.append(attrs["src"])
        if tag == "link" and attrs.get("rel") in {"stylesheet", "modulepreload"}:
            self.assets.append(attrs.get("href", ""))


def validate_dashboard(directory: Path) -> None:
    directory = directory.resolve()
    try:
        parser = IndexParser()
        parser.feed((directory / "index.html").read_text(encoding="utf-8"))
        if not parser.has_root:
            raise DashboardInvalid("Dashboard has no React root")
        kinds = set()
        for reference in parser.assets:
            url = urlsplit(reference)
            if url.scheme or url.netloc or not url.path.startswith("/static/assets/"):
                raise DashboardInvalid("Dashboard asset is not a local /static/assets/ reference")
            target = (directory / url.path.removeprefix("/static/")).resolve()
            if not target.is_relative_to(directory / "assets"):
                raise DashboardInvalid("Dashboard asset escapes the assets directory")
            if not target.is_file() or target.stat().st_size == 0:
                raise DashboardInvalid("Dashboard references a missing or empty asset")
            kinds.add(target.suffix)
        if not {".js", ".css"} <= kinds:
            raise DashboardInvalid("Dashboard must reference JavaScript and stylesheet assets")
    except (OSError, UnicodeError) as exc:
        raise DashboardInvalid("Dashboard index/assets are unavailable") from exc


if __name__ == "__main__":
    directory = Path(sys.argv[1]) if len(sys.argv) == 2 else Path(__file__).resolve().parents[1] / "backend/static"
    try:
        validate_dashboard(directory)
        print("Dashboard index and referenced assets verified.")
    except DashboardInvalid as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
