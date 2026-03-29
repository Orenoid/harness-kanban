#!/usr/bin/env bash

set -euo pipefail

DOCKER_SOCKET="${DOCKER_SOCKET:-/var/run/docker.sock}"
DOCKERD_LOG_FILE="${DOCKERD_LOG_FILE:-/tmp/dockerd.log}"
DOCKERD_MAX_ATTEMPTS="${DOCKERD_MAX_ATTEMPTS:-60}"
DOCKERD_RETRY_DELAY_SECONDS="${DOCKERD_RETRY_DELAY_SECONDS:-1}"
DOCKERD_STORAGE_DRIVER="${DOCKERD_STORAGE_DRIVER:-overlay2}"

ensure_node_can_access_docker() {
  if ! id node >/dev/null 2>&1; then
    return 0
  fi

  if ! getent group docker >/dev/null 2>&1; then
    groupadd --system docker
  fi

  usermod -aG docker node >/dev/null 2>&1 || true
}

start_dockerd() {
  if docker info >/dev/null 2>&1; then
    return 0
  fi

  mkdir -p "$(dirname "${DOCKER_SOCKET}")" /var/lib/docker

  dockerd \
    --host="unix://${DOCKER_SOCKET}" \
    --storage-driver="${DOCKERD_STORAGE_DRIVER}" \
    >"${DOCKERD_LOG_FILE}" 2>&1 &

  local attempt=1
  until docker info >/dev/null 2>&1; do
    if [[ "${attempt}" -ge "${DOCKERD_MAX_ATTEMPTS}" ]]; then
      echo "Docker daemon failed to start. Recent dockerd logs:" >&2
      tail -n 200 "${DOCKERD_LOG_FILE}" >&2 || true
      exit 1
    fi

    attempt=$((attempt + 1))
    sleep "${DOCKERD_RETRY_DELAY_SECONDS}"
  done
}

ensure_node_can_access_docker
start_dockerd

exec "$@"
