import { afterEach, describe, expect, it, vi } from 'vitest'
import { adjacentSection, sectionFromHash } from '../../apps/extension/src/features/settings/settingsNavigation'
import { openSettingsPage, settingsPageUrl } from '../../apps/extension/src/features/settings/openSettingsPage'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('settings navigation', () => {
  it('resolves direct sections and rejects unknown hashes', () => {
    expect(sectionFromHash('#profiles')).toBe('profiles')
    expect(sectionFromHash('#encryption')).toBe('encryption')
    expect(sectionFromHash('#unknown')).toBe('overview')
  })

  it('supports keyboard-style adjacent navigation with wrapping', () => {
    expect(adjacentSection('overview', 1)).toBe('setup')
    expect(adjacentSection('overview', -1)).toBe('general')
  })

  it('opens one canonical extension URL for a requested section', async () => {
    const create = vi.fn(async () => ({ id: 1 }))
    vi.stubGlobal('chrome', {
      runtime: { getURL: (path: string) => `chrome-extension://synthetic/${path}` },
      tabs: { create }
    })

    expect(settingsPageUrl('documents')).toBe('chrome-extension://synthetic/settings.html#documents')
    await openSettingsPage('providers')
    expect(create).toHaveBeenCalledWith({ url: 'chrome-extension://synthetic/settings.html#providers' })
  })
})
