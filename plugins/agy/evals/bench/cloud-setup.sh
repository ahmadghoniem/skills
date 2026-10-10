#!/bin/bash
# Setup script for the Claude Code cloud environment that runs the agy benchmark.
# Paste it into the environment's "Setup script" field. It runs as root before
# Claude starts, and what it installs is cached for later sessions.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

# agy keeps its Google sign-in in the Secret Service keyring; a headless VM has none.
apt-get update -qq
apt-get install -y -qq gnome-keyring dbus-x11 libsecret-1-0 >/dev/null

curl -fsSL https://antigravity.google/cli/install.sh | bash -s -- --dir /usr/local/bin

mkdir -p /opt/bench
git clone -q https://github.com/backnotprop/plannotator.git /opt/bench/plannotator
git -C /opt/bench/plannotator checkout -q b381ecbe
chmod -R a+rwX /opt/bench
