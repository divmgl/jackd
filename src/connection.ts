import { Socket } from "net"
import EventEmitter from "events"
import { DELIMITER } from "./constants"
import { JackdError, JackdErrorCode } from "./errors"
import { findIndex } from "./commands"

interface ConnectionOptions {
  host?: string
  port?: number
  autoReconnect?: boolean
  initialReconnectDelay?: number
  maxReconnectDelay?: number
  maxReconnectAttempts?: number
}

/**
 * Handles low-level socket communication with beanstalkd
 */
export class BeanstalkdConnection extends EventEmitter {
  public socket: Socket = this.createSocket()
  public connected: boolean = false

  private buffer: Uint8Array = new Uint8Array()
  private chunkLength: number = 0
  private host: string
  private port: number
  private autoReconnect: boolean
  private initialReconnectDelay: number
  private maxReconnectDelay: number
  private maxReconnectAttempts: number
  private reconnectAttempts: number = 0
  private currentReconnectDelay: number
  private reconnectTimeout?: ReturnType<typeof setTimeout>
  private isReconnecting: boolean = false

  // Queue of incoming messages
  private messages: Uint8Array[] = []

  constructor({
    host = "localhost",
    port = 11300,
    autoReconnect = true,
    initialReconnectDelay = 1000,
    maxReconnectDelay = 30000,
    maxReconnectAttempts = 0
  }: ConnectionOptions = {}) {
    super()
    this.host = host
    this.port = port
    this.autoReconnect = autoReconnect
    this.initialReconnectDelay = initialReconnectDelay
    this.maxReconnectDelay = maxReconnectDelay
    this.maxReconnectAttempts = maxReconnectAttempts
    this.currentReconnectDelay = initialReconnectDelay
  }

  private createSocket() {
    const socket = new Socket()
    socket.setKeepAlive(true)
    this.setupSocketListeners()
    return socket
  }

  private setupSocketListeners() {
    this.socket.on("ready", () => {
      this.connected = true
      this.reconnectAttempts = 0
      this.currentReconnectDelay = this.initialReconnectDelay
      this.emit("connected")
    })

    this.socket.on("close", () => {
      if (this.connected) this.handleDisconnect()
    })

    this.socket.on("end", () => {
      if (this.connected) this.handleDisconnect()
    })

    this.socket.on("error", (error: Error) => {
      this.emit("error", error)
      if (this.connected) this.handleDisconnect()
    })

    this.socket.on("data", incoming => {
      // Write the incoming data onto the buffer
      const newBuffer = new Uint8Array(this.buffer.length + incoming.length)
      newBuffer.set(this.buffer)
      newBuffer.set(new Uint8Array(incoming), this.buffer.length)
      this.buffer = newBuffer
      void this.processChunk(this.buffer)
    })
  }

  private handleDisconnect() {
    this.connected = false
    this.emit("disconnected")

    // Clear any buffered messages
    this.messages = []
    this.buffer = new Uint8Array()
    this.chunkLength = 0

    if (this.autoReconnect && !this.isReconnecting) {
      void this.attemptReconnect()
    }
  }

  private attemptReconnect() {
    if (
      this.maxReconnectAttempts > 0 &&
      this.reconnectAttempts >= this.maxReconnectAttempts
    ) {
      this.emit("error", new Error("Max reconnection attempts reached"))
      return
    }

    this.isReconnecting = true
    this.reconnectAttempts++

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
    }

    this.reconnectTimeout = setTimeout(() => {
      void (async () => {
        try {
          this.socket.removeAllListeners()
          this.socket = this.createSocket()
          await this.connect()
          this.isReconnecting = false
        } catch (error) {
          this.emit("error", error)
          this.currentReconnectDelay = Math.min(
            this.currentReconnectDelay * 2,
            this.maxReconnectDelay
          )
          this.isReconnecting = false
          void this.attemptReconnect()
        }
      })()
    }, this.currentReconnectDelay)
  }

  private async processChunk(head: Uint8Array) {
    let index = -1

    if (this.chunkLength > 0) {
      const remainingBytes = this.chunkLength - head.length
      if (remainingBytes > -DELIMITER.length) {
        return
      }
      index = head.length - DELIMITER.length
      this.chunkLength = 0
    } else {
      const delimiterBytes = new TextEncoder().encode(DELIMITER)
      index = findIndex(head, delimiterBytes)
    }

    if (index > -1) {
      this.messages.push(head.slice(0, index))
      this.emit("message", this.messages[this.messages.length - 1])

      const tail = head.slice(index + DELIMITER.length)
      this.buffer = tail
      await this.processChunk(tail)
    }
  }

  async connect(): Promise<void> {
    if (this.connected) return

    await new Promise<void>((resolve, reject) => {
      this.socket.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EISCONN") {
          return resolve()
        }
        reject(error)
      })

      this.socket.connect(this.port, this.host, resolve)
    })
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.connected) {
      throw new JackdError(JackdErrorCode.NOT_CONNECTED)
    }

    return new Promise<void>((resolve, reject) => {
      this.socket.write(data, err => (err ? reject(err) : resolve()))
    })
  }

  async close(): Promise<void> {
    if (!this.connected) return

    const waitForClose = new Promise<void>((resolve, reject) => {
      this.socket.once("close", resolve)
      this.socket.once("error", reject)
    })

    this.socket.end(new TextEncoder().encode("quit\r\n"))
    await waitForClose
  }

  isConnected(): boolean {
    return this.connected
  }
}
