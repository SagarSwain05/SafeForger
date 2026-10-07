"""Vision engine tests — run from cv-service/:  python -m pytest -q"""
import sys
from pathlib import Path

import cv2
import numpy as np
import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
SAMPLES = HERE.parent.parent / "samples"

from engine import TemporalConfirmer, VisionEngine, associate_ppe, iou, nms  # noqa: E402
from homography import HomographyEngine, load_layout  # noqa: E402


@pytest.fixture(scope="module")
def engine():
    return VisionEngine()


def test_iou_and_nms():
    assert iou([0, 0, 10, 10], [0, 0, 10, 10]) == pytest.approx(1.0)
    assert iou([0, 0, 10, 10], [20, 20, 30, 30]) == 0.0
    dets = [{"label": "a", "confidence": 0.9, "bbox": [0, 0, 10, 10]},
            {"label": "a", "confidence": 0.8, "bbox": [1, 1, 10, 10]},
            {"label": "b", "confidence": 0.7, "bbox": [1, 1, 10, 10]}]
    assert [d["confidence"] for d in nms(dets, 0.45)] == [0.9, 0.7]


def test_association_marks_missing_helmet(engine):
    dets = [{"label": "Worker", "confidence": 0.9, "bbox": [100, 100, 200, 400]},
            {"label": "No-Helmet", "confidence": 0.8, "bbox": [130, 100, 170, 140]},
            {"label": "Vest", "confidence": 0.8, "bbox": [110, 160, 190, 260]}]
    people = associate_ppe(dets, engine.manifest, ["helmet", "vest"])
    assert len(people) == 1
    assert people[0]["ppe"]["helmet"] == "missing" and people[0]["ppe"]["vest"] == "ok"
    assert people[0]["missing"] == ["helmet"] and not people[0]["compliant"]


def test_orphan_violation_creates_worker(engine):
    people = associate_ppe([{"label": "No-Helmet", "confidence": 0.7, "bbox": [10, 10, 40, 40]}], engine.manifest, ["helmet"])
    assert len(people) == 1 and people[0]["inferred"] and people[0]["missing"] == ["helmet"]


def test_blank_frame_is_quiet(engine):
    r = engine.detect(np.full((480, 640, 3), 40, np.uint8))
    assert r["worker_count"] == 0 and not r["fire_detected"] and not r["smoke_detected"]


def test_no_ppe_street_flags_violations(engine):
    r = engine.detect(cv2.imread(str(SAMPLES / "no_ppe_street.jpg")))
    assert r["worker_count"] >= 2 and r["ppe_violations"] >= 2
    assert not r["fire_detected"]


def test_compliant_crew_has_no_violations(engine):
    r = engine.detect(cv2.imread(str(SAMPLES / "ppe_compliant_crew.jpg")))
    assert r["worker_count"] >= 5 and r["ppe_violations"] == 0
    assert not r["fire_detected"] and not r["smoke_detected"]


def test_fire_and_smoke_samples(engine):
    assert engine.detect(cv2.imread(str(SAMPLES / "fire_flame.jpg")))["fire_detected"]
    assert engine.detect(cv2.imread(str(SAMPLES / "smoke_warehouse.jpg")))["smoke_detected"]


def test_fire_video_detected(engine):
    cap = cv2.VideoCapture(str(SAMPLES / "fire_outdoor.webm"))
    hits, n = 0, 0
    while n < 5:
        ok, frame = cap.read()
        if not ok:
            break
        for _ in range(23):
            cap.grab()
        hits += engine.detect(frame)["fire_detected"]
        n += 1
    assert n == 5 and hits >= 4


def test_temporal_confirmation_needs_repeats():
    tc = TemporalConfirmer({"window": 5, "fire": 2, "smoke": 3, "ppe": 3})
    fire = {"fire_detected": True, "fire_confidence": 0.7, "smoke_detected": False, "smoke_confidence": 0,
            "ppe_violations": 0, "workers": []}
    assert tc.update(fire) == []
    assert [e["type"] for e in tc.update(fire)] == ["FIRE"]
    assert [e["type"] for e in TemporalConfirmer({}).update(fire, single_frame=True)] == ["FIRE"]


def test_homography_fallback_maps_into_camera_zone():
    layout = load_layout()
    h = HomographyEngine({}, layout)
    z = next(z for z in layout["zones"] if z["id"] == "Z-07")
    x, y = h.transform("CAM-03", [320, 480], (640, 480), "Z-07")
    assert z["x"] <= x <= z["x"] + z["w"] and z["y"] <= y <= z["y"] + z["h"]
    assert h.get_zone([x, y]) == "Z-07"
