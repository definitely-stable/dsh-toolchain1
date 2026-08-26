export interface Sha256Port {
  sha256Utf8(value: string): Promise<string>
}
