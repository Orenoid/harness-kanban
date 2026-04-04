import { http } from 'msw/core/http'

import type {
  CodingAgentManagementDetail,
  CreateCodingAgentManagementInput,
  UpdateCodingAgentManagementInput,
} from '@repo/shared'

const now = new Date('2026-04-04T10:00:00Z').toISOString()
type CodingAgentHandler = ReturnType<typeof http.get>

export const createMockCodingAgents = (): CodingAgentManagementDetail[] => [
  {
    id: 'codex-primary',
    name: 'Primary Codex',
    type: 'codex',
    settings: {
      model: 'gpt-5.3-codex',
      reasoningEffort: 'medium',
      hasCredential: true,
    },
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'claude-legacy',
    name: 'Legacy Claude Runner',
    type: 'claude-code',
    settings: {
      model: 'claude-sonnet-4',
      hasCredential: true,
    },
    isDefault: false,
    createdAt: now,
    updatedAt: now,
  },
]

export const createCodingAgentHandlers = ({
  initialCodingAgents = createMockCodingAgents(),
}: {
  initialCodingAgents?: CodingAgentManagementDetail[]
} = {}): CodingAgentHandler[] => {
  let codingAgents = [...initialCodingAgents]

  return [
    http.get('*/api/v1/coding-agents', () =>
      Response.json({
        success: true,
        data: {
          codingAgents,
        },
        error: null,
      }),
    ),
    http.post('*/api/v1/coding-agents', async ({ request }) => {
      const body = (await request.json()) as { codingAgent: CreateCodingAgentManagementInput<'codex'> }
      const input = body.codingAgent
      const createdAgent: CodingAgentManagementDetail<'codex'> = {
        id: `codex-${codingAgents.length + 1}`,
        name: input.name,
        type: 'codex',
        settings: {
          model: input.settings.model,
          reasoningEffort: input.settings.reasoningEffort,
          hasCredential: true,
        },
        isDefault: Boolean(input.isDefault),
        createdAt: now,
        updatedAt: now,
      }

      codingAgents = codingAgents.map(codingAgent =>
        codingAgent.type === createdAgent.type && createdAgent.isDefault
          ? {
              ...codingAgent,
              isDefault: false,
            }
          : codingAgent,
      )

      codingAgents = [...codingAgents, createdAgent]

      return Response.json({
        success: true,
        data: {
          codingAgent: createdAgent,
        },
        error: null,
      })
    }),
    http.put('*/api/v1/coding-agents/:id', async ({ params, request }) => {
      const body = (await request.json()) as { codingAgent: UpdateCodingAgentManagementInput<'codex'> }
      const codingAgentId = String(params.id)
      const existingCodingAgent = codingAgents.find(codingAgent => codingAgent.id === codingAgentId)

      if (!existingCodingAgent || existingCodingAgent.type !== 'codex') {
        return Response.json(
          {
            success: false,
            data: null,
            error: {
              code: 'NOT_FOUND',
              message: 'Coding agent does not exist.',
            },
          },
          { status: 404 },
        )
      }

      const currentCodexAgent = existingCodingAgent as CodingAgentManagementDetail<'codex'>
      const updatedAgent: CodingAgentManagementDetail<'codex'> = {
        ...currentCodexAgent,
        name: body.codingAgent.name ?? currentCodexAgent.name,
        settings: {
          ...currentCodexAgent.settings,
          model: body.codingAgent.settings?.model ?? currentCodexAgent.settings.model,
          reasoningEffort: body.codingAgent.settings?.reasoningEffort ?? currentCodexAgent.settings.reasoningEffort,
          hasCredential: currentCodexAgent.settings.hasCredential || Boolean(body.codingAgent.settings?.apiKey?.trim()),
        },
        isDefault: body.codingAgent.isDefault ?? currentCodexAgent.isDefault,
        updatedAt: now,
      }

      codingAgents = codingAgents.map(codingAgent => {
        if (codingAgent.id === updatedAgent.id) {
          return updatedAgent
        }

        if (codingAgent.type === updatedAgent.type && updatedAgent.isDefault) {
          return {
            ...codingAgent,
            isDefault: false,
          }
        }

        return codingAgent
      })

      return Response.json({
        success: true,
        data: {
          codingAgent: updatedAgent,
        },
        error: null,
      })
    }),
    http.delete('*/api/v1/coding-agents/:id', ({ params }) => {
      const codingAgentId = String(params.id)
      codingAgents = codingAgents.filter(codingAgent => codingAgent.id !== codingAgentId)

      return Response.json({
        success: true,
        data: null,
        error: null,
      })
    }),
  ]
}
