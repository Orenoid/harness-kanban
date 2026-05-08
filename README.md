<h1><img src="./apps/web/public/logo.svg" alt="Harness Kanban Logo" height="36" align="center" /> Harness Kanban</h1>

[![Beta](https://img.shields.io/badge/Status-Beta-yellow)]() [![Build](https://github.com/Orenoid/harness-kanban/actions/workflows/build.yml/badge.svg)](https://github.com/Orenoid/harness-kanban/actions/workflows/build.yml)
[![Unit Test](https://github.com/Orenoid/harness-kanban/actions/workflows/unittest.yml/badge.svg)](https://github.com/Orenoid/harness-kanban/actions/workflows/unittest.yml)
[![Storybook Tests](https://github.com/Orenoid/harness-kanban/actions/workflows/storybook-tests.yml/badge.svg)](https://github.com/Orenoid/harness-kanban/actions/workflows/storybook-tests.yml)

Harness Kanban is a cloud-based kanban tool for managing fully containerized coding agents that run 24/7 to handle assigned issues. Currently supports **Codex** and **Claude Code**.

## Screenshots

![Harness Kanban screenshot](./.github/images/screenshots-kanban.jpg)

Collaborate with CodeBot like a real teammate.

![Issue detail screenshot](./.github/images/screenshots-issue-activity.png)

## Features

- **🔄 Comprehensive Issue Lifecycle**: Issues move through a human-in-the-loop workflow, from requirement clarification to plan review, implementation, help requests, code review, and completion.
- **🐳 Fully Containerized**: Each agent runs in an isolated, full-featured development container, can install dependencies like databases, and has YOLO mode on by default.
- **☁️ Cloud Based**: Both the kanban tool and coding agents can run in the cloud. No local CLI installation required.
- **🧰 Harness Engineering**: Agents run in a stable environment defined by your dev container specification, and the system forces the AI to keep repairing changes until user-defined validation commands and CI/CD checks pass.
- **⚡ Highly Scalable**: Built around a scalable worker orchestration architecture. Scale the number of concurrent workers based on your hardware resources. Agents automatically pick up available issues upon startup.
- **🔔 Async Workflow**: Automatically sends notifications when an issue requires your attention.

## Prerequisites

- Git
- Docker with Docker Compose
- GitHub account

## Quick Start

1. Clone the repository and enter the project directory:

   ```bash
   git clone https://github.com/Orenoid/harness-kanban.git && cd harness-kanban
   ```

2. Start the services:

   ```bash
   docker compose up -d
   ```

   You can run multiple workers when you need more parallel execution, for example:

   ```bash
   docker compose up -d --scale worker=3
   ```

   Each worker automatically claims queued issues after it starts up or after it finishes its current issue.  
   Start with 1-2 workers, then scale up based on your system's hardware utilization.

   > The number of workers you can run is limited by how many dev containers your machine can handle. Resource usage varies by project, so tune this according to your workload.

3. Register an account, sign in, then open Settings to configure a GitHub token and at least one coding agent. Harness Kanban supports **Claude Code** and **Codex**.

4. Create a project and a new issue, assign it to CodeBot, and you're on a roll.

## Advanced

### Dev Container Support

Harness Kanban implements the open [Dev Containers](https://containers.dev/) specification to provision each agent's workspace. When a worker picks up an issue, it builds a container based on the target repo's `.devcontainer/devcontainer.json` (or `.devcontainer.json` at the repo root) on the issue's base branch. The agent then runs against the same toolchain, dependencies, and lifecycle scripts a human teammate would get when opening the repo in VSCode.

Anything you can express in the spec — base image, [features](https://containers.dev/features), `postCreateCommand`, multi-service setups via `dockerComposeFile`, mounts, environment, etc. — is honored. Container provisioning is delegated to [DevPod](https://devpod.sh/) under the hood, so if your config works there, it works here.

### Mount Performance

Be careful with the `mounts` field in `devcontainer.json`. Bind mounts from the host (`type=bind`) traverse Docker Desktop's filesystem virtualization layer on macOS and Windows, and can be many times slower than the container's native filesystem. Pointing them at hot directories like `node_modules`, build caches, or database data dirs will quickly bottleneck installs, builds, and test runs — which directly starves the agent's iteration loop and bloats issue completion time.

Prefer named Docker volumes (`type=volume`) for these paths, or leave them on the container filesystem entirely. As a reference, this repo's own [`devcontainer.json`](./.devcontainer/devcontainer.json) mounts a named volume over `node_modules` for exactly this reason.

### Validate Your devcontainer.json First

> **Strongly recommended:** before assigning issues to CodeBot in a new repository, open that repo with VSCode's [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) and verify the container builds, starts, and lets you run the repo's install / build / test commands end-to-end.

The Harness Kanban worker exercises the same dev container code path as VSCode, but it runs unattended — there is no human to react to a stalled `postCreateCommand` or a missing build arg. VSCode is by far the fastest place to surface and iterate on these issues. A clean VSCode launch is the strongest single signal that the worker will be able to make progress on the repo.

## Architecture

![Harness Kanban architecture](./.github/images/readme-architecture.svg)

Theoretically, you can deploy the worker anywhere that can connect to the project database (and, of course, has the necessary network access).

## Future Plans

- Build a Linear adapter and detach agent worker scheduling from the built-in kanban so Harness Kanban can integrate with more existing issue management systems.
