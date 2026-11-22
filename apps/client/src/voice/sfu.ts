import { LocalAudioTrack, Room, RoomEvent, Track, type RemoteParticipant, type RemoteTrack } from 'livekit-client';
import type { RadioChannel } from './radio-fx.js';

/**
 * LiveKit transport (loaded only when the server runs an SFU). The server grants publishing
 * for the length of a transmission and listening while we are on the air; the client only
 * publishes when the grant arrives and plays every subscribed voice through its radio channel.
 */
export class SfuLink {
  private room = new Room({ adaptiveStream: false, dynacast: false });
  private track?: LocalAudioTrack;
  private wantMic = false;
  private els = new Map<string, HTMLAudioElement>();

  constructor(private ctx: AudioContext, private channel: (id: string) => RadioChannel | undefined, private changed: () => void) {}

  async connect(url: string, token: string, mic: MediaStreamTrack): Promise<void> {
    this.room.on(RoomEvent.TrackSubscribed, (t: RemoteTrack, _pub, p: RemoteParticipant) => this.play(t, p));
    this.room.on(RoomEvent.TrackUnsubscribed, (_t, _pub, p: RemoteParticipant) => this.stop(p.identity));
    this.room.on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => this.stop(p.identity));
    // Publishing is allowed only while the server has keyed us up
    this.room.on(RoomEvent.ParticipantPermissionsChanged, () => void this.sync());
    this.room.on(RoomEvent.ConnectionStateChanged, () => this.changed());
    // The URL may be relative to the game server (proxied there)
    const abs = url.startsWith('/') ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${url}` : url;
    await this.room.connect(abs, token, { autoSubscribe: true });
    this.track = new LocalAudioTrack(mic, undefined, false);
  }

  private play(t: RemoteTrack, p: RemoteParticipant): void {
    if (t.kind !== Track.Kind.Audio) return;
    const stream = new MediaStream([t.mediaStreamTrack]);
    const el = document.createElement('audio');
    el.muted = true;
    el.srcObject = stream;
    void el.play().catch(() => undefined);
    this.els.set(p.identity, el);
    const ch = this.channel(p.identity);
    if (ch) this.ctx.createMediaStreamSource(stream).connect(ch.input);
    this.changed();
  }

  private stop(id: string): void {
    const el = this.els.get(id);
    if (el) el.srcObject = null;
    this.els.delete(id);
    this.changed();
  }

  connected(id: string): boolean {
    return [...this.room.remoteParticipants.values()].some((p) => p.identity === id);
  }

  async setMic(on: boolean): Promise<void> {
    this.wantMic = on;
    await this.sync();
  }

  private async sync(): Promise<void> {
    const lp = this.room.localParticipant;
    const may = !!lp.permissions?.canPublish;
    const pub = this.track ? lp.getTrackPublication(Track.Source.Microphone) : undefined;
    try {
      if (this.wantMic && may && this.track && !pub) await lp.publishTrack(this.track, { source: Track.Source.Microphone, dtx: true, red: false });
      else if ((!this.wantMic || !may) && pub?.track) await lp.unpublishTrack(pub.track, false);
    } catch {
      /* the next grant or release tries again */
    }
  }

  async close(): Promise<void> {
    for (const id of [...this.els.keys()]) this.stop(id);
    await this.room.disconnect();
  }
}
