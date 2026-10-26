export interface DevRelay {
  /** ws:// URL of the relay. */
  url: string
  /** http:// URL of its fake Bitcoin block-height endpoint. */
  heightUrl: string
  /** "Mines" blocks; returns the new height. */
  mine(blocks?: number): number
  close(): Promise<void>
}

export function startDevRelay(options?: { port?: number; blockHeight?: number }): Promise<DevRelay>
