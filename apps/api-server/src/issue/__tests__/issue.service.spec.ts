import { AuthService } from '@/auth/auth.service'
import { PrismaService } from '@/database/prisma.service'
import { ISSUE_EVENTS } from '@/event-bus/constants/event.constants'
import { emit, emitInTx } from '@/event-bus/event-bus'
import { PreCreateIssueHook, PreUpdateIssueHook } from '@/issue/types/hook.types'
import { PropertyImplRegistry } from '@/property/impl-registry.service'
import { PropertyService } from '@/property/property.service'
import { BadRequestException } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { FilterOperator, PropertyType, SystemPropertyId } from '@repo/shared/property/constants'
import { FilterCondition } from '@repo/shared/property/types'
import { IssueService } from '../issue.service'

jest.mock('@/event-bus/event-bus')

describe('IssueService', () => {
  let service: IssueService
  let prismaService: jest.Mocked<PrismaService>
  let authService: jest.Mocked<AuthService>
  let propertyService: jest.Mocked<PropertyService>
  let propertyImplRegistry: jest.Mocked<PropertyImplRegistry>
  let eventEmitter: jest.Mocked<EventEmitter2>
  let preCreateIssueHooks: jest.Mocked<PreCreateIssueHook[]>
  let preUpdateIssueHooks: jest.Mocked<PreUpdateIssueHook[]>

  const mockStatusConfig = {
    initialStatusId: 'todo',
    statuses: [
      { id: 'todo', label: 'Todo', icon: 'Circle' },
      { id: 'in_progress', label: 'In progress', icon: 'Hammer' },
      { id: 'in_review', label: 'In review', icon: 'GitPullRequest' },
      { id: 'completed', label: 'Completed', icon: 'BadgeCheck' },
      { id: 'canceled', label: 'Canceled', icon: 'CircleSlash' },
    ],
    transitions: {
      todo: [
        { toStatusId: 'in_progress', actionLabel: 'Start work' },
        { toStatusId: 'canceled', actionLabel: 'Cancel' },
      ],
      in_progress: [
        { toStatusId: 'in_review', actionLabel: 'Submit for review' },
        { toStatusId: 'canceled', actionLabel: 'Cancel' },
      ],
      in_review: [
        { toStatusId: 'completed', actionLabel: 'Approve' },
        { toStatusId: 'in_progress', actionLabel: 'Request changes' },
      ],
      completed: [],
      canceled: [],
    },
  }

  beforeEach(() => {
    prismaService = {
      client: {
        $queryRaw: jest.fn(),
        $transaction: jest.fn(),
        issue: {
          findUnique: jest.fn(),
          findFirst: jest.fn(),
          findMany: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
          delete: jest.fn(),
        },
        property_single_value: {
          findMany: jest.fn().mockResolvedValue([]),
          findFirst: jest.fn(),
          deleteMany: jest.fn(),
        },
        property_multi_value: {
          findMany: jest.fn().mockResolvedValue([]),
          deleteMany: jest.fn(),
        },
        subscription: {
          findMany: jest.fn(),
        },
        property: {
          findMany: jest.fn(),
        },
      },
    } as unknown as jest.Mocked<PrismaService>

    authService = {
      checkUserPermission: jest.fn(),
      MANAGE_ISSUE_PERMISSION: 'manage:issue',
      CREATE_ISSUE_PERMISSION: 'create:issue',
    } as unknown as jest.Mocked<AuthService>

    propertyService = {
      getPropertyDefinitions: jest.fn(),
      getFieldToPropertyMapping: jest.fn(),
      getInitialStatusId: jest.fn().mockReturnValue(mockStatusConfig.initialStatusId),
      getPropertyDefinition: jest.fn(),
      getStatusPropertyConfig: jest.fn().mockResolvedValue(mockStatusConfig),
    } as unknown as jest.Mocked<PropertyService>

    propertyImplRegistry = {
      getImpl: jest.fn(),
    } as unknown as jest.Mocked<PropertyImplRegistry>

    eventEmitter = {
      emit: jest.fn(),
      emitAsync: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<EventEmitter2>

    preCreateIssueHooks = []
    preUpdateIssueHooks = []

    service = new IssueService(
      prismaService,
      authService,
      propertyService,
      propertyImplRegistry,
      eventEmitter,
      preCreateIssueHooks,
      preUpdateIssueHooks,
    )

    jest.clearAllMocks()
    ;(emit as jest.Mock).mockClear()
    ;(emitInTx as jest.Mock).mockClear()
  })

  describe('getIssues', () => {
    const mockProperties = [
      { id: SystemPropertyId.ID, name: 'ID', type: 'id' },
      { id: SystemPropertyId.TITLE, name: 'Title', type: 'title' },
      { id: SystemPropertyId.STATUS, name: 'Status', type: 'status', config: mockStatusConfig },
      { id: 'custom-prop-123', name: 'Custom Field', type: 'text' },
    ]

    beforeEach(() => {
      propertyService.getPropertyDefinitions.mockResolvedValue(mockProperties as any)
      ;(prismaService.client.$queryRaw as jest.Mock).mockResolvedValue([])
      ;(prismaService.client.property_single_value.findMany as jest.Mock).mockResolvedValue([])
      ;(prismaService.client.property_multi_value.findMany as jest.Mock).mockResolvedValue([])
    })

    it('should throw BadRequestException when filter contains invalid property ID', async () => {
      const filters: FilterCondition[] = [
        {
          propertyId: 'invalid-property-id',
          propertyType: 'text',
          operator: FilterOperator.Equals,
          operand: 'test',
        },
      ]

      await expect(service.getIssues(filters, [], 'workspace-123')).rejects.toThrow(
        new BadRequestException('Invalid property ID in filters: invalid-property-id'),
      )
    })

    it('should not throw error when all filter property IDs are valid', async () => {
      const filters: FilterCondition[] = [
        {
          propertyId: SystemPropertyId.STATUS,
          propertyType: 'status',
          operator: FilterOperator.Equals,
          operand: 'todo',
        },
        {
          propertyId: 'custom-prop-123',
          propertyType: 'text',
          operator: FilterOperator.Contains,
          operand: 'test',
        },
      ]

      // getPropertyDefinitions is called twice: once for validation, once in getIssuesWithValues
      propertyService.getPropertyDefinitions
        .mockResolvedValueOnce(mockProperties as any)
        .mockResolvedValueOnce(mockProperties as any)

      await expect(service.getIssues(filters, [], 'workspace-123')).resolves.not.toThrow()
    })

    it('should throw BadRequestException for first invalid property ID when multiple invalid IDs exist', async () => {
      const filters: FilterCondition[] = [
        {
          propertyId: SystemPropertyId.TITLE,
          propertyType: 'title',
          operator: FilterOperator.Equals,
          operand: 'valid',
        },
        {
          propertyId: 'another-invalid-id',
          propertyType: 'text',
          operator: FilterOperator.Equals,
          operand: 'test',
        },
      ]

      await expect(service.getIssues(filters, [], 'workspace-123')).rejects.toThrow(
        new BadRequestException('Invalid property ID in filters: another-invalid-id'),
      )
    })

    it('should skip validation when filters is empty array', async () => {
      // getPropertyDefinitions is called once in getIssuesWithValues, but not for validation
      propertyService.getPropertyDefinitions.mockResolvedValue(mockProperties as any)
      await expect(service.getIssues([], [], 'workspace-123')).resolves.not.toThrow()
      expect(propertyService.getPropertyDefinitions).toHaveBeenCalledTimes(1)
    })

    it('should skip validation when filters is undefined', async () => {
      // getPropertyDefinitions is called once in getIssuesWithValues, but not for validation
      propertyService.getPropertyDefinitions.mockResolvedValue(mockProperties as any)
      await expect(service.getIssues(undefined, [], 'workspace-123')).resolves.not.toThrow()
      expect(propertyService.getPropertyDefinitions).toHaveBeenCalledTimes(1)
    })

    it('should validate all system property IDs correctly', async () => {
      const filters: FilterCondition[] = [
        {
          propertyId: SystemPropertyId.ID,
          propertyType: 'id',
          operator: FilterOperator.Equals,
          operand: '123',
        },
        {
          propertyId: SystemPropertyId.TITLE,
          propertyType: 'title',
          operator: FilterOperator.Contains,
          operand: 'test',
        },
        {
          propertyId: SystemPropertyId.STATUS,
          propertyType: 'status',
          operator: FilterOperator.Equals,
          operand: 'todo',
        },
        {
          propertyId: SystemPropertyId.PRIORITY,
          propertyType: 'select',
          operator: FilterOperator.Equals,
          operand: 'high',
        },
      ]

      const validProperties = [
        { id: SystemPropertyId.ID, name: 'ID', type: 'id' },
        { id: SystemPropertyId.TITLE, name: 'Title', type: 'title' },
        { id: SystemPropertyId.STATUS, name: 'Status', type: 'status', config: mockStatusConfig },
        { id: SystemPropertyId.PRIORITY, name: 'Priority', type: 'select' },
      ]

      // getPropertyDefinitions is called twice: once for validation, once in getIssuesWithValues
      propertyService.getPropertyDefinitions
        .mockResolvedValueOnce(validProperties as any)
        .mockResolvedValueOnce(validProperties as any)

      await expect(service.getIssues(filters, [], 'workspace-123')).resolves.not.toThrow()
    })

    it('should call getPropertyDefinitions to get valid property IDs', async () => {
      const filters: FilterCondition[] = [
        {
          propertyId: SystemPropertyId.STATUS,
          propertyType: 'status',
          operator: FilterOperator.Equals,
          operand: 'todo',
        },
      ]

      // getPropertyDefinitions is called twice: once for validation, once in getIssuesWithValues
      propertyService.getPropertyDefinitions
        .mockResolvedValueOnce(mockProperties as any)
        .mockResolvedValueOnce(mockProperties as any)

      await service.getIssues(filters, [], 'workspace-123')

      expect(propertyService.getPropertyDefinitions).toHaveBeenCalledTimes(2)
    })
  })

  describe('getIssueById', () => {
    it('should return issue when found', async () => {
      ;(prismaService.client.issue.findFirst as jest.Mock).mockResolvedValue({
        id: 123,
        workspace_id: 'workspace-123',
      })
      ;(prismaService.client.$queryRaw as jest.Mock).mockResolvedValue([
        { issue_id: 123, property_id: 'title', property_type: 'title', value: 'Test Issue' },
      ])
      ;(prismaService.client.property_single_value.findMany as jest.Mock).mockResolvedValue([
        { issue_id: 123, property_id: 'title', property_type: 'title', value: 'Test Issue' },
      ])
      ;(prismaService.client.property_multi_value.findMany as jest.Mock).mockResolvedValue([])
      propertyService.getPropertyDefinitions.mockResolvedValue([{ id: 'title', name: 'Title', type: 'title' }] as any)

      const result = await service.getIssueById(123)

      expect(result.issueId).toBe(123)
      expect(result.propertyValues).toBeDefined()
    })

    it('should throw NotFoundException when issue not found', async () => {
      ;(prismaService.client.issue.findFirst as jest.Mock).mockResolvedValue(null)

      await expect(service.getIssueById(999)).rejects.toThrow('Issue with ID 999 not found')
    })
  })

  describe('getIssuesByIds', () => {
    it('should return issues for given ids', async () => {
      ;(prismaService.client.issue.findMany as jest.Mock).mockResolvedValue([{ id: 1 }, { id: 2 }])
      ;(prismaService.client.$queryRaw as jest.Mock).mockResolvedValue([
        { issue_id: 1, property_id: 'title', property_type: 'title', value: 'Issue 1' },
        { issue_id: 2, property_id: 'title', property_type: 'title', value: 'Issue 2' },
      ])
      ;(prismaService.client.property_single_value.findMany as jest.Mock).mockResolvedValue([
        { issue_id: 1, property_id: 'title', property_type: 'title', value: 'Issue 1' },
        { issue_id: 2, property_id: 'title', property_type: 'title', value: 'Issue 2' },
      ])
      ;(prismaService.client.property_multi_value.findMany as jest.Mock).mockResolvedValue([])
      propertyService.getPropertyDefinitions.mockResolvedValue([{ id: 'title', name: 'Title', type: 'title' }] as any)

      const result = await service.getIssuesByIds([1, 2])

      expect(result).toHaveLength(2)
      expect(result[0].issueId).toBe(1)
      expect(result[1].issueId).toBe(2)
    })

    it('should return empty array when no ids provided', async () => {
      const result = await service.getIssuesByIds([])

      expect(result).toEqual([])
      expect(prismaService.client.issue.findMany).not.toHaveBeenCalled()
    })

    it('should filter out non-existent issue ids', async () => {
      ;(prismaService.client.issue.findMany as jest.Mock).mockResolvedValue([{ id: 1 }])
      ;(prismaService.client.$queryRaw as jest.Mock).mockResolvedValue([
        { issue_id: 1, property_id: 'title', property_type: 'title', value: 'Issue 1' },
      ])
      ;(prismaService.client.property_single_value.findMany as jest.Mock).mockResolvedValue([
        { issue_id: 1, property_id: 'title', property_type: 'title', value: 'Issue 1' },
      ])
      ;(prismaService.client.property_multi_value.findMany as jest.Mock).mockResolvedValue([])
      propertyService.getPropertyDefinitions.mockResolvedValue([{ id: 'title', name: 'Title', type: 'title' }] as any)

      const result = await service.getIssuesByIds([1, 999])

      expect(result).toHaveLength(1)
      expect(result[0].issueId).toBe(1)
    })

    it('should filter by workspaceId when provided', async () => {
      ;(prismaService.client.issue.findMany as jest.Mock).mockResolvedValue([{ id: 1 }])
      ;(prismaService.client.$queryRaw as jest.Mock).mockResolvedValue([])
      ;(prismaService.client.property_single_value.findMany as jest.Mock).mockResolvedValue([])
      ;(prismaService.client.property_multi_value.findMany as jest.Mock).mockResolvedValue([])
      propertyService.getPropertyDefinitions.mockResolvedValue([])

      await service.getIssuesByIds([1], 'workspace-123')

      expect(prismaService.client.issue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            workspace_id: 'workspace-123',
          }),
        }),
      )
    })

    it('should maintain order of input ids', async () => {
      ;(prismaService.client.issue.findMany as jest.Mock).mockResolvedValue([{ id: 3 }, { id: 1 }, { id: 2 }])
      ;(prismaService.client.$queryRaw as jest.Mock).mockResolvedValue([
        { issue_id: 1, property_id: 'title', property_type: 'title', value: 'Issue 1' },
        { issue_id: 2, property_id: 'title', property_type: 'title', value: 'Issue 2' },
        { issue_id: 3, property_id: 'title', property_type: 'title', value: 'Issue 3' },
      ])
      ;(prismaService.client.property_single_value.findMany as jest.Mock).mockResolvedValue([
        { issue_id: 1, property_id: 'title', property_type: 'title', value: 'Issue 1' },
        { issue_id: 2, property_id: 'title', property_type: 'title', value: 'Issue 2' },
        { issue_id: 3, property_id: 'title', property_type: 'title', value: 'Issue 3' },
      ])
      ;(prismaService.client.property_multi_value.findMany as jest.Mock).mockResolvedValue([])
      propertyService.getPropertyDefinitions.mockResolvedValue([{ id: 'title', name: 'Title', type: 'title' }] as any)

      const result = await service.getIssuesByIds([3, 1, 2])

      expect(result[0].issueId).toBe(3)
      expect(result[1].issueId).toBe(1)
      expect(result[2].issueId).toBe(2)
    })
  })

  describe('issue property value helpers', () => {
    it('should return a trimmed string property value for a single issue', async () => {
      ;(prismaService.client.issue.findFirst as jest.Mock).mockResolvedValue({
        id: 123,
        workspace_id: 'workspace-123',
      })
      ;(prismaService.client.property_single_value.findMany as jest.Mock).mockResolvedValue([
        {
          issue_id: 123,
          property_id: SystemPropertyId.TITLE,
          property_type: PropertyType.TITLE,
          value: '  Issue title  ',
          number_value: null,
        },
      ])
      ;(prismaService.client.property_multi_value.findMany as jest.Mock).mockResolvedValue([])
      propertyService.getPropertyDefinitions.mockResolvedValue([
        { id: SystemPropertyId.TITLE, name: 'Title', type: PropertyType.TITLE },
      ] as any)

      await expect(service.getIssueStringPropertyValue(123, SystemPropertyId.TITLE)).resolves.toBe('Issue title')
    })

    it('should return requested property values for multiple issues', async () => {
      ;(prismaService.client.issue.findMany as jest.Mock).mockResolvedValue([{ id: 1 }, { id: 2 }])
      ;(prismaService.client.property_single_value.findMany as jest.Mock).mockResolvedValue([
        {
          issue_id: 1,
          property_id: SystemPropertyId.TITLE,
          property_type: PropertyType.TITLE,
          value: 'Issue 1',
          number_value: null,
        },
        {
          issue_id: 1,
          property_id: SystemPropertyId.STATUS,
          property_type: PropertyType.STATUS,
          value: 'todo',
          number_value: null,
        },
        {
          issue_id: 2,
          property_id: SystemPropertyId.TITLE,
          property_type: PropertyType.TITLE,
          value: 'Issue 2',
          number_value: null,
        },
      ])
      ;(prismaService.client.property_multi_value.findMany as jest.Mock).mockResolvedValue([])
      propertyService.getPropertyDefinitions.mockResolvedValue([
        { id: SystemPropertyId.TITLE, name: 'Title', type: PropertyType.TITLE },
        { id: SystemPropertyId.STATUS, name: 'Status', type: PropertyType.STATUS },
      ] as any)

      const result = await service.getIssuePropertyValuesByIds([1, 2], [SystemPropertyId.TITLE])

      expect(result.get(1)?.get(SystemPropertyId.TITLE)).toBe('Issue 1')
      expect(result.get(1)?.has(SystemPropertyId.STATUS)).toBe(false)
      expect(result.get(2)?.get(SystemPropertyId.TITLE)).toBe('Issue 2')
    })
  })

  describe('getIssueStates', () => {
    it('returns assignee and status snapshots for existing issues', async () => {
      ;(prismaService.client.issue.findMany as jest.Mock).mockResolvedValue([{ id: 2 }, { id: 1 }])
      ;(prismaService.client.property_single_value.findMany as jest.Mock).mockResolvedValue([
        {
          issue_id: 1,
          property_id: SystemPropertyId.ASSIGNEE,
          value: 'user-1',
        },
        {
          issue_id: 1,
          property_id: SystemPropertyId.STATUS,
          value: 'todo',
        },
        {
          issue_id: 2,
          property_id: SystemPropertyId.STATUS,
          value: 'in_progress',
        },
      ])

      const result = await service.getIssueStates([1, 2, 999])

      expect(Array.from(result.entries())).toEqual([
        [
          1,
          {
            assigneeId: 'user-1',
            statusId: 'todo',
          },
        ],
        [
          2,
          {
            assigneeId: null,
            statusId: 'in_progress',
          },
        ],
      ])
      expect(prismaService.client.property_single_value.findMany).toHaveBeenCalledWith({
        where: {
          issue_id: { in: [1, 2] },
          property_id: { in: [SystemPropertyId.ASSIGNEE, SystemPropertyId.STATUS] },
          deleted_at: null,
        },
        select: {
          issue_id: true,
          property_id: true,
          value: true,
        },
      })
    })

    it('filters issue snapshots by workspace when provided', async () => {
      ;(prismaService.client.issue.findMany as jest.Mock).mockResolvedValue([{ id: 7 }])
      ;(prismaService.client.property_single_value.findMany as jest.Mock).mockResolvedValue([])

      const result = await service.getIssueStates([7, 8], 'workspace-123')

      expect(Array.from(result.keys())).toEqual([7])
      expect(prismaService.client.issue.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: [7, 8] },
          deleted_at: null,
          workspace_id: 'workspace-123',
        },
        select: {
          id: true,
        },
      })
    })
  })

  describe('deleteIssue', () => {
    const mockIssueId = 123
    const mockWorkspaceId = 'workspace-123'
    const mockUserId = 'user-123'

    beforeEach(() => {
      ;(prismaService.client.issue.findUnique as jest.Mock).mockResolvedValue({
        id: mockIssueId,
        workspace_id: mockWorkspaceId,
      })
      ;(authService.checkUserPermission as jest.Mock).mockResolvedValue(true)
      ;(prismaService.client.$transaction as jest.Mock).mockImplementation(async callback => {
        const mockTx = {
          property_single_value: {
            findFirst: jest.fn().mockResolvedValue({ value: 'Issue title' }),
            deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
          property_multi_value: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
          subscription: {
            findMany: jest.fn().mockResolvedValue([{ user_id: 'subscriber-1' }, { user_id: mockUserId }]),
          },
          issue: { delete: jest.fn().mockResolvedValue({ id: mockIssueId }) },
        }
        return await callback(mockTx)
      })
    })

    it('should delete issue and emit ISSUE_DELETED events', async () => {
      await service.deleteIssue(mockWorkspaceId, mockUserId, mockIssueId)

      expect(prismaService.client.$transaction).toHaveBeenCalled()
      expect(emitInTx).toHaveBeenCalledWith(eventEmitter, expect.anything(), ISSUE_EVENTS.ISSUE_DELETED_IN_TX, {
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        issueId: mockIssueId,
        issueTitle: 'Issue title',
        subscriberIds: ['subscriber-1', mockUserId],
      })
      expect(emit).toHaveBeenCalledWith(eventEmitter, ISSUE_EVENTS.ISSUE_DELETED, {
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        issueId: mockIssueId,
        issueTitle: 'Issue title',
        subscriberIds: ['subscriber-1', mockUserId],
      })
    })

    it('should throw NotFoundException when issue does not exist', async () => {
      ;(prismaService.client.issue.findUnique as jest.Mock).mockResolvedValue(null)

      await expect(service.deleteIssue(mockWorkspaceId, mockUserId, mockIssueId)).rejects.toThrow(
        'Issue does not exist.',
      )
    })

    it('should throw NotFoundException when issue belongs to different workspace', async () => {
      ;(prismaService.client.issue.findUnique as jest.Mock).mockResolvedValue({
        id: mockIssueId,
        workspace_id: 'different-workspace',
      })

      await expect(service.deleteIssue(mockWorkspaceId, mockUserId, mockIssueId)).rejects.toThrow(
        'Issue does not exist.',
      )
    })

    it('should throw ForbiddenException when user has no permission', async () => {
      ;(authService.checkUserPermission as jest.Mock).mockResolvedValue(false)

      await expect(service.deleteIssue(mockWorkspaceId, mockUserId, mockIssueId)).rejects.toThrow(
        'No access to delete issues',
      )
    })
  })

  describe('batchCreateIssues', () => {
    const mockWorkspaceId = 'workspace-123'
    const mockCreatorId = 'user-123'

    beforeEach(() => {
      ;(authService.checkUserPermission as jest.Mock).mockResolvedValue(true)
      ;(prismaService.client.property.findMany as jest.Mock).mockResolvedValue([
        {
          id: SystemPropertyId.STATUS,
          name: 'Status',
          type: PropertyType.STATUS,
          config: mockStatusConfig,
          readonly: false,
          deletable: false,
        },
        { id: SystemPropertyId.TITLE, name: 'Title', type: 'title', config: {}, readonly: false, deletable: false },
      ])
      ;(propertyImplRegistry.getImpl as jest.Mock).mockReturnValue({
        validateFormat: jest.fn().mockReturnValue({ valid: true }),
        validateBusinessRules: jest.fn().mockResolvedValue({ valid: true }),
        transformToDbFormat: jest.fn().mockResolvedValue({
          singleValues: [{ issue_id: 1, property_id: SystemPropertyId.TITLE, property_type: 'title', value: 'Test' }],
          multiValues: [],
        }),
      })
      ;(prismaService.client.$transaction as jest.Mock).mockImplementation(async callback => {
        const mockTx = {
          issue: {
            create: jest.fn().mockResolvedValue({ id: 1, created_at: new Date() }),
          },
          property_single_value: {
            createMany: jest.fn().mockResolvedValue({ count: 2 }),
          },
          property_multi_value: {
            createMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
          activity: {
            createMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
        }
        return await callback(mockTx)
      })
    })

    it('should create issues and emit ISSUE_CREATED events', async () => {
      const issues = [
        {
          propertyValues: [{ propertyId: SystemPropertyId.TITLE, value: 'Test Issue' }],
        },
      ]

      await service.batchCreateIssues(mockWorkspaceId, mockCreatorId, issues)

      expect(prismaService.client.$transaction).toHaveBeenCalled()
      expect(emitInTx).toHaveBeenCalledWith(
        eventEmitter,
        expect.anything(),
        ISSUE_EVENTS.ISSUE_CREATED_IN_TX,
        expect.objectContaining({
          issues: expect.arrayContaining([
            expect.objectContaining({
              workspaceId: mockWorkspaceId,
              userId: mockCreatorId,
              issueId: expect.any(Number),
            }),
          ]),
        }),
      )
      expect(emit).toHaveBeenCalledWith(eventEmitter, ISSUE_EVENTS.ISSUE_CREATED, expect.any(Object))
    })

    it('should not emit events when no issues are created', async () => {
      await service.batchCreateIssues(mockWorkspaceId, mockCreatorId, [])

      expect(prismaService.client.$transaction).not.toHaveBeenCalled()
      expect(emitInTx).not.toHaveBeenCalled()
      expect(emit).not.toHaveBeenCalled()
    })

    it('should not emit events when validation fails', async () => {
      const issues = [
        {
          propertyValues: [{ propertyId: 'invalid-property', value: 'test' }],
        },
      ]

      // Mock validation failure
      ;(propertyImplRegistry.getImpl as jest.Mock).mockReturnValue({
        validateFormat: jest.fn().mockReturnValue({ valid: false, errors: ['Invalid format'] }),
      })

      const result = await service.batchCreateIssues(mockWorkspaceId, mockCreatorId, issues)

      expect(result[0].success).toBe(false)
      expect(prismaService.client.$transaction).not.toHaveBeenCalled()
      expect(emitInTx).not.toHaveBeenCalled()
      expect(emit).not.toHaveBeenCalled()
    })

    it('should apply the configured default status when input omits status', async () => {
      const titleProcessor = {
        validateFormat: jest.fn().mockReturnValue({ valid: true }),
        validateBusinessRules: jest.fn().mockResolvedValue({ valid: true }),
        transformToDbFormat: jest.fn().mockResolvedValue({
          singleValues: [{ issue_id: 1, property_id: SystemPropertyId.TITLE, property_type: 'title', value: 'Test' }],
          multiValues: [],
        }),
      }
      const statusProcessor = {
        validateFormat: jest.fn().mockReturnValue({ valid: true }),
        validateBusinessRules: jest.fn().mockResolvedValue({ valid: true }),
        transformToDbFormat: jest.fn().mockResolvedValue({
          singleValues: [
            { issue_id: 1, property_id: SystemPropertyId.STATUS, property_type: PropertyType.STATUS, value: 'todo' },
          ],
          multiValues: [],
        }),
      }
      ;(propertyImplRegistry.getImpl as jest.Mock).mockImplementation((_registryName: string, type: string) =>
        type === PropertyType.STATUS ? statusProcessor : titleProcessor,
      )

      await service.batchCreateIssues(mockWorkspaceId, mockCreatorId, [
        {
          propertyValues: [{ propertyId: SystemPropertyId.TITLE, value: 'Test Issue' }],
        },
      ])

      expect(statusProcessor.validateFormat).toHaveBeenCalledWith(
        expect.objectContaining({ id: SystemPropertyId.STATUS, type: PropertyType.STATUS }),
        'todo',
      )
      expect(statusProcessor.validateBusinessRules).toHaveBeenCalledWith(
        { userId: mockCreatorId, workspaceId: mockWorkspaceId },
        expect.objectContaining({ id: SystemPropertyId.STATUS, type: PropertyType.STATUS }),
        'todo',
      )
    })

    it('should run pre-create hooks before transaction writes', async () => {
      const hook = {
        execute: jest.fn().mockResolvedValue({ valid: true }),
      } as unknown as PreCreateIssueHook
      preCreateIssueHooks.push(hook)

      await service.batchCreateIssues(mockWorkspaceId, mockCreatorId, [
        {
          propertyValues: [{ propertyId: SystemPropertyId.TITLE, value: 'Test Issue' }],
        },
      ])

      expect(hook.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: mockWorkspaceId,
          userId: mockCreatorId,
          getRequestedValue: expect.any(Function),
        }),
      )
      expect(prismaService.client.$transaction).toHaveBeenCalled()
    })

    it('should return hook errors and skip writes when a pre-create hook rejects the issue', async () => {
      const hook = {
        execute: jest.fn().mockResolvedValue({ valid: false, errors: ['hook rejected create'] }),
      } as unknown as PreCreateIssueHook
      preCreateIssueHooks.push(hook)

      const result = await service.batchCreateIssues(mockWorkspaceId, mockCreatorId, [
        {
          propertyValues: [{ propertyId: SystemPropertyId.TITLE, value: 'Test Issue' }],
        },
      ])

      expect(result).toEqual([
        {
          issueId: 0,
          success: false,
          errors: ['hook rejected create'],
        },
      ])
      expect(prismaService.client.$transaction).not.toHaveBeenCalled()
    })
  })

  describe('updateIssue', () => {
    const mockWorkspaceId = 'workspace-123'
    const mockUserId = 'user-123'
    const mockIssueId = 123

    beforeEach(() => {
      ;(prismaService.client.issue.findUnique as jest.Mock).mockResolvedValue({
        id: mockIssueId,
        workspace_id: mockWorkspaceId,
        deleted_at: null,
      })
      ;(prismaService.client.property.findMany as jest.Mock).mockResolvedValue([
        {
          id: SystemPropertyId.STATUS,
          name: 'Status',
          type: PropertyType.STATUS,
          config: mockStatusConfig,
          readonly: false,
          deletable: false,
        },
        { id: SystemPropertyId.TITLE, name: 'Title', type: 'title', config: {}, readonly: false, deletable: false },
      ])
      ;(prismaService.client.$transaction as jest.Mock).mockImplementation(async callback => {
        const mockTx = {
          property_single_value: {
            upsert: jest.fn().mockResolvedValue({}),
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
          property_multi_value: {
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
            createMany: jest.fn().mockResolvedValue({ count: 0 }),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
          activity: {
            createManyAndReturn: jest.fn().mockResolvedValue([{ id: 1 }]),
          },
          issue: {
            update: jest.fn().mockResolvedValue({ id: mockIssueId }),
          },
        }
        return await callback(mockTx)
      })
      ;(propertyImplRegistry.getImpl as jest.Mock).mockReturnValue({
        validateFormat: jest.fn().mockReturnValue({ valid: true }),
        validateBusinessRules: jest.fn().mockResolvedValue({ valid: true }),
        valueChanged: jest.fn().mockReturnValue(true),
        generateActivity: jest.fn().mockReturnValue([]),
        transformToDbOperations: jest.fn().mockResolvedValue({
          singleValueUpdate: { value: 'new value', number_value: null },
        }),
      })
    })

    it('should update issue and emit ISSUE_UPDATED and ACTIVITY_CREATED events', async () => {
      const validateBusinessRules = jest.fn().mockResolvedValue({ valid: true })
      ;(propertyImplRegistry.getImpl as jest.Mock).mockReturnValue({
        validateFormat: jest.fn().mockReturnValue({ valid: true }),
        validateBusinessRules,
        valueChanged: jest.fn().mockReturnValue(true),
        generateActivity: jest
          .fn()
          .mockReturnValue([
            { issueId: mockIssueId, type: 'update', payload: { userId: mockUserId }, createdBy: mockUserId },
          ]),
        transformToDbOperations: jest.fn().mockResolvedValue({
          singleValueUpdate: { value: 'in_progress', number_value: null },
        }),
      })

      const input = {
        issueId: mockIssueId,
        operations: [
          {
            propertyId: SystemPropertyId.STATUS,
            operationType: 'set',
            operationPayload: { value: 'in_progress' },
          },
        ],
      }

      await service.updateIssue({ workspaceId: mockWorkspaceId, userId: mockUserId }, input as any)

      expect(prismaService.client.$transaction).toHaveBeenCalled()
      expect(emitInTx).toHaveBeenCalledWith(
        eventEmitter,
        expect.anything(),
        ISSUE_EVENTS.ACTIVITY_CREATED_IN_TX,
        expect.any(Object),
      )
      expect(emitInTx).toHaveBeenCalledWith(eventEmitter, expect.anything(), ISSUE_EVENTS.ISSUE_UPDATED_IN_TX, {
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        issueId: mockIssueId,
        updatedPropertyIds: [SystemPropertyId.STATUS],
        propertyChanges: [
          {
            propertyId: SystemPropertyId.STATUS,
            previousValue: null,
            newValue: 'in_progress',
          },
        ],
      })
      expect(emit).toHaveBeenCalledWith(eventEmitter, ISSUE_EVENTS.ACTIVITY_CREATED, expect.any(Object))
      expect(emit).toHaveBeenCalledWith(eventEmitter, ISSUE_EVENTS.ISSUE_UPDATED, {
        workspaceId: mockWorkspaceId,
        userId: mockUserId,
        issueId: mockIssueId,
        updatedPropertyIds: [SystemPropertyId.STATUS],
        propertyChanges: [
          {
            propertyId: SystemPropertyId.STATUS,
            previousValue: null,
            newValue: 'in_progress',
          },
        ],
      })
      expect(validateBusinessRules).toHaveBeenCalledWith(
        { workspaceId: mockWorkspaceId, userId: mockUserId },
        expect.objectContaining({ id: SystemPropertyId.STATUS, type: PropertyType.STATUS }),
        'set',
        { value: 'in_progress' },
        mockIssueId,
      )
    })

    it('should not emit events when no changes are made', async () => {
      ;(propertyImplRegistry.getImpl as jest.Mock).mockReturnValue({
        validateFormat: jest.fn().mockReturnValue({ valid: true }),
        validateBusinessRules: jest.fn().mockResolvedValue({ valid: true }),
        valueChanged: jest.fn().mockReturnValue(false),
        generateActivity: jest.fn().mockReturnValue([]),
        transformToDbOperations: jest.fn().mockResolvedValue({}),
      })

      const input = {
        issueId: mockIssueId,
        operations: [
          {
            propertyId: SystemPropertyId.STATUS,
            operationType: 'set',
            operationPayload: { value: 'same_value' },
          },
        ],
      }

      const result = await service.updateIssue({ workspaceId: mockWorkspaceId, userId: mockUserId }, input as any)

      expect(result.success).toBe(true)
      expect(prismaService.client.$transaction).not.toHaveBeenCalled()
      expect(emitInTx).not.toHaveBeenCalled()
      expect(emit).not.toHaveBeenCalled()
    })

    it('should return error when issue not found', async () => {
      ;(prismaService.client.issue.findUnique as jest.Mock).mockResolvedValue(null)

      const input = {
        issueId: mockIssueId,
        operations: [
          {
            propertyId: SystemPropertyId.STATUS,
            operationType: 'set',
            operationPayload: { value: 'in_progress' },
          },
        ],
      }

      const result = await service.updateIssue({ workspaceId: mockWorkspaceId, userId: mockUserId }, input as any)

      expect(result.success).toBe(false)
      expect(prismaService.client.$transaction).not.toHaveBeenCalled()
      expect(emitInTx).not.toHaveBeenCalled()
      expect(emit).not.toHaveBeenCalled()
    })

    it('should return business validation errors without writing changes', async () => {
      ;(propertyImplRegistry.getImpl as jest.Mock).mockReturnValue({
        validateFormat: jest.fn().mockReturnValue({ valid: true }),
        validateBusinessRules: jest
          .fn()
          .mockResolvedValue({ valid: false, errors: ['Transition from "todo" to "completed" is not allowed'] }),
        valueChanged: jest.fn().mockReturnValue(true),
      })

      const result = await service.updateIssue({ workspaceId: mockWorkspaceId, userId: mockUserId }, {
        issueId: mockIssueId,
        operations: [
          {
            propertyId: SystemPropertyId.STATUS,
            operationType: 'set',
            operationPayload: { value: 'completed' },
          },
        ],
      } as any)

      expect(result).toEqual({
        success: false,
        errors: ['Transition from "todo" to "completed" is not allowed'],
      })
      expect(prismaService.client.$transaction).not.toHaveBeenCalled()
      expect(emitInTx).not.toHaveBeenCalled()
      expect(emit).not.toHaveBeenCalled()
    })

    it('should reject project reassignment after creation', async () => {
      propertyImplRegistry.getImpl.mockReturnValue({
        validateFormat: jest.fn().mockReturnValue({
          valid: false,
          errors: ['Project cannot be changed after issue creation'],
        }),
      } as any)
      ;(prismaService.client.property.findMany as jest.Mock).mockResolvedValue([
        {
          id: SystemPropertyId.PROJECT,
          name: 'Project',
          type: 'project',
          config: {},
          readonly: false,
          deletable: false,
        },
      ])

      const input = {
        issueId: mockIssueId,
        operations: [
          {
            propertyId: SystemPropertyId.PROJECT,
            operationType: 'set',
            operationPayload: { value: 'project-2' },
          },
        ],
      }

      const result = await service.updateIssue({ workspaceId: mockWorkspaceId, userId: mockUserId }, input as any)

      expect(result).toEqual({
        success: false,
        errors: ['Project cannot be changed after issue creation'],
      })
      expect(propertyImplRegistry.getImpl).toHaveBeenCalled()
      expect(prismaService.client.$transaction).not.toHaveBeenCalled()
    })

    it('should run pre-update hooks with changed operations only', async () => {
      const hook = {
        execute: jest.fn().mockResolvedValue({ valid: true }),
      } as unknown as PreUpdateIssueHook
      preUpdateIssueHooks.push(hook)
      ;(prismaService.client.property.findMany as jest.Mock).mockResolvedValue([
        {
          id: SystemPropertyId.STATUS,
          name: 'Status',
          type: PropertyType.STATUS,
          config: mockStatusConfig,
          readonly: false,
          deletable: false,
        },
        {
          id: SystemPropertyId.TITLE,
          name: 'Title',
          type: PropertyType.TITLE,
          config: {},
          readonly: false,
          deletable: false,
        },
      ])
      ;(prismaService.client.property_single_value.findMany as jest.Mock).mockResolvedValue([
        {
          issue_id: mockIssueId,
          property_id: SystemPropertyId.STATUS,
          property_type: PropertyType.STATUS,
          value: 'todo',
          number_value: null,
        },
        {
          issue_id: mockIssueId,
          property_id: SystemPropertyId.TITLE,
          property_type: PropertyType.TITLE,
          value: 'Existing title',
          number_value: null,
        },
      ])

      const valueChanged = jest.fn().mockReturnValueOnce(true).mockReturnValueOnce(false)

      ;(propertyImplRegistry.getImpl as jest.Mock).mockReturnValue({
        validateFormat: jest.fn().mockReturnValue({ valid: true }),
        validateBusinessRules: jest.fn().mockResolvedValue({ valid: true }),
        valueChanged,
        generateActivity: jest.fn().mockReturnValue([]),
        transformToDbOperations: jest.fn().mockResolvedValue({
          singleValueUpdate: { value: 'in_progress', number_value: null },
        }),
      })

      await service.updateIssue(
        { workspaceId: mockWorkspaceId, userId: mockUserId },
        {
          issueId: mockIssueId,
          operations: [
            {
              propertyId: SystemPropertyId.STATUS,
              operationType: 'set',
              operationPayload: { value: 'in_progress' },
            },
            {
              propertyId: SystemPropertyId.TITLE,
              operationType: 'set',
              operationPayload: { value: 'Existing title' },
            },
          ],
        },
      )

      expect(hook.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          operations: [
            expect.objectContaining({
              propertyId: SystemPropertyId.STATUS,
            }),
          ],
        }),
      )
    })

    it('should return hook errors and skip writes when a pre-update hook rejects the issue', async () => {
      const hook = {
        execute: jest.fn().mockResolvedValue({ valid: false, errors: ['hook rejected update'] }),
      } as unknown as PreUpdateIssueHook
      preUpdateIssueHooks.push(hook)
      ;(prismaService.client.property_single_value.findMany as jest.Mock).mockResolvedValue([
        {
          issue_id: mockIssueId,
          property_id: SystemPropertyId.STATUS,
          property_type: PropertyType.STATUS,
          value: 'todo',
          number_value: null,
        },
      ])

      const result = await service.updateIssue(
        { workspaceId: mockWorkspaceId, userId: mockUserId },
        {
          issueId: mockIssueId,
          operations: [
            {
              propertyId: SystemPropertyId.STATUS,
              operationType: 'set',
              operationPayload: { value: 'in_progress' },
            },
          ],
        },
      )

      expect(result).toEqual({
        success: false,
        errors: ['hook rejected update'],
      })
      expect(prismaService.client.$transaction).not.toHaveBeenCalled()
    })
  })

  describe('resolveStatusActions', () => {
    beforeEach(() => {
      propertyService.getPropertyDefinition.mockResolvedValue({
        id: SystemPropertyId.STATUS,
        name: 'Status',
        type: PropertyType.STATUS,
        readonly: false,
        deletable: false,
        config: mockStatusConfig,
      } as any)
    })

    it('should resolve actions from a provided current status id', async () => {
      const result = await service.resolveStatusActions('workspace-123', { currentStatusId: 'in_review' })

      expect(result.currentStatusId).toBe('in_review')
      expect(result.actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            toStatusId: 'completed',
            actionLabel: 'Approve',
            label: 'Completed',
            icon: 'BadgeCheck',
          }),
        ]),
      )
    })

    it('should resolve actions from an existing issue status', async () => {
      ;(prismaService.client.issue.findFirst as jest.Mock).mockResolvedValue({ id: 123 })
      ;(prismaService.client.property_single_value.findFirst as jest.Mock).mockResolvedValue({ value: 'todo' })

      const result = await service.resolveStatusActions('workspace-123', { issueId: 123 })

      expect(result).toEqual({
        currentStatusId: 'todo',
        actions: expect.arrayContaining([
          expect.objectContaining({
            toStatusId: 'in_progress',
            actionLabel: 'Start work',
            label: 'In progress',
            icon: 'Hammer',
          }),
        ]),
      })
    })

    it('should reject unknown current status ids', async () => {
      await expect(service.resolveStatusActions('workspace-123', { currentStatusId: 'unknown' })).rejects.toThrow(
        new BadRequestException('Unknown status: unknown'),
      )
    })
  })
})
