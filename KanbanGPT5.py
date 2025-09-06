#!/usr/bin/env python3
import http.server
import socketserver
import os
import webbrowser
import threading


def open_browser(port: int) -> None:
    try:
        webbrowser.open_new(f"http://localhost:{port}")
    except Exception:
        pass


def run_server() -> None:
    base_dir = os.path.dirname(os.path.abspath(__file__))
    public_dir = os.path.join(base_dir, "public")
    if not os.path.isdir(public_dir):
        raise SystemExit(
            "public/ directory not found. Please ensure the static files are created at 'public/'."
        )

    os.chdir(public_dir)

    port = int(os.environ.get("PORT", "8000"))
    handler = http.server.SimpleHTTPRequestHandler

    with socketserver.TCPServer(("", port), handler) as httpd:
        print(f"KanbanGPT5 server running at http://localhost:{port}")
        # Open browser shortly after server starts
        threading.Timer(0.8, open_browser, args=(port,)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server...")
        finally:
            httpd.server_close()


if __name__ == "__main__":
    run_server()


