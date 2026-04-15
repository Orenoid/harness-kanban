import { BaseContext } from '@/issue/types/issue.types'
import { Injectable } from '@nestjs/common'
import { CommonPropertyOperationType } from '@repo/shared/property/constants'
import { PropertyDefinition } from '@repo/shared/property/types'
import { DbUpdateOperationResult, ValidationResult } from '../types/property.types'
import { BaseUpdatePropertyProcessor } from './base'

const MAX_LENGTH = 200

@Injectable()
export class TitleUpdatePropertyProcessor extends BaseUpdatePropertyProcessor {
  validateFormat(
    property: PropertyDefinition,
    operationType: string,
    payload: Record<string, unknown>,
  ): ValidationResult {
    if (operationType !== CommonPropertyOperationType.SET.toString()) {
      return {
        valid: false,
        errors: [`Title property does not support operation type: ${operationType}`],
      }
    }
    if (!('value' in payload) || typeof payload.value !== 'string') {
      return {
        valid: false,
        errors: ['SET operation requires a string value'],
      }
    }
    if (payload.value.length > MAX_LENGTH) {
      return {
        valid: false,
        errors: [`Property ${property.name} cannot be longer than ${MAX_LENGTH} characters`],
      }
    }
    return { valid: true }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async validateBusinessRules(
    _context: BaseContext,
    _property: PropertyDefinition,
    _operationType: string,
    _payload: Record<string, unknown>,
    _issueId?: number,
  ): Promise<ValidationResult> {
    return { valid: true }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async transformToDbOperations(
    _context: BaseContext,
    _property: PropertyDefinition,
    _operationType: string,
    payload: Record<string, unknown>,
    _issueId: number,
  ): Promise<DbUpdateOperationResult> {
    const result: DbUpdateOperationResult = {
      singleValueUpdate: {
        value: payload.value as string,
        number_value: null,
      },
    }
    return result
  }
}
