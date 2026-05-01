'use client'

import { motion } from 'framer-motion'
import Image from 'next/image'
import { memo, useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/shadcn/utils'

const Star = ({ index }: { index: number }) => {
  const [position, setPosition] = useState({ top: '0', left: '0' })
  const [animationProps, setAnimationProps] = useState({})

  useEffect(() => {
    const random = () => Math.random()
    const randomMove = () => Math.random() * 4 - 2
    const randomOpacity = () => Math.random()

    setPosition({
      top: `${random() * 100}%`,
      left: `${random() * 100}%`,
    })

    setAnimationProps({
      animate: {
        top: `calc(${random() * 100}% + ${randomMove()}px)`,
        left: `calc(${random() * 100}% + ${randomMove()}px)`,
        opacity: randomOpacity(),
        scale: [1, 1.2, 0],
      },
      transition: {
        duration: random() * 10 + 20,
        repeat: Infinity,
        ease: 'linear',
      },
    })
  }, [])

  return (
    <motion.span
      key={`star-${index}`}
      {...animationProps}
      style={{
        position: 'absolute',
        top: position.top,
        left: position.left,
        width: '2px',
        height: '2px',
        backgroundColor: 'white',
        borderRadius: '50%',
        zIndex: 1,
      }}
      className="inline-block"
    />
  )
}

const Stars = () => {
  return (
    <div className="absolute inset-0">
      {[...Array(80)].map((_, i) => (
        <Star key={i} index={i} />
      ))}
    </div>
  )
}

const MemoizedStars = memo(Stars)

export const GlobalLoading = ({ text = 'Loading', className }: { text?: string; className?: string }) => {
  const cardRef = useRef<HTMLDivElement>(null)

  return (
    <div className="flex flex-1 items-start justify-center">
      <div
        ref={cardRef}
        className={cn(
          'relative mt-24 w-full max-w-[90vw] sm:max-w-md md:mt-24 md:max-w-xl lg:max-w-2xl xl:max-w-[40rem]',
          'overflow-hidden rounded-lg border border-white/[0.08] bg-[#1d1c20] p-6 sm:p-8',
          'flex flex-col items-center justify-center border-none bg-transparent',
          className,
        )}>
        <div style={{ animation: 'spin 2s linear infinite' }}>
          <Image src="/images/spinner.svg" width="140" height="140" alt="Loading spinner" priority />
        </div>
        <div className="relative mt-[-40px] flex max-h-40 items-center overflow-hidden">
          <div className="overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,white,transparent)]">
            <p className="bg-[#323238] bg-clip-text py-6 text-3xl font-bold text-transparent sm:text-5xl dark:bg-[#e0e0e0]">
              {text}
            </p>
            <MemoizedStars />
          </div>
        </div>
      </div>
      <style>{`
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  )
}
