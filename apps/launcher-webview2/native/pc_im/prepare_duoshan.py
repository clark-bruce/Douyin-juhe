"""Offline Duoshan conversation preflight; it never sends or creates data."""
import json
import sys

try:
    material = json.loads(sys.stdin.read() or "{}")
except Exception:
    material = {}
uid = str(material.get("uid") or "") if isinstance(material, dict) else ""
target = str(material.get("targetUid") or "") if isinstance(material, dict) else ""
if uid.isdigit() and target.isdigit() and uid != target:
    print(json.dumps({"ok": True, "conversationId": f"0:1:{uid}:{target}", "message": "仅完成离线校验，实际会话由服务端加载"}, ensure_ascii=False, separators=(",", ":")))
else:
    print(json.dumps({"ok": False, "message": "发送身份或目标 UID 无效"}, ensure_ascii=False, separators=(",", ":")))
    raise SystemExit(1)
