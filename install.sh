#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bin_dir="${X_IMPLEMENT_BIN_DIR:-$HOME/.local/bin}"

for command_name in node npm claude glab; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Prérequis manquant : %s\n' "$command_name" >&2
    exit 1
  fi
done

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if (( node_major < 22 )); then
  printf 'Node.js 22 ou plus récent est requis. Version détectée : %s\n' "$(node --version)" >&2
  exit 1
fi

printf 'Installation des dépendances…\n'
npm ci --prefix "$repo_root/harness" --no-audit --no-fund
printf 'Compilation de l’interface…\n'
npm run build --prefix "$repo_root/harness"

if [[ ! -f "$repo_root/.env" ]]; then
  cp "$repo_root/.env.example" "$repo_root/.env"
fi

mkdir -p "$bin_dir"
chmod +x "$repo_root/bin/x-implement-ui"
ln -sfn "$repo_root/bin/x-implement-ui" "$bin_dir/x-implement-ui"
ln -sfn "$repo_root/bin/x-implement-ui" "$bin_dir/ximpl"

printf '\nInstallation terminée.\n'
printf 'Lancer l’interface : ximpl\n'
printf 'Traiter les retours RSI : ximpl improve\n'
if [[ ":$PATH:" != *":$bin_dir:"* ]]; then
  printf '\nAjoute %s à PATH, puis ouvre un nouveau terminal :\n' "$bin_dir"
  printf '  export PATH="%s:$PATH"\n' "$bin_dir"
fi
