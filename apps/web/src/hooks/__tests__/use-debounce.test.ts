import { describe, expect, it, vi } from 'vitest'

import { act, renderHook } from '@testing-library/react'
import { useDebouncedCallback } from '../use-debounce'

describe('useDebouncedCallback', () => {
  it('should debounce callback calls', () => {
    vi.useFakeTimers()
    const callback = vi.fn()

    const { result } = renderHook(() => useDebouncedCallback(callback, 500))

    act(() => {
      result.current.call('a')
      result.current.call('b')
      result.current.call('c')
    })

    expect(callback).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenLastCalledWith('c')

    vi.useRealTimers()
  })

  it('should flush pending callback immediately', () => {
    vi.useFakeTimers()
    const callback = vi.fn()

    const { result } = renderHook(() => useDebouncedCallback(callback, 500))

    act(() => {
      result.current.call('a')
    })

    expect(callback).not.toHaveBeenCalled()

    act(() => {
      result.current.flush()
    })

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenLastCalledWith('a')

    vi.useRealTimers()
  })

  it('should cancel pending callback', () => {
    vi.useFakeTimers()
    const callback = vi.fn()

    const { result } = renderHook(() => useDebouncedCallback(callback, 500))

    act(() => {
      result.current.call('a')
    })

    act(() => {
      result.current.cancel()
    })

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(callback).not.toHaveBeenCalled()

    vi.useRealTimers()
  })

  it('should use the latest callback reference', () => {
    vi.useFakeTimers()
    const firstCallback = vi.fn()
    const secondCallback = vi.fn()

    const { result, rerender } = renderHook(({ cb }) => useDebouncedCallback(cb, 500), {
      initialProps: { cb: firstCallback },
    })

    act(() => {
      result.current.call('x')
    })

    rerender({ cb: secondCallback })

    act(() => {
      result.current.flush()
    })

    expect(firstCallback).not.toHaveBeenCalled()
    expect(secondCallback).toHaveBeenCalledTimes(1)
    expect(secondCallback).toHaveBeenLastCalledWith('x')

    vi.useRealTimers()
  })
})
