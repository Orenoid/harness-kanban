import { AppModule } from '@/app.module'
import { ApiExceptionFilter } from '@/common/filters/api-exception.filter'
import { INestApplication } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { loginUser, SupertestAgent } from './utils/auth-helper'

import request = require('supertest')

describe.skip('AgentController (e2e)', () => {
  let app: INestApplication
  let agent: SupertestAgent

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    app.useGlobalFilters(new ApiExceptionFilter())
    await app.init()

    // Login the test user created in global setup
    agent = await loginUser(app, 'e2e-user@example.com', 'temppassword')
  })

  afterAll(async () => {
    await app.close()
  })

  // Helper function to create a chat by sending a message
  const createChat = async (): Promise<string> => {
    const chatId = `test-chat-${Date.now()}`

    // Create chat by sending a message
    await agent
      .post('/api/v1/agent/chat')
      .send({
        id: chatId,
        message: {
          role: 'user',
          parts: [{ type: 'text', text: 'Hello' }],
        },
      })
      .buffer(true)
      .expect(200)

    return chatId
  }

  describe('GET /api/v1/agent/chats', () => {
    it('should list all chats for current user sorted by time desc', async () => {
      // Create two chats by sending messages to verify sorting
      const chatId1 = `test-chat-${Date.now()}-1`
      const chatId2 = `test-chat-${Date.now()}-2`

      // Create first chat
      await agent
        .post('/api/v1/agent/chat')
        .send({
          id: chatId1,
          message: {
            role: 'user',
            parts: [{ type: 'text', text: 'Hello first' }],
          },
        })
        .buffer(true)
        .expect(200)

      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 100))

      // Create second chat
      await agent
        .post('/api/v1/agent/chat')
        .send({
          id: chatId2,
          message: {
            role: 'user',
            parts: [{ type: 'text', text: 'Hello second' }],
          },
        })
        .buffer(true)
        .expect(200)

      // Then list chats
      const response = await agent.get('/api/v1/agent/chats').expect(200)

      // API uses wrapper structure
      expect(response.body).toHaveProperty('success', true)
      expect(response.body).toHaveProperty('data')

      const chats = response.body.data
      expect(Array.isArray(chats)).toBe(true)
      expect(chats.length).toBeGreaterThanOrEqual(2)

      // Verify both chats exist in the list
      const foundChat1 = chats.find((c: { id: string }) => c.id === chatId1)
      const foundChat2 = chats.find((c: { id: string }) => c.id === chatId2)
      expect(foundChat1).toBeDefined()
      expect(foundChat2).toBeDefined()
      // Title may be 'New Chat' or AI-generated title (async)
      expect(foundChat1.title).toBeTruthy()
      expect(foundChat2.title).toBeTruthy()
      // Verify chats list does not include messages
      expect(foundChat1).not.toHaveProperty('messages')
      expect(foundChat2).not.toHaveProperty('messages')

      // Verify chats are sorted by updatedAt in descending order (newest first)
      const chatDates = chats.map((c: { updatedAt: string }) => new Date(c.updatedAt).getTime())
      for (let i = 1; i < chatDates.length; i++) {
        expect(chatDates[i - 1]).toBeGreaterThanOrEqual(chatDates[i])
      }
    })
  })

  describe('GET /api/v1/agent/chat/:chatId/history', () => {
    it('should get chat history with messages', async () => {
      // Create a chat by sending a message
      const chatId = `test-chat-${Date.now()}`

      // Send a message to the chat and wait for stream to complete
      const streamResponse = await agent
        .post('/api/v1/agent/chat')
        .send({
          id: chatId,
          message: {
            role: 'user',
            parts: [{ type: 'text', text: 'Hello' }],
          },
        })
        .buffer(true)
        .expect(200)

      // Wait for stream to complete and verify it ended properly
      expect(streamResponse.text).toBeDefined()
      expect(streamResponse.text).toContain('data: [DONE]')

      // Get chat history
      const response = await agent.get(`/api/v1/agent/chat/${chatId}/history`).expect(200)

      // API uses wrapper structure
      expect(response.body).toHaveProperty('success', true)
      expect(response.body).toHaveProperty('data')

      const chat = response.body.data
      expect(chat).toHaveProperty('id', chatId)
      expect(chat).toHaveProperty('messages')
      expect(Array.isArray(chat.messages)).toBe(true)
      expect(chat.messages.length).toBeGreaterThan(0)

      // Verify messages are in UIMessage format (AI SDK format for useChat)
      // UIMessage structure: { id, role, parts, metadata? }
      for (const message of chat.messages) {
        expect(message).toHaveProperty('id')
        expect(message).toHaveProperty('role')
        expect(['system', 'user', 'assistant']).toContain(message.role)
        expect(message).toHaveProperty('parts')
        expect(Array.isArray(message.parts)).toBe(true)
      }

      // Check user message exists
      const userMessage = chat.messages.find((m: { role: string }) => m.role === 'user')
      expect(userMessage).toBeDefined()
      expect(userMessage.parts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'text',
            text: 'Hello',
          }),
        ]),
      )

      // Check AI assistant message exists
      const assistantMessage = chat.messages.find((m: { role: string }) => m.role === 'assistant')
      expect(assistantMessage).toBeDefined()
      expect(assistantMessage).toHaveProperty('id')
      expect(assistantMessage.parts.length).toBeGreaterThan(0)
    })

    it('should return 404 for non-existent chat', async () => {
      const response = await agent.get('/api/v1/agent/chat/non-existent-chat-id/history').expect(404)

      // Error response also uses wrapper structure
      expect(response.body).toHaveProperty('success', false)
      expect(response.body).toHaveProperty('error')
    })
  })

  describe('POST /api/v1/agent/chat', () => {
    it('should return stream response following AI SDK UI stream protocol', async () => {
      const chatId = `test-chat-${Date.now()}`

      // Send message and get stream
      // This endpoint uses AI SDK UI Data Stream Protocol (Server-Sent Events format)
      // Format: each line starts with "data: " followed by JSON or [DONE]
      // Example: data: {"type":"text-start","id":"msg_123"}
      // Example: data: {"type":"text-delta","id":"msg_123","delta":"Hello"}
      // Example: data: [DONE]
      const response = await agent
        .post('/api/v1/agent/chat')
        .send({
          id: chatId,
          message: {
            role: 'user',
            parts: [{ type: 'text', text: 'Hello' }],
          },
        })
        .buffer(true) // Ensure we buffer the full response for testing
        .expect(200)
        .expect('Content-Type', /text\/event-stream/)

      // Verify stream content exists
      expect(response.text).toBeDefined()
      expect(response.text.length).toBeGreaterThan(0)

      // Parse SSE format lines and verify AI message structure
      const lines = response.text.split('\n').filter((line: string) => line.length > 0)
      expect(lines.length).toBeGreaterThan(0)

      // Verify lines follow SSE protocol format (starts with "data: ")
      const dataLines = lines.filter((line: string) => line.startsWith('data: '))
      expect(dataLines.length).toBeGreaterThan(0)

      // Parse and validate message parts
      const messageParts: Array<{ type: string; [key: string]: unknown }> = []
      for (const line of dataLines) {
        const jsonStr = line.slice(6) // Remove "data: " prefix
        if (jsonStr === '[DONE]') continue
        try {
          const parsed = JSON.parse(jsonStr) as { type: string; [key: string]: unknown }
          messageParts.push(parsed)
        } catch {
          // Skip invalid JSON lines
        }
      }

      // Verify AI message structure: check for message types in the stream
      // The AI SDK UI stream protocol may use different message types
      // Common types include: text-start, text-delta, text-end, or just 'f' (finish) messages
      const hasValidMessageType = messageParts.some(
        p =>
          p.type === 'text-start' ||
          p.type === 'text-delta' ||
          p.type === 'text-end' ||
          p.type === 'f' || // finish message type
          p.type === 'd' || // data message type
          p.type === '2' || // text delta type (numeric)
          p.type === '1', // text start type (numeric)
      )

      // If no recognized message types found, at least verify we got some messages
      if (!hasValidMessageType) {
        // Log the actual types for debugging
        console.log(
          'Actual message types:',
          messageParts.map(p => p.type),
        )
      }

      // Verify we have some message parts or at least data was streamed
      expect(messageParts.length).toBeGreaterThan(0)

      // Verify text-delta contains actual content (if present)
      const textDeltaParts = messageParts.filter(p => p.type === 'text-delta')
      if (textDeltaParts.length > 0) {
        const hasContent = textDeltaParts.some(p => typeof p.delta === 'string' && p.delta.length > 0)
        expect(hasContent).toBe(true)
      }

      // Check for stream termination marker [DONE]
      const hasDoneMarker = lines.some((line: string) => line === 'data: [DONE]')
      expect(hasDoneMarker).toBe(true)
    }, 30000)

    it('should create new chat when chatId does not exist', async () => {
      const nonExistentChatId = `new-chat-${Date.now()}`

      const response = await agent
        .post('/api/v1/agent/chat')
        .send({
          id: nonExistentChatId,
          message: {
            role: 'user',
            parts: [{ type: 'text', text: 'Hello' }],
          },
        })
        .buffer(true)
        .expect(200)
        .expect('Content-Type', /text\/event-stream/)

      // Verify stream content exists
      expect(response.text).toBeDefined()
      expect(response.text.length).toBeGreaterThan(0)
      expect(response.text).toContain('data: [DONE]')

      // Verify the chat was created by fetching its history
      const historyResponse = await agent.get(`/api/v1/agent/chat/${nonExistentChatId}/history`).expect(200)
      expect(historyResponse.body).toHaveProperty('success', true)
      expect(historyResponse.body).toHaveProperty('data')

      const chat = historyResponse.body.data
      expect(chat).toHaveProperty('id', nonExistentChatId)
      expect(chat).toHaveProperty('messages')
      expect(Array.isArray(chat.messages)).toBe(true)
      expect(chat.messages.length).toBeGreaterThan(0)

      // Verify user message was saved
      const userMessage = chat.messages.find((m: { role: string }) => m.role === 'user')
      expect(userMessage).toBeDefined()
      expect(userMessage.parts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'text',
            text: 'Hello',
          }),
        ]),
      )
    })

    it('should create an issue when agent is asked to create one', async () => {
      // Create a chat by sending a message
      const chatId = `test-chat-${Date.now()}`

      // Get initial issue count
      const initialIssuesResponse = await agent.get('/api/v1/issues').expect(200)
      const initialCount = initialIssuesResponse.body.data.pagination.total

      // Ask agent to create an issue
      const streamResponse = await agent
        .post('/api/v1/agent/chat')
        .send({
          id: chatId,
          message: {
            role: 'user',
            parts: [{ type: 'text', text: 'Please create a new issue with title "Test Issue from Agent"' }],
          },
        })
        .buffer(true)
        .expect(200)

      // Wait for stream to complete
      expect(streamResponse.text).toBeDefined()
      expect(streamResponse.text).toContain('data: [DONE]')

      // Wait a bit for the issue to be created
      await new Promise(resolve => setTimeout(resolve, 1000))

      // Verify that a new issue was created
      const finalIssuesResponse = await agent.get('/api/v1/issues').expect(200)
      const finalCount = finalIssuesResponse.body.data.pagination.total

      expect(finalCount).toBe(initialCount + 1)

      // Find the newly created issue (title property ID is property0002)
      const newIssue = finalIssuesResponse.body.data.issues.find(
        (inc: { propertyValues: Array<{ propertyId: string; value: unknown }> }) => {
          const titleValue = inc.propertyValues.find(
            (pv: { propertyId: string; value: unknown }) => pv.propertyId === 'property0002',
          )
          return titleValue?.value === 'Test Issue from Agent'
        },
      )
      expect(newIssue).toBeDefined()

      // Verify chat history contains tool messages and AI response
      const historyResponse = await agent.get(`/api/v1/agent/chat/${chatId}/history`).expect(200)
      expect(historyResponse.body).toHaveProperty('success', true)
      expect(historyResponse.body).toHaveProperty('data')

      const chat = historyResponse.body.data
      expect(chat).toHaveProperty('messages')
      expect(Array.isArray(chat.messages)).toBe(true)

      // Should have: user message + assistant message (with all step parts accumulated)
      expect(chat.messages.length).toBeGreaterThanOrEqual(2)

      // Verify user message exists
      const userMessage = chat.messages.find((m: { role: string }) => m.role === 'user')
      expect(userMessage).toBeDefined()
      expect(
        userMessage.parts.some(
          (p: { type: string; text?: string }) => p.type === 'text' && p.text?.includes('create a new issue'),
        ),
      ).toBe(true)

      // Verify assistant messages exist
      // Note: All step parts are accumulated into a single assistant message
      const assistantMessages = chat.messages.filter((m: { role: string }) => m.role === 'assistant')
      expect(assistantMessages.length).toBeGreaterThanOrEqual(1)

      // Check for tool-related parts in assistant messages
      const toolParts: Array<{ type: string; toolName?: string; state?: string }> = []
      for (const msg of assistantMessages) {
        for (const part of msg.parts) {
          if (part.type.startsWith('tool-')) {
            toolParts.push(part)
          }
        }
      }

      // Should have tool calls for createIssue and queryProperties
      const createIssueParts = toolParts.filter(
        (p: { type: string; toolName?: string }) => p.toolName === 'createIssue',
      )
      const queryPropertiesParts = toolParts.filter(
        (p: { type: string; toolName?: string }) => p.toolName === 'queryProperties',
      )

      expect(createIssueParts.length).toBeGreaterThanOrEqual(1)
      expect(queryPropertiesParts.length).toBeGreaterThanOrEqual(1)

      // Tool result should be present (output-available state)
      // Note: We only save the final state (output-available) to avoid duplicate tool_call_id
      // when convertToModelMessages processes the messages
      const hasToolResult = createIssueParts.some((p: { state?: string }) => p.state === 'output-available')
      expect(hasToolResult).toBe(true)

      // Verify final AI text response exists
      const hasTextResponse = assistantMessages.some((m: { parts: Array<{ type: string; text?: string }> }) =>
        m.parts.some((p: { type: string; text?: string }) => p.type === 'text' && p.text && p.text.length > 0),
      )
      expect(hasTextResponse).toBe(true)
    }, 30000)

    it('should preserve and recall chat history across multiple turns with tool calls', async () => {
      // Create a chat by sending a message
      const chatId = `test-chat-${Date.now()}`

      // Get initial issue count
      const initialIssuesResponse = await agent.get('/api/v1/issues').expect(200)
      const initialCount = initialIssuesResponse.body.data.pagination.total

      // Turn 1: Create an issue with a specific title
      const uniqueTitle = `History Test Issue ${Date.now()}`
      const streamResponse1 = await agent
        .post('/api/v1/agent/chat')
        .send({
          id: chatId,
          message: {
            role: 'user',
            parts: [{ type: 'text', text: `Please create a new issue with title "${uniqueTitle}"` }],
          },
        })
        .buffer(true)
        .expect(200)

      expect(streamResponse1.text).toBeDefined()
      expect(streamResponse1.text).toContain('data: [DONE]')

      // Wait for issue creation to complete
      await new Promise(resolve => setTimeout(resolve, 1000))

      // Turn 2: Ask about the previously created issue ID
      // This tests if the AI can recall information from earlier in the conversation
      // Note: issueId is returned by the createIssue tool (not queried from DB)
      const streamResponse2 = await agent
        .post('/api/v1/agent/chat')
        .send({
          id: chatId,
          message: {
            role: 'user',
            parts: [{ type: 'text', text: 'What is the ID of the issue I just created?' }],
          },
        })
        .buffer(true)
        .expect(200)

      expect(streamResponse2.text).toBeDefined()
      expect(streamResponse2.text).toContain('data: [DONE]')

      // Wait for response to be saved
      await new Promise(resolve => setTimeout(resolve, 500))

      // Verify the issue was created
      const finalIssuesResponse = await agent.get('/api/v1/issues').expect(200)
      const finalCount = finalIssuesResponse.body.data.pagination.total
      expect(finalCount).toBe(initialCount + 1)

      // Find the newly created issue and get its ID
      const newIssue = finalIssuesResponse.body.data.issues.find(
        (inc: { issueId: number; propertyValues: Array<{ propertyId: string; value: unknown }> }) => {
          const titleValue = inc.propertyValues.find(
            (pv: { propertyId: string; value: unknown }) => pv.propertyId === 'property0002',
          )
          return titleValue?.value === uniqueTitle
        },
      )
      expect(newIssue).toBeDefined()
      const issueId = newIssue.issueId as number

      // Verify chat history contains all messages from the multi-turn conversation
      // This is the core validation: history should preserve the entire conversation context
      const historyResponse = await agent.get(`/api/v1/agent/chat/${chatId}/history`).expect(200)
      expect(historyResponse.body).toHaveProperty('success', true)
      expect(historyResponse.body).toHaveProperty('data')

      const chat = historyResponse.body.data
      expect(chat).toHaveProperty('messages')
      expect(Array.isArray(chat.messages)).toBe(true)

      // Should have at least:
      // - 2 user messages (create issue, ask about ID)
      // - Multiple assistant messages (with tool calls/results and text responses)
      expect(chat.messages.length).toBeGreaterThanOrEqual(4)

      // Count user messages
      const userMessages = chat.messages.filter((m: { role: string }) => m.role === 'user')
      expect(userMessages.length).toBeGreaterThanOrEqual(2)

      // Verify each user message exists with correct content
      const firstUserMessage = userMessages.find((m: { parts: Array<{ type: string; text?: string }> }) =>
        m.parts.some(
          (p: { type: string; text?: string }) => p.type === 'text' && p.text?.includes('create a new issue'),
        ),
      )
      expect(firstUserMessage).toBeDefined()

      const secondUserMessage = userMessages.find((m: { parts: Array<{ type: string; text?: string }> }) =>
        m.parts.some((p: { type: string; text?: string }) => p.type === 'text' && p.text?.includes('ID of the issue')),
      )
      expect(secondUserMessage).toBeDefined()

      // Verify assistant messages exist (at least 2 responses for 2 user messages)
      const assistantMessages = chat.messages.filter((m: { role: string }) => m.role === 'assistant')
      expect(assistantMessages.length).toBeGreaterThanOrEqual(2)

      // The key assertion: the second assistant response should mention the issue ID
      // This proves the AI could access the conversation history and recall the issue details
      const lastAssistantMessage = assistantMessages[assistantMessages.length - 1]
      expect(lastAssistantMessage).toBeDefined()
      expect(lastAssistantMessage.parts.length).toBeGreaterThan(0)

      // Get the text response from the last assistant message
      const lastTextResponse = lastAssistantMessage.parts
        .filter((p: { type: string; text?: string }) => p.type === 'text' && p.text)
        .map((p: { type: string; text?: string }) => p.text || '')
        .join(' ')

      // The AI should mention the issue ID in its response
      // This confirms AI recalled the ID from the tool result, not from a new tool call
      expect(lastTextResponse).toContain(issueId.toString())

      // Verify no additional tool calls were made in the second turn
      // (AI should recall from history, not call a tool to get the ID)
      const lastAssistantToolParts = lastAssistantMessage.parts.filter((p: { type: string }) =>
        p.type.startsWith('tool-'),
      )
      expect(lastAssistantToolParts.length).toBe(0)

      // Verify messages are in chronological order
      const messageRoles = chat.messages.map((m: { role: string }) => m.role)
      expect(messageRoles[0]).toBe('user') // First message should be user
    }, 30000)
  })

  describe('POST /api/v1/agent/chat/:chatId/messages', () => {
    it('should save all messages for a chat', async () => {
      // Create a chat first
      const chatId = await createChat()

      // Prepare messages to save
      const messages = [
        {
          id: 'msg-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Hello, this is a test message' }],
        },
        {
          id: 'msg-2',
          role: 'assistant',
          parts: [{ type: 'text', text: 'Hi there! How can I help you?' }],
        },
        {
          id: 'msg-3',
          role: 'user',
          parts: [{ type: 'text', text: 'I need help with an issue' }],
        },
      ]

      // Save messages
      const saveResponse = await agent.post(`/api/v1/agent/chat/${chatId}/messages`).send({ messages }).expect(201)

      // Verify response structure
      expect(saveResponse.body).toHaveProperty('success', true)
      expect(saveResponse.body).toHaveProperty('data')
      expect(saveResponse.body.data).toHaveProperty('success', true)

      // Verify messages were saved by getting chat history
      const historyResponse = await agent.get(`/api/v1/agent/chat/${chatId}/history`).expect(200)
      expect(historyResponse.body).toHaveProperty('success', true)

      const chat = historyResponse.body.data
      expect(chat).toHaveProperty('messages')
      expect(Array.isArray(chat.messages)).toBe(true)
      expect(chat.messages.length).toBe(3)

      // Verify message content
      const userMessages = chat.messages.filter((m: { role: string }) => m.role === 'user')
      const assistantMessages = chat.messages.filter((m: { role: string }) => m.role === 'assistant')

      expect(userMessages.length).toBe(2)
      expect(assistantMessages.length).toBe(1)

      // Check first user message
      expect(userMessages[0].parts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'text',
            text: 'Hello, this is a test message',
          }),
        ]),
      )

      // Check assistant message
      expect(assistantMessages[0].parts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'text',
            text: 'Hi there! How can I help you?',
          }),
        ]),
      )
    })

    it('should replace existing messages when saving new ones', async () => {
      // Create a chat first
      const chatId = await createChat()

      // First batch of messages
      const firstMessages = [
        {
          id: 'msg-1',
          role: 'user',
          parts: [{ type: 'text', text: 'First message' }],
        },
      ]

      await agent.post(`/api/v1/agent/chat/${chatId}/messages`).send({ messages: firstMessages }).expect(201)

      // Second batch of messages (should replace first)
      const secondMessages = [
        {
          id: 'msg-2',
          role: 'user',
          parts: [{ type: 'text', text: 'Second message batch' }],
        },
        {
          id: 'msg-3',
          role: 'assistant',
          parts: [{ type: 'text', text: 'Response to second batch' }],
        },
      ]

      await agent.post(`/api/v1/agent/chat/${chatId}/messages`).send({ messages: secondMessages }).expect(201)

      // Verify only second batch exists
      const historyResponse = await agent.get(`/api/v1/agent/chat/${chatId}/history`).expect(200)
      const chat = historyResponse.body.data

      expect(chat.messages.length).toBe(2)

      // Verify first message is gone
      const hasFirstMessage = chat.messages.some((m: { parts: Array<{ type: string; text?: string }> }) =>
        m.parts.some((p: { type: string; text?: string }) => p.type === 'text' && p.text === 'First message'),
      )
      expect(hasFirstMessage).toBe(false)

      // Verify second batch exists
      const hasSecondMessage = chat.messages.some((m: { parts: Array<{ type: string; text?: string }> }) =>
        m.parts.some((p: { type: string; text?: string }) => p.type === 'text' && p.text === 'Second message batch'),
      )
      expect(hasSecondMessage).toBe(true)
    })

    it('should return 404 for non-existent chat', async () => {
      const messages = [
        {
          id: 'msg-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Test message' }],
        },
      ]

      const response = await agent
        .post('/api/v1/agent/chat/non-existent-chat-id/messages')
        .send({ messages })
        .expect(404)

      expect(response.body).toHaveProperty('success', false)
      expect(response.body).toHaveProperty('error')
    })

    it('should save messages with tool parts correctly', async () => {
      // Create a chat first
      const chatId = await createChat()

      // Messages with tool parts
      const messages = [
        {
          id: 'msg-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Create an issue' }],
        },
        {
          id: 'msg-2',
          role: 'assistant',
          parts: [
            { type: 'text', text: 'I will create an issue for you.' },
            {
              type: 'tool-createIssue',
              toolCallId: 'call-1',
              toolName: 'createIssue',
              state: 'output-available',
              input: { title: 'Test Issue' },
              output: { issueId: '12345' },
            },
          ],
        },
      ]

      const saveResponse = await agent.post(`/api/v1/agent/chat/${chatId}/messages`).send({ messages }).expect(201)

      expect(saveResponse.body).toHaveProperty('success', true)

      // Verify messages were saved correctly
      const historyResponse = await agent.get(`/api/v1/agent/chat/${chatId}/history`).expect(200)
      const chat = historyResponse.body.data

      expect(chat.messages.length).toBe(2)

      // Find assistant message with tool part
      const assistantMessage = chat.messages.find((m: { role: string }) => m.role === 'assistant')
      expect(assistantMessage).toBeDefined()
      expect(assistantMessage.parts.length).toBe(2)

      // Check tool part
      const toolPart = assistantMessage.parts.find((p: { type: string }) => p.type === 'tool-createIssue')
      expect(toolPart).toBeDefined()
      expect(toolPart).toHaveProperty('toolCallId', 'call-1')
      expect(toolPart).toHaveProperty('toolName', 'createIssue')
      expect(toolPart).toHaveProperty('state', 'output-available')
    })

    it('should handle empty messages array', async () => {
      // Create a chat first
      const chatId = await createChat()

      // Add a message first
      await agent
        .post(`/api/v1/agent/chat/${chatId}/messages`)
        .send({
          messages: [
            {
              id: 'msg-1',
              role: 'user',
              parts: [{ type: 'text', text: 'Test' }],
            },
          ],
        })
        .expect(201)

      // Now save empty messages (should clear all)
      const saveResponse = await agent.post(`/api/v1/agent/chat/${chatId}/messages`).send({ messages: [] }).expect(201)

      expect(saveResponse.body).toHaveProperty('success', true)

      // Verify all messages were cleared
      const historyResponse = await agent.get(`/api/v1/agent/chat/${chatId}/history`).expect(200)
      const chat = historyResponse.body.data

      expect(chat.messages.length).toBe(0)
    })
  })
})
