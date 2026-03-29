import { AuthService } from '@/auth/auth.service'
import { PrismaService } from '@/database/prisma.service'
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@repo/database'
import { ProjectService } from '../project.service'

describe('ProjectService', () => {
  let service: ProjectService
  let prismaService: jest.Mocked<PrismaService>
  let authService: jest.Mocked<AuthService>

  const workspaceId = 'workspace-123'
  const userId = 'user-123'

  beforeEach(() => {
    prismaService = {
      client: {
        project: {
          findMany: jest.fn(),
          findFirst: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
          count: jest.fn(),
        },
      },
    } as unknown as jest.Mocked<PrismaService>

    authService = {
      checkUserPermission: jest.fn(),
      CREATE_ISSUE_PERMISSION: 'create:issue',
      UPDATE_ISSUE_PERMISSION: 'update:issue',
    } as unknown as jest.Mocked<AuthService>

    service = new ProjectService(prismaService, authService)
  })

  it('normalizes repository URLs and preview commands on create', async () => {
    authService.checkUserPermission.mockResolvedValue(true)
    ;(prismaService.client.project.findFirst as jest.Mock).mockResolvedValue(null)
    const mcpConfig = {
      docs: {
        type: 'streamable-http' as const,
        url: 'https://example.com/mcp',
      },
    }
    const envConfig = {
      ' API_BASE_URL ': ' https://api.example.com ',
      DEBUG: ' true ',
    }
    ;(prismaService.client.project.create as jest.Mock).mockResolvedValue({
      id: 'project-1',
      workspace_id: workspaceId,
      name: 'Payments API',
      github_repo_url: 'https://github.com/harness-kanban/payments-api',
      repo_base_branch: 'main',
      check_ci_cd: true,
      preview_commands: ['pnpm install', 'pnpm dev'],
      mcp_config: mcpConfig,
      env_config: {
        API_BASE_URL: 'https://api.example.com',
        DEBUG: 'true',
      },
      created_by: userId,
      created_at: new Date('2026-03-11T00:00:00Z'),
      updated_at: new Date('2026-03-11T00:00:00Z'),
    })

    await service.createProject(workspaceId, userId, {
      name: '  Payments API  ',
      githubRepoUrl: 'git@github.com:harness-kanban/payments-api.git',
      repoBaseBranch: '  main ',
      checkCiCd: true,
      previewCommands: [' pnpm install ', 'pnpm dev  '],
      mcpConfig,
      envConfig,
    })

    expect(prismaService.client.project.create).toHaveBeenCalledWith({
      data: {
        workspace_id: workspaceId,
        name: 'Payments API',
        github_repo_url: 'https://github.com/harness-kanban/payments-api',
        repo_base_branch: 'main',
        check_ci_cd: true,
        preview_commands: ['pnpm install', 'pnpm dev'],
        mcp_config: mcpConfig,
        env_config: {
          API_BASE_URL: 'https://api.example.com',
          DEBUG: 'true',
        },
        created_by: userId,
      },
    })
  })

  it('rejects duplicate repository bindings within a workspace', async () => {
    authService.checkUserPermission.mockResolvedValue(true)
    ;(prismaService.client.project.findFirst as jest.Mock).mockResolvedValue({ id: 'existing-project' })

    await expect(
      service.createProject(workspaceId, userId, {
        name: 'Payments API',
        githubRepoUrl: 'https://github.com/harness-kanban/payments-api',
        repoBaseBranch: 'main',
      }),
    ).rejects.toThrow(new BadRequestException('A project for this repository already exists in the workspace.'))
  })

  it('rejects project creation without permission', async () => {
    authService.checkUserPermission.mockResolvedValue(false)

    await expect(
      service.createProject(workspaceId, userId, {
        name: 'Payments API',
        githubRepoUrl: 'https://github.com/harness-kanban/payments-api',
        repoBaseBranch: 'main',
      }),
    ).rejects.toThrow(new ForbiddenException('No access to create projects'))
  })

  it('updates only mutable fields', async () => {
    authService.checkUserPermission.mockResolvedValue(true)
    ;(prismaService.client.project.findFirst as jest.Mock).mockResolvedValue({
      id: 'project-1',
      workspace_id: workspaceId,
      deleted_at: null,
    })
    ;(prismaService.client.project.update as jest.Mock).mockResolvedValue({
      id: 'project-1',
      workspace_id: workspaceId,
      name: 'Payments API v2',
      github_repo_url: 'https://github.com/harness-kanban/payments-api',
      repo_base_branch: 'main',
      check_ci_cd: false,
      preview_commands: ['pnpm dev'],
      mcp_config: {
        'repo-tools': {
          type: 'stdio',
          command: 'node',
          args: ['scripts/mcp.js', '--port', '3000'],
          env: {
            DEBUG: '1',
          },
        },
      },
      env_config: {
        API_BASE_URL: 'https://staging.example.com',
        DEBUG: '0',
      },
      created_by: userId,
      created_at: new Date('2026-03-11T00:00:00Z'),
      updated_at: new Date('2026-03-11T01:00:00Z'),
    })

    await service.updateProject(workspaceId, userId, 'project-1', {
      name: '  Payments API v2 ',
      checkCiCd: false,
      previewCommands: [' pnpm dev '],
      mcpConfig: {
        'repo-tools': {
          type: 'stdio',
          command: ' node ',
          args: [' scripts/mcp.js ', ' --port ', '3000 '],
          env: {
            DEBUG: '1',
          },
        },
      },
      envConfig: {
        ' API_BASE_URL ': ' https://staging.example.com ',
        DEBUG: ' 0 ',
      },
    })

    expect(prismaService.client.project.update).toHaveBeenCalledWith({
      where: {
        id: 'project-1',
      },
      data: {
        name: 'Payments API v2',
        check_ci_cd: false,
        preview_commands: ['pnpm dev'],
        mcp_config: {
          'repo-tools': {
            type: 'stdio',
            command: 'node',
            args: ['scripts/mcp.js', '--port', '3000'],
            env: {
              DEBUG: '1',
            },
          },
        },
        env_config: {
          API_BASE_URL: 'https://staging.example.com',
          DEBUG: '0',
        },
      },
    })
  })

  it('clears stored MCP config when the update payload sends null', async () => {
    authService.checkUserPermission.mockResolvedValue(true)
    ;(prismaService.client.project.findFirst as jest.Mock).mockResolvedValue({
      id: 'project-1',
      workspace_id: workspaceId,
      deleted_at: null,
    })
    ;(prismaService.client.project.update as jest.Mock).mockResolvedValue({
      id: 'project-1',
      workspace_id: workspaceId,
      name: 'Payments API',
      github_repo_url: 'https://github.com/harness-kanban/payments-api',
      repo_base_branch: 'main',
      check_ci_cd: true,
      preview_commands: ['pnpm dev'],
      mcp_config: null,
      created_by: userId,
      created_at: new Date('2026-03-11T00:00:00Z'),
      updated_at: new Date('2026-03-11T01:00:00Z'),
    })

    await service.updateProject(workspaceId, userId, 'project-1', {
      mcpConfig: null,
    })

    expect(prismaService.client.project.update).toHaveBeenCalledWith({
      where: {
        id: 'project-1',
      },
      data: {
        mcp_config: Prisma.DbNull,
      },
    })
  })

  it('clears stored env config when the update payload sends null', async () => {
    authService.checkUserPermission.mockResolvedValue(true)
    ;(prismaService.client.project.findFirst as jest.Mock).mockResolvedValue({
      id: 'project-1',
      workspace_id: workspaceId,
      deleted_at: null,
    })
    ;(prismaService.client.project.update as jest.Mock).mockResolvedValue({
      id: 'project-1',
      workspace_id: workspaceId,
      name: 'Payments API',
      github_repo_url: 'https://github.com/harness-kanban/payments-api',
      repo_base_branch: 'main',
      check_ci_cd: true,
      preview_commands: ['pnpm dev'],
      mcp_config: null,
      env_config: null,
      created_by: userId,
      created_at: new Date('2026-03-11T00:00:00Z'),
      updated_at: new Date('2026-03-11T01:00:00Z'),
    })

    await service.updateProject(workspaceId, userId, 'project-1', {
      envConfig: null,
    })

    expect(prismaService.client.project.update).toHaveBeenCalledWith({
      where: {
        id: 'project-1',
      },
      data: {
        env_config: Prisma.DbNull,
      },
    })
  })

  it('throws when updating a project outside the workspace', async () => {
    authService.checkUserPermission.mockResolvedValue(true)
    ;(prismaService.client.project.findFirst as jest.Mock).mockResolvedValue(null)

    await expect(
      service.updateProject(workspaceId, userId, 'project-1', {
        name: 'Payments API',
      }),
    ).rejects.toThrow(new NotFoundException('Project does not exist.'))
  })

  it('returns false for empty project ids in existence checks', async () => {
    await expect(service.checkProjectExists(workspaceId, '')).resolves.toBe(false)
    expect(prismaService.client.project.count).not.toHaveBeenCalled()
  })
})
