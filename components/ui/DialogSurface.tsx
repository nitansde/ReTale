"use client"

import { useEffect, useId, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

type DialogPlacement = 'center' | 'left' | 'right' | 'bottom'

const PLACEMENT_STYLES: Record<DialogPlacement, string> = {
  center: 'm-auto max-h-[88vh] w-[calc(100%-2rem)] max-w-xl rounded-[30px]',
  left: 'mr-auto h-full w-[86vw] max-w-sm rounded-r-[30px]',
  right: 'ml-auto h-full w-[86vw] max-w-sm rounded-l-[30px]',
  bottom: 'mt-auto max-h-[88vh] w-full rounded-t-[30px]',
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function DialogSurface({
  open,
  onClose,
  title,
  description,
  children,
  placement = 'center',
  modal = true,
  closeOnBackdrop = true,
  closeDisabled = false,
  busy = false,
  backdropClassName,
  titleClassName,
  contentClassName,
  className,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  placement?: DialogPlacement
  modal?: boolean
  closeOnBackdrop?: boolean
  closeDisabled?: boolean
  busy?: boolean
  backdropClassName?: string
  titleClassName?: string
  contentClassName?: string
  className?: string
}) {
  const titleId = useId()
  const descriptionId = useId()
  const surfaceRef = useRef<HTMLDivElement>(null)
  const closeDisabledRef = useRef(closeDisabled)

  useEffect(() => {
    closeDisabledRef.current = closeDisabled
  }, [closeDisabled])

  useEffect(() => {
    if (!open) return

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    if (modal) document.body.style.overflow = 'hidden'

    const surface = surfaceRef.current
    const focusable = surface?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
    ;(focusable ?? surface)?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (closeDisabledRef.current) return
        onClose()
        return
      }
      if (event.key !== 'Tab' || !surface) return

      const focusableElements = Array.from(surface.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      if (focusableElements.length === 0) {
        event.preventDefault()
        surface.focus()
        return
      }

      const first = focusableElements[0]
      const last = focusableElements[focusableElements.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    function handleFocusIn(event: FocusEvent) {
      if (!surface || surface.contains(event.target as Node)) return
      const firstFocusable = surface.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      ;(firstFocusable ?? surface).focus()
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('focusin', handleFocusIn)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('focusin', handleFocusIn)
      if (modal) document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [modal, onClose, open])

  if (!open) return null

  return (
    <div
      className={cn('fixed inset-0 z-[70] flex bg-black/60 backdrop-blur-sm', backdropClassName)}
      onClick={(event) => {
        if (!closeDisabled && closeOnBackdrop && event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={surfaceRef}
        role="dialog"
        aria-modal={modal || undefined}
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        aria-busy={busy || undefined}
        tabIndex={-1}
        className={cn(
          'overflow-y-auto border border-white/10 bg-[#0d1017] px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-zinc-100 shadow-[0_30px_120px_rgba(0,0,0,0.5)] outline-none',
          PLACEMENT_STYLES[placement],
          className
        )}
      >
        <h2 id={titleId} className={cn('text-lg font-semibold text-zinc-100', titleClassName)}>{title}</h2>
        {description ? <p id={descriptionId} className="mt-2 text-sm leading-6 text-zinc-400">{description}</p> : null}
        <div className={cn('mt-5', contentClassName)}>{children}</div>
      </div>
    </div>
  )
}
