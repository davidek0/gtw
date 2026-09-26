#!/usr/bin/env python3
"""Read Garmin heart-rate broadcasts over Bluetooth Low Energy."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import statistics
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


BACKEND_DIR = Path(__file__).resolve().parents[1]
HEART_RATE_SERVICE = "0000180d-0000-1000-8000-00805f9b34fb"
HEART_RATE_MEASUREMENT = "00002a37-0000-1000-8000-00805f9b34fb"


def load_env_file() -> None:
    env_path = BACKEND_DIR / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        if key:
            os.environ.setdefault(key, value)


def bleak_library() -> tuple[Any, Any]:
    try:
        from bleak import BleakClient, BleakScanner  # type: ignore[import-not-found]
    except ImportError as exc:
        raise SystemExit(
            "Bleak is not installed. Run this through 'npm run garmin:live:scan' or "
            "'npm run garmin:live:test'."
        ) from exc
    return BleakClient, BleakScanner


def parse_bpm(data: bytearray) -> int:
    if len(data) < 2:
        raise ValueError("Heart-rate notification was too short")
    is_uint16 = bool(data[0] & 0x01)
    if is_uint16:
        if len(data) < 3:
            raise ValueError("16-bit heart-rate notification was too short")
        return int.from_bytes(data[1:3], byteorder="little")
    return int(data[1])


async def discover(timeout: float) -> list[tuple[Any, Any]]:
    _, BleakScanner = bleak_library()
    discovered = await BleakScanner.discover(timeout=timeout, return_adv=True)
    return list(discovered.values())


def has_heart_rate_service(advertisement: Any) -> bool:
    services = {str(value).lower() for value in (advertisement.service_uuids or [])}
    return HEART_RATE_SERVICE in services or "180d" in services


def device_label(device: Any, advertisement: Any | None = None) -> str:
    name = None
    if advertisement is not None:
        name = advertisement.local_name
    name = name or device.name or "Unnamed BLE device"
    return f"{name} ({device.address})"


async def scan_command(timeout: float) -> None:
    print("Scanning for Bluetooth devices. Put the watch in Broadcast Heart Rate mode now...")
    devices = await discover(timeout)
    if not devices:
        print("No Bluetooth LE devices were found.")
        return

    devices.sort(key=lambda item: (not has_heart_rate_service(item[1]), device_label(*item)))
    heart_rate_count = 0
    hidden_unnamed_count = 0
    for device, advertisement in devices:
        is_hr = has_heart_rate_service(advertisement)
        if is_hr:
            heart_rate_count += 1
        if not is_hr and not (advertisement.local_name or device.name):
            hidden_unnamed_count += 1
            continue
        marker = "HEART RATE" if is_hr else ""
        print(f"{marker:12} {device_label(device, advertisement)}")

    if hidden_unnamed_count:
        print(f"\nHidden {hidden_unnamed_count} unnamed nearby BLE devices.")

    if heart_rate_count == 0:
        print("\nNo standard Heart Rate service was advertised.")
        print("Confirm Broadcast Heart Rate is running on the watch, then scan again.")
    else:
        print(f"\nFound {heart_rate_count} device(s) broadcasting live heart rate.")


async def select_device(address: str | None, timeout: float) -> tuple[Any, str]:
    if address:
        return address, address

    print("Searching for a watch broadcasting the standard Bluetooth Heart Rate service...")
    devices = [item for item in await discover(timeout) if has_heart_rate_service(item[1])]
    if not devices:
        raise SystemExit(
            "No heart-rate broadcaster found. Enable Broadcast Heart Rate on the watch "
            "and run 'npm run garmin:live:scan'."
        )
    if len(devices) == 1:
        device, advertisement = devices[0]
        return device, device_label(device, advertisement)

    print("Multiple heart-rate devices were found:")
    for index, (device, advertisement) in enumerate(devices, start=1):
        print(f"  {index}. {device_label(device, advertisement)}")
    while True:
        try:
            selected = int(input("Choose device number: ").strip())
            device, advertisement = devices[selected - 1]
            return device, device_label(device, advertisement)
        except (ValueError, IndexError):
            print("Enter one of the listed numbers.")


def send_samples(subject_id: str, source_device: str, samples: list[dict[str, Any]]) -> int:
    admin_token = os.getenv("ADMIN_API_TOKEN", "").strip()
    if not admin_token:
        raise RuntimeError("ADMIN_API_TOKEN is missing from backend/.env")
    base_url = os.getenv("BACKEND_URL", "http://127.0.0.1:3000").rstrip("/")
    url = f"{base_url}/api/garmin-live/heart-rate"
    payload = json.dumps(
        {"subjectId": subject_id, "sourceDevice": source_device, "samples": samples},
        separators=(",", ":"),
    ).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {admin_token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Backend upload failed ({exc.code}): {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(
            f"Cannot reach {url}. Start the backend with 'npm run dev'."
        ) from exc
    return int(result.get("samplesInserted", 0))


async def flush_samples(
    subject_id: str,
    source_device: str,
    pending: list[dict[str, Any]],
) -> None:
    if not pending:
        return
    batch = pending.copy()
    pending.clear()
    try:
        await asyncio.to_thread(send_samples, subject_id, source_device, batch)
    except Exception as exc:
        pending[:0] = batch
        print(f"Warning: {exc}", file=sys.stderr)


async def monitor_command(args: argparse.Namespace) -> None:
    """Stream heart rate until stopped, reconnecting whenever Bluetooth drops."""
    BleakClient, _ = bleak_library()
    subject_id = os.getenv("GARMIN_SUBJECT_ID", "person-1").strip()
    if not args.no_upload and not os.getenv("ADMIN_API_TOKEN", "").strip():
        raise SystemExit("Fill ADMIN_API_TOKEN in backend/.env before starting the monitor.")

    pending: list[dict[str, Any]] = []
    print("Continuous live pulse monitor started. Press Ctrl+C to stop.")

    while True:
        try:
            target, label = await select_device(args.address, args.scan_timeout)
            queue: asyncio.Queue[tuple[int, str]] = asyncio.Queue()

            def on_heart_rate(_sender: Any, data: bytearray) -> None:
                try:
                    bpm = parse_bpm(data)
                except ValueError as exc:
                    print(f"Warning: {exc}", file=sys.stderr)
                    return
                measured_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
                queue.put_nowait((bpm, measured_at))

            print(f"Connecting to {label}...")
            async with BleakClient(target, timeout=20) as client:
                await client.start_notify(HEART_RATE_MEASUREMENT, on_heart_rate)
                print("Live pulse connected.")
                try:
                    while True:
                        bpm, measured_at = await asyncio.wait_for(queue.get(), timeout=20)
                        print(f"{measured_at}  {bpm:3d} bpm")
                        pending.append({"bpm": bpm, "measuredAt": measured_at})
                        if not args.no_upload and len(pending) >= 3:
                            await flush_samples(subject_id, label, pending)
                finally:
                    try:
                        await client.stop_notify(HEART_RATE_MEASUREMENT)
                    except Exception:
                        pass
                if not args.no_upload:
                    await flush_samples(subject_id, label, pending)
        except (Exception, SystemExit) as exc:
            print(
                f"Live pulse disconnected: {exc}. Retrying in {args.retry_interval} seconds...",
                file=sys.stderr,
            )
            await asyncio.sleep(args.retry_interval)


async def test_command(args: argparse.Namespace) -> None:
    BleakClient, _ = bleak_library()
    target, label = await select_device(args.address, args.scan_timeout)
    subject_id = os.getenv("GARMIN_SUBJECT_ID", "person-1").strip()
    if not args.no_upload and not os.getenv("ADMIN_API_TOKEN", "").strip():
        raise SystemExit("Fill ADMIN_API_TOKEN in backend/.env before starting the test.")

    queue: asyncio.Queue[tuple[int, str]] = asyncio.Queue()

    def on_heart_rate(_sender: Any, data: bytearray) -> None:
        try:
            bpm = parse_bpm(data)
        except ValueError as exc:
            print(f"Warning: {exc}", file=sys.stderr)
            return
        measured_at = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
        queue.put_nowait((bpm, measured_at))

    print(f"Connecting to {label}...")
    async with BleakClient(target, timeout=20) as client:
        await client.start_notify(HEART_RATE_MEASUREMENT, on_heart_rate)
        print("Connected. Stay still while the resting baseline is measured.")
        print("This is a demo, not medical monitoring. Stop if you feel unwell.\n")

        start_time: float | None = None
        last_phase = ""
        baseline_values: list[int] = []
        exercise_values: list[int] = []
        recovery_values: list[int] = []
        pending: list[dict[str, Any]] = []
        total_duration = args.baseline + args.exercise + args.recovery

        while True:
            try:
                bpm, measured_at = await asyncio.wait_for(queue.get(), timeout=15)
            except TimeoutError as exc:
                raise RuntimeError(
                    "Connected, but no heart-rate notifications arrived. Confirm that the "
                    "watch is still in Broadcast Heart Rate mode."
                ) from exc

            now = asyncio.get_running_loop().time()
            if start_time is None:
                start_time = now
            elapsed = now - start_time
            if elapsed >= total_duration:
                break

            if elapsed < args.baseline:
                phase = "REST"
                baseline_values.append(bpm)
                phase_remaining = args.baseline - elapsed
            elif elapsed < args.baseline + args.exercise:
                phase = "JUMP"
                exercise_values.append(bpm)
                phase_remaining = args.baseline + args.exercise - elapsed
            else:
                phase = "RECOVER"
                recovery_values.append(bpm)
                phase_remaining = total_duration - elapsed

            if phase != last_phase:
                if phase == "JUMP":
                    print("\nSTART JUMPING JACKS NOW.\n")
                elif phase == "RECOVER":
                    print("\nSTOP. Stand still for recovery.\n")
                last_phase = phase

            baseline = statistics.median(baseline_values) if baseline_values else bpm
            delta = bpm - baseline
            print(f"{phase:7} {bpm:3d} bpm  ({delta:+.0f})  {phase_remaining:4.0f}s remaining")
            pending.append({"bpm": bpm, "measuredAt": measured_at})
            if not args.no_upload and len(pending) >= 5:
                await flush_samples(subject_id, label, pending)

        await client.stop_notify(HEART_RATE_MEASUREMENT)
        if not args.no_upload:
            await flush_samples(subject_id, label, pending)

    if not baseline_values:
        raise RuntimeError("No resting samples were collected.")
    baseline = float(statistics.median(baseline_values))
    peak = max(exercise_values or baseline_values)
    rise = peak - baseline
    print("\nTest complete")
    print(f"Resting median: {baseline:.0f} bpm")
    print(f"Exercise peak:  {peak} bpm")
    print(f"Increase:       {rise:+.0f} bpm")
    if rise >= args.rise_threshold:
        print(f"Result: pulse rose by at least {args.rise_threshold} bpm.")
    else:
        print(f"Result: rise was below the {args.rise_threshold} bpm demo threshold.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    scan = commands.add_parser("scan", help="Find watches broadcasting Bluetooth heart rate.")
    scan.add_argument("--timeout", type=float, default=12.0)

    test = commands.add_parser("test", help="Run a baseline, jumping-jack, and recovery test.")
    test.add_argument("device_address", nargs="?", help="Optional Bluetooth device address.")
    test.add_argument("--address", dest="address_option", help="Bluetooth device address.")
    test.add_argument("--scan-timeout", type=float, default=12.0)
    test.add_argument("--baseline", type=int, default=20, help="Resting seconds.")
    test.add_argument("--exercise", type=int, default=45, help="Jumping-jack seconds.")
    test.add_argument("--recovery", type=int, default=30, help="Recovery seconds.")
    test.add_argument("--rise-threshold", type=int, default=10)
    test.add_argument("--no-upload", action="store_true")

    monitor = commands.add_parser("monitor", help="Stream and upload pulse until stopped.")
    monitor.add_argument("device_address", nargs="?", help="Optional Bluetooth device address.")
    monitor.add_argument("--address", dest="address_option", help="Bluetooth device address.")
    monitor.add_argument("--scan-timeout", type=float, default=12.0)
    monitor.add_argument("--retry-interval", type=int, default=5)
    monitor.add_argument("--no-upload", action="store_true")
    return parser


async def async_main() -> None:
    load_env_file()
    args = build_parser().parse_args()
    if args.command == "scan":
        await scan_command(args.timeout)
    else:
        args.address = (
            args.address_option
            or args.device_address
            or os.getenv("GARMIN_BLE_ADDRESS")
            or None
        )
        if args.command == "test":
            for name in ("baseline", "exercise", "recovery"):
                if getattr(args, name) < 5:
                    raise SystemExit(f"--{name} must be at least 5 seconds.")
            await test_command(args)
        else:
            if args.retry_interval < 1:
                raise SystemExit("--retry-interval must be at least 1 second.")
            await monitor_command(args)


if __name__ == "__main__":
    try:
        asyncio.run(async_main())
    except KeyboardInterrupt:
        print("\nStopped.")
