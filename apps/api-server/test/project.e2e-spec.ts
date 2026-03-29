import { AppModule } from '@/app.module'
import { ApiExceptionFilter } from '@/common/filters/api-exception.filter'
import { INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { ProjectEnvConfig, ProjectMcpConfig } from '@repo/shared/project/types'
import { CommonPropertyOperationType, FilterOperator, SystemPropertyId } from '@repo/shared/property/constants'
import { loginUser, SupertestAgent } from './utils/auth-helper'

type ProjectRecord = {
  id: string
  name: string
  githubRepoUrl: string
  repoBaseBranch: string
  checkCiCd: boolean
  mcpConfig: ProjectMcpConfig | null
  envConfig: ProjectEnvConfig | null
  previewCommands: string[]
}

type IssueRecord = {
  issueId: number
  propertyValues: Array<{ propertyId: string; value: unknown }>
}

describe('Project (e2e)', () => {
  let app: INestApplication
  let agent: SupertestAgent

  const getIssuePropertyValue = (issue: IssueRecord, propertyId: string) =>
    issue.propertyValues.find(propertyValue => propertyValue.propertyId === propertyId)?.value

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    app.useGlobalFilters(new ApiExceptionFilter())
    await app.init()

    agent = await loginUser(app, 'e2e-user@example.com', 'temppassword')
  })

  afterAll(async () => {
    await app.close()
  })

  it('supports project CRUD with immutable repository fields', async () => {
    const suffix = Date.now()
    const mcpConfig: ProjectMcpConfig = {
      docs: {
        type: 'streamable-http',
        url: `https://example.com/mcp/${suffix}`,
      },
      'repo-tools': {
        type: 'stdio',
        command: 'node',
        args: ['scripts/mcp.js', '--port', '3000'],
        env: {
          DEBUG: '1',
        },
      },
    }
    const envConfig: ProjectEnvConfig = {
      API_BASE_URL: `https://api.example.com/${suffix}`,
      DEBUG: 'true',
    }
    const createResponse = await agent
      .post('/api/v1/projects')
      .send({
        project: {
          name: `Payments API ${suffix}`,
          githubRepoUrl: `git@github.com:harness-kanban/payments-api-${suffix}.git`,
          repoBaseBranch: 'main',
          checkCiCd: true,
          previewCommands: ['pnpm install', 'pnpm dev'],
          mcpConfig,
          envConfig,
        },
      })
      .expect(201)

    const project = createResponse.body.data.project as ProjectRecord
    expect(project.githubRepoUrl).toBe(`https://github.com/harness-kanban/payments-api-${suffix}`)
    expect(project.mcpConfig).toEqual(mcpConfig)
    expect(project.envConfig).toEqual(envConfig)
    expect(project.previewCommands).toEqual(['pnpm install', 'pnpm dev'])

    const listResponse = await agent.get('/api/v1/projects').expect(200)
    const projects = listResponse.body.data.projects as ProjectRecord[]
    expect(projects.some(candidate => candidate.id === project.id)).toBe(true)

    const detailResponse = await agent.get(`/api/v1/projects/${project.id}`).expect(200)
    expect((detailResponse.body.data.project as ProjectRecord).name).toBe(project.name)

    const updateResponse = await agent
      .put(`/api/v1/projects/${project.id}`)
      .send({
        project: {
          name: `Payments API ${suffix} Updated`,
          checkCiCd: false,
          mcpConfig: null,
          envConfig: null,
          previewCommands: ['pnpm dev'],
        },
      })
      .expect(200)

    const updatedProject = updateResponse.body.data.project as ProjectRecord
    expect(updatedProject.name).toBe(`Payments API ${suffix} Updated`)
    expect(updatedProject.checkCiCd).toBe(false)
    expect(updatedProject.githubRepoUrl).toBe(`https://github.com/harness-kanban/payments-api-${suffix}`)
    expect(updatedProject.mcpConfig).toBeNull()
    expect(updatedProject.envConfig).toBeNull()

    await agent
      .put(`/api/v1/projects/${project.id}`)
      .send({
        project: {
          githubRepoUrl: 'https://github.com/harness-kanban/other-repo',
        },
      })
      .expect(400)
  })

  it('binds issues to projects and rejects reassignment after creation', async () => {
    const suffix = Date.now()
    const projectResponse = await agent
      .post('/api/v1/projects')
      .send({
        project: {
          name: `Checkout ${suffix}`,
          githubRepoUrl: `https://github.com/harness-kanban/checkout-${suffix}`,
          repoBaseBranch: 'main',
        },
      })
      .expect(201)

    const secondProjectResponse = await agent
      .post('/api/v1/projects')
      .send({
        project: {
          name: `Checkout ${suffix} Secondary`,
          githubRepoUrl: `https://github.com/harness-kanban/checkout-secondary-${suffix}`,
          repoBaseBranch: 'main',
        },
      })
      .expect(201)

    const project = projectResponse.body.data.project as ProjectRecord
    const secondProject = secondProjectResponse.body.data.project as ProjectRecord

    const createIssueResponse = await agent
      .post('/api/v1/issues')
      .send({
        issue: {
          propertyValues: [
            {
              propertyId: SystemPropertyId.TITLE,
              value: `Investigate checkout ${suffix}`,
            },
            {
              propertyId: SystemPropertyId.PROJECT,
              value: project.id,
            },
          ],
        },
      })
      .expect(201)

    const issueId = createIssueResponse.body.data.issueId as number

    const issueResponse = await agent.get(`/api/v1/issues/${issueId}`).expect(200)
    const issue = issueResponse.body.data.issue as IssueRecord
    expect(getIssuePropertyValue(issue, SystemPropertyId.PROJECT)).toBe(project.id)

    const filterResponse = await agent
      .get('/api/v1/issues')
      .query({
        filters: JSON.stringify([
          {
            propertyId: SystemPropertyId.PROJECT,
            propertyType: 'project',
            operator: FilterOperator.HasAnyOf,
            operand: [project.id],
          },
        ]),
      })
      .expect(200)

    const filteredIssues = filterResponse.body.data.issues as IssueRecord[]
    expect(filteredIssues.some(candidate => candidate.issueId === issueId)).toBe(true)

    await agent
      .put(`/api/v1/issues/${issueId}`)
      .send({
        operations: [
          {
            propertyId: SystemPropertyId.PROJECT,
            operationType: CommonPropertyOperationType.SET,
            operationPayload: { value: secondProject.id },
          },
        ],
      })
      .expect(403)
  })
})
