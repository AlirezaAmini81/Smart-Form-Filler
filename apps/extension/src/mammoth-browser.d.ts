declare module 'mammoth/mammoth.browser' {
  export type MammothMessage = {
    type: 'warning' | 'error'
    message: string
    error?: unknown
  }

  export type MammothResult = {
    value: string
    messages: MammothMessage[]
  }

  const mammoth: {
    extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<MammothResult>
  }

  export default mammoth
}
