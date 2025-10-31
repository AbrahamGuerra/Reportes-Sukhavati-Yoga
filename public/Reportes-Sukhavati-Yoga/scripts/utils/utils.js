import { getToken } from '../api.js'

export async function uploadFile(file, type, socio, folio, dataInfo) {
  const fd = new FormData()
  fd.append('file', file)

  const token = (typeof getToken === 'function' ? getToken() : null) || localStorage.getItem('token') || ''
  const res = await fetch('/api/bucket/upload', {
    method: 'POST',
    headers: 
    { 
      Authorization: `Bearer ${token}`,
      documentyype: `${type}`,
      documentuser: `${socio}`,
      documentfolio: `${folio}`,
      documentdatainfo: `${dataInfo}`
    },
    body: fd,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.error('Upload error →', res.status, text)
    throw new Error(`Error subiendo archivo (${res.status})`)
  }
  return res.json()
}