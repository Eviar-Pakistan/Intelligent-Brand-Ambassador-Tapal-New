import { useBrand } from '../context/BrandContext'

export function BrandMark({
  variant = 'light',
  compact = false,
  size = 'lg',
}: {
  variant?: 'light' | 'dark'
  compact?: boolean
  size?: 'md' | 'lg' | 'xl'
}) {
  const { brand } = useBrand()
  const onDark = variant === 'light'
  const sizeClass =
    size === 'xl'
      ? 'h-32 w-auto max-w-full'
      : size === 'lg'
        ? 'h-16 w-auto max-w-[200px]'
        : compact
          ? 'h-10 w-auto max-w-[140px]'
          : 'h-12 w-auto max-w-[168px]'

  return (
    <div className="flex w-full items-center justify-center gap-2.5">
      <img src={brand.logo} alt={brand.productName} className={`object-contain ${sizeClass}`} />
      {!compact && size === 'md' && (
        <div className="min-w-0 leading-tight">
          <div className={`text-[10px] ${onDark ? 'text-white/80' : 'text-slate-500'}`}>
            {brand.tagline}
          </div>
        </div>
      )}
    </div>
  )
}
