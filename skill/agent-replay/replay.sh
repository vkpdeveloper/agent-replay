#!/bin/sh
# Runs agent-replay. On first use it installs the latest release for this
# machine from GitHub, and it checks for a newer release at most once a day.
# Set AGENT_REPLAY_NO_UPDATE=1 to skip the check.
set -e

repo=vkpdeveloper/agent-replay
home=${AGENT_REPLAY_HOME:-$HOME/.local/share/agent-replay}

fail() {
  echo "agent-replay: $*" >&2
  exit 1
}

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  MINGW* | MSYS* | CYGWIN*) os=windows ;;
  *) fail "unsupported OS $(uname -s)" ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch=x64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) fail "unsupported CPU $(uname -m)" ;;
esac
# A shell under Rosetta reports x86_64 on Apple Silicon.
if [ "$os" = darwin ] && [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = 1 ]; then arch=arm64; fi
# Windows on Arm runs the x64 build.
exe=agent-replay
if [ "$os" = windows ]; then
  arch=x64
  exe=agent-replay.exe
fi
bin="$home/$exe"

# Latest release version, from the redirect of /releases/latest (no API rate limit).
latest() {
  curl -fsSI "https://github.com/$repo/releases/latest" | tr -d '\r' | grep -i '^location:' | sed -n 's#.*/releases/tag/v##p'
}

# True when version $1 is newer than version $2.
newer() {
  [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1)" = "$1" ]
}

install() {
  echo "agent-replay: installing v$1 for $os-$arch" >&2
  mkdir -p "$home" || return 1
  tmp=$(mktemp -d "$home/.install.XXXXXX") || return 1
  # A progress bar only in a terminal; agents capture stderr.
  progress=-sS
  if [ -t 2 ]; then progress=--progress-bar; fi
  if ! curl -fL "$progress" "https://github.com/$repo/releases/download/v$1/agent-replay-$os-$arch.tar.gz" -o "$tmp/release.tar.gz" ||
    ! tar -xzf "$tmp/release.tar.gz" -C "$tmp"; then
    rm -rf "$tmp"
    return 1
  fi
  # Swap in only what the release ships, keeping node_modules/.remotion,
  # where the Chrome used for MP4s is cached.
  for name in "$exe" site compositor package.json; do
    rm -rf "${home:?}/$name"
    mv "$tmp/$name" "$home/$name"
  done
  rm -rf "$tmp"
  if [ "$os" != windows ] && [ -z "${AGENT_REPLAY_HOME:-}" ]; then
    mkdir -p "$HOME/.local/bin" && ln -sf "$bin" "$HOME/.local/bin/agent-replay"
  fi
}

checked="$home/.last-update-check"
now=$(date +%s)
if [ ! -x "$bin" ]; then
  version=$(latest) || true
  [ -n "$version" ] || fail "could not find the latest release on github.com/$repo"
  install "$version" || fail "install failed"
  echo "$now" >"$checked"
elif [ "${AGENT_REPLAY_NO_UPDATE:-}" != 1 ] && [ $((now - $(cat "$checked" 2>/dev/null || echo 0))) -ge 86400 ]; then
  echo "$now" >"$checked"
  version=$(latest 2>/dev/null) || true
  current=$("$bin" --version 2>/dev/null) || current=0
  if [ -n "$version" ] && newer "$version" "$current"; then
    install "$version" || echo "agent-replay: update to v$version failed, using v$current" >&2
  fi
fi

exec "$bin" "$@"
