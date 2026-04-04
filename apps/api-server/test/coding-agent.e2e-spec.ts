import { AppModule } from '@/app.module'
import { ApiExceptionFilter } from '@/common/filters/api-exception.filter'
import { INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { loginUser, SupertestAgent } from './utils/auth-helper'

type CodingAgentRecord = {
  id: string
  name: string
  type: 'codex' | 'claude-code'
  settings: Record<string, unknown>
  isDefault: boolean
}

describe('CodingAgent (e2e)', () => {
  let app: INestApplication
  let agent: SupertestAgent

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

  it('supports create, read, update, and delete for coding agents', async () => {
    const suffix = Date.now()

    const createResponse = await agent
      .post('/api/v1/coding-agents')
      .send({
        codingAgent: {
          name: `Codex Runner ${suffix}`,
          type: 'codex',
          settings: {
            apiKey: `sk-test-${suffix}`,
            model: 'gpt-5.3-codex',
            reasoningEffort: 'low',
          },
          isDefault: true,
        },
      })
      .expect(201)

    const codingAgent = createResponse.body.data.codingAgent as CodingAgentRecord
    expect(codingAgent.name).toBe(`Codex Runner ${suffix}`)
    expect(codingAgent.settings).toEqual({
      model: 'gpt-5.3-codex',
      reasoningEffort: 'low',
      hasCredential: true,
    })
    expect(codingAgent.isDefault).toBe(true)

    const listResponse = await agent.get('/api/v1/coding-agents').expect(200)
    expect(listResponse.body.data.codingAgents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: codingAgent.id,
          name: `Codex Runner ${suffix}`,
        }),
      ]),
    )

    const getResponse = await agent.get(`/api/v1/coding-agents/${codingAgent.id}`).expect(200)
    expect((getResponse.body.data.codingAgent as CodingAgentRecord).settings).toEqual({
      model: 'gpt-5.3-codex',
      reasoningEffort: 'low',
      hasCredential: true,
    })

    const updateResponse = await agent
      .put(`/api/v1/coding-agents/${codingAgent.id}`)
      .send({
        codingAgent: {
          settings: {
            model: 'gpt-5.4',
            reasoningEffort: 'medium',
          },
          isDefault: false,
        },
      })
      .expect(200)

    expect((updateResponse.body.data.codingAgent as CodingAgentRecord).settings).toEqual({
      model: 'gpt-5.4',
      reasoningEffort: 'medium',
      hasCredential: true,
    })

    await agent.delete(`/api/v1/coding-agents/${codingAgent.id}`).expect(200)
    await agent.delete(`/api/v1/coding-agents/${codingAgent.id}`).expect(404)
  })

  it('rejects invalid settings for the selected coding agent type', async () => {
    const suffix = Date.now()

    await agent
      .post('/api/v1/coding-agents')
      .send({
        codingAgent: {
          name: `Claude Runner ${suffix}`,
          type: 'claude-code',
          settings: {
            apiKey: `sk-test-${suffix}`,
            model: 'claude-sonnet-4',
          },
        },
      })
      .expect(400)
  })
})
