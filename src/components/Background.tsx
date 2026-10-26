/** Slow-drifting colored blobs behind everything. Pure CSS so it costs almost nothing. */
export function Background() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute -top-32 -left-24 size-96 animate-float rounded-full bg-grape/30 blur-3xl" />
      <div
        className="absolute top-1/3 -right-32 size-[28rem] animate-float rounded-full bg-bubblegum/20 blur-3xl"
        style={{ animationDelay: '-3s' }}
      />
      <div
        className="absolute -bottom-40 left-1/4 size-96 animate-float rounded-full bg-mint/15 blur-3xl"
        style={{ animationDelay: '-6s' }}
      />
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />
    </div>
  )
}
