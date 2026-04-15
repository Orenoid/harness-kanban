import { describe, expect, it } from 'vitest'

import { getCommentMarkdown, parseCommentContent, stringifyCommentContent } from '../parser'

describe('parseCommentContent', () => {
  it('should parse new markdown-wrapped format', () => {
    const content = JSON.stringify({
      content: '# Hello',
      attr: { data: { type: 'bug' } },
    })
    const result = parseCommentContent(content)
    expect(result.content).toBe('# Hello')
    expect(result.attr?.data).toEqual({ type: 'bug' })
  })

  it('should treat old Tiptap JSON as plain text', () => {
    const oldJson = JSON.stringify({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
    })
    const result = parseCommentContent(oldJson)
    expect(result.content).toBe(oldJson)
    expect(result.attr?.data).toEqual({})
  })

  it('should preserve properties from old Tiptap JSON', () => {
    const oldJson = JSON.stringify({
      type: 'doc',
      content: [],
      attr: { data: { priority: 'high' } },
    })
    const result = parseCommentContent(oldJson)
    expect(result.content).toBe(oldJson)
    expect(result.attr?.data).toEqual({ priority: 'high' })
  })

  it('should treat plain text as markdown', () => {
    const content = 'This is plain text'
    const result = parseCommentContent(content)
    expect(result.content).toBe('This is plain text')
    expect(result.attr?.data).toEqual({})
  })

  it('should treat markdown as plain text', () => {
    const content = '# Heading\n\nSome **bold** text'
    const result = parseCommentContent(content)
    expect(result.content).toBe(content)
    expect(result.attr?.data).toEqual({})
  })
})

describe('getCommentMarkdown', () => {
  it('should return string content directly', () => {
    const result = getCommentMarkdown({ content: '# Hello' })
    expect(result).toBe('# Hello')
  })

  it('should stringify array content as fallback', () => {
    const result = getCommentMarkdown({ content: [{ type: 'paragraph' }] })
    expect(result).toBe('[{"type":"paragraph"}]')
  })

  it('should return empty string for undefined content', () => {
    const result = getCommentMarkdown({})
    expect(result).toBe('')
  })
})

describe('stringifyCommentContent', () => {
  it('should return plain markdown when no properties', () => {
    const result = stringifyCommentContent({ content: '# Hello' })
    expect(result).toBe('# Hello')
  })

  it('should wrap markdown with properties in JSON', () => {
    const result = stringifyCommentContent({
      content: '# Hello',
      attr: { data: { type: 'bug' } },
    })
    expect(JSON.parse(result)).toEqual({
      content: '# Hello',
      attr: { data: { type: 'bug' } },
    })
  })

  it('should stringify old array content', () => {
    const result = stringifyCommentContent({
      content: [{ type: 'paragraph' }],
      attr: { data: {} },
    })
    expect(result).toBe('[{"type":"paragraph"}]')
  })
})
