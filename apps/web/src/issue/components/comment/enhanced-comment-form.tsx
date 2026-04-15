'use client'

import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { AnimatedTabs } from '@/components/common/animated-tabs'
import { MarkdownEditor, MarkdownEditorHandle } from '@/components/core/markdown-editor'
import { Button } from '@/components/ui/button'
import { useUploadBase64Image } from '@/hooks/use-upload-image'
import { useCreateIssueComment } from '@/issue/hooks/use-create-issue-comment'
import { CommentPropertyForm } from './comment-property/comment-property-form'
import { stringifyCommentContent } from './comment-property/parser'
import { getCommentProperty, getCommentTabGroups } from './comment-property/registry'
import { CommentContent, CommentPropertyValueType } from './comment-property/types'

interface EnhancedCommentFormProps {
  issueId: number
}

interface EnhancedCommentFormViewProps {
  createComment: (content: string) => Promise<unknown>
  uploadImage: (base64: string) => Promise<string>
}

export const EnhancedCommentFormView: React.FC<EnhancedCommentFormViewProps> = ({ createComment, uploadImage }) => {
  const [activeTab, setActiveTab] = useState('default')
  const [propertyValues, setPropertyValues] = useState<Record<string, CommentPropertyValueType>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [validationErrors, setValidationErrors] = useState<Record<string, boolean>>({})
  const editorRef = useRef<MarkdownEditorHandle>(null)

  const { tabItems, activeTabItem } = useMemo(() => {
    const tabGroups = getCommentTabGroups()
    const primaryTabGroup = tabGroups[0]
    const tabsData = primaryTabGroup?.tabs || [{ id: 'default', label: 'Default', propertyIds: [] }]

    return {
      tabItems: tabsData.map(tab => ({ label: tab.label, value: tab.id })),
      activeTabItem: tabsData.find(tab => tab.id === activeTab),
    }
  }, [activeTab])

  const validateRequiredFields = useCallback(() => {
    if (!activeTabItem?.propertyIds) return { isValid: true, errors: {} }

    const activeProperties = activeTabItem.propertyIds.map(id => getCommentProperty(id)).filter(Boolean)

    const errors: Record<string, boolean> = {}
    let isValid = true

    for (const property of activeProperties) {
      if (property?.meta.required && !property.meta.readonly) {
        const value = propertyValues[property.id]
        if (value === undefined || value === null || value === '') {
          errors[property.id] = true
          isValid = false
        }
      }
    }
    return { isValid, errors }
  }, [activeTabItem?.propertyIds, propertyValues])

  const handlePropertyChange = (propertyId: string, value: CommentPropertyValueType) => {
    setPropertyValues(prev => ({
      ...prev,
      [propertyId]: value,
    }))
    if (validationErrors[propertyId]) {
      setValidationErrors(prev => {
        const newErrors = { ...prev }
        delete newErrors[propertyId]
        return newErrors
      })
    }
  }

  const resetForm = () => {
    editorRef.current?.clear()
    setPropertyValues({})
    setValidationErrors({})
    editorRef.current?.focusEnd()
    setActiveTab('default')
  }

  const handleSubmit = async () => {
    const editorValue = editorRef.current?.getValue()
    const hasProperties = Object.keys(propertyValues).length > 0

    if (!editorValue?.trim() && !hasProperties) {
      toast.error('Please write a comment')
      return
    }
    if (isSubmitting) return

    const validation = validateRequiredFields()
    if (!validation.isValid) {
      setValidationErrors(validation.errors)
      toast.error('Please fill in all required fields')
      return
    }
    setValidationErrors({})

    setIsSubmitting(true)
    try {
      let commentContent: CommentContent

      if (editorValue) {
        commentContent = hasProperties
          ? { content: editorValue, attr: { data: propertyValues } }
          : { content: editorValue }
      } else {
        commentContent = { content: '', attr: { data: propertyValues } }
      }

      await createComment(stringifyCommentContent(commentContent))

      toast.success('Comment added successfully')
      resetForm()

      setTimeout(() => {
        editorRef.current?.focusEnd()
      }, 100)
    } catch (error) {
      console.error('Failed to create comment:', error)
      toast.error('Failed to create comment. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const renderPropertyFields = (propertyIds?: string[]) => {
    if (!propertyIds || propertyIds.length === 0) return null

    const filteredPropertyIds = propertyIds.filter(id => {
      const property = getCommentProperty(id)
      return !property?.meta.readonly
    })
    const properties = filteredPropertyIds.map(id => getCommentProperty(id)).filter(Boolean)

    if (properties.length === 0) return null

    return (
      <div className="bg-accent/50 border-b p-4">
        <div className="flex gap-4">
          {properties.map(property => (
            <div key={property!.id} className="flex-1">
              <CommentPropertyForm
                property={property!}
                value={propertyValues[property!.id]}
                onChange={value => handlePropertyChange(property!.id, value)}
                hasError={validationErrors[property!.id]}
              />
            </div>
          ))}
        </div>
      </div>
    )
  }

  useEffect(() => {
    if (activeTab !== 'default' && activeTabItem?.defaultValues) {
      setPropertyValues(prev => ({
        ...prev,
        ...activeTabItem.defaultValues,
      }))
    }
  }, [activeTab, activeTabItem])

  return (
    <div className="w-full">
      <AnimatedTabs tabs={tabItems} defaultTab="default" value={activeTab} onTabChange={setActiveTab}>
        <div className="relative mt-1 -translate-y-1 border border-t-0">
          {renderPropertyFields(activeTabItem?.propertyIds)}
          <MarkdownEditor
            ref={editorRef}
            defaultValue=""
            updateMode="manual"
            editable
            placeholder="Write a comment... Markdown syntax is supported"
            uploadImage={uploadImage}
            containerClassName="p-3 pb-12"
            className="overflow-y-auto"
          />
          <div className="absolute bottom-3 right-3">
            <Button size="sm" onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                'Submit'
              )}
            </Button>
          </div>
        </div>
      </AnimatedTabs>
    </div>
  )
}

export const EnhancedCommentForm: React.FC<EnhancedCommentFormProps> = ({ issueId }) => {
  const { mutateAsync: uploadBase64Image } = useUploadBase64Image()
  const { mutateAsync: createComment } = useCreateIssueComment(issueId)

  const handleUploadImage = async (base64: string): Promise<string> => {
    const result = await uploadBase64Image(base64)
    return result.url
  }

  return <EnhancedCommentFormView createComment={createComment} uploadImage={handleUploadImage} />
}
