'use client'

import { Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import React, { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/shadcn/utils'

interface ValidationCommandsFieldProps {
  value: string[]
  onChange: (value: string[]) => void
  error?: string
  mode: 'create' | 'update'
}

const MAX_COMMAND_LENGTH = 2000

export const ValidationCommandsField: React.FC<ValidationCommandsFieldProps> = ({ value, onChange, error, mode }) => {
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const [newCommand, setNewCommand] = useState('')

  const handleAdd = () => {
    const trimmed = newCommand.trim()
    if (!trimmed) return
    if (trimmed.length > MAX_COMMAND_LENGTH) return

    onChange([...value, trimmed])
    setNewCommand('')
  }

  const handleDelete = (index: number) => {
    const newValue = [...value]
    newValue.splice(index, 1)
    onChange(newValue)
    if (editingIndex === index) {
      setEditingIndex(null)
      setEditValue('')
    }
  }

  const handleEditStart = (index: number) => {
    setEditingIndex(index)
    setEditValue(value[index] ?? '')
  }

  const handleEditSave = (index: number) => {
    const trimmed = editValue.trim()
    if (!trimmed || trimmed.length > MAX_COMMAND_LENGTH) {
      return
    }

    const newValue = [...value]
    newValue[index] = trimmed
    onChange(newValue)
    setEditingIndex(null)
    setEditValue('')
  }

  const handleEditCancel = () => {
    setEditingIndex(null)
    setEditValue('')
  }

  const handleKeyDown = (e: React.KeyboardEvent, action: () => void) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      action()
    }
  }

  const inputId = `${mode}-project-validation-commands`

  return (
    <div className="space-y-3" data-testid="validation-commands-section">
      <Label htmlFor={inputId}>Validation Commands</Label>

      <div className="space-y-2">
        {value.length === 0 ? (
          <p className="text-muted-foreground text-sm">No validation commands configured.</p>
        ) : (
          value.map((command, index) => (
            <div key={index} className="flex items-center gap-2">
              {editingIndex === index ? (
                <>
                  <Input
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onKeyDown={e => handleKeyDown(e, () => handleEditSave(index))}
                    className={cn('flex-1 font-mono text-sm', {
                      'border-red-500': editValue.trim().length === 0 || editValue.trim().length > MAX_COMMAND_LENGTH,
                    })}
                    autoFocus
                    aria-label={`Edit command ${index + 1}`}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => handleEditSave(index)}
                    disabled={!editValue.trim() || editValue.trim().length > MAX_COMMAND_LENGTH}
                    aria-label={`Save command ${index + 1}`}>
                    <Check className="size-4 text-green-600" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={handleEditCancel}
                    aria-label={`Cancel editing command ${index + 1}`}>
                    <X className="size-4 text-red-500" />
                  </Button>
                </>
              ) : (
                <>
                  <div className="flex flex-1 items-center gap-2">
                    <code className="bg-muted flex-1 break-all rounded px-2 py-1.5 text-sm">{command}</code>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => handleEditStart(index)}
                    aria-label={`Edit command ${index + 1}`}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(index)}
                    aria-label={`Delete command ${index + 1}`}>
                    <Trash2 className="size-4 text-red-500" />
                  </Button>
                </>
              )}
            </div>
          ))
        )}

        <div className="flex items-center gap-2 pt-2">
          <Input
            id={inputId}
            value={newCommand}
            onChange={e => setNewCommand(e.target.value)}
            onKeyDown={e => handleKeyDown(e, handleAdd)}
            placeholder="Enter a validation command (e.g., pnpm lint)"
            className={cn('flex-1 font-mono text-sm', {
              'border-red-500': newCommand.trim().length > MAX_COMMAND_LENGTH,
            })}
            aria-label="New validation command"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={handleAdd}
            disabled={!newCommand.trim() || newCommand.trim().length > MAX_COMMAND_LENGTH}
            aria-label="Add validation command">
            <Plus className="size-4" />
          </Button>
        </div>

        {error ? <p className="text-sm text-red-500">{error}</p> : null}
      </div>

      <p className="text-muted-foreground text-sm">
        Commands that will be run to validate changes made by the Coding Agent. These run after preview commands.
      </p>
    </div>
  )
}
