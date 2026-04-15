'use client'

import { FolderIcon } from 'lucide-react'

import { GeometricUserAvatar } from '@/components/common/geometric-user-avatar'
import { SvgIcon } from '@/components/common/svg-icon'
import { fetchProjects } from '@/lib/project/fetch-projects'
import { fetchOrganizationMembers } from '@/lib/user/fetch-organization-members'
import { EditableDatetime } from '@/property/components/fields/datetime/editable-datetime'
import { ReadonlyDatetime } from '@/property/components/fields/datetime/readonly-datetime'
import { DatetimeHeader } from '@/property/components/fields/datetime/table-header'
import { EditableDescription } from '@/property/components/fields/description/editable-description'
import { ReadonlyDescription } from '@/property/components/fields/description/readonly-description'
import { DescriptionHeader } from '@/property/components/fields/description/table-header'
import { EditableSelector } from '@/property/components/fields/selector/editable-selector'
import { ReadonlySelector } from '@/property/components/fields/selector/readonly-selector'
import { SelectorTableHeader } from '@/property/components/fields/selector/table-header'
import { EditableStatus } from '@/property/components/fields/status/editable-status'
import { ReadonlyStatus } from '@/property/components/fields/status/readonly-status'
import { StatusTableCell } from '@/property/components/fields/status/table-cell'
import { StatusTableHeader } from '@/property/components/fields/status/table-header'
import { EditableTitle } from '@/property/components/fields/title/editable-title'
import { ReadonlyTitle } from '@/property/components/fields/title/readonly-title'
import { TitleTableCell } from '@/property/components/fields/title/table-cell'
import { TitleHeader } from '@/property/components/fields/title/table-header'
import { registerPropertyRenderer } from '@/property/registry/property-registry'
import { PropertyFilterInputType, PropertyTableColumnLayout, RendererComponent } from '@/property/types/property-types'
import { SystemPropertyId } from '@repo/shared'
import { FilterOperator } from '@repo/shared/property/constants'
// Register system properties
import '@/issue/init-activity-behavior'

import { useContext, useEffect } from 'react'

import { DatatimeTableCell } from '@/property/components/fields/datetime/table-cell'
import { CapsuleSelectorTableCell, IconOnlySelectorTableCell } from '@/property/components/fields/selector/table-cell'
import { apiContext } from './hooks/api-server-context'

export const RegisterRenderersDynamically = () => {
  const { authenticatedFetch } = useContext(apiContext)!

  useEffect(() => {
    // Assignee (right layout, filterable only)
    registerPropertyRenderer(SystemPropertyId.ASSIGNEE, {
      type: 'selector',
      meta: {
        core: {
          propertyId: SystemPropertyId.ASSIGNEE,
          type: 'string',
          required: false,
        },
        display: {
          label: 'Assignee',
          placeholder: 'Assignee',
          placeholderIcon: (
            <SvgIcon
              src="/images/user-placeholder.svg"
              alt="Assignee"
              width={16}
              height={16}
              className="text-muted-foreground"
            />
          ),
        },
        query: {
          filter: {
            input: PropertyFilterInputType.MultiSelect,
            operators: [FilterOperator.HasAnyOf],
          },
        },
        table: {
          layout: PropertyTableColumnLayout.RIGHT,
          order: 101,
          defaultVisible: true,
        },
      },
      editable: EditableSelector,
      readonly: ReadonlySelector,
      tableHeader: SelectorTableHeader,
      tableCell: IconOnlySelectorTableCell,
      optionsLoader: async () => {
        const users = await fetchOrganizationMembers(authenticatedFetch)
        return users.map(user => ({
          value: user.id,
          label: user.username,
          icon: (
            <GeometricUserAvatar
              user={{
                id: user.id,
                username: user.username,
                imageUrl: user.imageUrl,
              }}
              size={16}
              className="h-4 w-4"
            />
          ),
        }))
      },
    })

    registerPropertyRenderer(SystemPropertyId.PROJECT, {
      type: 'selector',
      meta: {
        core: {
          propertyId: SystemPropertyId.PROJECT,
          type: 'project',
          required: false,
        },
        display: {
          label: 'Project',
          placeholder: 'Project',
          placeholderIcon: <FolderIcon className="text-muted-foreground size-4" />,
        },
        group: {
          id: 'project',
          label: 'Project',
        },
        query: {
          sortable: true,
          filter: {
            input: PropertyFilterInputType.MultiSelect,
            operators: [FilterOperator.HasAnyOf],
          },
        },
        table: {
          layout: PropertyTableColumnLayout.RIGHT,
          order: 99,
          defaultVisible: true,
        },
      },
      editable: EditableSelector,
      readonly: ReadonlySelector,
      tableHeader: SelectorTableHeader,
      tableCell: CapsuleSelectorTableCell,
      optionsLoader: async () => {
        const projects = await fetchProjects(authenticatedFetch)
        return projects.map(project => ({
          value: project.id,
          label: project.name,
          icon: <FolderIcon className="size-4" />,
        }))
      },
    })
  }, [authenticatedFetch])

  return null
}

// Title
registerPropertyRenderer(SystemPropertyId.TITLE, {
  type: 'title',
  meta: {
    core: {
      propertyId: SystemPropertyId.TITLE,
      type: 'string',
      required: true,
    },
    validation: {
      minLength: 1,
      maxLength: 100,
    },
    display: {
      label: 'Title',
      placeholder: 'Issue #',
    },
    query: {
      sortable: true,
      filter: {
        input: PropertyFilterInputType.Text,
        operators: [FilterOperator.Contains],
      },
    },
    table: {
      layout: PropertyTableColumnLayout.FILL,
      defaultVisible: true,
    },
  },
  editable: EditableTitle as RendererComponent,
  readonly: ReadonlyTitle as RendererComponent,
  tableHeader: TitleHeader,
  tableCell: TitleTableCell,
})

// Description
registerPropertyRenderer(SystemPropertyId.DESCRIPTION, {
  type: 'description',
  meta: {
    core: {
      propertyId: SystemPropertyId.DESCRIPTION,
      type: 'string',
      required: false,
    },
    display: {
      label: 'Description',
      placeholder: 'Add description',
    },
    table: {
      layout: PropertyTableColumnLayout.HIDDEN,
      defaultVisible: false,
    },
  },
  editable: EditableDescription as RendererComponent,
  readonly: ReadonlyDescription as RendererComponent,
  tableHeader: DescriptionHeader,
})

// Status (left layout, sortable, filterable)
registerPropertyRenderer(SystemPropertyId.STATUS, {
  type: 'status',
  meta: {
    core: {
      propertyId: SystemPropertyId.STATUS,
      type: 'status',
      required: true,
      defaultValue: 'todo',
    },
    display: {
      label: 'Status',
      placeholder: 'Status',
      placeholderIcon: <SvgIcon src="/images/none-placeholder.svg" alt="Status" width={16} height={16} />,
    },
    query: {
      sortable: true,
      filter: {
        input: PropertyFilterInputType.MultiSelect,
        operators: [FilterOperator.HasAnyOf],
      },
    },
    table: {
      layout: PropertyTableColumnLayout.LEFT,
      order: 1,
      defaultVisible: true,
    },
  },
  editable: EditableStatus,
  readonly: ReadonlyStatus,
  tableHeader: StatusTableHeader,
  tableCell: StatusTableCell,
})

// Priority (left layout, sortable, filterable)
registerPropertyRenderer(SystemPropertyId.PRIORITY, {
  type: 'selector',
  meta: {
    core: {
      propertyId: SystemPropertyId.PRIORITY,
      type: 'string',
      required: false,
      defaultValue: 'medium',
    },
    display: {
      label: 'Priority',
      placeholder: 'Priority',
      placeholderIcon: <SvgIcon src="/images/none-placeholder.svg" alt="Priority" width={16} height={16} />,
    },
    query: {
      sortable: true,
      filter: {
        input: PropertyFilterInputType.MultiSelect,
        operators: [FilterOperator.HasAnyOf],
      },
    },
    table: {
      layout: PropertyTableColumnLayout.LEFT,
      order: 0,
      defaultVisible: true,
    },
  },
  editable: EditableSelector,
  readonly: ReadonlySelector,
  tableHeader: SelectorTableHeader,
  tableCell: IconOnlySelectorTableCell,
  optionsLoader: () => [
    {
      value: 'no-priority',
      label: 'No Priority',
      icon: (
        <SvgIcon src="/images/priority-none.svg" alt="No Priority" width={16} height={16} className="dark:invert" />
      ),
    },
    {
      value: 'low',
      label: 'Low',
      icon: (
        <SvgIcon src="/images/priority-low.svg" alt="Low Priority" width={16} height={16} className="dark:invert" />
      ),
    },
    {
      value: 'medium',
      label: 'Medium',
      icon: (
        <SvgIcon
          src="/images/priority-medium.svg"
          alt="Medium Priority"
          width={16}
          height={16}
          className="dark:invert"
        />
      ),
    },
    {
      value: 'high',
      label: 'High',
      icon: (
        <SvgIcon src="/images/priority-high.svg" alt="High Priority" width={16} height={16} className="dark:invert" />
      ),
    },
    {
      value: 'urgent',
      label: 'Urgent',
      icon: <SvgIcon src="/images/priority-urgent.svg" alt="Urgent Priority" width={16} height={16} />,
    },
  ],
})

// Resolved At
registerPropertyRenderer(SystemPropertyId.RESOLVED_AT, {
  type: 'datetime',
  meta: {
    core: {
      propertyId: SystemPropertyId.RESOLVED_AT,
      type: 'number',
      required: false,
    },
    display: {
      label: 'Resolved At',
      placeholder: 'Resolved at',
      placeholderIcon: (
        <SvgIcon
          src="/images/datetime-placeholder.svg"
          alt="Resolved At"
          width={16}
          height={16}
          className="text-muted-foreground"
        />
      ),
    },
    table: {
      layout: PropertyTableColumnLayout.RIGHT,
      order: 101,
      sortable: true,
      defaultVisible: false,
    },
  },
  editable: EditableDatetime as RendererComponent,
  readonly: ReadonlyDatetime as RendererComponent,
  tableHeader: DatetimeHeader,
  tableCell: DatatimeTableCell,
})

// Created At
registerPropertyRenderer(SystemPropertyId.CREATED_AT, {
  type: 'datetime',
  meta: {
    core: {
      propertyId: SystemPropertyId.CREATED_AT,
      type: 'number',
      required: false,
    },
    display: {
      defaultVisible: false,
      label: 'Created At',
      placeholder: 'Created at',
      placeholderIcon: (
        <SvgIcon
          src="/images/datetime-placeholder.svg"
          alt="Created At"
          width={16}
          height={16}
          className="text-muted-foreground"
        />
      ),
    },
    table: {
      layout: PropertyTableColumnLayout.RIGHT,
      order: 102,
      sortable: true,
      defaultVisible: true,
    },
  },
  editable: EditableDatetime as RendererComponent,
  readonly: ReadonlyDatetime as RendererComponent,
  tableHeader: DatetimeHeader,
  tableCell: DatatimeTableCell,
})
