#!/usr/bin/env bash
set -euo pipefail

repository="https://github.com/Greg-Klein/implementation-harness.git"
install_dir="${X_IMPLEMENT_INSTALL_DIR:-$HOME/.local/share/implementation-harness}"

if ! command -v git >/dev/null 2>&1; then
  printf 'Prérequis manquant : git\n' >&2
  exit 1
fi

if [[ -d "$install_dir/.git" ]]; then
  printf 'Mise à jour de %s…\n' "$install_dir"
  git -C "$install_dir" pull --ff-only
elif [[ -e "$install_dir" ]]; then
  printf 'Le chemin existe déjà mais ne contient pas le dépôt : %s\n' "$install_dir" >&2
  exit 1
else
  printf 'Installation dans %s…\n' "$install_dir"
  mkdir -p "$(dirname "$install_dir")"
  git clone "$repository" "$install_dir"
fi

exec "$install_dir/install.sh"
