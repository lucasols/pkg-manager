export const PRERELEASE_TAGS = ['alpha', 'beta', 'rc'] as const
export type PrereleaseTag = (typeof PRERELEASE_TAGS)[number]

export type ParsedVersion = {
  major: number
  minor: number
  patch: number
  prerelease: { tag: string; number: number } | undefined
}

export function parseVersion(version: string): ParsedVersion {
  const [core, prereleaseStr] = version.split('-')

  const parts = (core ?? '').split('.').map(Number)
  const major = parts[0] ?? 0
  const minor = parts[1] ?? 0
  const patch = parts[2] ?? 0

  if (prereleaseStr) {
    const lastDotIndex = prereleaseStr.lastIndexOf('.')
    if (lastDotIndex !== -1) {
      const tag = prereleaseStr.slice(0, lastDotIndex)
      const num = Number(prereleaseStr.slice(lastDotIndex + 1))
      return { major, minor, patch, prerelease: { tag, number: num } }
    }
    return { major, minor, patch, prerelease: { tag: prereleaseStr, number: 0 } }
  }

  return { major, minor, patch, prerelease: undefined }
}

export function formatVersion(parsed: ParsedVersion): string {
  const base = `${parsed.major}.${parsed.minor}.${parsed.patch}`
  if (parsed.prerelease) {
    return `${base}-${parsed.prerelease.tag}.${parsed.prerelease.number}`
  }
  return base
}

export function isPrerelease(version: string): boolean {
  return version.includes('-')
}

export function getPrereleaseTag(version: string): string | undefined {
  return parseVersion(version).prerelease?.tag
}

/**
 * Returns prerelease tags that come after the given tag in the progression.
 * alpha → [beta, rc], beta → [rc], rc → []
 * Unknown tags → all PRERELEASE_TAGS
 */
export function getNextTags(currentTag: string): PrereleaseTag[] {
  const index = PRERELEASE_TAGS.findIndex((t) => t === currentTag)
  if (index === -1) return [...PRERELEASE_TAGS]
  return [...PRERELEASE_TAGS.slice(index + 1)]
}

/**
 * Computes the resulting version string for a given bump operation.
 * Used for displaying hints in the version select UI.
 */
export function bumpVersionPreview(
  version: string,
  type: 'patch' | 'minor' | 'major' | 'prepatch' | 'preminor' | 'premajor' | 'prerelease' | 'release',
  preid?: string,
): string {
  const parsed = parseVersion(version)

  switch (type) {
    case 'patch': {
      if (parsed.prerelease) {
        return `${parsed.major}.${parsed.minor}.${parsed.patch}`
      }
      return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`
    }
    case 'minor': {
      if (parsed.prerelease && parsed.patch === 0) {
        return `${parsed.major}.${parsed.minor}.0`
      }
      return `${parsed.major}.${parsed.minor + 1}.0`
    }
    case 'major': {
      if (parsed.prerelease && parsed.minor === 0 && parsed.patch === 0) {
        return `${parsed.major}.0.0`
      }
      return `${parsed.major + 1}.0.0`
    }
    case 'prepatch': {
      const tag = preid ?? 'alpha'
      return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}-${tag}.0`
    }
    case 'preminor': {
      const tag = preid ?? 'alpha'
      return `${parsed.major}.${parsed.minor + 1}.0-${tag}.0`
    }
    case 'premajor': {
      const tag = preid ?? 'alpha'
      return `${parsed.major + 1}.0.0-${tag}.0`
    }
    case 'prerelease': {
      if (parsed.prerelease) {
        if (preid && preid !== parsed.prerelease.tag) {
          return `${parsed.major}.${parsed.minor}.${parsed.patch}-${preid}.0`
        }
        return `${parsed.major}.${parsed.minor}.${parsed.patch}-${parsed.prerelease.tag}.${parsed.prerelease.number + 1}`
      }
      const tag = preid ?? 'alpha'
      return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}-${tag}.0`
    }
    case 'release': {
      return `${parsed.major}.${parsed.minor}.${parsed.patch}`
    }
  }
}
