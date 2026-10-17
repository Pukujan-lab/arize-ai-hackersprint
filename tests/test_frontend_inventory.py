"""Every HTML page route in contracts/openapi.json has a section in docs/FRONTEND_INVENTORY.md (#87)."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def html_routes():
    spec = json.loads((ROOT / "contracts" / "openapi.json").read_text())
    out = []
    for path, ops in spec["paths"].items():
        for op in ops.values():
            content = op.get("responses", {}).get("200", {}).get("content", {})
            if "text/html" in content:
                out.append(path)
                break
    return sorted(out)


def test_openapi_has_html_routes():
    assert "/" in html_routes()


def test_every_html_route_has_inventory_section():
    doc = ROOT / "docs" / "FRONTEND_INVENTORY.md"
    assert doc.exists(), "docs/FRONTEND_INVENTORY.md is missing"
    headings = set(re.findall(r"^##+\s+`([^`]+)`", doc.read_text(), flags=re.M))
    missing = [r for r in html_routes() if r not in headings]
    assert not missing, f"FRONTEND_INVENTORY.md has no section for: {missing}"
