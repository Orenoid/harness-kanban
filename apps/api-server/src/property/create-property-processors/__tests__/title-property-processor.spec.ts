import { PropertyType } from '@repo/shared/property/constants'
import { PropertyDefinition } from '@repo/shared/property/types'
import { TitlePropertyProcessor } from '../title-property-processor'

describe('TitlePropertyProcessor', () => {
  let processor: TitlePropertyProcessor

  beforeEach(() => {
    processor = new TitlePropertyProcessor()
  })

  const mockProperty: PropertyDefinition = {
    id: 'title-prop',
    name: 'Title',
    type: PropertyType.TITLE,
    readonly: false,
    deletable: true,
  }

  describe('validateFormat', () => {
    it('should return valid for valid string value', () => {
      const result = processor.validateFormat(mockProperty, 'Valid Title')

      expect(result.valid).toBe(true)
    })

    it('should return invalid for null value', () => {
      const result = processor.validateFormat(mockProperty, null)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Property Title cannot be empty')
    })

    it('should return invalid for undefined value', () => {
      const result = processor.validateFormat(mockProperty, undefined)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Property Title cannot be empty')
    })

    it('should return invalid for empty string', () => {
      const result = processor.validateFormat(mockProperty, '')

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Property Title cannot be empty')
    })

    it('should return invalid for string exceeding max length (200)', () => {
      const longTitle = 'A'.repeat(201)
      const result = processor.validateFormat(mockProperty, longTitle)

      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Property Title cannot be longer than 200 characters')
    })

    it('should return valid for string at exactly max length (200)', () => {
      const exactTitle = 'A'.repeat(200)
      const result = processor.validateFormat(mockProperty, exactTitle)

      expect(result.valid).toBe(true)
    })

    it('should return valid for number coercible to string within length', () => {
      const result = processor.validateFormat(mockProperty, 12345)

      expect(result.valid).toBe(true)
    })
  })

  describe('validateBusinessRules', () => {
    it('should always return valid', async () => {
      const context = { userId: 'user-1', workspaceId: 'ws-1' }

      const result = await processor.validateBusinessRules(context, mockProperty, 'any value')

      expect(result.valid).toBe(true)
    })
  })

  describe('transformToDbFormat', () => {
    it('should transform string value to single value format', async () => {
      const context = { userId: 'user-1', workspaceId: 'ws-1' }

      const result = await processor.transformToDbFormat(context, mockProperty, 'My Title', 123)

      expect(result.singleValues).toHaveLength(1)
      expect(result.singleValues![0]).toEqual({
        issue_id: 123,
        property_id: 'title-prop',
        property_type: PropertyType.TITLE,
        value: 'My Title',
        number_value: null,
      })
    })

    it('should convert non-string value to string', async () => {
      const context = { userId: 'user-1', workspaceId: 'ws-1' }

      const result = await processor.transformToDbFormat(context, mockProperty, 12345, 456)

      expect(result.singleValues![0].value).toBe('12345')
    })
  })
})
