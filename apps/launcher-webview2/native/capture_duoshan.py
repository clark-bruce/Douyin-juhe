"""Read the local Douyin Chat PC profile and return one JSON IPC result."""
from __future__ import annotations

import base64
import ctypes
import ctypes.wintypes as wintypes
import json
import os
import re
import urllib.parse
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time

COOKIE_NAMES = {"sessionid", "sessionid_ss", "sid_tt", "uid_tt", "uid_tt_ss", "sid_guard", "sid_ucp_v1", "ssid_ucp_v1", "session_tlb_tag", "passport_csrf_token", "passport_assist_user", "ttwid", "s_v_web_id", "has_biz_token", "is_staff_user"}
COOKIE_ORDER = ("sessionid", "sessionid_ss", "sid_tt", "uid_tt", "uid_tt_ss", "sid_guard", "sid_ucp_v1", "ssid_ucp_v1", "session_tlb_tag", "passport_csrf_token", "passport_assist_user", "ttwid", "s_v_web_id", "has_biz_token", "is_staff_user")
DOMAIN_SUFFIXES = (".douyin.com", "douyin.com")

class CaptureError(RuntimeError):
    pass

class _Blob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

def dpapi_unprotect(value: bytes) -> bytes:
    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    source = ctypes.create_string_buffer(value, len(value))
    incoming = _Blob(len(value), ctypes.cast(source, ctypes.POINTER(ctypes.c_char)))
    outgoing = _Blob()
    if not crypt32.CryptUnprotectData(ctypes.byref(incoming), None, None, None, None, 0, ctypes.byref(outgoing)):
        raise CaptureError(f"Windows 凭据解密失败（{ctypes.get_last_error()}）")
    try:
        return ctypes.string_at(outgoing.pbData, outgoing.cbData)
    finally:
        kernel32.LocalFree(outgoing.pbData)

def _profile() -> Path:
    explicit = os.environ.get("DOUYIN_CHAT_PROFILE")
    if explicit:
        return Path(explicit).expanduser()
    appdata = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
    return Path(appdata) / "抖音聊天"

def _cookie_key(profile: Path) -> bytes:
    try:
        state = json.loads((profile / "Local State").read_text(encoding="utf-8"))
        raw = base64.b64decode(state["os_crypt"]["encrypted_key"])
    except Exception as exc:
        raise CaptureError("抖音聊天 Local State 不可读取") from exc
    if not raw.startswith(b"DPAPI"):
        raise CaptureError("抖音聊天主密钥格式不受支持")
    return dpapi_unprotect(raw[5:])

def _decrypt(blob: bytes, key: bytes) -> str:
    if blob[:3] not in (b"v10", b"v11"):
        raise CaptureError("抖音聊天 cookie 加密版本不受支持")
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    except ImportError as exc:
        raise CaptureError("缺少 cryptography 依赖") from exc
    try:
        plain = AESGCM(key).decrypt(blob[3:15], blob[15:], None)
    except Exception as exc:
        raise CaptureError("抖音聊天 cookie 解密失败") from exc
    if len(plain) > 33 and any(byte < 32 or byte >= 127 for byte in plain[:32]) and all(32 <= byte < 127 or byte == 9 for byte in plain[32:]):
        plain = plain[32:]
    return plain.decode("utf-8", "replace")

def _read_cookie_rows(profile: Path):
    source = profile / "Network" / "Cookies"
    if not source.is_file():
        raise CaptureError("没有找到抖音聊天 cookie 库")
    # 1.1.33 can keep a plaintext value in the cookie database while the
    # Chromium Local State file is absent. Read the rows first and only
    # require DPAPI/AES-GCM when an encrypted value is actually present.
    with tempfile.TemporaryDirectory(prefix="douyinjuhe-duoshan-") as work:
        snapshot = Path(work) / "Cookies"
        try:
            shutil.copyfile(source, snapshot)
        except OSError as exc:
            raise CaptureError("抖音聊天正在占用 cookie 库，请退出后重试") from exc
        try:
            conn = sqlite3.connect(f"file:{snapshot.as_posix()}?mode=ro", uri=True)
            rows = conn.execute("SELECT host_key,name,value,encrypted_value FROM cookies ORDER BY host_key,name").fetchall()
            conn.close()
        except sqlite3.Error as exc:
            raise CaptureError("抖音聊天 cookie 库读取失败") from exc
    key = None
    result = []
    for host, name, plain, encrypted in rows:
        host = str(host or "")
        if not any(host.endswith(suffix) for suffix in DOMAIN_SUFFIXES):
            continue
        if plain:
            value = str(plain)
        elif encrypted:
            if key is None:
                key = _cookie_key(profile)
            value = _decrypt(bytes(encrypted), key)
        else:
            value = ""
        if value and str(name) in COOKIE_NAMES:
            result.append((str(name), value))
    return result

def _uid(profile: Path) -> str:
    root = profile / "db"
    candidates = []
    if root.is_dir():
        for marker in root.rglob("aweme_im_info_db"):
            if not marker.is_file() or not marker.parent.name.isdigit():
                continue
            try:
                candidates.append((marker.stat().st_mtime, marker.parent.name))
            except OSError:
                pass
        if candidates:
            return max(candidates)[1]
        for item in root.rglob("*"):
            if item.is_dir() and item.name.isdigit():
                try:
                    candidates.append((item.stat().st_mtime, item.name))
                except OSError:
                    pass
    if candidates:
        return max(candidates)[1]
    return _uid_from_indexeddb(profile)

def _uid_from_indexeddb(profile: Path) -> str:
    counts = {}
    for path in (profile / "IndexedDB").rglob("*"):
        if not path.is_file() or path.suffix not in (".log", ".ldb"):
            continue
        try:
            data = path.read_bytes()
        except OSError:
            continue
        for uid in re.findall(rb"(\d{8,25})_(?:user|kv-store)", data):
            counts[uid] = counts.get(uid, 0) + 1
    return max(counts, key=counts.get).decode() if counts else ""

def _uid_from_cookie_values(values: dict) -> str:
    for name in ("uid_tt", "uid_tt_ss", "uid_tt_ss_v2"):
        value = str(values.get(name) or "").strip()
        if re.fullmatch(r"\d{5,25}", value):
            return value
    return ""

def _profile_identity(profile: Path, uid: str) -> dict:
    """Read the optional local IM profile without making the server a dependency.

    Client releases have used several SQLite table/column names.  Probe only
    clearly identity-shaped columns and ignore locked, encrypted, or malformed
    databases; the PC protocol UID remains sufficient to continue login.
    """
    names = {
        "nickname": ("nickname", "nick_name", "display_name", "user_name"),
        "douyinId": ("unique_id", "uniqueid", "short_id", "shortid", "douyin_id", "douyinid"),
        "avatar": ("avatar", "avatar_url", "avatar_thumb", "avatar_medium", "avatar_larger"),
    }
    uid_names = ("uid", "user_id", "userid", "userId", "account_id", "accountid")
    candidates = []
    for root in [profile / "db", profile]:
        if not root.is_dir():
            continue
        candidates.extend(item for item in root.rglob("*") if item.is_file() and item.name != "Cookies" and item.suffix.lower() in ("", ".db", ".sqlite", ".sqlite3"))
    for database in candidates:
        conn = None
        try:
            conn = sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True, timeout=0.2)
            tables = [row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
            for table in tables:
                safe_table = '"' + str(table).replace('"', '""') + '"'
                columns = [str(row[1]) for row in conn.execute(f"PRAGMA table_info({safe_table})").fetchall()]
                lowered = {column.lower(): column for column in columns}
                selected = []
                for key, aliases in names.items():
                    match = next((lowered[alias.lower()] for alias in aliases if alias.lower() in lowered), None)
                    if match:
                        selected.append((key, match))
                if not selected:
                    continue
                uid_column = next((lowered[alias.lower()] for alias in uid_names if alias.lower() in lowered), None)
                select_columns = [column for _, column in selected] + ([uid_column] if uid_column else [])
                quoted = ','.join('"' + column.replace('"', '""') + '"' for column in select_columns)
                rows = conn.execute(f"SELECT {quoted} FROM {safe_table} LIMIT 50").fetchall()
                for row in rows:
                    values = dict(zip(select_columns, row))
                    if uid_column and str(values.get(uid_column) or "").strip() not in ("", str(uid)):
                        continue
                    result = {}
                    for key, column in selected:
                        value = str(values.get(column) or "").strip()
                        if key == "avatar":
                            match = re.search(r"https?://[^\"'\\s]+", value)
                            value = match.group(0) if match else value
                        if value:
                            result[key] = value[:2048 if key == "avatar" else 100]
                    if result:
                        return result
        except Exception:
            pass
        finally:
            try:
                if conn is not None:
                    conn.close()
            except Exception:
                pass
    return {}

def _web_identity(profile: Path, values: dict) -> dict:
    """Read bounded Web identity hints from Chromium storage without exporting arbitrary data."""
    result = {}
    verify_fp = str(values.get("s_v_web_id") or "").strip()
    if verify_fp:
        result["verifyFp"] = verify_fp[:256]
    roots = [profile / "Local Storage" / "leveldb", profile / "Session Storage"]
    blobs = []
    total = 0
    for root in roots:
        if not root.is_dir():
            continue
        for item in root.iterdir():
            if not item.is_file() or item.suffix.lower() not in ("", ".log", ".ldb"):
                continue
            try:
                if item.stat().st_size > 8 * 1024 * 1024 or total >= 32 * 1024 * 1024:
                    continue
                data = item.read_bytes()
                total += len(data)
                blobs.append(data.decode("utf-8", "ignore"))
            except OSError:
                continue
    text = "\n".join(blobs)
    tea = re.search(r'__tea_cache_tokens_\d+r[^\x20-\x7e]*[.{]?(\{"web_id":"(\d{8,30})"[^}]*\})', text)
    if tea:
        result["webId"] = tea.group(2)
    # SLARDAR storage values are URL-encoded JSON wrapped in base64. Keep only
    # the device/user identity fields; never export the whole storage record.
    fallback_device = ''
    for encoded in re.findall(r'JTdCJTIydXNlcklk[^\x20.]{40,600}', text):
        try:
            decoded = urllib.parse.unquote(base64.b64decode(encoded + "=" * (-len(encoded) % 4)).decode("utf-8"))
            payload = json.loads(decoded)
            device_id = str(payload.get("deviceId") or "").strip()
            if device_id:
                if not fallback_device:
                    fallback_device = device_id
                if re.fullmatch(r"[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,}", device_id):
                    result["identityDeviceId"] = device_id[:128]
                    result["identityUserId"] = str(payload.get("userId") or "").strip()[:64]
                    break
        except Exception:
            continue
    if "identityDeviceId" not in result and fallback_device:
        result["identityDeviceId"] = fallback_device[:128]
    # The signing SDK may persist a web_protect JSON envelope. Capture only
    # bounded non-secret identity fields for the next protocol stage.
    for match in re.finditer(r'web_protect.{0,1200}', text, re.IGNORECASE | re.DOTALL):
        fragment = match.group(0)
        for key in ("identity_token", "identityToken", "security_token", "securityToken"):
            token = re.search(rf'"{re.escape(key)}"\s*:\s*"([^"]{{1,4096}})"', fragment)
            if token:
                result["identityToken"] = token.group(1)
                break
        if result.get("identityToken"):
            break
    return result

def _capture(allow_close=False):
    profile = _profile()
    try:
        rows = _read_cookie_rows(profile)
    except CaptureError:
        if not allow_close:
            raise
        subprocess.run(["taskkill", "/IM", "douyinim.exe", "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        time.sleep(1)
        rows = _read_cookie_rows(profile)
    values = {name: value for name, value in rows}
    if "sessionid" not in values:
        raise CaptureError("抖音聊天尚未登录或没有 sessionid")
    uid = _uid(profile) or _uid_from_cookie_values(values)
    if not uid:
        raise CaptureError("无法从抖音聊天 profile 确定 UID")
    identity = _profile_identity(profile, uid)
    card_identity = _web_identity(profile, values)
    ordered = [name for name in COOKIE_ORDER if name in values]
    return {"ok": True, "uid": uid, "nickname": identity.get("nickname", ""), "douyinId": identity.get("douyinId", ""), "avatar": identity.get("avatar", ""), "cookie": "; ".join(f"{name}={values[name]}" for name in ordered), "cookieNames": ordered, "version": "1.1.34", "profile": str(profile), "source": "duoshan-pc-profile", "cardIdentity": card_identity}

def main():
    try:
        result = _capture("--close-client" in sys.argv[1:])
    except Exception as exc:
        result = {"ok": False, "code": "LOGIN_PENDING", "message": str(exc)[:240]}
    # Windows uses the active system code page for a redirected Python stream
    # by default (often GBK).  The launcher reads the IPC channel as UTF-8;
    # writing the JSON bytes explicitly prevents Chinese diagnostics from
    # becoming replacement characters (�) before the UI can display them.
    payload = json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    sys.stdout.buffer.write(payload)
    sys.stdout.buffer.flush()
    return 0 if result.get("ok") else 1

if __name__ == "__main__":
    raise SystemExit(main())
