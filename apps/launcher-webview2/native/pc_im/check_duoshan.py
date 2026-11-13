"""Offline validation for captured Duoshan PC material."""
import json
import sys

try:
    material = json.loads(sys.stdin.read() or "{}")
except Exception:
    material = {}
cookie = material.get("cookie") if isinstance(material, dict) else ""
uid = str(material.get("uid") or "") if isinstance(material, dict) else ""
if isinstance(cookie, str) and "sessionid=" in cookie and uid.isdigit():
    print(json.dumps({"ok": True, "status": "authenticated", "capabilities": ["duoshan_pc_im", "cmd_100", "cmd_300", "cmd_301"]}, ensure_ascii=False, separators=(",", ":")))
else:
    print(json.dumps({"ok": False, "code": "LOGIN_PENDING", "message": "抖音聊天身份材料不完整"}, ensure_ascii=False, separators=(",", ":")))
    raise SystemExit(1)
