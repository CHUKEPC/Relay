import { useEffect, useState } from 'react'
import { Icon } from '@renderer/components/Icon'
import { importDroppedFiles } from '@renderer/lib/file-drop'
import { tr } from '@renderer/lib/i18n'

/** Only a drag that carries files from the OS — tabs and requests use their own types. */
function carriesFiles(e: DragEvent): boolean {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')
}

/**
 * Drop files from Explorer / Finder anywhere on the window to import them.
 * Internal drags (tabs, requests into panes) are left alone: they never carry
 * the `Files` type.
 */
export function FileDropZone(): JSX.Element | null {
  const [active, setActive] = useState(false)

  useEffect(() => {
    // dragenter/dragleave fire for every child crossed; count to know when the
    // pointer really left the window.
    let depth = 0
    const enter = (e: DragEvent): void => {
      if (!carriesFiles(e)) return
      e.preventDefault()
      depth++
      setActive(true)
    }
    const over = (e: DragEvent): void => {
      if (!carriesFiles(e)) return
      // Without this the drop never fires and Chromium opens the file instead.
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const leave = (e: DragEvent): void => {
      if (!carriesFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setActive(false)
    }
    const drop = (e: DragEvent): void => {
      if (!carriesFiles(e)) return
      e.preventDefault()
      depth = 0
      setActive(false)
      void importDroppedFiles(Array.from(e.dataTransfer?.files ?? []))
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [])

  if (!active) return null
  return (
    <div className="file-drop-overlay" aria-hidden="true">
      <div className="file-drop-card">
        <Icon name="download" size={26} />
        <div className="file-drop-title">{tr('Отпустите, чтобы импортировать')}</div>
        <div className="file-drop-sub">
          {tr('Коллекции Postman и Insomnia, OpenAPI / Swagger, HAR, cURL, окружения и глобальные переменные Postman, .env и CSV, темы Relay')}
        </div>
      </div>
    </div>
  )
}
