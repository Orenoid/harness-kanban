'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import React, { useMemo } from 'react'

import {
  CodeBlockContainer,
  CodeBlockContent,
  CodeBlockHeader,
  CodeBlockTitle,
} from '@/components/ai-elements/code-block'
import { cn } from '@/lib/shadcn/utils'
import type { Components } from 'react-markdown'
import type { BundledLanguage } from 'shiki'

interface MarkdownRendererProps {
  content: string
  className?: string
}

const isValidLanguage = (lang: string): lang is BundledLanguage => {
  // Shiki bundled languages include common ones; we'll rely on runtime cast
  // and let CodeBlock fall back gracefully for unsupported languages.
  return lang.length > 0 && /^[a-z0-9_-]+$/i.test(lang)
}

const MarkdownCodeBlock: Components['pre'] = ({ children }) => {
  // Code blocks are rendered by the `code` component below.
  // We return a fragment to avoid extra <pre> nesting.
  return <>{children}</>
}

const MarkdownCode: Components['code'] = ({ className, children, node, ...props }) => {
  const isInline = useMemo(() => {
    if (!node?.position) return true
    // Heuristic: if parent is a paragraph, it's inline code.
    // react-markdown passes the element position; inline code doesn't wrap lines.
    const text = String(children || '')
    return !text.includes('\n')
  }, [children, node])

  const language = useMemo(() => {
    const match = /language-(\w+)/.exec(className || '')
    return match?.[1] ?? ''
  }, [className])

  if (!isInline) {
    const code = String(children || '').replace(/\n$/, '')
    if (language && isValidLanguage(language)) {
      return (
        <CodeBlockContainer className="my-4" language={language}>
          <CodeBlockHeader>
            <CodeBlockTitle>
              <span className="font-mono text-xs">{language}</span>
            </CodeBlockTitle>
          </CodeBlockHeader>
          <CodeBlockContent code={code} language={language} />
        </CodeBlockContainer>
      )
    }
    return (
      <pre className="bg-muted my-4 rounded-md p-4 text-sm">
        <code className="font-mono text-sm">{code}</code>
      </pre>
    )
  }

  return (
    <code className={cn('bg-muted text-primary rounded px-1.5 py-0.5 font-mono text-[0.875em]', className)} {...props}>
      {children}
    </code>
  )
}

const MarkdownComponents: Partial<Components> = {
  pre: MarkdownCodeBlock,
  code: MarkdownCode,
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className }) => {
  return (
    <div
      className={cn(
        'prose prose-sm prose-slate dark:prose-invert max-w-none break-words',
        '[&_p]:my-2',
        '[&_ul]:my-2',
        '[&_ol]:my-2',
        '[&_li]:my-0.5',
        '[&_blockquote]:border-muted-foreground/30 [&_blockquote]:text-muted-foreground [&_blockquote]:border-l-4 [&_blockquote]:pl-4 [&_blockquote]:italic',
        '[&_hr]:my-4',
        '[&_table]:w-auto [&_table]:border-collapse [&_table]:text-sm',
        '[&_th]:border-muted-foreground/20 [&_th]:border [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold',
        '[&_td]:border-muted-foreground/20 [&_td]:border [&_td]:px-3 [&_td]:py-1.5',
        '[&_tr:nth-child(even)]:bg-muted/30',
        '[&_input[type="checkbox"]]:mr-2',
        className,
      )}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MarkdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
