// SSE framing is shared; each caller owns its model completion and tool rules.
// https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream
export async function* readEventStream(response, { signal } = {}) {
  signal?.throwIfAborted();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const abort = () => { void reader.cancel(signal.reason).catch(() => undefined); };
  signal?.addEventListener("abort", abort, { once: true });
  let buffer = "";
  let data = [];
  let skipLf = false;
  let ended = false;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      ended = done;
      let chunk = decoder.decode(value, { stream: !done });
      if (skipLf && chunk.length) {
        if (chunk.startsWith("\n")) chunk = chunk.slice(1);
        skipLf = false;
      }
      buffer += chunk;
      // Compatible providers may close after a complete final payload. Callers
      // still validate JSON and require their own explicit completion state.
      if (done) buffer += "\n\n";
      const newline = /\r\n|\r|\n/g;
      let start = 0;
      for (let match; (match = newline.exec(buffer));) {
        const line = buffer.slice(start, match.index);
        start = newline.lastIndex;
        skipLf = match[0] === "\r" && start === buffer.length;
        if (line === "") {
          if (data.length) {
            const event = data.join("\n");
            data = [];
            yield event;
          }
        } else {
          const colon = line.indexOf(":");
          const field = colon < 0 ? line : line.slice(0, colon);
          if (field !== "data") continue;
          const value = colon < 0 ? "" : line.slice(colon + 1);
          data.push(value.startsWith(" ") ? value.slice(1) : value);
        }
      }
      buffer = buffer.slice(start);
      if (done) break;
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    if (!ended) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
