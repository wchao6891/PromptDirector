import { EMBED_PLAYER_RESPONSE_TIMEOUT_MS } from './media-playback.js';

// Packet timestamps use the WebCodecs microsecond time base, never a guessed fps.
const TICK = 1 / 1_000_000;
const METADATA = { metadataOnly: true };

export async function adjacentVideoPacket(sink, position, direction, duration = Infinity) {
  const lastPosition = Math.max(0, duration - TICK);
  const current = await sink.getPacket(Math.min(position, lastPosition), METADATA) || await sink.getFirstPacket(METADATA);
  if (!current) throw new Error('无法读取视频帧时间');
  const before = packet => sink.getPacket(packet.timestamp - TICK, METADATA);
  if (direction < 0) return await before(current) || current;
  let candidate = await sink.getPacket(current.timestamp + Math.max(current.duration, TICK), METADATA);
  // A zero-duration trailing packet at the media endpoint is not displayed.
  if (!candidate || candidate.timestamp <= current.timestamp || candidate.timestamp >= duration) candidate = await sink.getPacket(lastPosition, METADATA);
  if (!candidate || candidate.timestamp <= current.timestamp) return current;
  // Presentation order matters for B-frames. Sparse metadata queries also cover
  // variable frame durations and gaps without walking or decoding the whole file.
  let lower = current.timestamp;
  for (;;) {
    const previous = await before(candidate);
    if (!previous || previous.timestamp <= current.timestamp) return candidate;
    const midpoint = (lower + candidate.timestamp) / 2;
    if (midpoint === lower || midpoint === candidate.timestamp) throw new Error('无法定位相邻视频帧');
    const packet = await sink.getPacket(midpoint, METADATA);
    if (packet && packet.timestamp > current.timestamp) candidate = packet;
    else lower = midpoint;
  }
}

export function createVideoFrameStepper(player, { prepare, current = () => player.isConnected }) {
  let session = null, queue = Promise.resolve(), disposed = false, generation = 0;
  const assertCurrent = () => {
    if (disposed || !current()) throw new Error('逐帧期间媒体已切换');
  };
  async function open() {
    if (!session) {
      const state = { reader: null }; session = state;
      state.loading = (async () => {
        const blob = await player.getPlaybackBlob?.();
        if (!blob) throw new Error('此播放器无法读取原视频帧，请使用本地原件');
        const { Input, BlobSource, ALL_FORMATS, EncodedPacketSink } = await import('./video-frame-runtime.js');
        assertCurrent();
        if (session !== state) throw new Error('读取视频帧超时，请重试');
        state.reader = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
        const track = await state.reader.getPrimaryVideoTrack();
        assertCurrent();
        if (session !== state) throw new Error('读取视频帧超时，请重试');
        if (!track) throw new Error('无法读取视频帧时间');
        return new EncodedPacketSink(track);
      })().catch(error => { state.reader?.dispose(); if (session === state) session = null; throw error; });
    }
    return session.loading;
  }
  function step(direction) {
    player.pause();
    const ticket = generation;
    const check = () => {
      assertCurrent();
      if (ticket !== generation) throw new DOMException('视频位置已变化，请重新逐帧', 'AbortError');
    };
    const operation = queue.then(async () => {
      check();
      await prepare(); check();
      await waitForMetadata(player); check();
      const source = player.currentSrc, position = player.currentTime;
      let timeout;
      try {
        const target = await Promise.race([
          open().then(async sink => {
            check();
            // Live-recorded WebM can report an unknown (infinite) duration; the
            // final frame then ends at its own packet interval.
            const duration = Number.isFinite(player.duration) ? player.duration : Infinity;
            const packet = await adjacentVideoPacket(sink, position, direction, duration);
            check();
            const next = await adjacentVideoPacket(sink, packet.timestamp + TICK, 1, duration);
            const end = next.timestamp > packet.timestamp ? Math.min(next.timestamp, duration)
              : Number.isFinite(duration) ? duration : packet.timestamp + Math.max(packet.duration, TICK);
            // Chromium can display the predecessor at an exact VFR boundary.
            // The midpoint of the actual display interval selects this frame
            // without guessing a frame rate or skipping into a following frame.
            return Math.max(0, (packet.timestamp + end) / 2);
          }),
          new Promise((_, reject) => { timeout = setTimeout(() => {
            session?.reader?.dispose(); session = null;
            reject(new Error('读取视频帧超时，请重试'));
          }, EMBED_PLAYER_RESPONSE_TIMEOUT_MS); })
        ]);
        check();
        if (!player.paused || player.currentSrc !== source || player.currentTime !== position) throw new Error('视频位置已变化，请重新逐帧');
        await seekVideoFrame(player, target, check);
      } finally { clearTimeout(timeout); }
    });
    queue = operation.catch(() => {});
    return operation;
  }
  const cancel = () => { generation++; };
  const onPlay = () => { if (!player.paused) cancel(); };
  player.addEventListener('play', onPlay);
  return { step, cancel, destroy() { disposed = true; cancel(); player.removeEventListener('play', onPlay); session?.reader?.dispose(); session = null; } };
}

function waitForMetadata(player) {
  if (player.readyState >= 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timer); player.removeEventListener('loadedmetadata', onReady); player.removeEventListener('error', onError);
      error ? reject(error) : resolve();
    };
    const onReady = () => finish();
    const onError = () => finish(new Error('视频帧无法加载'));
    const timer = setTimeout(() => finish(new Error('读取视频帧超时，请重试')), EMBED_PLAYER_RESPONSE_TIMEOUT_MS);
    player.addEventListener('loadedmetadata', onReady); player.addEventListener('error', onError);
    player.load();
  });
}

function seekVideoFrame(player, target, assertCurrent) {
  if (player.currentTime === target) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timer); player.removeEventListener('seeked', onSeeked); player.removeEventListener('error', onError);
      error ? reject(error) : resolve();
    };
    const onSeeked = () => { try { assertCurrent(); finish(); } catch (error) { finish(error); } };
    const onError = () => finish(new Error('视频帧无法加载'));
    const timer = setTimeout(() => finish(new Error('视频帧定位超时，请重试')), EMBED_PLAYER_RESPONSE_TIMEOUT_MS);
    player.addEventListener('seeked', onSeeked); player.addEventListener('error', onError);
    try { player.currentTime = target; } catch (error) { finish(error); }
  });
}
