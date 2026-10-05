import { feedbackIcon, reviewTime } from './review-feedback.js';
import { setUiIcon } from './ui-icons.js';

// A shared, visible timeline: the selected segment belongs to the actual
// playback duration, rather than to a browser-specific native control layout.
export function installReviewPlayerControls(player, { range, review, t = value => value, failed }) {
  if (player.reviewTransport) return player.reviewTransport;
  const surface = player.closest('.detail-video-surface') || player.parentElement;
  const controls = document.createElement('div'); controls.className = 'review-transport';
  const track = document.createElement('div'); track.className = 'review-timeline';
  const selection = document.createElement('span'); selection.className = 'review-timeline-selection'; selection.hidden = true;
  const markers = ['入点', '出点'].map((label, index) => {
    const marker = document.createElement('span'); marker.className = `review-timeline-mark mark-${index ? 'out' : 'in'}`;
    marker.dataset.reviewMark = index ? 'out' : 'in'; marker.setAttribute('aria-label', t(label)); marker.hidden = true; return marker;
  });
  const seek = document.createElement('input'); seek.type = 'range'; seek.min = '0'; seek.max = '0'; seek.step = '1'; seek.value = '0'; seek.disabled = true; seek.setAttribute('aria-label', t('播放进度'));
  track.append(selection, ...markers, seek);
  const row = document.createElement('div'); row.className = 'review-transport-row';
  const play = feedbackIcon('播放 / 暂停', 'play', t);
  const clock = document.createElement('span'); clock.className = 'review-playback-clock';
  const mute = feedbackIcon('静音', 'volume-2', t);
  const reviewButton = feedbackIcon('审片', 'clapperboard', t); row.append(play, clock, mute, reviewButton); controls.append(track, row);
  let playIcon = 'play', muteIcon = 'volume-2';
  surface.classList.add('has-review-transport'); surface.append(controls);
  player.dataset.reviewTransport = 'true'; player.controls = false; player.draggable = false;
  const ready = async () => { await player.preparePlayback?.(); player.preload = 'metadata'; };
  play.addEventListener('click', async () => {
    try { if (player.paused) { await ready(); await player.play(); } else player.pause(); }
    catch (error) { failed(error); }
  });
  player.addEventListener('click', () => play.click());
  seek.addEventListener('input', () => { player.currentTime = Number(seek.value) / 1000; update(); });
  mute.addEventListener('click', () => { player.muted = !player.muted; update(); });
  reviewButton.hidden = Boolean(player.closest('#temporary-review-dialog'));
  reviewButton.addEventListener('click', () => { void Promise.resolve().then(review).catch(failed); });
  for (const type of ['pointerdown', 'click', 'keydown', 'dragstart']) controls.addEventListener(type, event => event.stopPropagation());
  function update() {
    const reviewing = Boolean(player.closest('#detail-drawer.is-reviewing'));
    const reviewLabel = t(reviewing ? '退出审片' : '审片');
    reviewButton.title = reviewLabel; reviewButton.setAttribute('aria-label', reviewLabel);
    reviewButton.setAttribute('aria-pressed', String(reviewing));
    controls.hidden = player.readyState < 1 || Boolean(player.error);
    const duration = Number.isFinite(player.duration) ? player.duration * 1000 : 0;
    seek.disabled = !duration; seek.max = String(duration); seek.value = String(player.currentTime * 1000);
    seek.setAttribute('aria-valuetext', `${reviewTime(player.currentTime * 1000)} / ${reviewTime(duration)}`);
    const time = `${reviewTime(player.currentTime * 1000)} / ${reviewTime(duration)}`;
    if (clock.textContent !== time) clock.textContent = time;
    const nextPlayIcon = player.paused ? 'play' : 'pause', nextMuteIcon = player.muted ? 'volume-x' : 'volume-2';
    if (playIcon !== nextPlayIcon) { setUiIcon(play, nextPlayIcon); playIcon = nextPlayIcon; }
    if (muteIcon !== nextMuteIcon) { setUiIcon(mute, nextMuteIcon); muteIcon = nextMuteIcon; }
    mute.setAttribute('aria-pressed', String(player.muted));
    const points = range();
    for (const [index, marker] of markers.entries()) {
      const value = index ? points.endMs : points.startMs;
      marker.hidden = value === null || value === undefined || !duration;
      if (!marker.hidden) { marker.style.left = `${Math.min(100, value / duration * 100)}%`; marker.title = `${t(index ? '出点' : '入点')} · ${reviewTime(value)}`; }
    }
    selection.hidden = !duration || points.startMs === null || points.endMs === null || points.endMs <= points.startMs;
    if (!selection.hidden) { selection.style.left = `${points.startMs / duration * 100}%`; selection.style.width = `${(points.endMs - points.startMs) / duration * 100}%`; }
    seek.style.setProperty('--played', `${duration ? player.currentTime * 1000 / duration * 100 : 0}%`);
  }
  for (const type of ['loadedmetadata', 'durationchange', 'timeupdate', 'seeked', 'play', 'pause', 'ended', 'volumechange', 'error']) player.addEventListener(type, update);
  update();
  player.reviewTransport = { update, play, mute, review: reviewButton }; return player.reviewTransport;
}
