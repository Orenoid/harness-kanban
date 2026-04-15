import { BaseContext } from '@/issue/types/issue.types'
import { Injectable } from '@nestjs/common'
import { PropertyType } from '@repo/shared/property/constants'
import { PropertyDefinition } from '@repo/shared/property/types'
import { DbInsertData, ValidationResult } from '../types/property.types'
import { BasePropertyProcessor } from './base'

const MAX_LENGTH = 200

@Injectable()
export class TitlePropertyProcessor extends BasePropertyProcessor {
  validateFormat(property: PropertyDefinition, value: unknown): ValidationResult {
    if (value === null || value === undefined) {
      return {
        valid: false,
        errors: [`Property ${property.name} cannot be empty`],
      }
    }

    try {
      const stringValue = String(value)

      if (stringValue.length === 0) {
        return {
          valid: false,
          errors: [`Property ${property.name} cannot be empty`],
        }
      }
      if (stringValue.length > MAX_LENGTH) {
        return {
          valid: false,
          errors: [`Property ${property.name} cannot be longer than ${MAX_LENGTH} characters`],
        }
      }

      return { valid: true }
    } catch {
      return {
        valid: false,
        errors: [`Property ${property.name} must be a string`],
      }
    }
  }

  async validateBusinessRules(
    _baseContext: BaseContext,
    _property: PropertyDefinition,
    _value: unknown,
  ): Promise<ValidationResult> {
    // no business rules for title
    return { valid: true }
  }

  async transformToDbFormat(
    _context: BaseContext,
    property: PropertyDefinition,
    value: unknown,
    issueId: number,
  ): Promise<DbInsertData> {
    const stringValue = String(value)
    return {
      singleValues: [this.createSingleValue(issueId, property.id, PropertyType.TITLE, stringValue, null)],
    }
  }
}
