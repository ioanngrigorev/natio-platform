#!/bin/sh
#
# Make sure every key in deploy/host/authorized_keys can log in as root.
#
# Why this exists: bootstrap.sh disables SSH passwords and only installs a key
# when SSH_PUBKEY is passed, and on the first production host it was not. The
# only way in was the provider's web console, which mangles the special
# characters in a typed password badly enough that the root password could not
# be entered at all. The deploy pipeline already runs as root on the host, so
# anyone who can change this repository can already act as root there; routing
# operator access through it adds no new trust, and turns "who can get in" into
# a reviewed, versioned file instead of something done by hand in a console.
#
# Additive and idempotent: a key already present is left alone, nothing is ever
# removed, and a failure here never fails the deploy — losing a deploy over SSH
# bookkeeping would be the wrong trade.
#
# Paths are parameters, so the same script also works when run by hand on a
# host, outside the container.

dir=${HOST_SSH_DIR:-/host-ssh}
keys=${KEYS_FILE:-/keys}
file="$dir/authorized_keys"

if [ ! -r "$keys" ]; then
  echo "host-access: no key list at $keys; nothing to do"
  exit 0
fi

mkdir -p "$dir" && chmod 700 "$dir" || { echo "host-access: cannot prepare $dir"; exit 0; }
touch "$file" || { echo "host-access: cannot write $file"; exit 0; }

# A file without a trailing newline would have the next key glued onto its last
# line, turning two good entries into one broken one.
if [ -s "$file" ] && [ "$(tail -c 1 "$file" | od -An -c | tr -d ' ')" != '\n' ]; then
  echo >> "$file"
fi

added=0
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    ''|'#'*) continue ;;
  esac
  if ! grep -qxF -- "$line" "$file"; then
    printf '%s\n' "$line" >> "$file"
    added=$((added + 1))
  fi
done < "$keys"

chmod 600 "$file"
chown 0:0 "$dir" "$file" 2>/dev/null || true
echo "host-access: $added key(s) added, $(grep -c '^ssh-' "$file") present in $file"
exit 0
