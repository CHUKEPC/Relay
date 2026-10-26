/**
 * Which app icon is in use and handing it to the main process. The choice is
 * a setting (`appIcon`); the picture is drawn here and sent as a PNG.
 */
import { CUSTOM_APP_ICON, DEFAULT_APP_ICON, findIcon, ICON_PRESETS, type AppIconDef } from '@shared/app-icon'
import type { AppIconResult } from '@shared/ipc-contract'
import type { SettingsDoc } from '@shared/types'
import { useFeatures } from '../store/features'
import { useSettings } from '../store/settings'
import { useUserIcons } from '../store/user-icons'
import { appIconDataUrl } from './app-icon-render'

export const RELAY_ICON: AppIconDef = ICON_PRESETS[0]

/** The icon `settings` ask for; a pack icon whose pack is gone is redrawn from its saved copy. */
export function resolveAppIcon(settings: SettingsDoc): AppIconDef {
  const id = settings.appIcon || DEFAULT_APP_ICON
  if (id === CUSTOM_APP_ICON) return settings.customAppIcon ?? RELAY_ICON
  return findIcon(id, useFeatures.getState().icons, useUserIcons.getState().icons) ?? settings.appIconData ?? RELAY_ICON
}

/** True when the original icon is in use (nothing custom to show or send). */
export function isDefaultIcon(settings: SettingsDoc): boolean {
  return !settings.appIcon || settings.appIcon === DEFAULT_APP_ICON
}

/** Draw the current icon and put it on the windows (and the shortcuts, if chosen). */
export async function pushAppIcon(): Promise<AppIconResult> {
  const settings = useSettings.getState().settings
  try {
    const png = isDefaultIcon(settings) ? null : await appIconDataUrl(resolveAppIcon(settings))
    return await window.api.setAppIcon(png, !!settings.appIconShortcuts)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Use `icon` as the app icon. A built-in preset is remembered by id; a pack or
 * file icon also keeps a copy, so it survives its pack being switched off.
 */
export function chooseAppIcon(icon: AppIconDef): Promise<AppIconResult> {
  const builtIn = ICON_PRESETS.some((p) => p.id === icon.id)
  useSettings.getState().update({ appIcon: icon.id, appIconData: builtIn ? null : icon })
  return pushAppIcon()
}

/** Use the icon built in the editor. */
export function chooseCustomIcon(icon: AppIconDef): Promise<AppIconResult> {
  useSettings.getState().update({ appIcon: CUSTOM_APP_ICON, customAppIcon: { ...icon, id: CUSTOM_APP_ICON }, appIconData: null })
  return pushAppIcon()
}
