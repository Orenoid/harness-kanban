'use client'

import { CheckIcon, ChevronsUpDownIcon, LoaderCircle } from 'lucide-react'
import React, { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/shadcn/utils'

export interface ProjectSearchSelectOption {
  description?: string
  label: string
  value: string
}

interface ProjectSearchSelectProps {
  disabled?: boolean
  emptyText: string
  id: string
  loading?: boolean
  loadingText?: string
  onValueChange: (value: string) => void
  options: ProjectSearchSelectOption[]
  placeholder: string
  searchPlaceholder: string
  value: string
}

export const ProjectSearchSelect: React.FC<ProjectSearchSelectProps> = ({
  disabled = false,
  emptyText,
  id,
  loading = false,
  loadingText = 'Loading...',
  onValueChange,
  options,
  placeholder,
  searchPlaceholder,
  value,
}) => {
  const [open, setOpen] = useState(false)
  const selectedOption = useMemo(() => options.find(option => option.value === value) ?? null, [options, value])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
          data-testid={id}>
          <span className={cn('min-w-0 truncate', !selectedOption && 'text-muted-foreground')}>
            {selectedOption?.label ?? placeholder}
          </span>
          {loading ? (
            <LoaderCircle className="text-muted-foreground size-4 animate-spin" />
          ) : (
            <ChevronsUpDownIcon className="text-muted-foreground size-4 opacity-70" />
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            {loading ? <div className="text-muted-foreground px-3 py-6 text-sm">{loadingText}</div> : null}
            {!loading ? <CommandEmpty>{emptyText}</CommandEmpty> : null}
            {!loading ? (
              <CommandGroup>
                {options.map(option => (
                  <CommandItem
                    key={option.value}
                    value={`${option.label} ${option.description ?? ''}`}
                    onSelect={() => {
                      onValueChange(option.value)
                      setOpen(false)
                    }}
                    data-testid={`${id}-option-${option.label.replaceAll('/', '-').replaceAll(' ', '-').replaceAll(':', '-')}`}>
                    <CheckIcon className={cn('size-4', value === option.value ? 'opacity-100' : 'opacity-0')} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{option.label}</div>
                      {option.description ? (
                        <div className="text-muted-foreground truncate text-xs">{option.description}</div>
                      ) : null}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
