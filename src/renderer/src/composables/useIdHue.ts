export function idHue(id: string): number {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}

export function hueBg(id: string): string {
  return `hsl(${idHue(id)} 60% 28%)`
}

export function hueFg(id: string): string {
  return `hsl(${idHue(id)} 70% 82%)`
}

export function hueColor(id: string): string {
  return `hsl(${idHue(id)} 60% 45%)`
}
