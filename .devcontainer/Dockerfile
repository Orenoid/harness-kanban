FROM mcr.microsoft.com/devcontainers/javascript-node:22-bookworm

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN apt-get update \
  && export DEBIAN_FRONTEND=noninteractive \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg iptables uidmap dbus-user-session fuse-overlayfs pigz xz-utils \
  && install -m 0755 -d /etc/apt/keyrings \
  && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
  && chmod a+r /etc/apt/keyrings/docker.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

COPY scripts/start-docker.sh /usr/local/share/harness-kanban/start-docker.sh

RUN chmod 0755 /usr/local/share/harness-kanban/start-docker.sh

ENTRYPOINT ["/usr/local/share/harness-kanban/start-docker.sh"]
CMD ["sleep", "infinity"]
