export interface PortDetectionOptions {
  execFileSync?: (
    file: string,
    args: readonly string[],
    options: { stdio: ['ignore', 'pipe', 'ignore'] },
  ) => string | Buffer
}

export function detectListeningPids(port: number, options?: PortDetectionOptions): string[]
export function assertPortAvailable(host: string, port: number, options?: PortDetectionOptions): void
export function assertPortReleased(port: number, options?: PortDetectionOptions): void
