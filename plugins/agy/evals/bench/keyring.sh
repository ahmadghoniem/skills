#!/bin/bash
# Start a D-Bus session and an unlocked gnome-keyring for agy's sign-in, once per VM.
# Each shell must then load it before running agy:  . /tmp/agy-keyring.env
set -euo pipefail
ENV=/tmp/agy-keyring.env
if [ -f "$ENV" ]; then
  . "$ENV"
  if kill -0 "$DBUS_SESSION_BUS_PID" 2>/dev/null; then echo "already running: . $ENV"; exit 0; fi
fi
eval "$(dbus-launch --sh-syntax)"
# Empty password: the keyring lasts only as long as this throwaway VM.
printf '\n' | gnome-keyring-daemon --unlock >/dev/null
gnome-keyring-daemon --start --components=secrets >/dev/null
printf "export DBUS_SESSION_BUS_ADDRESS='%s'\nexport DBUS_SESSION_BUS_PID=%s\n" "$DBUS_SESSION_BUS_ADDRESS" "$DBUS_SESSION_BUS_PID" > "$ENV"
echo "started: . $ENV"
