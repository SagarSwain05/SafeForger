#!/usr/bin/env python3
"""
Build the all-India industrial plant directory used at sign-up (backend/src/data/plant-directory.json).

Sources (public, reproducible):
  • Wikidata (CC0) — power stations, oil refineries, steel mills, cement plants, chemical plants,
    car factories, aluminium smelters, mines, ports and shipyards located in India.
  • OpenStreetMap (© OpenStreetMap contributors, ODbL) — named industrial works, power plants,
    industrial sites and industrial areas, queried state by state through the Overpass API.

Usage:  python3 backend/scripts/build_plant_directory.py
Re-run any time to refresh. Needs network access and `pip install shapely` (state assignment).
"""
import json
import re
import subprocess
import sys
import time
import unicodedata
import urllib.parse
from pathlib import Path

UA = "SafeForgeDirectoryBuilder/1.0 (https://github.com/SagarSwain05/SafeForger)"
OUT = Path(__file__).resolve().parent.parent / "src" / "data" / "plant-directory.json"
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]


def http(url, data=None, accept="application/json", timeout=300):
    cmd = ["curl", "-s", "-m", str(timeout), "-A", UA, "-H", f"Accept: {accept}"]
    if data is not None:
        cmd += ["--data-urlencode", data]
    cmd.append(url)
    out = subprocess.run(cmd, capture_output=True, text=True).stdout
    return json.loads(out)


# ── Sector classification ───────────────────────────────────────────────────
KEYWORDS = [
    ("refinery", r"refiner|petroleum|\bcrude\b|\boil\b(?! mill)|\blpg\b|bottling"),
    ("steel", r"steel|ispat|\biron\b|sponge|alumin|smelter|\bzinc\b|copper|ferro|metal|foundry|forg"),
    ("cement", r"cement|clinker|\bacc\b|ultratech|ambuja|dalmia|shree cement|ramco"),
    ("chemical", r"chemic|fertili[sz]|petrochem|\bgas\b|\bgail\b|urea|ammonia|caustic|plastic|polymer|paint|rubber|explosive"),
    ("pharma", r"pharma|drug|laborator|\blabs?\b|healthcare|biotech|vaccine|api\b"),
    ("automotive", r"motor|\bauto|vehicle|tyre|tire|maruti|hyundai|mahindra|bajaj|tvs|hero\b|ashok leyland|toyota|honda|tata motors|tractor|engine|wagon|coach factory|locomotive"),
    ("mining", r"\bmine\b|mines\b|colliery|coal\b|quarry|ore\b|opencast|underground"),
    ("logistics", r"\bport\b|harbou?r|\bdock|shipyard|terminal|container|warehouse|logistic"),
    ("power", r"power|thermal|\btps\b|\bstps\b|energy|solar|wind farm|hydro|nuclear|atomic|electric"),
]


def classify(name, tags):
    text = " ".join([name, tags.get("operator", ""), tags.get("product", ""), tags.get("industrial", ""), tags.get("plant:source", "")]).lower()
    if tags.get("power") == "plant":
        return "power"
    if tags.get("industrial") in ("refinery", "oil") or tags.get("product") in ("oil", "petroleum"):
        return "refinery"
    if tags.get("industrial") in ("mine", "quarry") or tags.get("landuse") == "quarry":
        return "mining"
    if tags.get("industrial") in ("port", "shipyard"):
        return "logistics"
    for sector, rx in KEYWORDS:
        if re.search(rx, text):
            return sector
    return "manufacturing"


def type_label(tags, sector):
    if tags.get("power") == "plant":
        src = tags.get("plant:source")
        return f"{src.capitalize()} power plant" if src else "Power plant"
    if tags.get("man_made") == "works":
        return f"{tags['product'].replace(';', ', ').capitalize()} works" if tags.get("product") else "Industrial works"
    if tags.get("industrial"):
        return tags["industrial"].replace("_", " ").capitalize()
    if tags.get("landuse") == "industrial":
        return "Industrial site / estate"
    return sector.capitalize()


def latin_ok(name):
    letters = [c for c in name if c.isalpha()]
    return bool(letters) and sum(1 for c in letters if "LATIN" in unicodedata.name(c, "")) / len(letters) > 0.8


GENERIC = re.compile(r"^(factory|industry|industries|industrial (area|estate|zone)|works|plant|godown|warehouse|company|unit|mill|workshop)$", re.I)


def norm_key(name, state):
    return re.sub(r"[^a-z0-9]", "", name.lower()) + "|" + (state or "").lower()


# ── Wikidata ────────────────────────────────────────────────────────────────
WD_CLASSES = {
    "Q159719": "power", "Q12353044": "refinery", "Q2069494": "steel", "Q11689547": "cement",
    "Q905286": "chemical", "Q41793764": "automotive", "Q44396585": "steel", "Q959309": "mining",
    "Q820477": "mining", "Q44782": "logistics", "Q190928": "logistics", "Q83405": "manufacturing",
}


def wikidata():
    rows = []
    for qid, sector in WD_CLASSES.items():
        q = f"""
SELECT ?i ?iLabel ?typeLabel ?locLabel ?stateLabel ?opLabel ?coord WHERE {{
  ?i wdt:P31/wdt:P279* wd:{qid}; wdt:P17 wd:Q668.
  OPTIONAL {{ ?i wdt:P31 ?type. }}
  OPTIONAL {{ ?i wdt:P131 ?loc. }}
  OPTIONAL {{ ?i wdt:P131* ?state. ?state wdt:P31 ?st. VALUES ?st {{ wd:Q131541 wd:Q467745 }} }}
  OPTIONAL {{ ?i wdt:P137 ?op. }}
  OPTIONAL {{ ?i wdt:P625 ?coord. }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
}}"""
        try:
            data = http("https://query.wikidata.org/sparql?" + urllib.parse.urlencode({"query": q}), accept="application/sparql-results+json")
        except Exception as e:  # noqa: BLE001
            print(f"  wikidata {qid} failed: {e}", file=sys.stderr)
            continue
        n = 0
        for b in data["results"]["bindings"]:
            name = b.get("iLabel", {}).get("value", "")
            if not name or re.match(r"^Q\d+$", name):
                continue
            lat = lng = None
            m = re.match(r"Point\(([-\d.]+) ([-\d.]+)\)", b.get("coord", {}).get("value", ""))
            if m:
                lng, lat = float(m.group(1)), float(m.group(2))
            rows.append({
                "name": name, "operator": b.get("opLabel", {}).get("value", ""), "sector": sector,
                "type": b.get("typeLabel", {}).get("value", "").capitalize(),
                "district": b.get("locLabel", {}).get("value", ""), "state": b.get("stateLabel", {}).get("value", ""),
                "lat": lat, "lng": lng, "source": "wikidata", "ref": b["i"]["value"].rsplit("/", 1)[-1],
            })
            n += 1
        print(f"  wikidata {qid} ({sector}): {n} rows")
        time.sleep(2)
    return rows


# ── State boundaries (Natural Earth, public domain) ─────────────────────────
NE_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson"
STATE_ALIASES = {"Andaman and Nicobar": "Andaman and Nicobar Islands", "NCT of Delhi": "Delhi", "National Capital Territory of Delhi": "Delhi",
                 "Orissa": "Odisha", "Pondicherry": "Puducherry", "Uttaranchal": "Uttarakhand"}


class StateLocator:
    """Point → Indian state / UT using Natural Earth admin-1 polygons (requires shapely)."""

    def __init__(self):
        from shapely.geometry import shape, Point
        from shapely.strtree import STRtree
        cache = Path(__file__).resolve().parent / ".ne_admin1.geojson"
        if not cache.exists():
            subprocess.run(["curl", "-sL", "-o", str(cache), NE_URL], check=True)
        feats = [f for f in json.loads(cache.read_text())["features"] if f["properties"].get("adm0_a3") == "IND"]
        self.geoms = [shape(f["geometry"]) for f in feats]
        self.names = [STATE_ALIASES.get(f["properties"]["name"], f["properties"]["name"]) for f in feats]
        self.tree = STRtree(self.geoms)
        self.Point = Point

    def state(self, lat, lng):
        if lat is None or lng is None:
            return ""
        pt = self.Point(lng, lat)
        for i in self.tree.query(pt):
            if self.geoms[i].covers(pt):
                return self.names[i]
        # coastal / border points just outside a simplified boundary: nearest state within ~5 km
        best = min(range(len(self.geoms)), key=lambda i: self.geoms[i].distance(pt))
        return self.names[best] if self.geoms[best].distance(pt) < 0.05 else ""


# ── OpenStreetMap (country-wide, state assigned locally) ────────────────────
def overpass(query, tries=6):
    for attempt in range(tries):
        for url in OVERPASS:
            try:
                d = http(url, data=f"data={query}", timeout=600)
                if "elements" in d:
                    return d["elements"]
            except Exception:  # noqa: BLE001
                pass
            time.sleep(15 + attempt * 20)
    return None


OSM_QUERIES = {
    "works": 'nwr["man_made"="works"]["name"](area.in);',
    "power": 'nwr["power"="plant"]["name"](area.in);',
    "industrial": 'nwr["industrial"]["name"]["landuse"!="industrial"](area.in);',
    "areas": 'nwr["landuse"="industrial"]["name"](area.in);',
}


def osm(locator):
    rows = []
    for label, sel in OSM_QUERIES.items():
        q = f'[out:json][timeout:600];area["ISO3166-1"="IN"][admin_level=2]->.in;({sel});out center tags;'
        els = overpass(q)
        if els is None:
            print(f"  {label}: FAILED", file=sys.stderr)
            continue
        n = 0
        for e in els:
            t = e.get("tags", {})
            name = (t.get("name:en") or t.get("name") or "").strip()
            if len(name) < 4 or not latin_ok(name) or GENERIC.match(name):
                continue
            c = e.get("center") or e
            lat, lng = c.get("lat"), c.get("lon")
            sector = classify(name, t)
            rows.append({
                "name": name, "operator": t.get("operator", ""), "sector": sector, "type": type_label(t, sector),
                "district": t.get("addr:district") or t.get("addr:city") or t.get("is_in:district") or "",
                "state": locator.state(lat, lng), "lat": lat, "lng": lng,
                "source": "osm", "ref": f"{e['type'][0]}{e['id']}",
                "estate": t.get("landuse") == "industrial" and not t.get("industrial") and t.get("man_made") != "works",
            })
            n += 1
        print(f"  osm {label}: {n} named sites")
        time.sleep(10)
    return rows


SECTOR_LABEL = {
    "refinery": "Oil & gas refinery", "steel": "Steel & metals", "power": "Power generation", "chemical": "Chemical / petrochemical",
    "cement": "Cement", "automotive": "Automotive", "mining": "Mining", "pharma": "Pharmaceutical", "logistics": "Ports & logistics",
    "construction": "Construction", "manufacturing": "General manufacturing",
}


def main():
    locator = StateLocator()
    print("Wikidata…")
    wd = wikidata()
    for r in wd:   # normalise state names; fill from coordinates when Wikidata has none
        r["state"] = STATE_ALIASES.get(r["state"], r["state"]) if r["state"] else locator.state(r["lat"], r["lng"])
    print("OpenStreetMap…")
    om = osm(locator)
    merged, seen = [], {}
    for r in wd + om:   # Wikidata first: it wins on duplicates (better metadata)
        k = norm_key(r["name"], r["state"])
        if k in seen:
            prev = seen[k]
            for f in ("operator", "district", "lat", "lng", "state"):
                if not prev.get(f) and r.get(f):
                    prev[f] = r[f]
            continue
        seen[k] = r
        merged.append(r)
    out = []
    for i, r in enumerate(sorted(merged, key=lambda x: (x["state"] or "~", x["name"].lower()))):
        out.append({
            "id": f"in-{r['source'][:2]}-{r['ref']}".lower(),
            "name": r["name"][:120], "operator": (r["operator"] or "")[:100], "sector": r["sector"],
            "sectorLabel": SECTOR_LABEL[r["sector"]], "type": (r["type"] or "")[:60],
            "district": (r["district"] or "")[:60], "state": r["state"] or "", "country": "India",
            "lat": round(r["lat"], 5) if r.get("lat") is not None else None,
            "lng": round(r["lng"], 5) if r.get("lng") is not None else None,
            "source": r["source"], "estate": bool(r.get("estate")),
        })
    OUT.write_text(json.dumps({
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "attribution": "Wikidata (CC0) and © OpenStreetMap contributors (ODbL, https://www.openstreetmap.org/copyright)",
        "count": len(out), "plants": out,
    }, ensure_ascii=False, separators=(",", ":")))
    by = {}
    for p in out:
        by[p["sector"]] = by.get(p["sector"], 0) + 1
    print(f"wrote {len(out)} plants → {OUT}  {by}")


if __name__ == "__main__":
    main()
