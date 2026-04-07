# syntax=docker/dockerfile:1.7

FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /workspace

FROM base AS build-base
RUN apt-get update -y && apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  git \
  openssh-client \
  openssl \
  xz-utils \
  && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml /workspace/
COPY apps/api-server/package.json /workspace/apps/api-server/package.json
COPY packages/config/package.json /workspace/packages/config/package.json
COPY packages/database/package.json /workspace/packages/database/package.json
COPY packages/shared/package.json /workspace/packages/shared/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --filter @harness-kanban/api-server... --frozen-lockfile
COPY apps/api-server /workspace/apps/api-server
COPY packages/config /workspace/packages/config
COPY packages/database /workspace/packages/database
COPY packages/shared /workspace/packages/shared
COPY scripts /workspace/scripts
COPY docker /workspace/docker

FROM build-base AS api-build
RUN pnpm --filter @repo/shared build
RUN pnpm --filter @repo/database db:generate
RUN pnpm --filter @repo/database build
RUN pnpm --filter @harness-kanban/api-server build

FROM api-build AS worker-build
ARG TARGETARCH
ARG HARNESS_WORKER_CODEX_TOOLCHAIN_VERSION=0.116.0
ARG HARNESS_WORKER_CLAUDE_CODE_TOOLCHAIN_VERSION=2.1.92
RUN case "$TARGETARCH" in \
    amd64) toolchain_target="linux-x64" ;; \
    arm64) toolchain_target="linux-arm64" ;; \
    *) echo "Unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
  esac \
  && node /workspace/scripts/build-coding-agent-toolchain.mjs --agent codex --version "$HARNESS_WORKER_CODEX_TOOLCHAIN_VERSION" --output-dir /opt/harness-kanban/toolchains --target "$toolchain_target" \
  && node /workspace/scripts/build-coding-agent-toolchain.mjs --agent claude-code --version "$HARNESS_WORKER_CLAUDE_CODE_TOOLCHAIN_VERSION" --output-dir /opt/harness-kanban/toolchains --target "$toolchain_target"

FROM api-build AS api-deploy
RUN pnpm deploy --filter @harness-kanban/api-server --legacy --prod /opt/harness-kanban/api-server

FROM debian:bookworm-slim AS devpod-binary
ARG TARGETARCH
ARG DEVPOD_VERSION=v0.6.15
RUN apt-get update -y && apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL "https://github.com/loft-sh/devpod/releases/download/${DEVPOD_VERSION}/devpod-linux-${TARGETARCH}" -o /usr/local/bin/devpod \
  && chmod +x /usr/local/bin/devpod

FROM docker:cli AS docker-cli

FROM base AS api-runtime
ENV NODE_ENV=production
RUN apt-get update -y && apt-get install -y --no-install-recommends \
  curl \
  openssl \
  && rm -rf /var/lib/apt/lists/*
COPY --from=api-deploy /opt/harness-kanban/api-server /workspace
COPY --from=api-build /workspace/docker /workspace/docker
WORKDIR /workspace
EXPOSE 3001
CMD ["sh", "/workspace/docker/api-entrypoint.sh"]

FROM base AS worker-runtime
ENV NODE_ENV=production
ENV DEVPOD_HOME=/var/lib/harness-kanban/devpod
ENV DEVPOD_DOCKER_CONFIG_DIR=/var/lib/harness-kanban/docker-config
ENV HARNESS_WORKER_TOOLCHAIN_STORE_DIR=/opt/harness-kanban/toolchains
ENV DOCKER_HOST=unix:///var/run/docker.sock
RUN apt-get update -y && apt-get install -y --no-install-recommends \
  bash \
  ca-certificates \
  curl \
  git \
  openssh-client \
  openssl \
  procps \
  && rm -rf /var/lib/apt/lists/*
COPY --from=api-deploy /opt/harness-kanban/api-server /workspace
COPY --from=api-build /workspace/docker /workspace/docker
COPY --from=worker-build /opt/harness-kanban/toolchains /opt/harness-kanban/toolchains
COPY --from=devpod-binary /usr/local/bin/devpod /usr/local/bin/devpod
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/bin/docker-compose /usr/local/bin/docker-compose
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins /usr/local/libexec/docker/cli-plugins
WORKDIR /workspace
CMD ["sh", "/workspace/docker/worker-entrypoint.sh"]
