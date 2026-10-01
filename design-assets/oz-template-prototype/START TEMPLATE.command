#!/bin/bash
cd "$(dirname "$0")" || exit 1
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 belum tersedia. Buka index.html langsung di browser."
  read -r -p "Tekan Enter untuk menutup..."
  exit 1
fi
python3 -m http.server 8765 >/tmp/oz-template-server.log 2>&1 &
oz_server_pid=$!
trap 'kill "$oz_server_pid" 2>/dev/null' EXIT
sleep 1
open "http://localhost:8765"
echo "OZ Template aktif di http://localhost:8765"
echo "Biarkan jendela ini terbuka. Tekan Control+C untuk berhenti."
wait "$oz_server_pid"
