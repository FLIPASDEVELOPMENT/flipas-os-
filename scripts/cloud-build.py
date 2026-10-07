"""Optional cloud Docker build with the provided proxy CA and DNS resolution."""
import argparse
import os
import socket
import subprocess
import urllib.parse

parser = argparse.ArgumentParser()
parser.add_argument("--target", choices=["runtime", "tools"], default="runtime")
parser.add_argument("--tag", default="flipas-os")
options = parser.parse_args()
args = ["docker", "build"]
proxy = os.environ.get("HTTPS_PROXY")
if proxy:
    host = urllib.parse.urlsplit(proxy).hostname
    address = socket.getaddrinfo(host, None, socket.AF_INET, socket.SOCK_STREAM)[0][4][0]
    args += ["--network", "host", "--add-host", host + ":" + address]
    for name in ["HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY"]:
        if name in os.environ:
            args += ["--build-arg", name]
certificate = os.environ.get("NODE_EXTRA_CA_CERTS")
if certificate:
    args += ["--secret", "id=proxy_ca,src=" + certificate]
args += ["--target", options.target, "-t", options.tag, "."]
raise SystemExit(subprocess.call(args))
