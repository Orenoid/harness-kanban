'use client'

import { Markdown } from 'tiptap-markdown'
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'

import { useDebouncedCallback } from '@/hooks/use-debounce'
import { cn } from '@/lib/shadcn/utils'
import {
  createSuggestionsItems,
  enableKeyboardNavigation,
  Slash,
  SlashCmd,
  SlashCmdProvider,
} from '@harshtalks/slash-tiptap'
import { Image } from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { Editor } from '@tiptap/core'

interface MarkdownStorage {
  markdown: {
    getMarkdown: () => string
  }
}

const getMarkdownFromEditor = (editor: Editor | null): string => {
  if (!editor) return ''
  return (editor.storage as unknown as MarkdownStorage).markdown.getMarkdown()
}

export interface MarkdownEditorHandle {
  getValue: () => string
  setValue: (value: string) => void
  clear: () => void
  focusEnd: () => void
}

export type UpdateMode = 'immediate' | 'manual' | 'debounced'

export interface MarkdownEditorOptions {
  debounceMs?: number
}

export interface MarkdownEditorProps {
  value?: string
  defaultValue?: string
  editable?: boolean
  uploadImage?: (base64String: string) => Promise<string>
  placeholder?: string
  className?: string
  containerClassName?: string
  updateMode?: UpdateMode
  options?: MarkdownEditorOptions
  onUpdate?: (value: string) => void
  onBlur?: (value: string) => void
}

const SLASH_COMMAND_SUGGESTION_ITEMS = createSuggestionsItems([
  {
    title: 'Heading 1',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run(),
  },
  {
    title: 'Heading 2',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run(),
  },
  {
    title: 'Heading 3',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run(),
  },
  {
    title: 'Bulleted list',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: 'Numbered list',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    title: 'Checklist',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    title: 'Code block',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).setCodeBlock().run(),
  },
  {
    title: 'Blockquote',
    command: ({ editor, range }) => editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
  },
])

const SLASH_GROUPS = [
  {
    heading: 'Headings',
    items: [SLASH_COMMAND_SUGGESTION_ITEMS[0], SLASH_COMMAND_SUGGESTION_ITEMS[1], SLASH_COMMAND_SUGGESTION_ITEMS[2]],
  },
  {
    heading: 'Text',
    items: [SLASH_COMMAND_SUGGESTION_ITEMS[3], SLASH_COMMAND_SUGGESTION_ITEMS[4], SLASH_COMMAND_SUGGESTION_ITEMS[5]],
  },
  {
    heading: 'Insert',
    items: [SLASH_COMMAND_SUGGESTION_ITEMS[6], SLASH_COMMAND_SUGGESTION_ITEMS[7]],
  },
]

const UploadableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      uploading: {
        default: false,
      },
    }
  },

  renderHTML({ HTMLAttributes }) {
    const { uploading, ...rest } = HTMLAttributes
    return [
      'span',
      {
        class: cn(
          'inline-block relative',
          uploading && 'after:absolute after:inset-0 after:bg-white/60 after:content-[""] after:pointer-events-none',
        ),
      },
      ['img', rest],
    ]
  },
}).configure({
  allowBase64: true,
  HTMLAttributes: {
    class: 'max-w-[400px] w-full',
  },
})

const MarkdownEditorComponent = (
  {
    value = '',
    defaultValue,
    onUpdate,
    onBlur,
    editable = true,
    placeholder = 'Write a comment... Markdown syntax is supported',
    className,
    uploadImage,
    containerClassName,
    updateMode = 'immediate',
    options = {},
  }: MarkdownEditorProps,
  ref: React.ForwardedRef<MarkdownEditorHandle>,
) => {
  const isUploadingRef = useRef(false)
  const hasUserInteracted = useRef(false)
  const isInternalUpdate = useRef(false)
  const { debounceMs = 5000 } = options

  const defaultUpload = (base64: string) => new Promise<string>(res => setTimeout(() => res(base64), 5000))

  const debouncedUpdate = useDebouncedCallback((value: string) => {
    onUpdate?.(value)
  }, debounceMs)

  const handleUpdate = useCallback(
    (value: string) => {
      if (updateMode === 'manual') {
        return
      } else if (updateMode === 'debounced') {
        debouncedUpdate(value)
      } else {
        onUpdate?.(value)
      }
    },
    [updateMode, onUpdate, debouncedUpdate],
  )

  const initialContent = React.useMemo(() => {
    const rawContent = updateMode === 'manual' ? defaultValue || value : value
    return rawContent || ''
  }, [updateMode, defaultValue, value])

  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem,
      UploadableImage,
      Slash.configure({
        suggestion: {
          items: () => SLASH_COMMAND_SUGGESTION_ITEMS,
        },
      }),
      Placeholder.configure({
        placeholder,
      }),
      Markdown.configure({
        html: false,
        tightLists: true,
        bulletListMarker: '-',
        linkify: false,
        breaks: false,
        transformPastedText: true,
        transformCopiedText: false,
      }),
    ],
    content: initialContent,
    editable,
    editorProps: {
      attributes: {
        class: cn(
          'prose prose-sm sm:prose-base dark:prose-invert prose-no-margins max-w-none',
          'focus:outline-none',
          'scrollbar-hide',
          className,
        ),
      },
      handleDOMEvents: {
        keydown: (view, event) => {
          hasUserInteracted.current = true
          return enableKeyboardNavigation(event)
        },
        input: () => {
          hasUserInteracted.current = true
          return false
        },
        paste: (view, event) => {
          hasUserInteracted.current = true
          const items = event.clipboardData?.items
          if (!items) return false

          const itemArray = Array.from(items) as DataTransferItem[]
          for (const item of itemArray) {
            if (item.type.startsWith('image/')) {
              const file = item.getAsFile()
              if (!file) continue
              event.preventDefault()

              const reader = new FileReader()
              reader.onload = () => {
                const base64 = reader.result as string
                const { state, dispatch } = view

                const imageNode = state.schema.nodes.image
                if (!imageNode) return
                const node = imageNode.create({ src: base64, uploading: true })
                dispatch(state.tr.replaceSelectionWith(node).scrollIntoView())

                isUploadingRef.current = true
                const fn = uploadImage ?? defaultUpload
                fn(base64).then(url => {
                  view.state.doc.descendants((n, pos) => {
                    if (n.type.name === 'image' && n.attrs.src === base64) {
                      view.dispatch(
                        view.state.tr.setNodeMarkup(pos, undefined, {
                          ...n.attrs,
                          src: url,
                          uploading: false,
                        }),
                      )

                      isUploadingRef.current = false
                      const markdown = getMarkdownFromEditor(editor)
                      handleUpdate(markdown)
                      return false
                    }
                    return true
                  })
                })
              }
              reader.readAsDataURL(file)
              return true
            }
          }
          return false
        },
      },
    },
    onUpdate: ({ editor, transaction }) => {
      if (!hasUserInteracted.current && !transaction.docChanged) {
        return
      }

      if (isInternalUpdate.current) {
        return
      }

      const markdown = getMarkdownFromEditor(editor)
      handleUpdate(markdown)
    },
    onBlur: ({ editor }) => {
      if (onBlur) {
        const markdown = getMarkdownFromEditor(editor)
        onBlur(markdown)
      }
    },
    immediatelyRender: false,
  })

  useImperativeHandle(
    ref,
    () => ({
      getValue: () => getMarkdownFromEditor(editor),
      setValue: (value: string) => {
        if (!editor) return
        editor.commands.setContent(value || '')
      },
      clear: () => editor?.commands.clearContent(),
      focusEnd: () => editor?.commands.focus('end'),
    }),
    [editor],
  )

  useEffect(() => {
    if (!editor) return

    if (updateMode === 'manual') {
      return
    }

    const current = getMarkdownFromEditor(editor)
    if (value !== current) {
      isInternalUpdate.current = true
      editor.commands.setContent(value || '')
      Promise.resolve().then(() => {
        isInternalUpdate.current = false
      })
    }
  }, [editor, value, updateMode])

  useEffect(() => {
    editor?.setEditable(editable)
  }, [editor, editable])

  if (!editor) {
    return null
  }

  return (
    <div className={cn('relative', containerClassName)}>
      <SlashCmdProvider>
        <EditorContent editor={editor} />
        <SlashCmd.Root editor={editor}>
          <SlashCmd.Cmd>
            <div className="bg-popover text-popover-foreground animate-in fade-in slide-in-from-top-1 w-[250px] rounded-sm border p-1 shadow-md">
              <SlashCmd.List className="p-1">
                {SLASH_GROUPS.map((group, gi) => (
                  <React.Fragment key={gi}>
                    <div className="text-muted-foreground px-2 py-1 text-xs font-semibold uppercase">
                      {group.heading}
                    </div>
                    {group.items.map(item => {
                      if (!item) return null
                      return (
                        <SlashCmd.Item
                          key={item.title}
                          value={item.title}
                          onCommand={v => item.command(v)}
                          className={cn(
                            'flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm',
                            'aria-selected:bg-accent aria-selected:text-accent-foreground',
                          )}>
                          {item.title}
                        </SlashCmd.Item>
                      )
                    })}
                    {gi !== SLASH_GROUPS.length - 1 && <div className="my-1 border-t border-gray-200" />}
                  </React.Fragment>
                ))}
              </SlashCmd.List>
            </div>
          </SlashCmd.Cmd>
        </SlashCmd.Root>
      </SlashCmdProvider>
    </div>
  )
}

export const MarkdownEditor = forwardRef(MarkdownEditorComponent)
