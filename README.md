<h1><img src="./apps/web/public/logo.svg" alt="Harness Kanban Logo" height="36" align="center" /> Harness Kanban</h1>

[![Build](https://github.com/Orenoid/harness-kanban/actions/workflows/build.yml/badge.svg)](https://github.com/Orenoid/harness-kanban/actions/workflows/build.yml)
[![Unit Test](https://github.com/Orenoid/harness-kanban/actions/workflows/unittest.yml/badge.svg)](https://github.com/Orenoid/harness-kanban/actions/workflows/unittest.yml)
[![Storybook Tests](https://github.com/Orenoid/harness-kanban/actions/workflows/storybook-tests.yml/badge.svg)](https://github.com/Orenoid/harness-kanban/actions/workflows/storybook-tests.yml)

> This project is still in the MVP stage. Many features still need refinement, and breaking changes may be introduced as the product evolves.

Harness Kanban is a cloud-based kanban tool for managing fully containerized coding agents that run 24/7 to handle assigned issues.

## Screenshots

![Harness Kanban screenshot](./.github/images/screenshots-kanban.jpg)

## Features

- **🐳 Fully Containerized**: Coding agents develop in isolated containers, preventing cross-task interference and making parallel execution safer.
- **☁️ Cloud Based**: Both the kanban tool and coding agents can run in the cloud. No local CLI installation required.
- **⚡ Highly Scalable**: Built around a scalable worker orchestration architecture. Scale the number of concurrent coding agents based on your hardware resources. Agents automatically pick up available issues upon startup.
- **✅ Quality Assurance**: Automatically applies user-configured self-check instructions and CI/CD results, forcing the AI to fix errors until the code passes all checks.
- **👤 Human in the Loop**: Humans and agents alternate responsibility for different lifecycle stages of an issue.
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

## Architecture

![Harness Kanban architecture](./.github/images/readme-architecture.svg)

Theoretically, you can deploy the worker anywhere that can connect to the project database (and, of course, has the necessary network access).

## Future Plans

2. Implement more dynamic scheduling logic so that when an issue is blocked by a human step, such as waiting for review, workers can switch to other available issues.
3. Build a Linear adapter and detach agent worker scheduling from the built-in kanban so Harness Kanban can integrate with more existing issue management systems.
