import debounce from 'lodash-es/debounce'
import { useMemo, useRef } from 'react'

export interface DebouncedCallback<T extends (...args: any[]) => any> {
  call: (...args: Parameters<T>) => void
  flush: () => void
  cancel: () => void
}

export const useDebouncedCallback = <T extends (...args: any[]) => any>(
  callback: T,
  delay: number,
): DebouncedCallback<T> => {
  const callbackRef = useRef(callback)

  // Update callback ref when callback changes
  callbackRef.current = callback

  const debounced = useMemo(() => {
    const debouncedFn = debounce((...args: Parameters<T>) => {
      callbackRef.current(...args)
    }, delay)

    return {
      call: (...args: Parameters<T>) => {
        debouncedFn(...args)
      },
      flush: () => {
        debouncedFn.flush()
      },
      cancel: () => {
        debouncedFn.cancel()
      },
    }
  }, [delay])

  return debounced
}
