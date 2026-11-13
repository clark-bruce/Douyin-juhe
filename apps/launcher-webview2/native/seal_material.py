"""Create the server-only RSA-OAEP-256 + AES-256-GCM material envelope."""
from __future__ import annotations

import base64
import json
import secrets
import sys

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.backends import default_backend


def main() -> int:
    payload = json.loads(sys.stdin.read() or "{}")
    public_key = serialization.load_pem_public_key(str(payload["publicKey"]).encode("utf-8"), backend=default_backend())
    plaintext = json.dumps(payload["material"], ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    key = secrets.token_bytes(32)
    iv = secrets.token_bytes(12)
    encrypted = AESGCM(key).encrypt(iv, plaintext, None)
    wrapped = public_key.encrypt(
        key,
        padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None),
    )
    envelope = {
        "v": 1,
        "alg": "RSA-OAEP-256+A256GCM",
        "key": base64.b64encode(wrapped).decode("ascii"),
        "iv": base64.b64encode(iv).decode("ascii"),
        "tag": base64.b64encode(encrypted[-16:]).decode("ascii"),
        "data": base64.b64encode(encrypted[:-16]).decode("ascii"),
    }
    sys.stdout.write(base64.b64encode(json.dumps(envelope, separators=(",", ":")).encode("utf-8")).decode("ascii"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
