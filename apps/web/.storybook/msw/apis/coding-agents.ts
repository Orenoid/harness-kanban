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
      model: 'sonnet',
      baseUrl: 'https://api.example.com/',
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
      const body = (await request.json()) as { codingAgent: CreateCodingAgentManagementInput }
      const input = body.codingAgent
      const createdAgent: CodingAgentManagementDetail =
        input.type === 'codex'
          ? {
              id: `codex-${codingAgents.length + 1}`,
              name: input.name,
              type: 'codex',
              settings: {
                model: (input.settings as CreateCodingAgentManagementInput<'codex'>['settings']).model,
                reasoningEffort: (input.settings as CreateCodingAgentManagementInput<'codex'>['settings'])
                  .reasoningEffort,
                hasCredential: true,
              },
              isDefault: Boolean(input.isDefault),
              createdAt: now,
              updatedAt: now,
            }
          : {
              id: `claude-${codingAgents.length + 1}`,
              name: input.name,
              type: 'claude-code',
              settings: {
                model: (input.settings as CreateCodingAgentManagementInput<'claude-code'>['settings']).model,
                baseUrl: (input.settings as CreateCodingAgentManagementInput<'claude-code'>['settings']).baseUrl,
                hasCredential: true,
              },
              isDefault: Boolean(input.isDefault),
              createdAt: now,
              updatedAt: now,
            }

      codingAgents = codingAgents.map(codingAgent =>
        createdAgent.isDefault
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
      const body = (await request.json()) as { codingAgent: UpdateCodingAgentManagementInput }
      const codingAgentId = String(params.id)
      const existingCodingAgent = codingAgents.find(codingAgent => codingAgent.id === codingAgentId)

      if (!existingCodingAgent) {
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

      const updatedAgent: CodingAgentManagementDetail =
        existingCodingAgent.type === 'codex'
          ? {
              ...(existingCodingAgent as CodingAgentManagementDetail<'codex'>),
              name: body.codingAgent.name ?? existingCodingAgent.name,
              settings: {
                ...(existingCodingAgent as CodingAgentManagementDetail<'codex'>).settings,
                model:
                  (body.codingAgent.settings as UpdateCodingAgentManagementInput<'codex'>['settings'])?.model ??
                  (existingCodingAgent as CodingAgentManagementDetail<'codex'>).settings.model,
                reasoningEffort:
                  (body.codingAgent.settings as UpdateCodingAgentManagementInput<'codex'>['settings'])
                    ?.reasoningEffort ??
                  (existingCodingAgent as CodingAgentManagementDetail<'codex'>).settings.reasoningEffort,
                hasCredential:
                  (existingCodingAgent as CodingAgentManagementDetail<'codex'>).settings.hasCredential ||
                  Boolean(
                    (
                      body.codingAgent.settings as UpdateCodingAgentManagementInput<'codex'>['settings']
                    )?.apiKey?.trim(),
                  ),
              },
              isDefault: body.codingAgent.isDefault ?? existingCodingAgent.isDefault,
              updatedAt: now,
            }
          : {
              ...(existingCodingAgent as CodingAgentManagementDetail<'claude-code'>),
              name: body.codingAgent.name ?? existingCodingAgent.name,
              settings: {
                ...(existingCodingAgent as CodingAgentManagementDetail<'claude-code'>).settings,
                model:
                  (body.codingAgent.settings as UpdateCodingAgentManagementInput<'claude-code'>['settings'])?.model ??
                  (existingCodingAgent as CodingAgentManagementDetail<'claude-code'>).settings.model,
                baseUrl:
                  (body.codingAgent.settings as UpdateCodingAgentManagementInput<'claude-code'>['settings'])?.baseUrl ??
                  (existingCodingAgent as CodingAgentManagementDetail<'claude-code'>).settings.baseUrl,
                hasCredential:
                  (existingCodingAgent as CodingAgentManagementDetail<'claude-code'>).settings.hasCredential ||
                  Boolean(
                    (
                      body.codingAgent.settings as UpdateCodingAgentManagementInput<'claude-code'>['settings']
                    )?.apiKey?.trim(),
                  ),
              },
              isDefault: body.codingAgent.isDefault ?? existingCodingAgent.isDefault,
              updatedAt: now,
            }

      codingAgents = codingAgents.map(codingAgent => {
        if (codingAgent.id === updatedAgent.id) {
          return updatedAgent
        }

        if (updatedAgent.isDefault) {
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
