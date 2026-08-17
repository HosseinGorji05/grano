// Thin promise-friendly wrapper around the `ws` package for the CDP client.
import RawWS from "ws";

export class WebSocket {
  constructor(url) {
    this.sock = new RawWS(url, { maxPayload: 512 * 1024 * 1024 });
    this.ready = new Promise((resolve, reject) => {
      this.sock.once("open", resolve);
      this.sock.once("error", reject);
    });
  }

  onMessage(fn) {
    this.sock.on("message", (data) => fn(data.toString()));
  }

  send(payload) {
    this.sock.send(payload);
  }

  close() {
    this.sock.close();
  }
}
