"""Minimal Duoshan PC IM protobuf builders used by offline tooling."""
from __future__ import annotations

def varint(value: int) -> bytes:
    value = int(value)
    if value < 0:
        raise ValueError("negative protobuf value")
    out = bytearray()
    while True:
        byte = value & 0x7f
        value >>= 7
        out.append(byte | (0x80 if value else 0))
        if not value:
            return bytes(out)

def field_varint(number: int, value: int) -> bytes:
    return varint((int(number) << 3) | 0) + varint(value)

def field_bytes(number: int, value: bytes) -> bytes:
    value = bytes(value)
    return varint((int(number) << 3) | 2) + varint(len(value)) + value

def field_string(number: int, value: str) -> bytes:
    return field_bytes(number, str(value).encode("utf-8"))

def build_request(command: int, body_field: int, body: bytes, uid: str, sequence_id: int = 1) -> bytes:
    inner = field_bytes(body_field, body)
    return b"".join([
        field_varint(1, command), field_varint(2, sequence_id), field_string(3, "1.1.33"),
        field_string(4, ""), field_varint(5, 0), field_varint(6, 1),
        field_string(7, "1.1.33(420753164)"), field_bytes(8, inner), field_string(9, uid),
        field_string(10, "official"), field_string(11, "windows"), field_string(12, "x64"),
        field_string(13, "10.0.19045"), field_string(14, "1.1.33"), field_varint(18, 1),
        field_string(21, "douyin_im_pc"), field_string(22, "cpp_sdk"),
    ])

def build_conversation_list(uid: str, cursor: int = 0, sequence_id: int = 1) -> bytes:
    return build_request(300, 300, field_varint(1, cursor), uid, sequence_id)

def build_history(uid: str, conversation_id: str, cursor: int = 0, limit: int = 50, sequence_id: int = 1) -> bytes:
    body = field_string(1, conversation_id) + field_varint(2, cursor) + field_varint(3, limit)
    return build_request(301, 301, body, uid, sequence_id)

def decode_fields(data: bytes):
    result = {}
    offset = 0
    while offset < len(data):
        key, offset = read_varint(data, offset)
        number, wire = key >> 3, key & 7
        if wire == 0:
            value, offset = read_varint(data, offset)
        elif wire == 2:
            size, offset = read_varint(data, offset)
            end = offset + size
            if end > len(data):
                raise ValueError("truncated protobuf field")
            value, offset = data[offset:end], end
        else:
            raise ValueError("unsupported protobuf wire type")
        result.setdefault(number, []).append(value)
    return result

def read_varint(data: bytes, offset: int = 0):
    value = 0
    shift = 0
    while offset < len(data) and shift < 70:
        byte = data[offset]
        offset += 1
        value |= (byte & 0x7f) << shift
        if not byte & 0x80:
            return value, offset
        shift += 7
    raise ValueError("truncated protobuf varint")

def response_body(data: bytes, command: int) -> bytes:
    root = decode_fields(data)
    container = (root.get(6) or [b""])[0]
    return (decode_fields(container).get(command) or [b""])[0]

def conversation_ids(data: bytes) -> list[str]:
    body = decode_fields(response_body(data, 300))
    output = []
    for raw in body.get(1, []):
        fields = decode_fields(raw)
        value = (fields.get(1) or [b""])[0]
        if isinstance(value, bytes):
            value = value.decode("utf-8", "replace")
        if value:
            output.append(str(value)[:300])
    return output
