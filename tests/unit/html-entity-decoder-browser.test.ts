// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { decodeHTMLStrict as browserDecode } from '@/lib/html-entity-decoder.browser'
import { decodeHTMLStrict as serverDecode } from '@/lib/html-entity-decoder.server'

describe('native browser entity decoding matches strict server decoding', () => {
  it.each([
    '&amp; &AMP; &quot; &apos; &lt; &gt; &nbsp;',
    '&NotEqualTilde; &CounterClockwiseContourIntegral; &Afr; &acE;',
    '&notit; &notin; &copycat; &ampere; &bogus; &amP;',
    '&amp &copy &#12 &#x12 &notit &;',
    '&#0; &#13; &#128; &#xD800; &#x110000; &#99999999;',
    '&#x1F600; &#X1f600; &#00038; &#000; &#abc; &#xnope;',
    '&amp;lt;p&amp;gt; &lt;img src=x onerror=alert(1)&gt;',
    'hello " \' <p>original markup</p> &quot; autofocus &quot;',
    '&notit;&notin;&notin;&notit;&amp;#38;',
    'literal prose with no entities',
  ])('preserves strict, single-pass decoding for %s', (input) => {
    expect(browserDecode(input)).toBe(serverDecode(input))
    expect(document.querySelector('img')).toBeNull()
  })

  it('keeps numeric-reference edge cases consistent beyond the small reference cache', () => {
    for (const codePoint of [0, 1, 9, 10, 13, ...Array.from({ length: 300 }, (_, index) => index + 32), 0xd800, 0xdfff, 0xffff, 0x10ffff, 0x110000]) {
      for (const input of [`&#${codePoint};`, `&#x${codePoint.toString(16)};`]) {
        expect(browserDecode(input)).toBe(serverDecode(input))
      }
    }
  })
})
