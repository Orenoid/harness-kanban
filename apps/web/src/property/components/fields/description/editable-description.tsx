import { useRef } from 'react'

import { TiptapEditor, TiptapEditorHandle } from '@/components/core/editor/tiptap-editor'
import { useUploadBase64Image } from '@/hooks/use-upload-image'
import type { RendererComponent } from '@/property/types/property-types'

export const EditableDescription: RendererComponent<string> = ({ value, onChange, disabled, meta }) => {
  const editorRef = useRef<TiptapEditorHandle>(null)
  const { mutateAsync } = useUploadBase64Image()
  const placeholder = meta.display?.placeholder ?? 'Enter description...'

  const uploadImage = async (base64: string): Promise<string> => {
    const result = await mutateAsync(base64)
    return result.url
  }

  return (
    <TiptapEditor
      ref={editorRef}
      value={value}
      updateMode="debounced"
      onUpdate={onChange}
      onBlur={onChange}
      editable={!disabled}
      placeholder={placeholder}
      uploadImage={uploadImage}
      containerClassName="border-border bg-background min-h-[300px]"
      className="overflow-y-auto"
    />
  )
}
