import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import type { CSSProperties, ReactNode } from 'react'
import { Icon } from './Icon'

/* ---------- buttons ---------- */
export function IconButton({
  icon,
  size = 16,
  title,
  onClick,
  active,
  className = '',
  style
}: {
  icon: string
  size?: number
  title?: string
  onClick?: (e: React.MouseEvent) => void
  active?: boolean
  className?: string
  style?: CSSProperties
}) {
  return (
    <button className={`icon-btn ${active ? 'on' : ''} ${className}`} title={title} onClick={onClick} style={style}>
      <Icon name={icon} size={size} />
    </button>
  )
}

export function Spinner({ size = 15 }: { size?: number }) {
  return <Icon name="refresh" size={size} className="spin" />
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>
}

/* ---------- segmented control ---------- */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  style
}: {
  options: { value: T; label: ReactNode }[]
  value: T
  onChange: (v: T) => void
  style?: CSSProperties
}) {
  return (
    <div className="seg" style={style}>
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ---------- toggle ---------- */
export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <SwitchPrimitive.Root className={`toggle ${checked ? 'on' : ''}`} checked={checked} onCheckedChange={onChange}>
      <SwitchPrimitive.Thumb />
    </SwitchPrimitive.Root>
  )
}

/* ---------- field ---------- */
export function Field({ label, children, hint }: { label?: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  )
}

/* ---------- dropdown menu ---------- */
export interface MenuOption {
  label: ReactNode
  icon?: string
  onSelect?: () => void
  checked?: boolean
  danger?: boolean
  separator?: boolean
}

export function Menu({
  trigger,
  items,
  align = 'start',
  side = 'bottom'
}: {
  trigger: ReactNode
  items: MenuOption[]
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'bottom' | 'left' | 'right'
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="popover" align={align} side={side} sideOffset={6} style={{ position: 'relative' }}>
          {items.map((it, i) =>
            it.separator ? (
              <div key={i} className="pop-sep" />
            ) : (
              <DropdownMenu.Item
                key={i}
                className="pop-item"
                onSelect={it.onSelect}
                style={it.danger ? { color: 'var(--s-5xx)' } : undefined}
              >
                {it.icon && <Icon name={it.icon} size={15} />}
                <span style={{ flex: 1 }}>{it.label}</span>
                {it.checked && <Icon name="check" size={14} className="tick" />}
              </DropdownMenu.Item>
            )
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

/* ---------- popover (rich content) ---------- */
export function Popover({
  trigger,
  children,
  align = 'end',
  side = 'bottom',
  open,
  onOpenChange
}: {
  trigger: ReactNode
  children: ReactNode
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'bottom' | 'left' | 'right'
  open?: boolean
  onOpenChange?: (o: boolean) => void
}) {
  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content className="popover" align={align} side={side} sideOffset={6} style={{ position: 'relative' }}>
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

/* ---------- tooltip ---------- */
export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  if (!content) return <>{children}</>
  return (
    <TooltipPrimitive.Provider delayDuration={250}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content className="rl-tooltip" sideOffset={6}>
            {content}
            <TooltipPrimitive.Arrow className="rl-tooltip-arrow" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}

/* ---------- modal dialog ---------- */
export function Modal({
  open,
  onOpenChange,
  children,
  width = 460,
  title
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  children: ReactNode
  width?: number
  title?: ReactNode
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="modal-scrim" />
        <DialogPrimitive.Content className="modal" style={{ width }} aria-describedby={undefined}>
          {title && <DialogPrimitive.Title className="modal-title">{title}</DialogPrimitive.Title>}
          {!title && <DialogPrimitive.Title style={{ display: 'none' }}>Dialog</DialogPrimitive.Title>}
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
