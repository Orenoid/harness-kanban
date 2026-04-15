import React from 'react'

import { PropertyOptionItem, PropertyOptionsLoader } from '@/property/types/property-types'
import type { JSONContent } from '@tiptap/core'

export type CommentPropertyValueType = string | number | boolean | null | undefined | string[]

export enum CommentPropertyType {
  STRING = 'string',
  NUMBER = 'number',
  BOOLEAN = 'boolean',
  SELECT = 'select',
}

export interface CommentPropertyMeta {
  propertyId: string
  type: CommentPropertyType
  required?: boolean
  defaultValue?: unknown
  readonly?: boolean
  validation?: {
    min?: number
    max?: number
    minLength?: number
    maxLength?: number
    pattern?: string
  }
  display?: {
    label: string
    description?: string
    placeholder?: string
    order?: number
  }
}

export interface CommentPropertyReadonlyProps {
  value: CommentPropertyValueType
  meta: CommentPropertyMeta
  options?: PropertyOptionItem[]
  className?: string
}

export interface CommentPropertyRegistryEntry {
  id: string
  type: CommentPropertyType
  meta: CommentPropertyMeta
  optionsLoader?: PropertyOptionsLoader
  editable?: React.ComponentType<CommentPropertyRendererProps>
  readonly?: React.ComponentType<CommentPropertyReadonlyProps>
  shouldDisplay?: (data: Record<string, CommentPropertyValueType>) => boolean
}

export interface CommentPropertyRendererProps {
  value: CommentPropertyValueType
  onChange: (value: CommentPropertyValueType) => void
  disabled?: boolean
  meta: CommentPropertyMeta
  options?: PropertyOptionItem[]
}

export interface CommentTheme {
  label?: string
  container?: string // background and border classes
  text?: string // text color for the label
}

export interface CommentThemeConfig {
  id: string
  propertyId: string // The property that determines this theme
  matcher: (value: CommentPropertyValueType) => boolean // Function to match the property value
  theme: CommentTheme
}

export interface CommentContent {
  type?: string
  content?: JSONContent[] | string
  attr?: {
    data: Record<string, CommentPropertyValueType>
  }
}

export interface CommentTabConfig {
  id: string
  label: string
  propertyIds: string[]
  order?: number
  theme?: CommentTheme
  defaultValues?: Record<string, CommentPropertyValueType>
}

export interface CommentTabGroup {
  id: string
  label: string
  tabs: CommentTabConfig[]
  defaultTab?: string
}
