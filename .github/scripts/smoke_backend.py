#!/usr/bin/env python3
"""
End-to-end smoke test for the PACKAGED PacketSniffer backend on Linux.

It launches the real PyInstaller binary (not the Python sources) with an
isolated HOME and checks the behaviour the desktop app depends on:

  * the backend starts and answers /api/status (what the Tauri shell waits for)
  * Gemini API key + model are saved, survive a backend restart and are used
    by the chat route afterwards ("enter once, use again during chat")
  * the key lands in the expected store (system keyring or private 0600 file)
  * clearing the key removes it everywhere
  * the Root CA is created with private permissions and can be saved to the
    Downloads folder (the Linux certificate download path)

Only the Python standard library is used.

  --mode fallback   no D-Bus / keyring in the environment -> the private-file
                    fallback must be used
  --mode keyring    a Secret Service is running -> the key must be stored in it
"""

import argparse
import json
import os
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

API = "http://127.0.0.1:8765"
PROXY = "http://127.0.0.1:8080"
KEY = "AIza-ci-smoke-test-key-0123456789"


class Failure(Exception):
    pass


def check(condition, message):
    if not condition:
        raise Failure(message)
    print(f"  ok  {message}")


def call(method, path, body=None, timeout=20):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"} if data is not None else {}
    request = urllib.request.Request(
        API + path, data=data, method=method, headers=headers
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def call_json(method, path, body=None, timeout=20):
    status, raw = call(method, path, body, timeout)

    try:
        return status, json.loads(raw.decode("utf-8"))
    except ValueError:
        return status, {"_raw": raw[:300].decode("utf-8", "replace")}


class Backend:
    def __init__(self, binary, env, log_path):
        self.binary = Path(binary).resolve()
        self.env = env
        self.log_path = log_path
        self.process = None

    def start(self):
        with socket.socket() as probe:
            probe.settimeout(0.5)
            if probe.connect_ex(("127.0.0.1", 8765)) == 0:
                raise Failure("Port 8765 is already in use before the test.")

        log = open(self.log_path, "ab")
        self.process = subprocess.Popen(
            [str(self.binary)],
            cwd=self.binary.parent,
            env=self.env,
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
        )

        deadline = time.monotonic() + 60

        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                raise Failure(
                    f"Backend exited early with code {self.process.returncode}."
                )

            try:
                status, _ = call("GET", "/api/status", timeout=2)
                if status == 200:
                    return
            except (urllib.error.URLError, OSError):
                pass

            time.sleep(0.5)

        raise Failure("Backend did not answer /api/status within 60 seconds.")

    def stop(self):
        if self.process is None or self.process.poll() is not None:
            return

        self.process.terminate()

        try:
            self.process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()

        # Give the OS a moment to release the listening sockets.
        time.sleep(1)

    def restart(self):
        self.stop()
        self.start()


def mode_of(path):
    return stat.S_IMODE(path.stat().st_mode)


def run(binary, mode):
    home = Path(tempfile.mkdtemp(prefix="psnf-home-"))
    config_dir = home / ".config"
    data_dir = home / ".local" / "share"

    env = {
        "HOME": str(home),
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "LANG": "C.UTF-8",
        "XDG_CONFIG_HOME": str(config_dir),
        "XDG_DATA_HOME": str(data_dir),
    }

    if mode == "keyring":
        for name in ("DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR"):
            if name in os.environ:
                env[name] = os.environ[name]

        if "DBUS_SESSION_BUS_ADDRESS" not in env:
            raise Failure("keyring mode needs a D-Bus session with a Secret Service.")

    expected_storage = "system_keyring" if mode == "keyring" else "local_file"

    app_config = config_dir / "PacketSniffer"
    secret_file = app_config / "gemini_api_key.secret"
    ai_json = app_config / "ai.json"
    cert_dir = data_dir / "PacketSniffer" / "certificates"
    log_path = home / "backend.log"

    backend = Backend(binary, env, log_path)

    try:
        print(f"[{mode}] starting backend: {binary}")
        backend.start()
        check(True, "backend started and /api/status answered")

        status, data = call_json("GET", "/api/ai/settings")
        check(status == 200 and data.get("configured") is False,
              "fresh install: AI not configured")

        # ---- save key + model ------------------------------------------
        status, data = call_json(
            "PUT", "/api/ai/settings",
            {"api_key": KEY, "model": "gemini-2.5-pro"},
        )
        check(status == 200, f"PUT /api/ai/settings -> 200 (got {status}: {data})")
        check(data.get("configured") is True and data.get("model") == "gemini-2.5-pro",
              "key saved and model selected")
        check(data.get("credential_storage") == expected_storage,
              f"key stored in {expected_storage}")
        check(KEY not in json.dumps(data), "API key is never echoed back")

        check(json.loads(ai_json.read_text())["model"] == "gemini-2.5-pro",
              "model persisted to ai.json")

        if mode == "fallback":
            check(secret_file.is_file(), "fallback credential file exists")
            check(mode_of(secret_file) == 0o600, "fallback file permissions are 0600")
            check(mode_of(app_config) == 0o700, "config folder permissions are 0700")
            check(secret_file.read_text().strip() == KEY, "fallback file holds the key")
        else:
            check(not secret_file.exists(),
                  "no plaintext copy of the key on disk when a keyring is used")

        # ---- restart: key + model must come back --------------------------
        print(f"[{mode}] restarting backend (simulates closing and reopening the app)")
        backend.restart()

        status, data = call_json("GET", "/api/ai/settings")
        check(data.get("configured") is True and data.get("model") == "gemini-2.5-pro",
              "after restart: key and model are restored")
        check(data.get("credential_storage") == expected_storage,
              "after restart: same credential store is used")

        # model change without re-entering the key keeps the key
        status, data = call_json("PUT", "/api/ai/settings", {"model": "gemini-2.5-flash"})
        check(data.get("configured") is True and data.get("model") == "gemini-2.5-flash",
              "changing only the model keeps the saved key")

        # chat must use the stored key: it may fail at the provider (fake key,
        # maybe no network) but must NOT report 'key not configured' (503).
        status, data = call_json("POST", "/api/ai/chat", {"message": "ping"}, timeout=70)
        check(status != 503,
              f"chat route uses the stored key (status {status}, not 'not configured')")

        # ---- clear key ------------------------------------------------------
        status, data = call_json(
            "PUT", "/api/ai/settings",
            {"model": "gemini-2.5-flash", "clear_api_key": True},
        )
        check(data.get("configured") is False, "clearing the key works")
        check(not secret_file.exists(), "no key file left after clearing")

        backend.restart()
        status, data = call_json("GET", "/api/ai/settings")
        check(data.get("configured") is False, "after restart: key stays cleared")
        check(data.get("model") == "gemini-2.5-flash", "after restart: model still remembered")

        # ---- certificate ----------------------------------------------------
        status, data = call_json("GET", "/api/certificate")
        check(status == 200 and data.get("available") is True, "Root CA was generated")
        check(mode_of(cert_dir) == 0o700, "certificate folder permissions are 0700")
        check(mode_of(cert_dir / "packetsniff-ca.key") == 0o600,
              "CA private key permissions are 0600")

        status, raw = call("GET", "/api/certificate/download")
        check(status == 200 and raw.startswith(b"-----BEGIN CERTIFICATE-----"),
              "certificate download endpoint serves a PEM certificate")

        status, data = call_json("POST", "/api/certificate/save")
        check(status == 200, f"POST /api/certificate/save -> 200 (got {status}: {data})")
        saved = Path(data.get("path", ""))
        check(saved.parent == home / "Downloads" and saved.name == "packetsniff-ca.crt",
              f"certificate saved to ~/Downloads ({saved})")
        check(saved.read_bytes() == raw, "saved certificate matches the served one")

        # ---- proxy (informational only) --------------------------------------
        try_proxy_forwarding()

        print(f"[{mode}] ALL CHECKS PASSED")

    except Exception:
        print(f"\n[{mode}] FAILED. Backend log:")
        print("-" * 60)
        try:
            print(log_path.read_text(errors="replace")[-6000:])
        except OSError:
            print("(no log)")
        print("-" * 60)
        raise

    finally:
        backend.stop()
        shutil.rmtree(home, ignore_errors=True)


def try_proxy_forwarding():
    """Best-effort end-to-end check of the proxy. Never fails the build."""

    class Hello(BaseHTTPRequestHandler):
        def do_GET(self):
            body = b"hello-from-origin"
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 18080), Hello)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    try:
        status, _ = call("POST", "/api/proxy/start")
        if status != 200:
            print(f"  --  proxy start returned {status}; forwarding check skipped")
            return

        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({"http": PROXY})
        )

        with opener.open("http://127.0.0.1:18080/hello", timeout=10) as response:
            body = response.read()

        if body == b"hello-from-origin":
            print("  ok  proxy forwarded an HTTP request end to end")
        else:
            print(f"  --  proxy answered with unexpected body {body[:60]!r} (informational)")

        call("POST", "/api/proxy/stop")

    except Exception as error:
        print(f"  --  proxy forwarding check skipped ({error!r}) (informational)")

    finally:
        server.shutdown()
        server.server_close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", required=True)
    parser.add_argument("--mode", choices=("fallback", "keyring"), required=True)
    args = parser.parse_args()

    if not Path(args.binary).is_file():
        print(f"Backend binary not found: {args.binary}", file=sys.stderr)
        return 2

    try:
        run(args.binary, args.mode)
    except Exception as error:
        print(f"SMOKE TEST FAILED: {error}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
