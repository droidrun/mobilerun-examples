#!/usr/bin/env python3
"""Run the signed mobilerun webhook receiver."""

from mobilerun_webhook_receiver.http_server import run_server

if __name__ == "__main__":
    run_server()
