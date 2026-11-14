#!/bin/sh
# The sandbox's entrypoint. On a template with trusted users s5x starts it as
# root, whatever the image's USER says, so this script decides who runs what,
# and is the only thing here that runs as root.
set -eu

refuse() {
  echo "start.sh: $*" >&2
  exit 1
}

# Run a program as a user, with that user's groups and home, from its home:
# WORKDIR is agent's home, which no other user may enter. setpriv opens no
# login session and keeps the environment, so what s5x puts there (box.env)
# reaches both programs: a secret only the helper may see goes in the vault.
as() {
  user=$1
  shift
  HOME=$(getent passwd "$user" | cut -d: -f6)
  export HOME USER="$user" LOGNAME="$user"
  cd "$HOME"
  exec setpriv --reuid="$user" --regid="$user" --init-groups -- "$@"
}

# The volume at /data must be root's, 0755, before root makes anything in it.
# A fresh volume's root is, on a template with trusted users. A volume that
# held files before keeps its owner, often USER, and then the assistant could
# have left a link where this script makes a directory (/data/sessions ->
# /etc) for root to follow. Before an older volume moves to trusted users,
# make its root root's (chown root:root, chmod 0755) and check what is at its
# top: an entry USER made there stays USER's.
[ "$(stat -c %u:%a /data)" = 0:755 ] || refuse "/data is $(stat -c %U:%a /data), not root's 0755: see the comment above"
for dir in /data/workspace /data/sessions; do
  [ ! -L "$dir" ] || refuse "$dir is a link, which root does not follow"
done

# The harness's own directory, made at every start.
install -d -o agent -g agent -m 0755 /data/workspace
# Sessions the helper hands the harness. Set-group-ID, so each file the
# helper writes here is the agent group's, which may only read it.
install -d -o helper -g agent -m 2750 /data/sessions
# On a volume from before trusted users, agent may have left files here: only
# the helper's stay, so no session the harness loads is agent's to rewrite.
find /data/sessions -mindepth 1 -maxdepth 1 ! -user helper -exec rm -rf -- {} +
# The helper's socket: the helper's directory, which agent's group may enter,
# so only the helper and agent reach it. Made afresh at each start; /run is
# root's, and only the helper writes in it, so nothing of agent's is in it.
rm -rf /run/helper
install -d -o helper -g agent -m 0750 /run/helper

# The helper, as the one trusted user, restarted whenever it exits by a loop
# that runs as the helper too, so no root process is left. It logs to a file
# of its own, root's (opened here, in a directory only root writes), not to
# this script's output, the app's log, where agent could write lines that look
# like the helper's. Its socket is waited for, up to 10 s, so the harness's
# first sign-in finds it.
(as helper sh -c 'while :; do node /opt/example/trusted-helper/helper.ts; sleep 1; done') >>/var/log/helper.log 2>&1 &
i=0
until [ -S /run/helper/helper.sock ] || [ "$i" -ge 100 ]; do
  sleep 0.1
  i=$((i + 1))
done

# The harness, as USER, with everything the assistant does: whatever the model
# asks for runs as agent, which cannot read a login or the vault. `as` execs,
# so the harness takes this script's place, as the process s5x signals, and
# nothing is left running as root.
as agent node /opt/example/trusted-helper/harness.ts
