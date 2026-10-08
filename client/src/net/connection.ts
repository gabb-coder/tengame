import type { ClientMessage, GameMode, ServerMessage, WelcomeMessage } from '../../../shared/protocol.ts';

type Listener = (msg: ServerMessage) => void;

/** WebSocket link to the game server's /ws endpoint. */
export class Connection {
  private listeners = new Set<Listener>();
  /** Messages that arrived while nobody was listening (e.g. while the world loads). */
  private backlog: ServerMessage[] = [];
  onClose: () => void = () => {};

  private constructor(private ws: WebSocket) {
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data) as ServerMessage;
      if (this.listeners.size === 0) this.backlog.push(msg);
      for (const l of this.listeners) l(msg);
    });
    ws.addEventListener('close', () => this.onClose());
  }

  /** Connects and joins (or creates, when `room` is omitted) a room. */
  static async join(name: string, room?: string, mode?: GameMode): Promise<{ conn: Connection; welcome: WelcomeMessage }> {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${protocol}://${location.host}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', () => reject(new Error('Could not reach the server')), { once: true });
    });

    const conn = new Connection(ws);
    const welcome = await new Promise<WelcomeMessage>((resolve, reject) => {
      const off = conn.on((msg) => {
        if (msg.type === 'welcome') resolve(msg);
        else if (msg.type === 'error') reject(new Error(msg.message));
        else return;
        off();
      });
      conn.send({ type: 'join', name, room, mode });
    }).catch((err) => {
      ws.close();
      throw err;
    });
    return { conn, welcome };
  }

  /** Adds a listener; the first one also receives anything that arrived before it. */
  on(listener: Listener): () => void {
    this.listeners.add(listener);
    for (const msg of this.backlog.splice(0)) listener(msg);
    return () => this.listeners.delete(listener);
  }

  send(msg: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
