export async function readBufferedTextStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      if (value) {
        text += decoder.decode(value, { stream: true })
      }
    }

    text += decoder.decode()
    return text
  } finally {
    try {
      await reader.cancel()
    } catch {
    }
  }
}

export function createBufferedTextStream(text: string) {
  const encoder = new TextEncoder()

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text))
      controller.close()
    },
  })
}

export async function transformBufferedTextStream(
  stream: ReadableStream<Uint8Array>,
  transform: (value: string) => string
) {
  const text = await readBufferedTextStream(stream)
  return createBufferedTextStream(transform(text))
}
