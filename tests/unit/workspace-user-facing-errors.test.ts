import { describe, expect, it } from 'vitest'
import { getMessage, type Locale, type TranslationKey } from '@/lib/i18n/messages'
import {
  redactUserFacingDiagnostic,
  resolveWorkspaceUserFacingError,
  toUserFacingPresetCompatError,
  toUserFacingWorkspaceError,
  type WorkspaceErrorOperation,
} from '@/lib/workspace-user-facing-errors'

const locales: Locale[] = ['zh', 'en']

const approvedMappings = [
  ['preset_not_found', 'errors.preset_not_found'],
  ['standalone_regex_not_found', 'errors.standalone_regex_not_found'],
  ['builtin_system_prompt_not_found', 'errors.builtin_system_prompt_not_found'],
  ['load_failed', 'errors.load_failed'],
  ['revision_mismatch', 'errors.revision_mismatch'],
  ['invalid_import_kind', 'errors.invalid_import_kind'],
  ['Failed to load preset compat library', 'errors.failedLoadPresetCompatLibrary'],
  ['Failed to save preset compat library', 'errors.failedSavePresetCompatLibrary'],
  ['Refusing to overwrite a recoverable workspace with an empty payload', 'errors.refuseOverwriteWorkspace'],
  ['Workspace restore timed out', 'errors.workspaceRestoreTimedOut'],
  ['Failed to restore workspace', 'errors.failedRestoreWorkspace'],
  ['Workspace endpoint returned invalid JSON', 'errors.workspaceInvalidJson'],
  ['Failed to load AI settings', 'errors.failedLoadAISettings'],
  ['Failed to save AI settings', 'errors.failedSaveAISettings'],
  ['Continue block load failed', 'errors.continueBlockLoadFailed'],
  ['Roleplay session load failed', 'errors.roleplaySessionLoadFailed'],
  ['Roleplay message append failed', 'errors.roleplayMessageAppendFailed'],
  ['Roleplay variant creation failed', 'errors.roleplayVariantCreationFailed'],
  ['Roleplay streaming request failed', 'errors.roleplayStreamingRequestFailed'],
  ['Roleplay streaming response body is empty', 'errors.roleplayStreamingResponseEmpty'],
  ['What-if session load failed', 'errors.whatIfSessionLoadFailed'],
  ['Future jump run load failed', 'errors.futureJumpRunLoadFailed'],
  ['Future jump revise failed', 'errors.futureJumpReviseFailed'],
] satisfies ReadonlyArray<readonly [string, TranslationKey]>

const unknownDiagnostics: unknown[] = [
  new Error('DatabaseError: no such table\n    at loadWorkspace (/srv/app/workspace.ts:42:9)'),
  'SELECT * FROM workspaces WHERE path = "/Users/example/private.db"',
  '/Users/example/secret/workspace.json',
  '<html><body>502 Bad Gateway</body></html>',
  '{"error":"provider rejected the request","apiKey":"secret"}',
  'Temporary upstream failure',
  '',
  '   ',
  { error: 'nested raw diagnostic' },
  503,
  null,
  undefined,
]

describe('user-facing diagnostic redaction', () => {
  it.each([
    ['Authorization bearer header', 'Authorization: Bearer secret-value', 'secret-value'],
    ['Authorization basic header', 'Authorization: Basic dXNlcjpwYXNz', 'dXNlcjpwYXNz'],
    ['JSON Authorization basic value', '{"Authorization":"Basic anNvbi11c2VyOnBhc3M="}', 'anNvbi11c2VyOnBhc3M='],
    ['quoted Authorization basic value', 'Authorization: "Basic cXVvdGVkLXVzZXI6cGFzcw=="', 'cXVvdGVkLXVzZXI6cGFzcw=='],
    ['standalone bearer token', 'Bearer raw-token-value', 'raw-token-value'],
    ['API key', 'api_key=sk-private', 'sk-private'],
    ['generic token', 'token: token-private', 'token-private'],
    ['generic secret', 'secret=hidden-secret', 'hidden-secret'],
    ['password', 'password: hidden-password', 'hidden-password'],
    ['AWS secret access key', 'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'],
    ['client secret', '{"client_secret":"oauth-client-secret"}', 'oauth-client-secret'],
    ['Set-Cookie session', 'Set-Cookie: session=set-cookie-secret; Path=/; HttpOnly', 'set-cookie-secret'],
    ['Cookie session', 'Cookie: session=cookie-secret; theme=dark', 'cookie-secret'],
    ['session key', 'session_token=session-token-secret', 'session-token-secret'],
    ['private key property', '{"private_key":"escaped-private-key-material"}', 'escaped-private-key-material'],
    ['PEM private key', '-----BEGIN PRIVATE KEY-----\nprivate-key-material\n-----END PRIVATE KEY-----', 'private-key-material'],
    ['URL userinfo', 'https://alice:password@example.com/v1', 'alice:password'],
    ['URL userinfo with at-sign password', 'https://alice:p@ss@word@example.com/v1', 'alice:p@ss@word'],
    ['URL username-only userinfo', 'https://api-token-value@example.com/v1', 'api-token-value'],
    ['inline file URL', 'Cannot load file:///Users/alice/project/private-config.json', '/Users/alice/project/private-config.json'],
    ['macOS user path', '/Users/alice/private/workspace.json', '/Users/alice'],
    ['Linux home path', '/home/alice/private/workspace.json', '/home/alice'],
    ['service path', '/srv/app/private/workspace.json', '/srv/app'],
    ['root path', '/root/.config/provider.json', '/root/.config'],
    ['container app path', '/app/runtime/provider.log', '/app/runtime'],
    ['workspace path', '/workspace/project/provider.log', '/workspace/project'],
    ['mount path', '/mnt/data/provider.log', '/mnt/data'],
    ['Windows drive path', 'C:\\Users\\Alice\\private.txt', 'C:\\Users'],
    ['Windows UNC path', '\\\\fileserver\\private-share\\provider.log', '\\\\fileserver\\private-share'],
    ['Node stack frame', 'Error: failed\n    at run (/Users/alice/app.ts:42:9)', 'app.ts:42:9'],
    ['OpenAI token', 'OpenAI rejected sk-proj-1234567890abcdef', 'sk-proj-1234567890abcdef'],
    ['GitHub token', 'GitHub rejected ghp_1234567890abcdefghijklmnopqrstuv', 'ghp_1234567890abcdefghijklmnopqrstuv'],
    ['GitHub fine-grained token', 'GitHub rejected github_pat_11AA22BB33CC44DD55EE66FF77GG88HH', 'github_pat_11AA22BB33CC44DD55EE66FF77GG88HH'],
    ['AWS access key ID', 'AWS rejected AKIAIOSFODNN7EXAMPLE', 'AKIAIOSFODNN7EXAMPLE'],
  ])('redacts %s', (_name, diagnostic, secret) => {
    const result = redactUserFacingDiagnostic(diagnostic)
    expect(result).not.toContain(secret)
    expect(result).toMatch(/\[REDACTED\]|\[local path\]|Error: failed/)
    expect(redactUserFacingDiagnostic(result)).toBe(result)
  })

  it.each([
    [
      'mixed-encoded HTTP query POSIX path',
      'https://host?path=%2FUsers/alice/private.json',
      'https://host?path=[local path]',
      '/alice/private.json',
    ],
    [
      'mixed-encoded HTTP fragment Windows path',
      'https://host#file=C%3A%5CUsers\\Alice\\private.txt',
      'https://host#file=[local path]',
      '\\Alice\\private.txt',
    ],
    [
      'literal-drive encoded-separator HTTP fragment path',
      'https://host#x=C:%5CUsers%5CAlice%5Cprivate.txt',
      'https://host#x=[local path]',
      '%5CUsers%5CAlice%5Cprivate.txt',
    ],
    [
      'encoded file URL HTTP query path',
      'https://host?x=file%3A%2F%2F%2FUsers%2Falice%2Fprivate.db',
      'https://host?x=[local path]',
      '%2FUsers%2Falice%2Fprivate.db',
    ],
    [
      'HTTP query path after ampersand',
      'https://host?ok=1&/Users/alice/private.txt',
      'https://host?ok=1&[local path]',
      '/Users/alice/private.txt',
    ],
    [
      'standalone fully encoded POSIX path',
      'path=%2FUsers%2Falice%2Fprivate.json',
      'path=[local path]',
      '%2FUsers%2Falice%2Fprivate.json',
    ],
    [
      'standalone fully encoded Windows path',
      'file=C%3A%5CUsers%5CAlice%5Cprivate.txt',
      'file=[local path]',
      'C%3A%5CUsers%5CAlice%5Cprivate.txt',
    ],
    [
      'standalone fully encoded file URL',
      'x=file%3A%2F%2F%2FUsers%2Falice%2Fprivate.db',
      'x=[local path]',
      'file%3A%2F%2F%2FUsers%2Falice%2Fprivate.db',
    ],
    [
      'standalone mixed-encoded POSIX path',
      'path=%2FUsers/alice/private.json',
      'path=[local path]',
      '/alice/private.json',
    ],
    [
      'standalone mixed-encoded Windows path',
      'file=C%3A%5CUsers\\Alice\\private.txt',
      'file=[local path]',
      '\\Alice\\private.txt',
    ],
    [
      'standalone mixed-encoded file URL',
      'x=file%3A%2F%2F%2FUsers/alice/private.db',
      'x=[local path]',
      '/alice/private.db',
    ],
    [
      'fully encoded POSIX path after question mark',
      '?%2FUsers%2Falice%2Fprivate.json',
      '?[local path]',
      '%2FUsers%2Falice%2Fprivate.json',
    ],
    [
      'fully encoded Windows path after fragment marker',
      '#C%3A%5CUsers%5CAlice%5Cprivate.txt',
      '#[local path]',
      'C%3A%5CUsers%5CAlice%5Cprivate.txt',
    ],
    [
      'fully encoded file URL after ampersand',
      '&file%3A%2F%2F%2FUsers%2Falice%2Fprivate.db',
      '&[local path]',
      'file%3A%2F%2F%2FUsers%2Falice%2Fprivate.db',
    ],
    [
      'mixed-encoded POSIX path after question mark',
      '?%2FUsers/alice/private.json',
      '?[local path]',
      '/alice/private.json',
    ],
    [
      'mixed-encoded Windows path after fragment marker',
      '#C%3A%5CUsers\\Alice\\private.txt',
      '#[local path]',
      '\\Alice\\private.txt',
    ],
    [
      'mixed-encoded file URL after ampersand',
      '&file%3A%2F%2F%2FUsers/alice/private.db',
      '&[local path]',
      '/alice/private.db',
    ],
  ])('redacts the complete %s token', (_name, diagnostic, expected, leakedSuffix) => {
    const result = redactUserFacingDiagnostic(diagnostic)
    expect(result).toBe(expected)
    expect(result).not.toContain(leakedSuffix)
    expect(redactUserFacingDiagnostic(result)).toBe(result)
  })

  it.each([
    ['plain combined Authorization', 'Authorization: Basic first-secret, Bearer second-secret', ['first-secret', 'second-secret']],
    ['JSON combined Authorization', '{"Authorization":"Basic first-secret, Bearer second-secret","status":"failed"}', ['first-secret', 'second-secret']],
    ['JSON array Authorization', '{"Authorization":["Basic first-secret","Bearer second-secret"],"status":"failed"}', ['first-secret', 'second-secret']],
    ['tuple Authorization', '[["Authorization","Basic first-secret, Bearer second-secret"]]', ['first-secret', 'second-secret']],
    ['map arrow Authorization', '"Authorization" => "Basic arrow-secret"', ['arrow-secret']],
    ['map arrow token array', '"token" => ["first-secret","second-secret"]', ['first-secret', 'second-secret']],
    ['normalized X-API-Key', '{"X-API-Key":"x-api-secret"}', ['x-api-secret']],
    ['normalized X-Client-Key', '{"X-Client-Key":"x-client-secret"}', ['x-client-secret']],
    ['prefixed Proxy-Authorization', 'Proxy-Authorization: Bearer proxy-secret', ['proxy-secret']],
    ['quoted API Key with space', '{"API Key":"spaced-key-secret"}', ['spaced-key-secret']],
    ['quoted connect.sid key', '{"connect.sid":"connect-session-secret"}', ['connect-session-secret']],
    ['unquoted API Key with space', 'API Key: spaced-secret', ['spaced-secret']],
    ['unquoted Client Key with space', 'Client Key = client-secret', ['client-secret']],
    ['unquoted connect.sid equals', 'connect.sid=session-secret', ['session-secret']],
    ['unquoted connect.sid colon', 'connect.sid: secret', ['secret']],
    ['prefixed unquoted connect.sid', 'session.connect.sid=secret', ['secret']],
    ['unquoted session.id', 'session.id=session-id-secret', ['session-id-secret']],
    ['bracket Authorization assignment', 'headers["Authorization"] = "bracket-secret"', ['bracket-secret']],
    ['passwd alias', 'passwd=passwd-secret', ['passwd-secret']],
    ['passphrase alias array', '{"passphrase":["first-secret","second-secret"]}', ['first-secret', 'second-secret']],
    ['escaped serialized API key', '{\\"apiKey\\":\\"escaped-json-secret\\"}', ['escaped-json-secret']],
    ['plain combined Cookie', 'Cookie: session=first-secret, refresh=second-secret', ['first-secret', 'second-secret']],
    ['JSON array Cookie', '{"Cookie":["session=first-secret","refresh=second-secret"]}', ['first-secret', 'second-secret']],
    ['tuple Set-Cookie', '[["Set-Cookie",["session=first-secret","refresh=second-secret"]]]', ['first-secret', 'second-secret']],
    ['generic token array', '{"token":["first-secret","second-secret"]}', ['first-secret', 'second-secret']],
    ['generic secret object', '{"client_secret":{"primary":"first-secret","fallback":"second-secret"}}', ['first-secret', 'second-secret']],
    ['equal-sign API key object', 'api_key={"primary":"first-secret","fallback":"second-secret"}', ['first-secret', 'second-secret']],
    ['tuple session object', '[["session",{"primary":"first-secret","fallback":"second-secret"}]]', ['first-secret', 'second-secret']],
  ])('redacts the complete %s value', (_name, diagnostic, secrets) => {
    const result = redactUserFacingDiagnostic(diagnostic)
    for (const secret of secrets) expect(result).not.toContain(secret)
    expect(result).toContain('[REDACTED]')
    expect(redactUserFacingDiagnostic(result)).toBe(result)
  })

  it.each([
    ['POSIX path with spaces', 'Cannot load "/usr/local/My App/private config.json"', '/usr/local/My App/private config.json'],
    ['data-root path with spaces', 'Cannot load "/data/Novel Files/private index.db"', '/data/Novel Files/private index.db'],
    ['Library path with spaces', 'Cannot load /Library/Application Support/Retale/private.db', '/Library/Application Support/Retale/private.db'],
    ['generic-root path with spaces', 'Cannot load "/custom-root/Private Files/config.json"', '/custom-root/Private Files/config.json'],
    ['Windows drive path with spaces', 'Cannot load "C:\\Program Files\\Retale\\private config.json"', 'C:\\Program Files\\Retale\\private config.json'],
    ['UNC path with spaces', 'Cannot load "\\\\fileserver\\Shared Folder\\private config.json"', '\\\\fileserver\\Shared Folder\\private config.json'],
    ['forward network path with spaces', 'Cannot load //fileserver/Shared Folder/private config.json', '//fileserver/Shared Folder/private config.json'],
    ['file URL path with spaces', 'Cannot load "file:///Users/alice/My Project/private config.json"', '/Users/alice/My Project/private config.json'],
    ['backtick POSIX path', 'Cannot load `/usr/local/My App/private config.json`', '/usr/local/My App/private config.json'],
    ['backtick Windows path', 'Cannot load `C:\\Program Files\\Retale\\private config.json`', 'C:\\Program Files\\Retale\\private config.json'],
    ['backtick UNC path', 'Cannot load `\\\\fileserver\\Shared Folder\\private config.json`', '\\\\fileserver\\Shared Folder\\private config.json'],
    ['backtick file URL', 'Cannot load `file:///Library/Application Support/Retale/private config.json`', '/Library/Application Support/Retale/private config.json'],
    ['home-relative path', 'Cannot load ~/Private Folder/config.json', '~/Private Folder/config.json'],
    ['current-relative path', 'Cannot load ./Private Folder/config.json', './Private Folder/config.json'],
    ['parent-relative path', 'Cannot load ../Private Folder/config.json', '../Private Folder/config.json'],
    ['angle POSIX path', 'Cannot load </usr/local/My App/config.json>', '/usr/local/My App/config.json'],
    ['angle Windows path', 'Cannot load <C:\\Program Files\\Retale\\config.json>', 'C:\\Program Files\\Retale\\config.json'],
    ['angle UNC path', 'Cannot load <\\\\fileserver\\Shared Folder\\config.json>', '\\\\fileserver\\Shared Folder\\config.json'],
    ['localhost file URL', 'Cannot load file://localhost/Users/alice/My Project/config.json', 'localhost/Users/alice/My Project/config.json'],
    ['Windows file URL', 'Cannot load file://C:/Program Files/Retale/config.json', 'C:/Program Files/Retale/config.json'],
    ['HTTP query POSIX path', 'https://example.com/download?path=/Users/alice/private/config.json', '/Users/alice/private/config.json'],
    ['HTTPS fragment Windows path', 'https://example.com/view#file=C:\\Users\\Alice\\private.txt', 'C:\\Users\\Alice\\private.txt'],
    ['bare HTTP query POSIX path', 'https://host?/Users/alice/private.txt', '/Users/alice/private.txt'],
    ['bare HTTP fragment POSIX path', 'https://host#/Users/alice/private.txt', '/Users/alice/private.txt'],
    ['bare fragment Windows path', '#C:\\Users\\Alice\\private.txt', 'C:\\Users\\Alice\\private.txt'],
    ['percent-encoded HTTP query POSIX path', 'https://host?path=%2FUsers%2Falice%2Fprivate.json', '%2FUsers%2Falice%2Fprivate.json'],
    ['percent-encoded HTTP fragment Windows path', 'https://host#file=C%3A%5CUsers%5CAlice%5Cprivate.txt', 'C%3A%5CUsers%5CAlice%5Cprivate.txt'],
  ])('redacts the complete %s', (_name, diagnostic, path) => {
    const result = redactUserFacingDiagnostic(diagnostic)
    expect(result).not.toContain(path)
    expect(result).toContain('[local path]')
    expect(redactUserFacingDiagnostic(result)).toBe(result)
  })

  it.each([
    ['POSIX path list', 'Paths: /Users/alice/first.json,/workspace/private/second.json', ['/Users/alice/first.json', '/workspace/private/second.json']],
    ['Windows path list', 'Paths: C:\\Users\\Alice\\first.txt;D:\\Private\\second.txt', ['C:\\Users\\Alice\\first.txt', 'D:\\Private\\second.txt']],
    ['UNC path list', 'Paths: \\\\server\\share\\first.txt,\\\\backup\\private\\second.txt', ['\\\\server\\share\\first.txt', '\\\\backup\\private\\second.txt']],
  ])('redacts every entry in a %s', (_name, diagnostic, paths) => {
    const result = redactUserFacingDiagnostic(diagnostic)
    for (const path of paths) expect(result).not.toContain(path)
    expect(result.match(/\[local path\]/g)).toHaveLength(2)
    expect(redactUserFacingDiagnostic(result)).toBe(result)
  })

  it.each([
    [
      'Python',
      'Traceback (most recent call last):\n  File "/Users/alice/project/worker.py", line 10, in run\nRuntimeError: provider failed',
      'Traceback (most recent call last):\nRuntimeError: provider failed',
    ],
    [
      'Java',
      'ProviderException: request failed\n    at com.example.ProviderClient.send(ProviderClient.java:42)',
      'ProviderException: request failed',
    ],
    [
      'Java module-qualified',
      'ProviderException: request failed\n    at java.base/java.lang.Thread.run(Thread.java:840)',
      'ProviderException: request failed',
    ],
    [
      '.NET',
      'ProviderException: request failed\n   at Example.ProviderClient.Send() in C:\\workspace\\ProviderClient.cs:line 42',
      'ProviderException: request failed',
    ],
    [
      'Ruby',
      'ProviderError: request failed\n    from /app/provider_client.rb:42:in `send_request`',
      'ProviderError: request failed',
    ],
  ])('removes %s stack frames while preserving exception context', (_format, diagnostic, expected) => {
    expect(redactUserFacingDiagnostic(diagnostic)).toBe(expected)
  })

  it.each([
    'Embedding provider timed out while calling /api/knowledge-view; retry is available.',
    'Embedding coverage remains 0 / 64 chapters.',
    'Provider docs are available at https://example.com/api/knowledge-view.',
    'Local service returned http://localhost:3000/api/knowledge-view.',
    'Provider link remains https://example.com/search?next=/api/knowledge-view&ratio=0/64.',
    'Encoded context remains https://example.com/search?q=hello%20world&ratio=0%2F64&next=%2Fapi%2Fknowledge-view.',
    'Mixed encoding remains https://host?note=hello%20world/docs&next=%2Fapi/knowledge-view&ratio=0%2F64/items.',
    'Encoded labels remain https://host?time=12:%30%30&label=profile%3A%2Fdocs.',
    'Query delimiters remain https://host?ok=1&next=/api/knowledge-view&ratio=0/64.',
    'Standalone encoding remains note=hello%20world/docs next=%2Fapi%2Fknowledge-view ratio=0%2F64.',
    'Bare delimiters remain ?hello%20world/docs #profile%3A%2Fdocs &0%2F64.',
    'Benign labels remain API status: ready; Client count = 2; connection.idle=true.',
  ])('preserves benign context in %s', (diagnostic) => {
    expect(redactUserFacingDiagnostic(diagnostic)).toBe(diagnostic)
  })

  it('redacts truncated private key PEM content through EOF', () => {
    const diagnostic = 'Provider failed\n-----BEGIN RSA PRIVATE KEY-----\ntruncated-private-material'
    const result = redactUserFacingDiagnostic(diagnostic)
    expect(result).toBe('Provider failed\n[REDACTED]')
    expect(redactUserFacingDiagnostic(result)).toBe(result)
  })

  it.each([
    ['Stripe', 'sk_live_1234567890ABCDEF'],
    ['Google', 'AIza1234567890abcdefghijkl'],
    ['Slack', 'xoxb-1234567890abcdefghijkl'],
    ['GitLab', 'glpat-1234567890abcdef'],
    ['npm', 'npm_1234567890abcdef'],
    ['GitHub OAuth', 'gho_1234567890abcdefghijkl'],
    ['GitHub server', 'ghs_1234567890abcdefghijkl'],
    ['AWS temporary access key', 'ASIAIOSFODNN7EXAMPLE'],
    ['Stripe restricted', 'rk_live_1234567890ABCDEF'],
    ['Stripe webhook', 'whsec_1234567890ABCDEF'],
    ['Google OAuth', 'ya29.1234567890abcdefghijkl'],
    ['Slack app', 'xapp-1234567890abcdefghijkl'],
    ['GitLab runner', 'glrt-1234567890abcdef'],
    ['JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwxYZ0123456789_-'],
  ])('redacts high-confidence %s tokens without labels', (_provider, token) => {
    const result = redactUserFacingDiagnostic(`Provider rejected ${token}`)
    expect(result).not.toContain(token)
    expect(result).toContain('[REDACTED]')
    expect(redactUserFacingDiagnostic(result)).toBe(result)
  })

  it('preserves benign credential prefixes', () => {
    const diagnostic = 'The docs mention sk-short, ghp_example, github_pat_format, AKIA, sk_live_example, AIza-example, xoxb-example, glpat-example, npm_example, gho_example, ghs_example, ASIA, rk_live_example, whsec_example, ya29.example, xapp-example, glrt-example, and eyJ.short.signature.'
    expect(redactUserFacingDiagnostic(diagnostic)).toBe(diagnostic)
  })

  it('bounds output and remains idempotent', () => {
    const diagnostic = `Embedding provider timed out token=private ${'x'.repeat(2_000)}`
    const once = redactUserFacingDiagnostic(diagnostic)
    expect(once.length).toBeLessThanOrEqual(1_000)
    expect(once).toContain('Embedding provider timed out')
    expect(once).not.toContain('private')
    expect(redactUserFacingDiagnostic(once)).toBe(once)
  })
})

describe('workspace user-facing errors', () => {
  it.each(locales)('preserves safe model failures across all writing operations in %s', (locale) => {
    const operations: WorkspaceErrorOperation[] = ['context-preview', 'rewrite-create', 'rewrite-job-failed', 'what-if-create', 'roleplay-send', 'roleplay-regenerate', 'roleplay-stream', 'future-jump-create', 'future-jump-revise']
    for (const operation of operations) {
      const message = resolveWorkspaceUserFacingError(operation, new Error('HTTP 400: maximum context length is 200000 tokens, requested 235000 tokens. api_key=sk-secret-value'), locale)
      expect(message).toContain('HTTP 400')
      expect(message).toContain('maximum context length is 200000 tokens, requested 235000 tokens')
      expect(message).toContain(getMessage(locale, 'errors.contextWindowExceeded'))
      expect(message).not.toContain('sk-secret-value')
    }
  })

  it.each(['context_length_exceeded', 'prompt is too long: 210000 tokens > 200000 maximum', '输入长度超过模型上限', '上下文过长'])('recognizes context overflow: %s', (detail) => {
    expect(resolveWorkspaceUserFacingError('rewrite-job-failed', detail)).toContain('高级上下文')
  })

  it.each(['HTTP 401: Invalid API key', 'HTTP 429: tokens per minute limit exceeded', 'Provider request timed out after 300000ms', 'fetch failed'])('keeps other failures without a misleading compression instruction: %s', (detail) => {
    const message = resolveWorkspaceUserFacingError('roleplay-stream', detail)
    expect(message).toContain(detail)
    expect(message).not.toContain('高级上下文')
  })

  it('preserves token counts without revealing authentication tokens', () => {
    const message = redactUserFacingDiagnostic('max_tokens: 200000, input_tokens: 235000, access_token: secret-value')
    expect(message).toContain('max_tokens: 200000')
    expect(message).toContain('input_tokens: 235000')
    expect(message).not.toContain('secret-value')
    expect(redactUserFacingDiagnostic('tokens: ["secret-value"]')).not.toContain('secret-value')
  })

  it.each(locales)('uses the operation fallback for unknown diagnostics in %s', (locale) => {
    const operation: WorkspaceErrorOperation = 'chapter-graph-load'
    const fallback = getMessage(locale, 'workspace.chapterGraph.loadFailed')

    for (const diagnostic of unknownDiagnostics) {
      expect(resolveWorkspaceUserFacingError(operation, diagnostic, locale)).toBe(fallback)
    }
  })

  it.each(locales)('preserves approved exact mappings for Error and string values in %s', (locale) => {
    const expected = getMessage(locale, 'errors.workspaceRestoreTimedOut')

    expect(resolveWorkspaceUserFacingError('chapter-graph-load', new Error(' Workspace restore timed out '), locale)).toBe(expected)
    expect(resolveWorkspaceUserFacingError('chapter-graph-load', ' Workspace restore timed out ', locale)).toBe(expected)
  })

  it.each(locales)('preserves every approved exact-message mapping in %s', (locale) => {
    for (const [message, key] of approvedMappings) {
      expect(resolveWorkspaceUserFacingError('workspace-restore', message, locale)).toBe(getMessage(locale, key))
    }
  })

  it.each(locales)('sanitizes unknown values through the legacy workspace helper in %s', (locale) => {
    expect(toUserFacingWorkspaceError(new Error('private stack trace'), locale)).toBe(
      getMessage(locale, 'errors.failedRestoreWorkspace')
    )
  })

  it.each(locales)('uses operation-specific preset compatibility fallbacks for unknown diagnostics in %s', (locale) => {
    expect(toUserFacingPresetCompatError('load', 'preset provider detail', locale)).toBe(
      getMessage(locale, 'errors.failedLoadPresetCompatLibrary')
    )
    expect(toUserFacingPresetCompatError('save', new Error('/private/preset-library.json'), locale)).toBe(
      getMessage(locale, 'errors.failedSavePresetCompatLibrary')
    )
    expect(toUserFacingPresetCompatError('import-preset', { error: 'raw diagnostic' }, locale)).toBe(
      getMessage(locale, 'preset.importPresetFailed')
    )
    expect(toUserFacingPresetCompatError('import-regex', 503, locale)).toBe(
      getMessage(locale, 'preset.importRegexFailed')
    )
    expect(toUserFacingPresetCompatError('delete-save', null, locale)).toBe(
      getMessage(locale, 'preset.deleteAfterSaveFailed')
    )
  })

  it.each(locales)('preserves approved exact preset compatibility mappings in %s', (locale) => {
    expect(toUserFacingPresetCompatError('save', 'revision_mismatch', locale)).toBe(
      getMessage(locale, 'errors.revision_mismatch')
    )
    expect(toUserFacingPresetCompatError('import-preset', 'invalid_import_kind', locale)).toBe(
      getMessage(locale, 'errors.invalid_import_kind')
    )
  })
})
