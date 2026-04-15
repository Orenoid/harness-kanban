import { CommonPropertyOperationType, PropertyType } from '@repo/shared/property/constants'
import { PropertyDefinition } from '@repo/shared/property/types'
import { TitleUpdatePropertyProcessor } from '../title-update-processor'

describe('TitleUpdatePropertyProcessor', () => {
  let processor: TitleUpdatePropertyProcessor

  beforeEach(() => {
    processor = new TitleUpdatePropertyProcessor()
  })

  const mockProperty: PropertyDefinition = {
    id: 'title-prop',
    name: 'Title',
    type: PropertyType.TITLE,
    readonly: false,
    deletable: true,
  }

  const mockContext = {
    userId: 'user-1',
    workspaceId: 'ws-1',
  }

  describe('validateFormat', () => {
    it('should return valid for SET operation with string value', () => {
      const result = processor.validateFormat(mockProperty, CommonPropertyOperationType.SET.toString(), {
        value: 'New Title',
      })

      expect(result.valid).toBe(true)
    })

    it('should return invalid for unsupported operation type', () => {
      const result = processor.validateFormat(mockProperty, CommonPropertyOperationType.CLEAR.toString(), {})

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Title property does not support operation type: clear')
    })

    it('should return invalid when value field is missing', () => {
      const result = processor.validateFormat(mockProperty, CommonPropertyOperationType.SET.toString(), {})

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('SET operation requires a string value')
    })

    it('should return invalid when value is not a string', () => {
      const result = processor.validateFormat(mockProperty, CommonPropertyOperationType.SET.toString(), {
        value: 123,
      })

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('SET operation requires a string value')
    })

    it('should return invalid when value is null', () => {
      const result = processor.validateFormat(mockProperty, CommonPropertyOperationType.SET.toString(), {
        value: null,
      })

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('SET operation requires a string value')
    })

    it('should return invalid for string exceeding max length (200)', () => {
      const result = processor.validateFormat(mockProperty, CommonPropertyOperationType.SET.toString(), {
        value: 'A'.repeat(201),
      })

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Property Title cannot be longer than 200 characters')
    })

    it('should return valid for string at exactly max length (200)', () => {
      const result = processor.validateFormat(mockProperty, CommonPropertyOperationType.SET.toString(), {
        value: 'A'.repeat(200),
      })

      expect(result.valid).toBe(true)
    })
  })

  describe('validateBusinessRules', () => {
    it('should always return valid', async () => {
      const result = await processor.validateBusinessRules(
        mockContext,
        mockProperty,
        CommonPropertyOperationType.SET.toString(),
        { value: 'any value' },
      )

      expect(result.valid).toBe(true)
    })
  })

  describe('transformToDbOperations', () => {
    it('should transform SET operation to singleValueUpdate', async () => {
      const result = await processor.transformToDbOperations(
        mockContext,
        mockProperty,
        CommonPropertyOperationType.SET.toString(),
        { value: 'New Title' },
        123,
      )

      expect(result.singleValueUpdate).toEqual({
        value: 'New Title',
        number_value: null,
      })
    })

    it('should handle empty string value', async () => {
      const result = await processor.transformToDbOperations(
        mockContext,
        mockProperty,
        CommonPropertyOperationType.SET.toString(),
        { value: '' },
        456,
      )

      expect(result.singleValueUpdate).toEqual({
        value: '',
        number_value: null,
      })
    })
  })
})
