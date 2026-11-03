"""Run the API locally: `tripmap-api [--port N]`. It always binds to 127.0.0.1."""
import argparse

import uvicorn

from .app import create_app


def main(argv=None):
    ap = argparse.ArgumentParser(prog="tripmap-api",
                                 description="Serve the tripmap HTTP API on 127.0.0.1 (loopback only).")
    ap.add_argument("--port", type=int, default=8000, help="port to listen on (default 8000)")
    args = ap.parse_args(argv)
    uvicorn.run(create_app(), host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
