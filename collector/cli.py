"""Fetch one public item for the JavaScript CLI, without running an HTTP service."""
import json
import sys
from collector import collect, SourceError, requests

try:
    if len(sys.argv) != 2:
        raise SourceError("invalid_url", 400)
    print(json.dumps(collect(sys.argv[1]), ensure_ascii=False))
except SourceError as error:
    print(error.code, file=sys.stderr)
    sys.exit(1)
except requests.RequestsError:
    print("source_unavailable", file=sys.stderr)
    sys.exit(1)
