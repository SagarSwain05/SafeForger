"""
SafeForge telemetry gateway — pushes REAL sensor readings into a live facility.

Sources:
  --modbus HOST:PORT --map registers.json   poll a gas-detection controller / PLC over Modbus TCP
  --csv readings.csv                         replay an export (columns: sensorId,value[,timestamp])

registers.json maps sensor IDs (as configured in Site & Cameras) to holding registers:
  {"S-GAS-01": {"register": 30001, "scale": 0.1}, "S-GAS-02": {"register": 30002, "scale": 0.1, "unit": 1}}

Example:
  python telemetry_gateway.py --backend-url https://safeforger-backend.onrender.com \
      --site my-plant-ab12cd --api-key <INGEST_KEY> --modbus 10.0.0.5:502 --map registers.json
"""
import argparse
import csv
import json
import logging
import os
import sys
import time

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [gateway] %(levelname)s: %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("gateway")


def post(session, url, key, readings):
    if not readings:
        return
    try:
        r = session.post(url, json={"readings": readings, "source": "gateway"}, headers={"X-API-Key": key}, timeout=15)
        body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        if r.ok:
            log.info("sent %d reading(s)%s", body.get("accepted", len(readings)), f" — rejected: {body['rejected']}" if body.get("rejected") else "")
        else:
            log.warning("backend rejected readings (%s): %s", r.status_code, body.get("error") or r.text[:200])
    except requests.RequestException as e:
        log.warning("backend unreachable (%s) — will retry next cycle", e)


def modbus_loop(args, session, url):
    try:
        from pymodbus.client import ModbusTcpClient
    except ImportError:
        sys.exit("pymodbus is required for --modbus:  pip install pymodbus")
    host, _, port = args.modbus.partition(":")
    mapping = json.load(open(args.map))
    client = ModbusTcpClient(host, port=int(port or 502))
    while True:
        if not client.connected:
            client.connect()
        readings = []
        for sensor_id, spec in mapping.items():
            reg = int(spec["register"])
            address = reg - 30001 if reg >= 30001 else reg - 40001 if reg >= 40001 else reg
            fn = client.read_input_registers if reg >= 30001 and reg < 40001 else client.read_holding_registers
            rr = fn(address, count=1, slave=int(spec.get("unit", 1)))
            if rr.isError():
                log.warning("read failed for %s (register %s)", sensor_id, reg)
                continue
            readings.append({"sensorId": sensor_id, "value": round(rr.registers[0] * float(spec.get("scale", 1)), 3)})
        post(session, url, args.api_key, readings)
        time.sleep(args.interval)


def csv_loop(args, session, url):
    with open(args.csv) as f:
        rows = list(csv.DictReader(f))
    log.info("replaying %d rows from %s", len(rows), args.csv)
    for row in rows:
        post(session, url, args.api_key, [{"sensorId": row["sensorId"], "value": float(row["value"]), **({"timestamp": row["timestamp"]} if row.get("timestamp") else {})}])
        time.sleep(args.interval)


def main():
    ap = argparse.ArgumentParser(description="SafeForge telemetry gateway (real sensor inputs → live facility)")
    ap.add_argument("--backend-url", default=os.environ.get("SAFEFORGE_BACKEND_URL", "http://localhost:5001"))
    ap.add_argument("--site", default=os.environ.get("SAFEFORGE_SITE"), required=not os.environ.get("SAFEFORGE_SITE"))
    ap.add_argument("--api-key", default=os.environ.get("SAFEFORGE_API_KEY"), required=not os.environ.get("SAFEFORGE_API_KEY"))
    ap.add_argument("--modbus", help="HOST:PORT of a Modbus TCP gas controller / PLC")
    ap.add_argument("--map", help="JSON map of sensorId → register (with --modbus)")
    ap.add_argument("--csv", help="CSV export to replay (sensorId,value[,timestamp])")
    ap.add_argument("--interval", type=float, default=5.0, help="seconds between polls / rows")
    args = ap.parse_args()
    url = f"{args.backend_url.rstrip('/')}/api/sites/{args.site}/telemetry"
    session = requests.Session()
    if args.modbus:
        if not args.map:
            sys.exit("--map is required with --modbus")
        modbus_loop(args, session, url)
    elif args.csv:
        csv_loop(args, session, url)
    else:
        sys.exit("choose a source: --modbus HOST:PORT --map FILE, or --csv FILE")


if __name__ == "__main__":
    main()
