import { afterEach, describe, expect, it, vi } from 'vitest'
import { countChineseFriendlyWords, createUuid, htmlToPlainText, normalizeLegacySingleParagraphHtml, plainTextLinesToHtml, plainTextToHtml } from '@/lib/utils'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('htmlToPlainText', () => {
  it('decodes named entities before counting prose', () => {
    const text = htmlToPlainText('<p>She said &quot;go&quot; &amp; left &lt;quietly&gt;</p>')
    expect(text).toBe('She said "go" & left <quietly>')
    expect(countChineseFriendlyWords(text)).toBe(25)
  })

  it('supports numeric and named HTML references consistently on the server', () => {
    expect(htmlToPlainText('<p>&#65;&#x1F600; &apos;x&apos; &copy;&nbsp;2026</p>')).toBe("A😀 'x' © 2026")
  })

  it('decodes once after stripping markup and preserves literal encoded tags', () => {
    expect(htmlToPlainText('<p>&lt;p&gt;literal&lt;/p&gt; &amp;lt;tag&amp;gt;</p>')).toBe('<p>literal</p> &lt;tag&gt;')
  })

  it('handles invalid Unicode references without throwing and leaves unknown entities intact', () => {
    expect(htmlToPlainText('<p>&#99999999; &#xD800; &#0; &#abc; &unknown;</p>')).toBe('� � � &#abc; &unknown;')
  })

  it('preserves paragraph and line-break separation', () => {
    expect(htmlToPlainText('<p>a &amp; b<br>c</p><p>d</p>')).toBe('a & b\nc\n\n d')
  })

  it.each([plainTextToHtml, plainTextLinesToHtml])('escapes decoded prose when writing it back to chapter HTML', (toHtml) => {
    const text = 'A & B <img src=x onerror=alert(1)> &lt;literal&gt;'
    const html = toHtml(text)
    expect(html).not.toContain('<img')
    expect(htmlToPlainText(html)).toBe(text)
  })

  it('preserves entities when normalizing legacy line-break paragraphs', () => {
    expect(normalizeLegacySingleParagraphHtml('<p>first<br>A &amp; B<br>&lt;C&gt;</p>'))
      .toBe('<p>first</p><p>A &amp; B</p><p>&lt;C&gt;</p>')
  })
})

describe('createUuid', () => {
  it('uses crypto.randomUUID when the browser exposes it', () => {
    const randomUUID = vi.fn(() => '123e4567-e89b-42d3-a456-426614174000')
    vi.stubGlobal('crypto', { randomUUID })

    expect(createUuid()).toBe('123e4567-e89b-42d3-a456-426614174000')
    expect(randomUUID).toHaveBeenCalledOnce()
  })

  it('creates an RFC 4122 version 4 UUID when randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(0xab)
        return bytes
      },
    })

    expect(createUuid()).toBe('abababab-abab-4bab-abab-abababababab')
  })
})
