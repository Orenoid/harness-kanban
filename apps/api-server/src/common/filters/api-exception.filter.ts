import { Request, Response } from 'express'

import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common'
import { ErrorCode } from '../responses/error-codes'
import type { ApiError } from '../responses/api-error'
import type { ApiResponse } from '../responses/api-response'

interface ExceptionContext {
  status: HttpStatus
  error: ApiError
  shouldLogStackTrace: boolean
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest<Request>()

    const context = this.buildExceptionContext(exception)

    this.logException(request, context, exception)
    this.sendErrorResponse(response, context)
  }

  private buildExceptionContext(exception: unknown): ExceptionContext {
    if (exception instanceof HttpException) {
      return this.handleHttpException(exception)
    }

    if (exception instanceof Error) {
      return this.handleGenericError()
    }

    return this.handleUnknownException()
  }

  private handleHttpException(exception: HttpException): ExceptionContext {
    const status = exception.getStatus()

    // special handle for 404
    if (status === HttpStatus.NOT_FOUND) {
      return {
        status: HttpStatus.NOT_FOUND,
        error: {
          code: ErrorCode.NOT_FOUND,
          message: 'Resource not found',
        },
        shouldLogStackTrace: false,
      }
    }

    const response = exception.getResponse()
    const error = this.parseHttpExceptionResponse(response, exception.message)

    return {
      status,
      error,
      shouldLogStackTrace: status >= HttpStatus.INTERNAL_SERVER_ERROR,
    }
  }

  private parseHttpExceptionResponse(response: unknown, fallbackMessage: string): ApiError {
    if (this.isApiError(response)) {
      return response
    }

    if (this.isValidationError(response)) {
      return {
        code: ErrorCode.VALIDATION_ERROR,
        message: Array.isArray(response.message) ? response.message.join(', ') : response.message,
      }
    }

    return {
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      message: fallbackMessage,
    }
  }

  private handleGenericError(): ExceptionContext {
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      error: {
        code: ErrorCode.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
      },
      shouldLogStackTrace: true,
    }
  }

  private handleUnknownException(): ExceptionContext {
    this.logger.error('Unknown exception caught - this should be investigated', {
      type: 'UNKNOWN_EXCEPTION',
      message: 'An unknown exception type was caught in the exception filter',
    })
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      error: {
        code: ErrorCode.UNKNOWN_ERROR,
        message: 'Internal server error',
      },
      shouldLogStackTrace: true,
    }
  }

  private isApiError(obj: unknown): obj is ApiError {
    return (
      typeof obj === 'object' &&
      obj !== null &&
      'code' in obj &&
      'message' in obj &&
      typeof (obj as any).code === 'string' &&
      typeof (obj as any).message === 'string'
    )
  }

  private isValidationError(obj: unknown): obj is { message: string | string[]; error: string } {
    return typeof obj === 'object' && obj !== null && 'message' in obj && 'error' in obj
  }

  private logException(request: Request, context: ExceptionContext, exception: unknown): void {
    const { status, error, shouldLogStackTrace } = context

    const logMessage = `Server Request failed: ${request.method} ${request.url} - Status: ${status} - Error: ${JSON.stringify(error)}`

    if (shouldLogStackTrace || status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(logMessage, exception instanceof Error ? exception.stack : JSON.stringify(exception))
    } else {
      this.logger.warn(logMessage)
    }
  }

  private sendErrorResponse(response: Response, context: ExceptionContext): void {
    const body: ApiResponse<null> = {
      success: false,
      data: null,
      error: context.error,
    }

    response.status(context.status).json(body)
  }
}
