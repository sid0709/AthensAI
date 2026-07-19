#!/usr/bin/env python3
"""XOR + base64 encode an endpoint URL so packed extension JS has no plaintext host."""
from __future__ import annotations

import base64
import sys

KEY = b"athens-ext-cfg-v1"


def encode(url: str) -> str:
    raw = url.encode("utf-8")
    xored = bytes(b ^ KEY[i % len(KEY)] for i, b in enumerate(raw))
    return base64.b64encode(xored).decode("ascii")


def decode(token: str) -> str:
    raw = base64.b64decode(token.encode("ascii"))
    return bytes(b ^ KEY[i % len(KEY)] for i, b in enumerate(raw)).decode("utf-8")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: encode-endpoint.py <url>", file=sys.stderr)
        sys.exit(2)
    print(encode(sys.argv[1].strip()), end="")
