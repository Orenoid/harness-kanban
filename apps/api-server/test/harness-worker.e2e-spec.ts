import { DatabaseModule } from '@/database/database.module'
import { PrismaService } from '@/database/prisma.service'
import {
  HARNESS_WORKER_BUSY_STATUS,
  HARNESS_WORKER_IDLE_STATUS,
  HARNESS_WORKER_PLANNING_ISSUE_STATUS,
  HARNESS_WORKER_QUEUED_ISSUE_STATUS,
} from '@/harness-kanban/worker/worker.constants'
import { WorkerService } from '@/harness-kanban/worker/worker.service'
import { SystemBotId } from '@/user/constants/user.constants'
import { WorkerAppModule } from '@/worker-app.module'
import { INestApplicationContext } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { Test, TestingModule } from '@nestjs/testing'
import { PropertyType, SystemPropertyId } from '@repo/shared/property/constants'

const sleep = async (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const waitFor = async (assertion: () => Promise<boolean>, timeoutMs = 5_000, intervalMs = 100) => {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (await assertion()) {
      return
    }

    await sleep(intervalMs)
  }

  throw new Error(`Condition was not met within ${timeoutMs}ms`)
}

describe('Harness worker (e2e)', () => {
  jest.setTimeout(20_000)

  let moduleRef: TestingModule
  let prismaService: PrismaService
  const workerContexts: INestApplicationContext[] = []
  const testIssueCreator = 'harness-worker-e2e'
  const testWorkspaceId = 'workspace-harness-worker-e2e'

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
        }),
        DatabaseModule,
      ],
    }).compile()

    prismaService = moduleRef.get(PrismaService)
    await cleanupTestIssues()
  })

  afterEach(async () => {
    while (workerContexts.length > 0) {
      const workerContext = workerContexts.pop()
      if (workerContext) {
        await workerContext.close()
      }
    }

    await prismaService.client.harness_worker.deleteMany()
    await cleanupTestIssues()
  })

  afterAll(async () => {
    await moduleRef.close()
  })

  it('registers a worker row and keeps its heartbeat fresh', async () => {
    const workerService = await createWorkerHarness()
    const workerId = workerService.currentWorkerId

    expect(workerId).toBeTruthy()

    const initialWorker = await prismaService.client.harness_worker.findUniqueOrThrow({
      where: { id: workerId! },
    })

    expect(initialWorker.status).toBe(HARNESS_WORKER_IDLE_STATUS)
    expect(initialWorker.issue_id).toBeNull()
    expect(initialWorker.devpod_metadata).toBeNull()

    await waitFor(async () => {
      const refreshedWorker = await prismaService.client.harness_worker.findUniqueOrThrow({
        where: { id: workerId! },
      })

      return refreshedWorker.last_updated_at.getTime() > initialWorker.last_updated_at.getTime()
    }, 12_000)
  })

  it('deletes the worker row when the worker shuts down', async () => {
    const workerContext = await NestFactory.createApplicationContext(WorkerAppModule)
    const workerService = workerContext.get(WorkerService)
    const workerId = workerService.currentWorkerId

    expect(workerId).toBeTruthy()

    await workerContext.close()

    const worker = await prismaService.client.harness_worker.findUnique({
      where: { id: workerId! },
    })

    expect(worker).toBeNull()
  })

  it('ignores queued issues that are not assigned to Code Bot', async () => {
    const issueId = await createQueuedIssue('urgent', 'user-2')

    const workerService = await createWorkerHarness()
    const workerId = workerService.currentWorkerId!

    await sleep(250)

    const worker = await prismaService.client.harness_worker.findUniqueOrThrow({
      where: { id: workerId },
    })

    expect(worker.issue_id).toBeNull()
    expect(worker.status).toBe(HARNESS_WORKER_IDLE_STATUS)
    expect(await getIssueStatus(issueId)).toBe(HARNESS_WORKER_QUEUED_ISSUE_STATUS)
  })

  it('ignores queued Code Bot issues that are not in a project', async () => {
    const issueId = await createQueuedIssue('urgent', SystemBotId.CODE_BOT, null)

    const workerService = await createWorkerHarness()
    const workerId = workerService.currentWorkerId!

    await sleep(250)

    const worker = await prismaService.client.harness_worker.findUniqueOrThrow({
      where: { id: workerId },
    })

    expect(worker.issue_id).toBeNull()
    expect(worker.status).toBe(HARNESS_WORKER_IDLE_STATUS)
    expect(await getIssueStatus(issueId)).toBe(HARNESS_WORKER_QUEUED_ISSUE_STATUS)
  })

  it('claims the highest-priority queued Code Bot issue and moves it to planning', async () => {
    const ignoredUrgentIssueId = await createQueuedIssue('urgent', 'user-2')
    const lowIssueId = await createQueuedIssue('low')
    const urgentIssueId = await createQueuedIssue('urgent')

    const workerService = await createWorkerHarness()
    const workerId = workerService.currentWorkerId!

    await waitFor(async () => {
      const worker = await prismaService.client.harness_worker.findUniqueOrThrow({
        where: { id: workerId },
      })

      return (
        worker.issue_id === urgentIssueId &&
        worker.status === HARNESS_WORKER_BUSY_STATUS &&
        (await getIssueStatus(urgentIssueId)) === HARNESS_WORKER_PLANNING_ISSUE_STATUS
      )
    })

    const worker = await prismaService.client.harness_worker.findUniqueOrThrow({
      where: { id: workerId },
    })

    expect(worker.issue_id).toBe(urgentIssueId)
    expect(worker.status).toBe(HARNESS_WORKER_BUSY_STATUS)
    expect(workerService.currentIssueId).toBe(urgentIssueId)
    expect(worker.issue_id).not.toBe(lowIssueId)
    expect(worker.issue_id).not.toBe(ignoredUrgentIssueId)
    expect(await getIssueStatus(urgentIssueId)).toBe(HARNESS_WORKER_PLANNING_ISSUE_STATUS)
  })

  it('prevents two workers from claiming the same queued issue', async () => {
    const issueId = await createQueuedIssue('high')

    const [workerOne, workerTwo] = await Promise.all([createWorkerHarness(), createWorkerHarness()])
    const workerIds = [workerOne.currentWorkerId!, workerTwo.currentWorkerId!]

    await waitFor(async () => {
      const workers = await prismaService.client.harness_worker.findMany({
        where: {
          id: { in: workerIds },
        },
      })

      return (
        workers.length === 2 &&
        workers.filter(worker => worker.issue_id === issueId).length === 1 &&
        workers.filter(worker => worker.issue_id === null).length === 1 &&
        workers.some(worker => worker.status === HARNESS_WORKER_BUSY_STATUS) &&
        workers.some(worker => worker.status === HARNESS_WORKER_IDLE_STATUS) &&
        (await getIssueStatus(issueId)) === HARNESS_WORKER_PLANNING_ISSUE_STATUS
      )
    })

    const workers = await prismaService.client.harness_worker.findMany({
      where: {
        id: { in: workerIds },
      },
      orderBy: { id: 'asc' },
    })

    expect(workers).toHaveLength(2)
    expect(workers.filter(worker => worker.issue_id === issueId)).toHaveLength(1)
    expect(workers.filter(worker => worker.issue_id === null)).toHaveLength(1)
    expect(workers.some(worker => worker.status === HARNESS_WORKER_BUSY_STATUS)).toBe(true)
    expect(workers.some(worker => worker.status === HARNESS_WORKER_IDLE_STATUS)).toBe(true)
    expect(await getIssueStatus(issueId)).toBe(HARNESS_WORKER_PLANNING_ISSUE_STATUS)
  })

  const createWorkerHarness = async (): Promise<WorkerService> => {
    const workerContext = await NestFactory.createApplicationContext(WorkerAppModule)
    workerContexts.push(workerContext)

    return workerContext.get(WorkerService)
  }

  const createQueuedIssue = async (
    priority: 'urgent' | 'high' | 'medium' | 'low' | 'no-priority',
    assigneeId: string = SystemBotId.CODE_BOT,
    projectId: string | null = 'project-1',
  ): Promise<number> => {
    // TODO shouldn't call db directly in e2e tests, need to review other tests as well
    const issue = await prismaService.client.issue.create({
      data: {
        created_by: testIssueCreator,
        workspace_id: testWorkspaceId,
      },
    })

    await prismaService.client.property_single_value.createMany({
      data: [
        {
          issue_id: issue.id,
          property_id: SystemPropertyId.STATUS,
          property_type: PropertyType.STATUS,
          value: HARNESS_WORKER_QUEUED_ISSUE_STATUS,
        },
        {
          issue_id: issue.id,
          property_id: SystemPropertyId.PRIORITY,
          property_type: PropertyType.SELECT,
          value: priority,
        },
        {
          issue_id: issue.id,
          property_id: SystemPropertyId.ASSIGNEE,
          property_type: PropertyType.USER,
          value: assigneeId,
        },
        ...(projectId
          ? [
              {
                issue_id: issue.id,
                property_id: SystemPropertyId.PROJECT,
                property_type: PropertyType.PROJECT,
                value: projectId,
              },
            ]
          : []),
      ],
    })

    return issue.id
  }

  const getIssueStatus = async (issueId: number): Promise<string | null> => {
    const row = await prismaService.client.property_single_value.findUnique({
      where: {
        issue_id_property_id: {
          issue_id: issueId,
          property_id: SystemPropertyId.STATUS,
        },
      },
      select: {
        value: true,
      },
    })

    return typeof row?.value === 'string' ? row.value : null
  }

  const cleanupTestIssues = async (): Promise<void> => {
    const issues = await prismaService.client.issue.findMany({
      where: {
        created_by: testIssueCreator,
      },
      select: {
        id: true,
      },
    })

    if (issues.length === 0) {
      return
    }

    const issueIds = issues.map(issue => issue.id)

    await prismaService.client.property_single_value.deleteMany({
      where: {
        issue_id: { in: issueIds },
      },
    })

    await prismaService.client.issue.deleteMany({
      where: {
        id: { in: issueIds },
      },
    })
  }
})
