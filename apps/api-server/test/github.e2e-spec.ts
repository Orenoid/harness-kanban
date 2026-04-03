import { AppModule } from '@/app.module'
import { ApiExceptionFilter } from '@/common/filters/api-exception.filter'
import { INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { loginUser, SupertestAgent } from './utils/auth-helper'

describe('GitHub connection (e2e)', () => {
  let app: INestApplication
  let agent: SupertestAgent
  let originalFetch: typeof fetch
  let fetchMock: jest.Mock

  const createJsonResponse = (body: unknown) =>
    ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => body,
      text: async () => JSON.stringify(body),
    }) as Response

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    app.useGlobalFilters(new ApiExceptionFilter())
    await app.init()

    agent = await loginUser(app, 'e2e-user@example.com', 'temppassword')
    originalFetch = global.fetch
  })

  beforeEach(() => {
    fetchMock = jest.fn()
    global.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  afterAll(async () => {
    global.fetch = originalFetch
    await app.close()
  })

  // TODO shouldn't mocking in e2e tests, consider using a real GitHub token
  it('supports saving a token, loading repositories and branches, and clearing the connection', async () => {
    fetchMock
      .mockResolvedValueOnce(createJsonResponse({ login: 'octo-user' }))
      .mockResolvedValueOnce(
        createJsonResponse([
          {
            id: 101,
            full_name: 'harness-kanban/payments-api',
            html_url: 'https://github.com/harness-kanban/payments-api',
            default_branch: 'main',
            private: true,
          },
        ]),
      )
      .mockResolvedValueOnce(createJsonResponse({ default_branch: 'main' }))
      .mockResolvedValueOnce(createJsonResponse([{ name: 'release' }, { name: 'main' }]))

    const saveResponse = await agent.put('/api/v1/github/connection').send({ token: 'ghp_e2e_token' }).expect(200)
    expect(saveResponse.body.data.connection).toEqual({
      hasToken: true,
      updatedAt: expect.any(String),
    })

    const repositoriesResponse = await agent.get('/api/v1/github/repositories').expect(200)
    expect(repositoriesResponse.body.data.repositories).toEqual([
      {
        id: 101,
        fullName: 'harness-kanban/payments-api',
        githubRepoUrl: 'https://github.com/harness-kanban/payments-api',
        defaultBranch: 'main',
        isPrivate: true,
      },
    ])

    const branchesResponse = await agent
      .get('/api/v1/github/branches')
      .query({ repository: 'harness-kanban/payments-api' })
      .expect(200)
    expect(branchesResponse.body.data.branches).toEqual([
      {
        name: 'main',
        isDefault: true,
      },
      {
        name: 'release',
        isDefault: false,
      },
    ])

    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer ghp_e2e_token',
    })

    const deleteResponse = await agent.delete('/api/v1/github/connection').expect(200)
    expect(deleteResponse.body.data.connection).toEqual({
      hasToken: false,
      updatedAt: null,
    })
  })
})
