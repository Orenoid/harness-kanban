import { AppModule } from '@/app.module'
import { ApiExceptionFilter } from '@/common/filters/api-exception.filter'
import { SystemBotId } from '@/user/constants/user.constants'
import { INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { CommonPropertyOperationType, SystemPropertyId } from '@repo/shared/property/constants'
import { loginUser, SupertestAgent } from './utils/auth-helper'

type IssueRecord = {
  issueId: number
  propertyValues: Array<{ propertyId: string; value: unknown }>
}

type ActivityRecord = {
  type: string
  createdBy: string
  payload?: {
    propertyId?: string
    newValue?: unknown
  }
}

describe('Issue + Property (e2e)', () => {
  let app: INestApplication
  let agent: SupertestAgent

  const getPropertyValue = (issue: IssueRecord, propertyId: string) =>
    issue.propertyValues.find(p => p.propertyId === propertyId)?.value

  const waitForIssuePropertyValue = async (
    issueId: number,
    propertyId: string,
    expectedValue: unknown,
    attempts = 20,
  ): Promise<IssueRecord> => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const response = await agent.get(`/api/v1/issues/${issueId}`).expect(200)
      const issue = response.body.data.issue as IssueRecord

      if (getPropertyValue(issue, propertyId) === expectedValue) {
        return issue
      }

      await new Promise(resolve => setTimeout(resolve, 100))
    }

    throw new Error(`Issue ${issueId} did not reach ${propertyId}=${String(expectedValue)}`)
  }

  const waitForStatusActivity = async (
    issueId: number,
    nextStatusId: string,
    attempts = 20,
  ): Promise<ActivityRecord> => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const response = await agent.get(`/api/v1/issues/${issueId}/activities?descOrder=true`).expect(200)
      const activity = (response.body.data.activities as ActivityRecord[]).find(
        entry =>
          entry.createdBy === SystemBotId.CODE_BOT &&
          entry.payload?.propertyId === SystemPropertyId.STATUS &&
          entry.payload?.newValue === nextStatusId,
      )

      if (activity) {
        return activity
      }

      await new Promise(resolve => setTimeout(resolve, 100))
    }

    throw new Error(`Issue ${issueId} did not record a Code Bot status activity for ${nextStatusId}`)
  }

  const createCodexCodingAgent = async () => {
    const suffix = Date.now()

    await agent
      .post('/api/v1/coding-agents')
      .send({
        codingAgent: {
          name: `Issue Property Codex ${suffix}`,
          type: 'codex',
          settings: {
            apiKey: `sk-issue-property-${suffix}`,
            model: 'gpt-5.3-codex',
            reasoningEffort: 'medium',
          },
          isDefault: true,
        },
      })
      .expect(201)
  }

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

  it('GET /api/v1/properties should return system properties', async () => {
    const response = await agent.get('/api/v1/properties').expect(200)

    expect(response.body).toHaveProperty('success', true)
    expect(response.body).toHaveProperty('data.properties')

    const properties = response.body.data.properties as Array<{
      id: string
      type: string
      config?: { initialStatusId?: string; statuses?: Array<{ id: string }> }
    }>
    expect(Array.isArray(properties)).toBe(true)
    expect(properties.length).toBeGreaterThan(0)

    const titleProperty = properties.find(p => p.id === SystemPropertyId.TITLE)
    const statusProperty = properties.find(p => p.id === SystemPropertyId.STATUS)

    expect(titleProperty).toBeDefined()
    expect(titleProperty?.type).toBe('title')
    expect(statusProperty).toBeDefined()
    expect(statusProperty?.type).toBe('status')
    expect(statusProperty?.config?.initialStatusId).toBe('todo')
    expect(statusProperty?.config?.statuses?.some(status => status.id === 'in_progress')).toBe(true)
  })

  it('should complete issue main flow: create -> get/list -> update -> delete', async () => {
    const createdTitle = `e2e-issue-${Date.now()}`
    const updatedTitle = `${createdTitle}-updated`

    const createResponse = await agent
      .post('/api/v1/issues')
      .send({
        issue: {
          propertyValues: [
            {
              propertyId: SystemPropertyId.TITLE,
              value: createdTitle,
            },
          ],
        },
      })
      .expect(201)

    expect(createResponse.body).toHaveProperty('success', true)
    expect(createResponse.body).toHaveProperty('data.issueId')

    const issueId = createResponse.body.data.issueId as number
    expect(typeof issueId).toBe('number')

    const getResponse = await agent.get(`/api/v1/issues/${issueId}`).expect(200)
    const createdIssue = getResponse.body.data.issue as IssueRecord

    expect(createdIssue.issueId).toBe(issueId)
    expect(getPropertyValue(createdIssue, SystemPropertyId.TITLE)).toBe(createdTitle)
    expect(getPropertyValue(createdIssue, SystemPropertyId.STATUS)).toBe('todo')

    const listResponse = await agent.get('/api/v1/issues').expect(200)
    const listedIssue = (listResponse.body.data.issues as IssueRecord[]).find(inc => inc.issueId === issueId)

    expect(listedIssue).toBeDefined()
    expect(getPropertyValue(listedIssue!, SystemPropertyId.TITLE)).toBe(createdTitle)

    await agent
      .put(`/api/v1/issues/${issueId}`)
      .send({
        operations: [
          {
            propertyId: SystemPropertyId.TITLE,
            operationType: CommonPropertyOperationType.SET,
            operationPayload: { value: updatedTitle },
          },
        ],
      })
      .expect(200)

    const getAfterUpdateResponse = await agent.get(`/api/v1/issues/${issueId}`).expect(200)
    const updatedIssue = getAfterUpdateResponse.body.data.issue as IssueRecord
    expect(getPropertyValue(updatedIssue, SystemPropertyId.TITLE)).toBe(updatedTitle)

    await agent.delete(`/api/v1/issues/${issueId}`).expect(200)

    await agent.get(`/api/v1/issues/${issueId}`).expect(404)
  })

  it('should resolve status actions, enforce transition rules, and filter by status', async () => {
    const createdTitle = `status-issue-${Date.now()}`

    const createResponse = await agent
      .post('/api/v1/issues')
      .send({
        issue: {
          propertyValues: [
            {
              propertyId: SystemPropertyId.TITLE,
              value: createdTitle,
            },
          ],
        },
      })
      .expect(201)

    const issueId = createResponse.body.data.issueId as number

    const resolveResponse = await agent.post('/api/v1/issues/status-actions/resolve').send({ issueId }).expect(201)

    expect(resolveResponse.body).toHaveProperty('success', true)
    expect(resolveResponse.body.data.currentStatusId).toBe('todo')
    expect(resolveResponse.body.data.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toStatusId: 'in_progress',
          actionLabel: 'Start work',
          label: 'In progress',
        }),
      ]),
    )

    await agent
      .put(`/api/v1/issues/${issueId}`)
      .send({
        operations: [
          {
            propertyId: SystemPropertyId.STATUS,
            operationType: CommonPropertyOperationType.SET,
            operationPayload: { value: 'completed' },
          },
        ],
      })
      .expect(403)

    await agent
      .put(`/api/v1/issues/${issueId}`)
      .send({
        operations: [
          {
            propertyId: SystemPropertyId.STATUS,
            operationType: CommonPropertyOperationType.SET,
            operationPayload: { value: 'in_progress' },
          },
        ],
      })
      .expect(200)

    const getResponse = await agent.get(`/api/v1/issues/${issueId}`).expect(200)
    const updatedIssue = getResponse.body.data.issue as IssueRecord

    expect(getPropertyValue(updatedIssue, SystemPropertyId.STATUS)).toBe('in_progress')

    const filters = encodeURIComponent(
      JSON.stringify([
        {
          propertyId: SystemPropertyId.STATUS,
          propertyType: 'status',
          operator: 'equals',
          operand: 'in_progress',
        },
      ]),
    )
    const listResponse = await agent.get(`/api/v1/issues?filters=${filters}`).expect(200)
    const filteredIssue = (listResponse.body.data.issues as IssueRecord[]).find(issue => issue.issueId === issueId)

    expect(filteredIssue).toBeDefined()
    expect(getPropertyValue(filteredIssue!, SystemPropertyId.STATUS)).toBe('in_progress')

    await agent.delete(`/api/v1/issues/${issueId}`).expect(200)
  })

  it('POST /api/v1/issues/batch should create multiple issues', async () => {
    const title1 = `batch-issue-${Date.now()}-1`
    const title2 = `batch-issue-${Date.now()}-2`

    const response = await agent
      .post('/api/v1/issues/batch')
      .send({
        issues: [
          {
            propertyValues: [
              {
                propertyId: SystemPropertyId.TITLE,
                value: title1,
              },
            ],
          },
          {
            propertyValues: [
              {
                propertyId: SystemPropertyId.TITLE,
                value: title2,
              },
            ],
          },
        ],
      })
      .expect(201)

    expect(response.body).toHaveProperty('success', true)
    expect(response.body).toHaveProperty('data.results')

    const results = response.body.data.results as Array<{ issueId: number; success: boolean; errors?: string[] }>
    expect(results).toHaveLength(2)
    expect(results.every(r => r.success)).toBe(true)

    const listResponse = await agent.get('/api/v1/issues').expect(200)
    const issues = listResponse.body.data.issues as IssueRecord[]

    const titles = issues.map(inc => getPropertyValue(inc, SystemPropertyId.TITLE))
    expect(titles).toContain(title1)
    expect(titles).toContain(title2)
  })

  // TODO this should be moved to the tests of harness-kanban module
  it('should auto-queue Code Bot issues while preserving human restrictions', async () => {
    const createdIssueIds: number[] = []
    await createCodexCodingAgent()

    const createWithBotResponse = await agent
      .post('/api/v1/issues')
      .send({
        issue: {
          propertyValues: [
            {
              propertyId: SystemPropertyId.TITLE,
              value: `bot-create-${Date.now()}`,
            },
            {
              propertyId: SystemPropertyId.ASSIGNEE,
              value: SystemBotId.CODE_BOT,
            },
          ],
        },
      })
      .expect(201)

    const createWithBotIssueId = createWithBotResponse.body.data.issueId as number
    createdIssueIds.push(createWithBotIssueId)

    const createdIssue = await waitForIssuePropertyValue(createWithBotIssueId, SystemPropertyId.STATUS, 'queued')
    expect(getPropertyValue(createdIssue, SystemPropertyId.STATUS)).toBe('queued')
    expect(getPropertyValue(createdIssue, SystemPropertyId.ASSIGNEE)).toBe(SystemBotId.CODE_BOT)
    await waitForStatusActivity(createWithBotIssueId, 'queued')

    const invalidCreateResponse = await agent
      .post('/api/v1/issues')
      .send({
        issue: {
          propertyValues: [
            {
              propertyId: SystemPropertyId.TITLE,
              value: `bot-invalid-create-${Date.now()}`,
            },
            {
              propertyId: SystemPropertyId.ASSIGNEE,
              value: SystemBotId.CODE_BOT,
            },
            {
              propertyId: SystemPropertyId.STATUS,
              value: 'in_progress',
            },
          ],
        },
      })
      .expect(400)

    expect(invalidCreateResponse.body.error.message).toBe('Code Bot can only be assigned to issues in Todo status')

    const normalCreateResponse = await agent
      .post('/api/v1/issues')
      .send({
        issue: {
          propertyValues: [
            {
              propertyId: SystemPropertyId.TITLE,
              value: `bot-update-${Date.now()}`,
            },
          ],
        },
      })
      .expect(201)

    const updateIssueId = normalCreateResponse.body.data.issueId as number
    createdIssueIds.push(updateIssueId)

    await agent
      .put(`/api/v1/issues/${updateIssueId}`)
      .send({
        operations: [
          {
            propertyId: SystemPropertyId.ASSIGNEE,
            operationType: CommonPropertyOperationType.SET,
            operationPayload: { value: SystemBotId.CODE_BOT },
          },
        ],
      })
      .expect(200)

    const updatedIssue = await waitForIssuePropertyValue(updateIssueId, SystemPropertyId.STATUS, 'queued')
    expect(getPropertyValue(updatedIssue, SystemPropertyId.ASSIGNEE)).toBe(SystemBotId.CODE_BOT)
    await waitForStatusActivity(updateIssueId, 'queued')

    const invalidStatusResponse = await agent
      .put(`/api/v1/issues/${updateIssueId}`)
      .send({
        operations: [
          {
            propertyId: SystemPropertyId.STATUS,
            operationType: CommonPropertyOperationType.SET,
            operationPayload: { value: 'in_progress' },
          },
        ],
      })
      .expect(403)

    expect(invalidStatusResponse.body.error.message).toBe(
      'This issue is currently controlled by Code Bot. You can only cancel it.',
    )

    await agent
      .put(`/api/v1/issues/${updateIssueId}`)
      .send({
        operations: [
          {
            propertyId: SystemPropertyId.STATUS,
            operationType: CommonPropertyOperationType.SET,
            operationPayload: { value: 'canceled' },
          },
        ],
      })
      .expect(200)

    const nonTodoCreateResponse = await agent
      .post('/api/v1/issues')
      .send({
        issue: {
          propertyValues: [
            {
              propertyId: SystemPropertyId.TITLE,
              value: `bot-non-todo-${Date.now()}`,
            },
          ],
        },
      })
      .expect(201)

    const nonTodoIssueId = nonTodoCreateResponse.body.data.issueId as number
    createdIssueIds.push(nonTodoIssueId)

    await agent
      .put(`/api/v1/issues/${nonTodoIssueId}`)
      .send({
        operations: [
          {
            propertyId: SystemPropertyId.STATUS,
            operationType: CommonPropertyOperationType.SET,
            operationPayload: { value: 'in_progress' },
          },
        ],
      })
      .expect(200)

    await agent
      .put(`/api/v1/issues/${nonTodoIssueId}`)
      .send({
        operations: [
          {
            propertyId: SystemPropertyId.ASSIGNEE,
            operationType: CommonPropertyOperationType.SET,
            operationPayload: { value: SystemBotId.CODE_BOT },
          },
        ],
      })
      .expect(200)

    const continuedIssue = await agent.get(`/api/v1/issues/${nonTodoIssueId}`).expect(200)
    const continuedIssueRecord = continuedIssue.body.data.issue as IssueRecord
    expect(getPropertyValue(continuedIssueRecord, SystemPropertyId.ASSIGNEE)).toBe(SystemBotId.CODE_BOT)
    expect(getPropertyValue(continuedIssueRecord, SystemPropertyId.STATUS)).toBe('in_progress')

    await Promise.all(createdIssueIds.map(issueId => agent.delete(`/api/v1/issues/${issueId}`).expect(200)))
  })
})
