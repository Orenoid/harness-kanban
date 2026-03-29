#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${REPO_ROOT}/.devcontainer/workspace.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}" >&2
  exit 1
fi

set -a
source "${ENV_FILE}"
set +a

pnpm_cmd() {
  if command -v pnpm >/dev/null 2>&1; then
    pnpm "$@"
  else
    corepack pnpm "$@"
  fi
}

devpod_cmd() {
  if command -v devpod >/dev/null 2>&1; then
    devpod "$@"
  else
    echo "DevPod CLI is not installed." >&2
    return 1
  fi
}

run_as_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo -n "$@"
  else
    return 1
  fi
}

ensure_workspace_node_modules_writable() {
  local node_modules_dir="${REPO_ROOT}/node_modules"
  local uid gid
  uid="$(id -u)"
  gid="$(id -g)"

  if [[ -w "${node_modules_dir}" ]]; then
    return 0
  fi

  echo "Ensuring ${node_modules_dir} is writable..."

  if ! run_as_root mkdir -p "${node_modules_dir}"; then
    echo "Failed to create ${node_modules_dir} with elevated permissions." >&2
    return 1
  fi

  if ! run_as_root chown -R "${uid}:${gid}" "${node_modules_dir}"; then
    echo "Failed to update ownership for ${node_modules_dir}." >&2
    return 1
  fi

  if [[ ! -w "${node_modules_dir}" ]]; then
    echo "${node_modules_dir} is still not writable after fixing permissions." >&2
    return 1
  fi
}

wait_for_tcp() {
  local host="$1"
  local port="$2"
  local label="$3"

  echo "Waiting for ${label} at ${host}:${port}..."
  for _ in $(seq 1 60); do
    if node -e "
      const net = require('node:net');
      const socket = net.connect({ host: process.argv[1], port: Number(process.argv[2]) });
      socket.setTimeout(1000);
      socket.on('connect', () => { socket.end(); process.exit(0); });
      socket.on('timeout', () => { socket.destroy(); process.exit(1); });
      socket.on('error', () => process.exit(1));
    " "${host}" "${port}"; then
      echo "${label} is ready."
      return 0
    fi
    sleep 2
  done

  echo "Timed out waiting for ${label}." >&2
  return 1
}

wait_for_docker() {
  local max_attempts="${DEVCONTAINER_DOCKER_READY_MAX_ATTEMPTS:-30}"
  local retry_delay="${DEVCONTAINER_DOCKER_READY_RETRY_DELAY_SECONDS:-2}"
  local attempt=1

  echo "Waiting for Docker daemon inside the dev container..."
  until docker info >/dev/null 2>&1; do
    if [[ "${attempt}" -ge "${max_attempts}" ]]; then
      echo "Docker daemon is not reachable after ${attempt} attempts." >&2
      return 1
    fi

    echo "Docker is not ready yet (attempt ${attempt}/${max_attempts}); retrying..."
    attempt=$((attempt + 1))
    sleep "${retry_delay}"
  done

  echo "Docker daemon is ready."
}

resolve_devpod_download_url() {
  local version="${DEVPOD_VERSION:-latest}"
  local arch

  case "$(uname -m)" in
    x86_64|amd64)
      arch="amd64"
      ;;
    aarch64|arm64)
      arch="arm64"
      ;;
    *)
      echo "Unsupported architecture for DevPod CLI: $(uname -m)" >&2
      return 1
      ;;
  esac

  if [[ "${version}" == "latest" ]]; then
    printf 'https://github.com/loft-sh/devpod/releases/latest/download/devpod-linux-%s' "${arch}"
  else
    printf 'https://github.com/loft-sh/devpod/releases/download/%s/devpod-linux-%s' "${version}" "${arch}"
  fi
}

install_devpod_cli() {
  if command -v devpod >/dev/null 2>&1; then
    echo "DevPod CLI is already installed: $(devpod version | head -n 1)"
    return 0
  fi

  local download_url tmp_file
  download_url="$(resolve_devpod_download_url)"
  tmp_file="$(mktemp)"

  echo "Installing DevPod CLI from ${download_url}..."
  curl -fsSL -o "${tmp_file}" "${download_url}"

  if ! run_as_root install -c -m 0755 "${tmp_file}" /usr/local/bin/devpod; then
    rm -f "${tmp_file}"
    echo "Failed to install DevPod CLI into /usr/local/bin." >&2
    return 1
  fi

  rm -f "${tmp_file}"
  echo "Installed DevPod CLI: $(devpod version | head -n 1)"
}

configure_devpod_provider() {
  echo "Configuring DevPod docker provider..."

  if ! devpod_cmd provider use docker -o DOCKER_PATH=docker >/dev/null 2>&1; then
    devpod_cmd provider add docker -o DOCKER_PATH=docker >/dev/null
    devpod_cmd provider use docker -o DOCKER_PATH=docker >/dev/null
  fi

  echo "DevPod docker provider is ready."
}

write_env_files() {
  echo "Writing development .env files..."

  mkdir -p "${REPO_ROOT}/apps/api-server" "${REPO_ROOT}/apps/web" "${REPO_ROOT}/packages/database"

  cat > "${REPO_ROOT}/apps/api-server/.env" <<EOF
DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}?schema=public"

PORT=${API_PORT}
NODE_ENV=development
APP_ENV=${APP_ENV}

BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}
BETTER_AUTH_URL=${BETTER_AUTH_URL}

APP_BASE_URL=${APP_BASE_URL}

AI_PROVIDER=${AI_PROVIDER}
OPENAI_API_KEY=${OPENAI_API_KEY}
OPENAI_MODEL=${OPENAI_MODEL}

EMBEDDING_OPENAI_API_KEY=${EMBEDDING_OPENAI_API_KEY}
EMBEDDING_OPENAI_MODEL=${EMBEDDING_OPENAI_MODEL}
EOF

  cat > "${REPO_ROOT}/apps/web/.env" <<EOF
PORT=${WEB_PORT}
NEXT_PUBLIC_APP_BASE_URL=${NEXT_PUBLIC_APP_BASE_URL}
NEXT_PUBLIC_API_SERVER_URL=${NEXT_PUBLIC_API_SERVER_URL}

STORYBOOK_PORT=${STORYBOOK_PORT}

MINIO_ENDPOINT=${MINIO_ENDPOINT}
MINIO_PORT=${MINIO_PORT}
MINIO_USE_SSL=${MINIO_USE_SSL}
MINIO_ACCESS_KEY=${MINIO_ROOT_USER}
MINIO_SECRET_KEY=${MINIO_ROOT_PASSWORD}
MINIO_BUCKET=${MINIO_BUCKET}
EOF

  cat > "${REPO_ROOT}/packages/database/.env" <<EOF
DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}?schema=public"
EOF
}

main() {
  cd "${REPO_ROOT}"

  write_env_files
  install_devpod_cli
  wait_for_docker
  configure_devpod_provider
  ensure_workspace_node_modules_writable

  echo "Installing workspace dependencies..."
  pnpm_cmd install

  wait_for_tcp "${POSTGRES_HOST}" "${POSTGRES_PORT}" "PostgreSQL"
  wait_for_tcp "${MINIO_ENDPOINT}" "${MINIO_PORT}" "MinIO"

  echo "Generating Prisma client..."
  pnpm_cmd --filter @repo/database db:generate

  echo "Applying Prisma migrations..."
  pnpm_cmd --filter @repo/database db:migrate

  echo "Devcontainer initialization complete."
}

main "$@"
