'use client'

import { Plus, Trash2 } from 'lucide-react'
import React from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface ValidationCommandsInputProps {
  value: string[]
  onChange: (value: string[]) => void
  disabled?: boolean
}

export const ValidationCommandsInput: React.FC<ValidationCommandsInputProps> = ({
  value,
  onChange,
  disabled = false,
}) => {
  const handleAddCommand = () => {
    onChange([...value, ''])
  }

  const handleRemoveCommand = (index: number) => {
    const newCommands = value.filter((_, i) => i !== index)
    onChange(newCommands)
  }

  const handleChangeCommand = (index: number, newCommand: string) => {
    const newCommands = value.map((cmd, i) => (i === index ? newCommand : cmd))
    onChange(newCommands)
  }

  return (
    <div className="space-y-3">
      {value.map((command, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            value={command}
            onChange={e => handleChangeCommand(index, e.target.value)}
            placeholder="Enter validation command"
            disabled={disabled}
            className="flex-1"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => handleRemoveCommand(index)}
            disabled={disabled}
            aria-label={`Remove command ${index + 1}`}>
            <Trash2 className="size-4 text-red-500" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleAddCommand}
        disabled={disabled}
        className="gap-1">
        <Plus className="size-4" />
        Add command
      </Button>
    </div>
  )
}
