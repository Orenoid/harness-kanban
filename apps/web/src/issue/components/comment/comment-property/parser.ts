import { CommentContent } from './types'

export const parseCommentContent = (content: string): CommentContent => {
  try {
    const parsed = JSON.parse(content)

    // New markdown-wrapped format: { content: "markdown string", attr: { data: {} } }
    if (typeof parsed.content === 'string') {
      return parsed as CommentContent
    }

    // Old Tiptap JSON format - treat as plain text, preserving any properties
    const attrData = parsed.attr?.data || {}
    return {
      content,
      attr: { data: attrData },
    }
  } catch {
    // Plain text / markdown
    return {
      content,
      attr: { data: {} },
    }
  }
}

export const getCommentMarkdown = (content: CommentContent): string => {
  if (typeof content.content === 'string') {
    return content.content
  }
  // Fallback for unexpected structures
  if (content.content) {
    return JSON.stringify(content.content)
  }
  return ''
}

export const stringifyCommentContent = (content: CommentContent): string => {
  const markdownContent = typeof content.content === 'string' ? content.content : JSON.stringify(content.content)
  const hasAttr = content.attr && Object.keys(content.attr.data).length > 0

  if (!hasAttr) {
    return markdownContent
  }

  return JSON.stringify({
    content: markdownContent,
    attr: content.attr,
  })
}
