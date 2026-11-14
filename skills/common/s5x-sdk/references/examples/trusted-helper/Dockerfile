# The trusted helper: one small program, the helper, runs as `helper`, the one
# user the template trusts; everything else, the harness included, runs as
# `agent`, the image's USER. Built from references/examples/, so it can copy the
# sealed sign-in beside it:
#
#   docker build -f trusted-helper/Dockerfile -t ghcr.io/acme/assistant:1.4.0 .
#   docker push ghcr.io/acme/assistant:1.4.0
#   s5x template build ghcr.io/acme/assistant:1.4.0 --name assistant --trusted-users helper
#
# or from code: Template.build({ image, name: "assistant", trustedUsers: ["helper"] }).
FROM node:24-trixie-slim

# Chromium, for the helper's sealed sign-in.
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium \
 && rm -rf /var/lib/apt/lists/*

# Nothing set-user-ID or set-group-ID: su, mount and passwd are how a user
# becomes another, and the template's build warns of each one it finds.
RUN find / -xdev -perm /6000 -type f -exec chmod ug-s {} +

# Neither user is root. Each home is 0700 (trixie's HOME_MODE), so the
# helper's browser profile is the helper's alone.
RUN useradd --create-home --uid 1001 helper \
 && useradd --create-home --uid 1002 agent

# Where the volume goes, root's 0755, as the start script requires. On a
# template with trusted users s5x leaves /data as the image has it, so a
# sandbox with no volume at /data gets this one, root's, and so does
# `docker run` without a volume.
RUN install -d -o root -g root -m 0755 /data

# Chrome reads these policies from the machine, root's files, so no user can
# turn the password manager back on. Chromium reads the first directory,
# Google Chrome the second.
COPY sealed-sign-in/chrome-policy.json /etc/chromium/policies/managed/sign-in.json
COPY sealed-sign-in/chrome-policy.json /etc/opt/chrome/policies/managed/sign-in.json

# Laid out as in references/examples/, so the helper finds the sign-in at
# ../sealed-sign-in/sign-in.ts here and there. Root's, so no user changes them.
COPY trusted-helper/start.sh trusted-helper/helper.ts trusted-helper/harness.ts /opt/example/trusted-helper/
COPY sealed-sign-in/sign-in.ts /opt/example/sealed-sign-in/
RUN chmod 0755 /opt/example/trusted-helper/start.sh

# exec, the shell and scheduled commands run as USER, from WORKDIR: agent's
# home, which is in the image, so it is there before any volume is. The
# entrypoint does not: on a template with trusted users s5x starts it as root.
WORKDIR /home/agent
USER agent
ENTRYPOINT ["/opt/example/trusted-helper/start.sh"]
