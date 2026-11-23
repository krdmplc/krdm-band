// fetch() for the app's own API. Errors carry the API's code ("out_of_stock") so
// pages can say what went wrong in the reader's language; no connection at all
// is the code "offline".

export class ApiError extends Error {
  constructor (public code: string, public status: number, public detail?: unknown) {
    super(code)
  }
}

async function request<T> (method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body instanceof FormData || body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body)
    })
  } catch {
    throw new ApiError('offline', 0)
  }
  if (!res.ok) {
    let code = 'server_error'
    let detail: unknown
    try {
      const json = await res.json() as { error?: string, detail?: unknown }
      code = json.error ?? code
      detail = json.detail
    } catch { /* not JSON */ }
    if (res.status === 401) window.dispatchEvent(new Event('merch:signed-out'))
    throw new ApiError(code, res.status, detail)
  }
  return await res.json() as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, form)
}

export const imageUrl = (key: string) => `/images/${key}`
